import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { config } from '../../config';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { upsertPullRequest, markNotified } from '../../services/pr.service';
import { upsertReviewRequest, getSlackUserForGithub } from '../../services/reviewer.service';
import { notifyReviewer } from '../../services/notification.service';

export const githubRouter = Router();

/**
 * Verifies the GitHub webhook signature (HMAC SHA-256).
 */
function verifySignature(payload: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', config.github.webhookSecret)
    .update(payload)
    .digest('hex')}`;
  
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * POST /webhooks/github — GitHub webhook entrypoint.
 */
githubRouter.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const event = req.headers['x-github-event'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  // Verify webhook signature
  if (!rawBody || !verifySignature(rawBody, signature)) {
    logger.warn('Invalid GitHub webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  logger.info(`GitHub webhook received: ${event}`, {
    action: req.body.action,
  });

  try {
    switch (event) {
      case 'pull_request':
        await handlePullRequestEvent(req.body);
        break;
      case 'pull_request_review':
        await handlePullRequestReviewEvent(req.body);
        break;
      default:
        logger.debug(`Unhandled GitHub event: ${event}`);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Error handling GitHub webhook', { error, event });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Handles pull_request webhook events.
 */
async function handlePullRequestEvent(payload: any): Promise<void> {
  const { action, pull_request: pr, repository, installation } = payload;

  // Find or create repository
  const repo = await prisma.repository.upsert({
    where: { githubRepoId: repository.id },
    create: {
      githubRepoId: repository.id,
      fullName: repository.full_name,
      installationId: await getOrCreateInstallation(installation?.id),
    },
    update: {},
  });

  // Map GitHub PR state to our enum
  const state = pr.merged
    ? 'MERGED'
    : pr.state === 'closed'
      ? 'CLOSED'
      : 'OPEN';

  const savedPr = await upsertPullRequest({
    repositoryId: repo.id,
    githubPrNumber: pr.number,
    title: pr.title,
    authorGithubLogin: pr.user.login,
    state,
    changedFilesCount: pr.changed_files || 0,
    labels: (pr.labels || []).map((l: any) => l.name),
    htmlUrl: pr.html_url,
    isDraft: pr.draft || false,
    openedAt: new Date(pr.created_at),
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
  });

  // Handle review_requested action — notify the reviewer
  if (action === 'review_requested' && pr.requested_reviewers) {
    for (const reviewer of pr.requested_reviewers) {
      await upsertReviewRequest({
        pullRequestId: savedPr.id,
        reviewerGithubLogin: reviewer.login,
      });

      // Try to DM the reviewer if they have a Slack mapping
      const installationRecord = await prisma.repository.findUnique({
        where: { id: repo.id },
        select: { installationId: true },
      });

      if (installationRecord) {
        const slackUserId = await getSlackUserForGithub(
          installationRecord.installationId,
          reviewer.login
        );
        if (slackUserId) {
          await notifyReviewer(slackUserId, savedPr, pr.user.login);
          await markNotified(savedPr.id);
        }
      }
    }
  }
}

/**
 * Handles pull_request_review webhook events.
 */
async function handlePullRequestReviewEvent(payload: any): Promise<void> {
  const { review, pull_request: pr } = payload;

  const existingPr = await prisma.pullRequest.findFirst({
    where: {
      githubPrNumber: pr.number,
      repository: { githubRepoId: payload.repository.id },
    },
  });

  if (!existingPr) {
    logger.warn(`PR #${pr.number} not found for review event`);
    return;
  }

  // Map GitHub review state
  const statusMap: Record<string, 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'> = {
    approved: 'APPROVED',
    changes_requested: 'CHANGES_REQUESTED',
    commented: 'COMMENTED',
    dismissed: 'DISMISSED',
  };

  const status = statusMap[review.state] || 'COMMENTED';

  await upsertReviewRequest({
    pullRequestId: existingPr.id,
    reviewerGithubLogin: review.user.login,
    status,
  });
}

/**
 * Helper to get or create an installation record.
 * For the MVP, creates a placeholder if no installation exists.
 */
async function getOrCreateInstallation(githubInstallationId?: number): Promise<string> {
  if (!githubInstallationId) {
    // Fallback: use a default installation for dev/testing
    const defaultInstall = await prisma.installation.findFirst();
    if (defaultInstall) return defaultInstall.id;

    const created = await prisma.installation.create({
      data: {
        githubInstallationId: 0,
        slackTeamId: 'default',
        slackBotToken: config.slack.botToken || 'xoxb-dummy-token',
      },
    });
    return created.id;
  }

  const install = await prisma.installation.upsert({
    where: { githubInstallationId },
    create: {
      githubInstallationId,
      slackTeamId: 'pending',
      slackBotToken: config.slack.botToken || 'xoxb-dummy-token',
    },
    update: {},
  });

  return install.id;
}
