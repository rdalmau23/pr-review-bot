import { slackApp } from '../../integrations/slack';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { linkUser, getReviewerWorkload, getSlackUserForGithub } from '../../services/reviewer.service';
import { getOpenPullRequests } from '../../services/pr.service';
import { sendDigest } from '../../services/notification.service';
import { formatDuration, hoursAgo } from '../../utils/time';
import { sendDirectMessage } from '../../integrations/slack';
import { getMostActiveReviewers, getFastestReviewers, getAverageTimeToMerge } from '../../services/stats.service';

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
        case 'nudge':
          await handleNudge(command, args, respond);
          break;
        case 'stats':
          await handleStats(command, respond);
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
      });
    }
  });
  // ────────────────────────────────────────────
  // Action handlers
  // ────────────────────────────────────────────
  slackApp.action('nudge_reviewers', async ({ ack, body, action, respond }) => {
    await ack();
    
    // action.value will contain the PR number
    const prNumber = parseInt((action as any).value, 10);
    const slackUserId = body.user.id;

    // Use handleNudge logic internally
    const commandMock = {
      team_id: (body as any).team.id,
      user_id: slackUserId,
    };
    
    const argsMock = ['nudge', prNumber.toString()];
    
    // We need a custom respond for the action context
    const actionRespond = async (msg: any) => {
      await respond({
        ...msg,
        replace_original: false, // Keep the status message
      });
    };

    try {
      await handleNudge(commandMock, argsMock, actionRespond);
    } catch (error) {
      logger.error('Error handling nudge action', { error, prNumber });
    }
  });
}

/**
 * /prbot status — Show the user's pending reviews and their own open PRs.
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

  // 1. Find reviews I owe
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

  // 2. Find my own open PRs
  const myOpenPrs = await prisma.pullRequest.findMany({
    where: {
      authorGithubLogin: mapping.githubLogin,
      state: 'OPEN',
    },
    include: {
      reviewRequests: {
        where: { status: 'PENDING' },
      },
    },
    orderBy: { openedAt: 'desc' },
  });

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📊 PR Bot Status', emoji: true },
    },
  ];

  // Section: Reviews I owe
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📥 Reviews I Owe*' },
  });

  if (pendingReviews.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_You have no pending reviews. Nice!_ ☕' },
    });
  } else {
    pendingReviews.forEach((r: any) => {
      const age = formatDuration(hoursAgo(r.requestedAt));
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• <${r.pullRequest.htmlUrl}|${r.pullRequest.title}> (#${r.pullRequest.githubPrNumber})\n> _Waiting ${age}_`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Review', emoji: true },
          url: r.pullRequest.htmlUrl,
          action_id: 'open_review_url',
        },
      });
    });
  }

  blocks.push({ type: 'divider' });

  // Section: My Open PRs
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📤 My Open PRs*' },
  });

  if (myOpenPrs.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_You have no open PRs._' },
    });
  } else {
    myOpenPrs.forEach((pr: any) => {
      const pendingCount = pr.reviewRequests.length;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• <${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber})\n> _${pendingCount} pending reviewer(s)_`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '👉 Nudge', emoji: true },
          value: pr.githubPrNumber.toString(),
          action_id: 'nudge_reviewers',
          style: pendingCount > 0 ? 'primary' : undefined,
          confirm: pendingCount > 0 ? {
            title: { type: 'plain_text', text: 'Are you sure?' },
            text: { type: 'mrkdwn', text: `This will send a reminder to all ${pendingCount} pending reviewers.` },
            confirm: { type: 'plain_text', text: 'Yes, nudge them' },
            deny: { type: 'plain_text', text: 'Cancel' },
          } : undefined,
        },
      });
    });
  }

  await respond({
    blocks,
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

  if (!installation.slackBotToken) {
    await respond({
      text: '⚠️ Bot is not properly authenticated with Slack.',
      response_type: 'ephemeral',
    });
    return;
  }

  await sendDigest(installation.slackBotToken, command.channel_id, prs, workload);

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
/**
 * /prbot nudge <pr-number> — Send a friendly nudge to pending reviewers.
 */
