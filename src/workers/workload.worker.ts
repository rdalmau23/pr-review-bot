import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { sendChannelMessage } from '../integrations/slack';
import { getReviewerWorkload } from '../services/reviewer.service';

const connection = { url: config.redis.url };

export const workloadQueue = new Queue('workload', { connection });

/**
 * Worker: Detects reviewer workload imbalance and alerts the team.
 * An imbalance is detected when the max/min review ratio exceeds 3:1.
 */
export const workloadWorker = new Worker(
  'workload',
  async () => {
    logger.info('Running workload analysis...');

    const teamConfigs = await prisma.teamConfig.findMany({
      include: { installation: true },
    });

    for (const teamConfig of teamConfigs) {
      const workload = await getReviewerWorkload(teamConfig.installationId);

      if (workload.length < 2) continue; // Need at least 2 reviewers to compare

      const maxCount = workload[0].count; // Already sorted desc
      const minCount = workload[workload.length - 1].count;

      // Detect imbalance: max reviewer has 3x+ the load of the min
      if (minCount > 0 && maxCount / minCount >= 3) {
        const blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                '⚠️ *Reviewer Workload Imbalance Detected*\n\n' +
                workload
                  .map((w) => `• *${w.reviewer}*: ${w.count} pending review${w.count > 1 ? 's' : ''}`)
                  .join('\n') +
                '\n\nConsider redistributing reviews for faster turnaround.',
            },
          },
        ];

        await sendChannelMessage(
          teamConfig.slackChannelId,
          blocks,
          'Reviewer workload imbalance detected'
        );

        logger.info('Workload imbalance alert sent', {
          channel: teamConfig.slackChannelId,
          maxReviewer: workload[0].reviewer,
          maxCount,
          minCount,
        });
      }
    }
  },
  { connection }
);

workloadWorker.on('completed', (job) => {
  logger.info(`Workload analysis completed`, { jobId: job.id });
});

workloadWorker.on('failed', (job, err) => {
  logger.error(`Workload analysis failed`, { jobId: job?.id, error: err.message });
});

/**
 * Schedules workload analysis to run every 2 hours.
 */
export async function scheduleWorkloadAnalysis(): Promise<void> {
  const repeatableJobs = await workloadQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await workloadQueue.removeRepeatableByKey(job.key);
  }

  await workloadQueue.add(
    'analyze',
    {},
    {
      repeat: { pattern: '0 */2 * * *' },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info('Scheduled workload analysis (every 2 hours)');
}
