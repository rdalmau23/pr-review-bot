import { prisma } from '../db/client';
import { logger } from '../utils/logger';

/**
 * Upserts a review request when a reviewer is assigned to a PR.
 */
export async function upsertReviewRequest(data: {
  pullRequestId: string;
  reviewerGithubLogin: string;
  status?: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
}): Promise<void> {
  await prisma.reviewRequest.upsert({
    where: {
      pullRequestId_reviewerGithubLogin: {
        pullRequestId: data.pullRequestId,
        reviewerGithubLogin: data.reviewerGithubLogin,
      },
    },
    create: {
      pullRequestId: data.pullRequestId,
      reviewerGithubLogin: data.reviewerGithubLogin,
      status: data.status || 'PENDING',
    },
    update: {
      status: data.status || 'PENDING',
      ...(data.status && data.status !== 'PENDING' ? { completedAt: new Date() } : {}),
    },
  });

  logger.info(`Upserted review request`, {
    pullRequestId: data.pullRequestId,
    reviewer: data.reviewerGithubLogin,
    status: data.status,
  });
}

/**
 * Gets the number of pending reviews per reviewer for a given installation.
 */
export async function getReviewerWorkload(
  installationId: string
): Promise<{ reviewer: string; count: number }[]> {
  const results = await prisma.reviewRequest.groupBy({
    by: ['reviewerGithubLogin'],
    where: {
      status: 'PENDING',
      pullRequest: {
        state: 'OPEN',
        repository: { installationId },
      },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  return results.map((r) => ({
    reviewer: r.reviewerGithubLogin,
    count: r._count.id,
  }));
}

/**
 * Gets the Slack user ID for a GitHub login, if mapped.
 */
export async function getSlackUserForGithub(
  installationId: string,
  githubLogin: string
): Promise<string | null> {
  const mapping = await prisma.userMapping.findUnique({
    where: {
      installationId_githubLogin: {
        installationId,
        githubLogin,
      },
    },
  });

  return mapping?.slackUserId ?? null;
}

/**
 * Links a GitHub login to a Slack user ID.
 */
export async function linkUser(
  installationId: string,
  githubLogin: string,
  slackUserId: string
): Promise<void> {
  await prisma.userMapping.upsert({
    where: {
      installationId_githubLogin: {
        installationId,
        githubLogin,
      },
    },
    create: { installationId, githubLogin, slackUserId },
    update: { slackUserId },
  });

  logger.info(`Linked GitHub user ${githubLogin} to Slack user ${slackUserId}`);
}
