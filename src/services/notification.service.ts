import { PullRequest, ReviewRequest } from '.prisma/client';
import { sendDirectMessage, sendChannelMessage } from '../integrations/slack';
import { formatDuration, hoursAgo } from '../utils/time';
import { getPriorityTier, sortByPriority } from './priority.service';

type PullRequestWithReviews = PullRequest & { reviewRequests: ReviewRequest[] };

/**
 * Sends a DM to a reviewer when they are assigned to a PR.
 */
export async function notifyReviewer(
  token: string,
  slackUserId: string,
  pr: PullRequest,
  authorGithubLogin: string
): Promise<void> {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `👀 *Review Requested*\n\n<${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber})\nby *${authorGithubLogin}* • ${pr.changedFilesCount} files changed`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔗 Open PR', emoji: true },
          url: pr.htmlUrl,
          action_id: 'open_pr',
        },
      ],
    },
  ];

  await sendDirectMessage(
    token,
    slackUserId,
    blocks,
    `Review requested: ${pr.title} (#${pr.githubPrNumber})`
  );
}

/**
 * Sends a stale PR alert to a Slack channel.
 */
export async function notifyStalePR(token: string, channelId: string, pr: PullRequest): Promise<void> {
  const waiting = formatDuration(hoursAgo(pr.openedAt));

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⏰ *PR Waiting for Review — ${waiting}*\n\n<${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber})\nby *${pr.authorGithubLogin}* • ${pr.changedFilesCount} files changed`,
      },
    },
  ];

  await sendChannelMessage(token, channelId, blocks, `PR waiting for review (${waiting}): ${pr.title}`);
}

/**
 * Builds and sends a daily digest message to a Slack channel.
 */
export async function sendDigest(
  token: string,
  channelId: string,
  prs: PullRequestWithReviews[],
  workload: { reviewer: string; count: number }[]
): Promise<void> {
  if (prs.length === 0 && workload.length === 0) {
    return; // Nothing to report
  }

  const sorted = sortByPriority(prs);
  const highPriority = sorted.filter((pr) => getPriorityTier(pr.priorityScore) === 'high');
  const stale = sorted.filter(
    (pr) => hoursAgo(pr.openedAt) > 24 && getPriorityTier(pr.priorityScore) !== 'high'
  );
  const normal = sorted.filter(
    (pr) => getPriorityTier(pr.priorityScore) !== 'high' && hoursAgo(pr.openedAt) <= 24
  );

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📋 PR Review Digest', emoji: true },
    },
  ];

  // High priority section
  if (highPriority.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '🔴 *High Priority*\n' +
          highPriority
            .map(
              (pr) =>
                `• <${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber}) — ${pr.labels.join(', ') || 'high score'}`
            )
            .join('\n'),
      },
    });
  }

  // Stale PRs section
  if (stale.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '⏰ *Waiting > 24h*\n' +
          stale
            .map(
              (pr) =>
                `• <${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber}) — opened ${formatDuration(hoursAgo(pr.openedAt))} ago`
            )
            .join('\n'),
      },
    });
  }

  // Normal PRs section
  if (normal.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '📝 *Open PRs*\n' +
          normal
            .map(
              (pr) =>
                `• <${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber}) — ${formatDuration(hoursAgo(pr.openedAt))}`
            )
            .join('\n'),
      },
    });
  }

  // Workload section
  if (workload.length > 0) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            '⚖️ *Reviewer Workload*\n' +
            workload
              .map((w) => `• *${w.reviewer}*: ${w.count} review${w.count > 1 ? 's' : ''} pending`)
              .join('\n'),
        },
      }
    );
  }

  // Summary footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${prs.length} open PR${prs.length !== 1 ? 's' : ''} total`,
      },
    ],
  });

  await sendChannelMessage(token, channelId, blocks, `PR Review Digest: ${prs.length} open PRs`);
}
