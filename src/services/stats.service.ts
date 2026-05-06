import { prisma } from '../db/client';

export interface ReviewerStats {
  reviewer: string;
  count: number;
}

export interface ReviewerSpeedStats {
  reviewer: string;
  avgHours: number;
}

/**
 * Returns the top 3 reviewers with the most completed reviews.
 */
export async function getMostActiveReviewers(installationId: string): Promise<ReviewerStats[]> {
  const results = await prisma.reviewRequest.groupBy({
    by: ['reviewerGithubLogin'],
    where: {
      status: { not: 'PENDING' },
      pullRequest: {
        repository: { installationId },
      },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 3,
  });

  return results.map((r: any) => ({
    reviewer: r.reviewerGithubLogin,
    count: r._count.id,
  }));
}

/**
 * Returns the top 3 fastest reviewers (lowest average time between requested and completed).
 */
export async function getFastestReviewers(installationId: string): Promise<ReviewerSpeedStats[]> {
  const reviews = await prisma.reviewRequest.findMany({
    where: {
      status: { not: 'PENDING' },
      completedAt: { not: null },
      pullRequest: {
        repository: { installationId },
      },
    },
    select: {
      reviewerGithubLogin: true,
      requestedAt: true,
      completedAt: true,
    },
  });

  const statsMap = new Map<string, { totalHours: number; count: number }>();

  for (const review of reviews) {
    if (!review.completedAt) continue;

    const diffMs = review.completedAt.getTime() - review.requestedAt.getTime();
    // Ignore negative times (data anomalies) or super fast automatic reviews (< 1 minute)
    if (diffMs < 60000) continue;

    const diffHours = diffMs / (1000 * 60 * 60);

    const current = statsMap.get(review.reviewerGithubLogin) || { totalHours: 0, count: 0 };
    statsMap.set(review.reviewerGithubLogin, {
      totalHours: current.totalHours + diffHours,
      count: current.count + 1,
    });
  }

  const speedStats: ReviewerSpeedStats[] = [];
  for (const [reviewer, data] of statsMap.entries()) {
    speedStats.push({
      reviewer,
      avgHours: data.totalHours / data.count,
    });
  }

  // Sort by lowest average time
  return speedStats.sort((a, b) => a.avgHours - b.avgHours).slice(0, 3);
}

/**
 * Calculates the team's average time to merge (in hours).
 */
export async function getAverageTimeToMerge(installationId: string): Promise<number | null> {
  const prs = await prisma.pullRequest.findMany({
    where: {
      state: 'MERGED',
      closedAt: { not: null },
      repository: { installationId },
    },
    select: {
      openedAt: true,
      closedAt: true,
    },
  });

  if (prs.length === 0) return null;

  let totalMs = 0;
  for (const pr of prs) {
    if (pr.closedAt) {
      totalMs += pr.closedAt.getTime() - pr.openedAt.getTime();
    }
  }

  return totalMs / prs.length / (1000 * 60 * 60);
}
