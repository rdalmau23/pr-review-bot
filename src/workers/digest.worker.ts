import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { getOpenPullRequests } from '../services/pr.service';
import { getReviewerWorkload } from '../services/reviewer.service';
import { sendDigest } from '../services/notification.service';

const connection = { url: config.redis.url };

export const digestQueue = new Queue('digest', { connection });

/**
 * Worker: Generates and posts the daily PR review digest
 * to all configured Slack channels.
 */
export const digestWorker = new Worker(
  'digest',
  async () => {
    logger.info('Running daily digest generation...');

    const teamConfigs = await prisma.teamConfig.findMany({
      include: { installation: true },
    });

    for (const teamConfig of teamConfigs) {
      const prs = await getOpenPullRequests();
      const workload = await getReviewerWorkload(teamConfig.installationId);

      if (teamConfig.installation.slackBotToken) {
        await sendDigest(teamConfig.installation.slackBotToken, teamConfig.slackChannelId, prs, workload);

        logger.info(`Digest sent to channel ${teamConfig.slackChannelId}`, {
          prCount: prs.length,
          reviewerCount: workload.length,
        });
      } else {
        logger.warn(`Skipping digest for channel ${teamConfig.slackChannelId} due to missing Slack token`);
      }
    }
  },
  { connection }
);

digestWorker.on('completed', (job) => {
  logger.info(`Digest generation completed`, { jobId: job.id });
});

digestWorker.on('failed', (job, err) => {
  logger.error(`Digest generation failed`, { jobId: job?.id, error: err.message });
});

/**
 * Schedules the daily digest.
 */
export async function scheduleDigest(): Promise<void> {
  const repeatableJobs = await digestQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await digestQueue.removeRepeatableByKey(job.key);
  }

  await digestQueue.add(
    'daily-digest',
    {},
    {
      repeat: { pattern: config.defaults.digestCron },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info(`Scheduled daily digest with cron: ${config.defaults.digestCron}`);
}
