import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { createGitHubClient, fetchOpenPullRequests, fetchPullRequest } from '../integrations/github';
import { upsertPullRequest } from '../services/pr.service';

const connection = { url: config.redis.url };

export const syncPrQueue = new Queue('sync-pr', { connection });

/**
 * Worker: Syncs open PRs from GitHub to catch any missed webhooks.
 * Runs every 6 hours.
 */
export const syncPrWorker = new Worker(
  'sync-pr',
  async () => {
    logger.info('Running GitHub PR sync...');

    const installations = await prisma.installation.findMany({
      include: { repositories: true },
    });

    for (const installation of installations) {
      if (!installation.githubInstallationId) continue;

      const octokit = createGitHubClient(installation.githubInstallationId);

      for (const repo of installation.repositories) {
        try {
          const [owner, name] = repo.fullName.split('/');
          
          // 1. Fetch all open PRs from GitHub API
          const openPrs = await fetchOpenPullRequests(octokit, owner, name);
          const openPrNumbers = new Set(openPrs.map(pr => pr.number));

          // 2. Upsert fetched open PRs into our database
          for (const pr of openPrs) {
            await upsertPullRequest({
              repositoryId: repo.id,
              githubPrNumber: pr.number,
              title: pr.title,
              authorGithubLogin: pr.user?.login || 'unknown',
              state: 'OPEN',
              changedFilesCount: 0, // List endpoint doesn't include changed_files
              labels: (pr.labels || []).map((l: any) => l.name),
              htmlUrl: pr.html_url,
              isDraft: pr.draft || false,
              openedAt: new Date(pr.created_at),
              closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
            });
          }

          // 3. Find PRs in our DB that are OPEN but weren't in the GitHub API response
          const dbOpenPrs = await prisma.pullRequest.findMany({
            where: { repositoryId: repo.id, state: 'OPEN' },
          });

          for (const dbPr of dbOpenPrs) {
            if (!openPrNumbers.has(dbPr.githubPrNumber)) {
              // It's no longer open. Fetch exact state to see if closed or merged.
              try {
                const prDetail = await fetchPullRequest(octokit, owner, name, dbPr.githubPrNumber);
                const newState = prDetail.merged ? 'MERGED' : (prDetail.state === 'closed' ? 'CLOSED' : 'OPEN');
                
                if (newState !== 'OPEN') {
                  await upsertPullRequest({
                    repositoryId: repo.id,
                    githubPrNumber: prDetail.number,
                    title: prDetail.title,
                    authorGithubLogin: prDetail.user?.login || 'unknown',
                    state: newState,
                    changedFilesCount: prDetail.changed_files || dbPr.changedFilesCount,
                    labels: (prDetail.labels || []).map((l: any) => l.name),
                    htmlUrl: prDetail.html_url,
                    isDraft: prDetail.draft || false,
                    openedAt: new Date(prDetail.created_at),
                    closedAt: prDetail.closed_at ? new Date(prDetail.closed_at) : null,
                  });
                  logger.info(`Synced PR #${dbPr.githubPrNumber} state to ${newState}`);
                }
              } catch (detailError) {
                logger.error(`Failed to fetch specific PR #${dbPr.githubPrNumber} for sync`, { error: detailError });
              }
            }
          }

        } catch (error) {
          logger.error(`Failed to sync repository ${repo.fullName}`, { error });
        }
      }
    }
  },
  { connection }
);

syncPrWorker.on('completed', (job) => {
  logger.info(`GitHub PR sync completed`, { jobId: job.id });
});

syncPrWorker.on('failed', (job, err) => {
  logger.error(`GitHub PR sync failed`, { jobId: job?.id, error: err.message });
});

/**
 * Schedules the GitHub PR sync to run every 6 hours.
 */
export async function scheduleSyncPr(): Promise<void> {
  const repeatableJobs = await syncPrQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await syncPrQueue.removeRepeatableByKey(job.key);
  }

  await syncPrQueue.add(
    'sync',
    {},
    {
      repeat: { pattern: '0 */6 * * *' }, // Every 6 hours
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info('Scheduled GitHub PR sync (every 6 hours)');
}
