import { App, LogLevel } from '@slack/bolt';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Slack Bolt app instance.
 * Uses socket mode in development, HTTP mode in production.
 * Provides dummy values if missing for local testing.
 */
export const slackApp = new App({
  token: config.slack.botToken || 'xoxb-dummy-token',
  signingSecret: config.slack.signingSecret || 'dummy-signing-secret',
  tokenVerificationEnabled: !!config.slack.botToken && config.slack.botToken !== 'xoxb-dummy-token',
  ...(config.slack.appToken
    ? { socketMode: true, appToken: config.slack.appToken }
    : {}),
  logLevel: config.env === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
});

/**
 * Send a direct message to a Slack user.
 */
export async function sendDirectMessage(
  slackUserId: string,
  blocks: any[],
  text: string
): Promise<void> {
  if (!config.slack.botToken || config.slack.botToken === 'xoxb-dummy-token') {
    logger.warn('[SLACK MOCK] Skipping DM (no token)', { slackUserId, text });
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
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
  channelId: string,
  blocks: any[],
  text: string
): Promise<void> {
  if (!config.slack.botToken || config.slack.botToken === 'xoxb-dummy-token') {
    logger.warn('[SLACK MOCK] Skipping channel message (no token)', { channelId, text });
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
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
