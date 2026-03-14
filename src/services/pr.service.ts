import { PullRequest, ReviewRequest } from '.prisma/client';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';

type PullRequestWithReviews = PullRequest & { reviewRequests: ReviewRequest[] };

/**
 * Upserts a pull request from a GitHub webhook payload.
 */
export async function upsertPullRequest(data: {
  repositoryId: string;
  githubPrNumber: number;
  title: string;
  authorGithubLogin: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  changedFilesCount: number;
  labels: string[];
  htmlUrl: string;
  isDraft: boolean;
  openedAt: Date;
  closedAt?: Date | null;
}): Promise<PullRequest> {
  const pr = await prisma.pullRequest.upsert({
    where: {
      repositoryId_githubPrNumber: {
        repositoryId: data.repositoryId,
        githubPrNumber: data.githubPrNumber,
      },
    },
    create: data,
    update: {
      title: data.title,
      state: data.state,
      changedFilesCount: data.changedFilesCount,
      labels: data.labels,
      isDraft: data.isDraft,
      closedAt: data.closedAt,
    },
  });

  logger.info(`Upserted PR #${data.githubPrNumber}`, { prId: pr.id, state: data.state });
  return pr;
}

/**
 * Returns all open pull requests, optionally filtered by repository.
 */
export async function getOpenPullRequests(
  repositoryId?: string
): Promise<PullRequestWithReviews[]> {
  return prisma.pullRequest.findMany({
    where: {
      state: 'OPEN',
      isDraft: false,
      ...(repositoryId ? { repositoryId } : {}),
    },
    include: { reviewRequests: true },
    orderBy: { openedAt: 'asc' },
  });
}

/**
 * Returns open PRs that have been waiting longer than the threshold.
 */
export async function getStalePullRequests(
  thresholdHours: number,
  installationId?: string
): Promise<PullRequestWithReviews[]> {
  const thresholdDate = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

  return prisma.pullRequest.findMany({
    where: {
      state: 'OPEN',
      isDraft: false,
      openedAt: { lte: thresholdDate },
      ...(installationId
        ? { repository: { installationId } }
        : {}),
    },
    include: { reviewRequests: true },
    orderBy: { openedAt: 'asc' },
  });
}

/**
 * Marks a PR's last notification time to prevent spam.
 */
export async function markNotified(prId: string): Promise<void> {
  await prisma.pullRequest.update({
    where: { id: prId },
    data: { lastNotifiedAt: new Date() },
  });
}
