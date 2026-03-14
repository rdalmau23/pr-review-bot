import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Creates an authenticated Octokit instance for a given GitHub App installation.
 */
export function createGitHubClient(installationId?: number): Octokit {
  if (!config.github.appId || !config.github.privateKey) {
    logger.warn('GitHub App config missing; creating unauthenticated client');
    return new Octokit();
  }

  const authArgs = installationId 
    ? {
        appId: config.github.appId,
        privateKey: config.github.privateKey,
        installationId,
      }
    : {
        appId: config.github.appId,
        privateKey: config.github.privateKey,
      };

  return new Octokit({
    authStrategy: createAppAuth,
    auth: authArgs,
    log: {
      debug: (msg: string) => logger.debug(`[GitHub] ${msg}`),
      info: (msg: string) => logger.info(`[GitHub] ${msg}`),
      warn: (msg: string) => logger.warn(`[GitHub] ${msg}`),
      error: (msg: string) => logger.error(`[GitHub] ${msg}`),
    },
  });
}

/**
 * Fetches open pull requests for a given repository.
 */
export async function fetchOpenPullRequests(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });

  return data;
}

/**
 * Fetches details for a single pull request.
 */
export async function fetchPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  return data;
}
