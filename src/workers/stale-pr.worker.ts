import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { getStalePullRequests, markNotified } from '../services/pr.service';
import { notifyStalePR } from '../services/notification.service';

const connection = { url: config.redis.url };

export const stalePrQueue = new Queue('stale-pr', { connection });

/**
 * Worker: Scans for PRs waiting longer than the configured threshold
 * and sends stale PR alerts to the configured Slack channel.
 */
export const stalePrWorker = new Worker(
  'stale-pr',
  async () => {
    logger.info('Running stale PR scan...');

    const teamConfigs = await prisma.teamConfig.findMany({
      include: { installation: true },
    });

    for (const teamConfig of teamConfigs) {
      const stalePrs = await getStalePullRequests(
        teamConfig.staleThresholdHours,
        teamConfig.installationId
      );

      // Filter out PRs we've already notified about recently (within threshold)
      const notifyThreshold = new Date(
        Date.now() - teamConfig.staleThresholdHours * 60 * 60 * 1000
      );

      const prsToNotify = stalePrs.filter(
        (pr) => !pr.lastNotifiedAt || pr.lastNotifiedAt < notifyThreshold
      );

      logger.info(`Found ${prsToNotify.length} stale PRs for channel ${teamConfig.slackChannelId}`);

      for (const pr of prsToNotify) {
        if (teamConfig.installation.slackBotToken) {
          await notifyStalePR(teamConfig.installation.slackBotToken, teamConfig.slackChannelId, pr);
        } else {
          logger.warn(`Skipping stale PR alert for channel ${teamConfig.slackChannelId} due to missing Slack token`);
        }
        await markNotified(pr.id);
      }
    }
  },
  { connection }
);

stalePrWorker.on('completed', (job) => {
  logger.info(`Stale PR scan completed`, { jobId: job.id });
});

stalePrWorker.on('failed', (job, err) => {
  logger.error(`Stale PR scan failed`, { jobId: job?.id, error: err.message });
});

/**
 * Schedules the stale PR scan to run every 30 minutes.
 */
export async function scheduleStalePrScan(): Promise<void> {
  const repeatableJobs = await stalePrQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await stalePrQueue.removeRepeatableByKey(job.key);
  }

  await stalePrQueue.add(
    'scan',
    {},
    {
      repeat: { pattern: '*/30 * * * *' },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info('Scheduled stale PR scan (every 30 minutes)');
}