async function handleNudge(command: any, args: string[], respond: any): Promise<void> {
  const prNumberStr = args[1];
  if (!prNumberStr) {
    await respond({
      text: '⚠️ Usage: `/prbot nudge <pr-number>` (e.g. `/prbot nudge 42`)',
      response_type: 'ephemeral',
    });
    return;
  }

  const prNumber = parseInt(prNumberStr.replace('#', ''), 10);
  if (isNaN(prNumber)) {
    await respond({
      text: '⚠️ Invalid PR number.',
      response_type: 'ephemeral',
    });
    return;
  }

  const installation = await prisma.installation.findFirst({
    where: { slackTeamId: command.team_id },
  });

  if (!installation || !installation.slackBotToken) {
    await respond({
      text: '⚠️ Bot is not configured for this workspace yet.',
      response_type: 'ephemeral',
    });
    return;
  }

  const pr = await prisma.pullRequest.findFirst({
    where: {
      githubPrNumber: prNumber,
      repository: { installationId: installation.id },
      state: 'OPEN',
    },
    include: {
      reviewRequests: {
        where: { status: 'PENDING' },
      },
    },
  });

  if (!pr) {
    await respond({
      text: `⚠️ Open PR #${prNumber} not found.`,
      response_type: 'ephemeral',
    });
    return;
  }

  if (pr.reviewRequests.length === 0) {
    await respond({
      text: `✅ PR #${prNumber} has no pending reviewers to nudge.`,
      response_type: 'ephemeral',
    });
    return;
  }

  const NUDGE_GIFS = [
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHRreXFrZ3R2Yzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyJmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/jc2Mm29DkLCIU/giphy.gif', // Pablo Escobar
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHRreXFrZ3R2Yzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyJmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/GrUhLU9q3nyRG/giphy.gif', // Old man
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHRreXFrZ3R2Yzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyJmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/26n6WywWKAO8rYn9m/giphy.gif', // Eyes
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHRreXFrZ3R2Yzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyYzh0Y2RreHlyJmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/3o7TKMGpxx6rZfXo5W/giphy.gif', // Waiting cat
  ];

  let nudgedCount = 0;
  for (const reviewRequest of pr.reviewRequests) {
    const slackUserId = await getSlackUserForGithub(
      installation.id,
      reviewRequest.reviewerGithubLogin
    );

    if (slackUserId) {
      const randomGif = NUDGE_GIFS[Math.floor(Math.random() * NUDGE_GIFS.length)];
      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `👋 *Friendly Nudge!*\n\n<@${command.user_id}> gently reminds you to review:\n<${pr.htmlUrl}|${pr.title}> (#${pr.githubPrNumber})`,
          },
        },
        {
          type: 'image',
          image_url: randomGif,
          alt_text: 'waiting',
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
        installation.slackBotToken,
        slackUserId,
        blocks,
        `Friendly nudge for PR #${pr.githubPrNumber}: ${pr.title}`
      );
      nudgedCount++;
    }
  }

  await respond({
    text: `✅ Sent a nudge to ${nudgedCount} pending reviewer(s) for PR #${pr.githubPrNumber}.`,
    response_type: 'ephemeral',
  });
}


/**
 * /prbot stats — Show team gamification and analytics leaderboard.
 */
async function handleStats(command: any, respond: any): Promise<void> {
  const installation = await prisma.installation.findFirst({
    where: { slackTeamId: command.team_id },
  });

  if (!installation || !installation.slackBotToken) {
    await respond({
      text: '⚠️ Bot is not configured for this workspace yet.',
      response_type: 'ephemeral',
    });
    return;
  }

  const [activeReviewers, fastestReviewers, avgTimeToMerge] = await Promise.all([
    getMostActiveReviewers(installation.id),
    getFastestReviewers(installation.id),
    getAverageTimeToMerge(installation.id),
  ]);

  let text = '🏆 *Team PR Analytics & Leaderboard* 🏆\n\n';

  // 1. Time to Merge
  if (avgTimeToMerge !== null) {
    text += `📈 *Average Time-to-Merge:* \`${avgTimeToMerge.toFixed(1)} hours\`\n\n`;
  } else {
    text += `📈 *Average Time-to-Merge:* \`N/A\` (No merged PRs yet)\n\n`;
  }

  // 2. Most Active
  text += '🦸 *Most Active Reviewers*\n';
  if (activeReviewers.length > 0) {
    activeReviewers.forEach((r, idx) => {
      const medals = ['🥇', '🥈', '🥉'];
      text += `${medals[idx] || '•'} *${r.reviewer}* — ${r.count} reviews\n`;
    });
  } else {
    text += '> No completed reviews yet.\n';
  }
  text += '\n';

  // 3. Fastest
  text += '⚡ *Fastest Reviewers*\n';
  if (fastestReviewers.length > 0) {
    fastestReviewers.forEach((r, idx) => {
      const medals = ['🥇', '🥈', '🥉'];
      text += `${medals[idx] || '•'} *${r.reviewer}* — ${r.avgHours.toFixed(1)}h avg time\n`;
    });
  } else {
    text += '> Not enough data to calculate speed.\n';
  }

  await respond({
    text,
    response_type: 'in_channel', // 'in_channel' to show off stats to the whole channel
  });
}

/**
 * /prbot help — Show available commands.
 */
async function handleHelp(respond: any): Promise<void> {
  await respond({
    text: `*PR Review Bot Commands*\n\n• \`/prbot status\` — Show your pending reviews\n• \`/prbot nudge <pr-number>\` — Send a reminder to pending reviewers\n• \`/prbot stats\` — Show team analytics leaderboard\n• \`/prbot digest\` — Post a digest to this channel\n• \`/prbot link <github-username>\` — Link your GitHub account\n• \`/prbot config threshold <hours>\` — Set stale PR threshold\n• \`/prbot config channel <#channel>\` — Set digest channel\n• \`/prbot help\` — Show this message`,
    response_type: 'ephemeral',
  });
}
