import { PullRequest, ReviewRequest } from '.prisma/client';

type PullRequestWithReviews = PullRequest & { reviewRequests: ReviewRequest[] };

const PRIORITY_LABELS = ['urgent', 'critical', 'hotfix', 'p0'];
const BLOCKING_LABELS = ['blocks-deployment', 'blocking', 'blocker'];

/**
 * Calculates a priority score for a pull request.
 *
 * Score thresholds:
 *   >= 40  → High priority
 *   >= 20  → Medium priority
 *   < 20   → Normal
 */
export function calculatePriority(pr: PullRequestWithReviews): number {
  let score = 0;

  // Urgent/critical labels
  const lowerLabels = pr.labels.map((l) => l.toLowerCase());
  if (lowerLabels.some((l) => PRIORITY_LABELS.includes(l))) {
    score += 50;
  }

  // Blocking labels
  if (lowerLabels.some((l) => BLOCKING_LABELS.includes(l))) {
    score += 40;
  }

  // Large PRs are harder to review, tend to get delayed
  if (pr.changedFilesCount > 20) {
    score += 10;
  }

  // Waiting time escalation
  const waitingHours = Math.floor((Date.now() - pr.openedAt.getTime()) / (1000 * 60 * 60));
  if (waitingHours > 48) {
    score += 20;
  } else if (waitingHours > 24) {
    score += 10;
  }

  // No reviewers assigned
  if (pr.reviewRequests.length === 0) {
    score += 15;
  }

  return score;
}

/**
 * Returns the priority tier label.
 */
export function getPriorityTier(score: number): 'high' | 'medium' | 'normal' {
  if (score >= 40) return 'high';
  if (score >= 20) return 'medium';
  return 'normal';
}

/**
 * Sorts PRs by priority score (descending).
 */
export function sortByPriority(
  prs: PullRequestWithReviews[]
): (PullRequestWithReviews & { priorityScore: number })[] {
  return prs
    .map((pr) => ({ ...pr, priorityScore: calculatePriority(pr) }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}
