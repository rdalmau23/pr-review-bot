import { slackApp } from '../../integrations/slack';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { linkUser, getReviewerWorkload } from '../../services/reviewer.service';
import { getOpenPullRequests } from '../../services/pr.service';
import { sendDigest } from '../../services/notification.service';
import { formatDuration, hoursAgo } from '../../utils/time';
import type { ReviewRequest, PullRequest } from '.prisma/client';

/**
 * Registers all Slack slash command and interaction handlers.
 */
export function registerSlackHandlers(): void {
  // ────────────────────────────────────────────
  // /prbot command handler
  // ────────────────────────────────────────────
  slackApp.command('/prbot', async ({ command, ack, respond }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case 'status':
          await handleStatus(command, respond);
          break;
        case 'digest':
          await handleDigest(command, respond);
          break;
        case 'link':
          await handleLink(command, args, respond);
          break;
        case 'config':
          await handleConfig(command, args, respond);
          break;
        case 'help':
        default:
          await handleHelp(respond);
          break;
      }
    } catch (error) {
      logger.error('Error handling /prbot command', { error, subcommand });
      await respond({
        text: '❌ Something went wrong. Please try again.',
        response_type: 'ephemeral',
      });
    }
  });
}

/**
 * /prbot status — Show the user's pending reviews.
 */
async function handleStatus(command: any, respond: any): Promise<void> {
  const slackUserId = command.user_id;

  // Find user mapping
  const mapping = await prisma.userMapping.findFirst({
    where: { slackUserId },
  });

  if (!mapping) {
    await respond({
      text: '⚠️ Your GitHub account is not linked. Use `/prbot link <github-username>` first.',
      response_type: 'ephemeral',
    });
    return;
  }

  // Find pending reviews
  const pendingReviews = await prisma.reviewRequest.findMany({
    where: {
      reviewerGithubLogin: mapping.githubLogin,
      status: 'PENDING',
      pullRequest: { state: 'OPEN' },
    },
    include: {
      pullRequest: true,
    },
    orderBy: { requestedAt: 'asc' },
  });

  if (pendingReviews.length === 0) {
    await respond({
      text: '✅ You have no pending reviews. Nice!',
      response_type: 'ephemeral',
    });
    return;
  }

  const reviewList = pendingReviews
    .map((r: ReviewRequest & { pullRequest: PullRequest }) => {
      const age = formatDuration(hoursAgo(r.requestedAt));
      return `• <${r.pullRequest.htmlUrl}|${r.pullRequest.title}> (#${r.pullRequest.githubPrNumber}) — waiting ${age}`;
    })
    .join('\n');

  await respond({
    text: `📋 *Your Pending Reviews (${pendingReviews.length})*\n\n${reviewList}`,
    response_type: 'ephemeral',
  });
}

/**
 * /prbot digest — Trigger an on-demand digest.
 */
async function handleDigest(command: any, respond: any): Promise<void> {
  const installation = await prisma.installation.findFirst({
    where: { slackTeamId: command.team_id },
  });

  if (!installation) {
    await respond({
      text: '⚠️ Bot is not configured for this workspace yet.',
      response_type: 'ephemeral',
    });
    return;
  }

  const prs = await getOpenPullRequests();
  const workload = await getReviewerWorkload(installation.id);

  await sendDigest(command.channel_id, prs, workload);

  await respond({
    text: '📋 Digest posted to this channel.',
    response_type: 'ephemeral',
  });
}

/**
 * /prbot link <github-username> — Link GitHub to Slack identity.
 */
async function handleLink(command: any, args: string[], respond: any): Promise<void> {
  const githubLogin = args[1];
  if (!githubLogin) {
    await respond({
      text: '⚠️ Usage: `/prbot link <github-username>`',
      response_type: 'ephemeral',
    });
    return;
  }

  const installation = await prisma.installation.findFirst({
    where: { slackTeamId: command.team_id },
  });

  if (!installation) {
    await respond({
      text: '⚠️ Bot is not configured for this workspace yet.',
      response_type: 'ephemeral',
    });
    return;
  }

  await linkUser(installation.id, githubLogin, command.user_id);

  await respond({
    text: `✅ Linked GitHub user *${githubLogin}* to your Slack account.`,
    response_type: 'ephemeral',
  });
}

/**
 * /prbot config <key> <value> — Update team configuration.
 */
async function handleConfig(command: any, args: string[], respond: any): Promise<void> {
  const key = args[1]?.toLowerCase();
  const value = args.slice(2).join(' ');

  if (!key || !value) {
    await respond({
      text: '⚠️ Usage:\n• `/prbot config threshold <hours>` — Set stale PR threshold\n• `/prbot config channel <#channel>` — Set digest channel',
      response_type: 'ephemeral',
    });
    return;
  }

  const installation = await prisma.installation.findFirst({
    where: { slackTeamId: command.team_id },
  });

  if (!installation) {
    await respond({
      text: '⚠️ Bot is not configured for this workspace yet.',
      response_type: 'ephemeral',
    });
    return;
  }

  switch (key) {
    case 'threshold': {
      const hours = parseInt(value, 10);
      if (isNaN(hours) || hours < 1) {
        await respond({
          text: '⚠️ Threshold must be a positive number of hours.',
          response_type: 'ephemeral',
        });
        return;
      }
      await prisma.teamConfig.upsert({
        where: {
          installationId_slackChannelId: {
            installationId: installation.id,
            slackChannelId: command.channel_id,
          },
        },
        create: {
          installationId: installation.id,
          slackChannelId: command.channel_id,
          staleThresholdHours: hours,
        },
        update: { staleThresholdHours: hours },
      });
      await respond({
        text: `✅ Stale PR threshold set to *${hours} hours*.`,
        response_type: 'ephemeral',
      });
      break;
    }

    case 'channel': {
      // Extract channel ID from Slack mention format <#C12345|channel-name>
      const channelMatch = value.match(/<#([A-Z0-9]+)\|?[^>]*>/);
      const channelId = channelMatch ? channelMatch[1] : value;

      await prisma.teamConfig.upsert({
        where: {
          installationId_slackChannelId: {
            installationId: installation.id,
            slackChannelId: channelId,
          },
        },
        create: {
          installationId: installation.id,
          slackChannelId: channelId,
        },
        update: {},
      });
      await respond({
        text: `✅ Digest channel set to <#${channelId}>.`,
        response_type: 'ephemeral',
      });
      break;
    }

    default:
      await respond({
        text: `⚠️ Unknown config key: *${key}*. Available: \`threshold\`, \`channel\`.`,
        response_type: 'ephemeral',
      });
  }
}

/**
 * /prbot help — Show available commands.
 */
async function handleHelp(respond: any): Promise<void> {
  await respond({
    text: `*PR Review Bot Commands*\n\n• \`/prbot status\` — Show your pending reviews\n• \`/prbot digest\` — Post a digest to this channel\n• \`/prbot link <github-username>\` — Link your GitHub account\n• \`/prbot config threshold <hours>\` — Set stale PR threshold\n• \`/prbot config channel <#channel>\` — Set digest channel\n• \`/prbot help\` — Show this message`,
    response_type: 'ephemeral',
  });
}
