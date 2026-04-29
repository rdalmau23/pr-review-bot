import { config } from './config';
import { createApp } from './server/app';
import { slackApp } from './integrations/slack';
import { registerSlackHandlers } from './server/routes/slack';
import { scheduleStalePrScan } from './workers/stale-pr.worker';
import { scheduleDigest } from './workers/digest.worker';
import { scheduleWorkloadAnalysis } from './workers/workload.worker';
import { scheduleSyncPr } from './workers/sync-pr.worker';
import { prisma } from './db/client';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  logger.info('Starting PR Review Bot...');

  // 1. Start the Express server (GitHub webhooks)
  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`API server listening on port ${config.port}`);
  });

  // 2. Register Slack command handlers and start the Slack app
  registerSlackHandlers();

  // Only start Slack listener if we have a token and it's either socket mode OR we want a separate server
  // For local testing without a real Slack app, we skip this to avoid port 3000 conflicts with Express
  const isSlackConfigured = config.slack.botToken && config.slack.botToken !== 'xoxb-dummy-token';
  const isSocketMode = !!config.slack.appToken;

  if (isSocketMode || (isSlackConfigured && config.env === 'production')) {
    await slackApp.start();
    logger.info(`Slack bot started (${isSocketMode ? 'Socket Mode' : 'HTTP Mode'})`);
  } else {
    logger.warn('Slack bot listener skipped (not configured or development mode)');
  }

  // 3. Schedule background workers
  await scheduleStalePrScan();
  await scheduleDigest();
  await scheduleWorkloadAnalysis();
  await scheduleSyncPr();
  logger.info('Background workers scheduled');

  // 4. Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('PR Review Bot is ready! 🚀');
}

main().catch((error) => {
  logger.error('Fatal error during startup', { error });
  process.exit(1);
});
