import { App, LogLevel, Installation, InstallationQuery, ExpressReceiver } from '@slack/bolt';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../db/client';

/**
 * Persistent Installation Store for OAuth multitenancy
 */
const installationStore = {
  storeInstallation: async (installation: Installation) => {
    if (installation.isEnterpriseInstall) {
      logger.warn('Enterprise install not fully supported yet');
      return;
    }
    if (installation.team?.id) {
      await prisma.installation.upsert({
        where: { slackTeamId: installation.team.id },
        create: {
          slackTeamId: installation.team.id,
          slackBotToken: installation.bot?.token,
          slackBotId: installation.bot?.id,
          slackBotUserId: installation.bot?.userId,
        },
        update: {
          slackBotToken: installation.bot?.token,
          slackBotId: installation.bot?.id,
          slackBotUserId: installation.bot?.userId,
        },
      });
      logger.info(`Saved Slack installation for team ${installation.team.id}`);
    }
  },
  fetchInstallation: async (installQuery: InstallationQuery<boolean>) => {
    if (installQuery.teamId) {
      const dbInstall = await prisma.installation.findUnique({
        where: { slackTeamId: installQuery.teamId },
      });
      if (dbInstall && dbInstall.slackBotToken) {
        return {
          team: { id: installQuery.teamId },
          enterprise: undefined,
          bot: {
            token: dbInstall.slackBotToken,
            id: dbInstall.slackBotId || '',
            userId: dbInstall.slackBotUserId || '',
            scopes: [],
          },
        } as unknown as Installation;
      }
    }
    throw new Error('Failed fetching installation');
  },
};

/**
 * Slack ExpressReceiver handles OAuth HTTP routes.
 */
export const slackReceiver = new ExpressReceiver({
  signingSecret: config.slack.signingSecret || 'dummy-signing-secret',
  clientId: config.slack.clientId,
  clientSecret: config.slack.clientSecret,
  stateSecret: config.slack.stateSecret,
  scopes: ['commands', 'chat:write', 'users:read', 'chat:write.public'],
  installationStore,
});

/**
 * Slack Bolt app instance.
 * Uses socket mode in development, HTTP mode in production.
 * Configured for OAuth 2.0 with installationStore via ExpressReceiver.
 */
export const slackApp = new App({
  receiver: slackReceiver,
  ...(config.slack.appToken ? { socketMode: true, appToken: config.slack.appToken } : {}),
  logLevel: config.env === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
});

/**
 * Send a direct message to a Slack user.
 */
export async function sendDirectMessage(
  token: string,
  slackUserId: string,
  blocks: any[],
  text: string
): Promise<void> {
  if (!token || token === 'xoxb-dummy-token') {
    logger.warn('[SLACK MOCK] Skipping DM (no token)', { slackUserId, text });
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
      token,
      channel: slackUserId,
      blocks,
      text, // fallback for notifications
    });
    logger.info(`Sent DM to Slack user ${slackUserId}`);
  } catch (error) {
    logger.error(`Failed to send DM to ${slackUserId}`, { error });
    throw error;
  }
}

/**
 * Send a message to a Slack channel.
 */
export async function sendChannelMessage(
  token: string,
  channelId: string,
  blocks: any[],
  text: string
): Promise<void> {
  if (!token || token === 'xoxb-dummy-token') {
    logger.warn('[SLACK MOCK] Skipping channel message (no token)', { channelId, text });
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
      token,
      channel: channelId,
      blocks,
      text,
    });
    logger.info(`Sent message to channel ${channelId}`);
  } catch (error) {
    logger.error(`Failed to send message to channel ${channelId}`, { error });
    throw error;
  }
}
