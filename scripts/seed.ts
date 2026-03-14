import { prisma } from '../src/db/client';

/**
 * Seed script: inserts test data to simulate a real environment.
 * Run with: npx tsx scripts/seed.ts
 */
async function seed() {
  console.log('🌱 Seeding database...\n');

  // 1. Create a default installation
  const installation = await prisma.installation.upsert({
    where: { githubInstallationId: 12345 },
    create: {
      githubInstallationId: 12345,
      slackTeamId: 'T_TEST_TEAM',
      slackBotToken: process.env.SLACK_BOT_TOKEN || 'xoxb-test-token',
    },
    update: {},
  });
  console.log(`✅ Installation created: ${installation.id}`);

  // 2. Create test repositories
  const repos = [
    { githubRepoId: 100001, fullName: 'myorg/payment-service' },
    { githubRepoId: 100002, fullName: 'myorg/frontend-ui' },
    { githubRepoId: 100003, fullName: 'myorg/api-gateway' },
  ];

  const createdRepos = [];
  for (const repo of repos) {
    const created = await prisma.repository.upsert({
      where: { githubRepoId: repo.githubRepoId },
      create: { ...repo, installationId: installation.id },
      update: {},
    });
    createdRepos.push(created);
    console.log(`✅ Repository: ${repo.fullName}`);
  }

  // 3. Create test pull requests with different scenarios
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  const prs = [
    {
      repositoryId: createdRepos[0].id,
      githubPrNumber: 342,
      title: 'Fix payment processing timeout',
      authorGithubLogin: 'dev-sarah',
      state: 'OPEN' as const,
      changedFilesCount: 8,
      labels: ['urgent', 'blocks-deployment'],
      htmlUrl: 'https://github.com/myorg/payment-service/pull/342',
      isDraft: false,
      openedAt: hoursAgo(6),
    },
    {
      repositoryId: createdRepos[1].id,
      githubPrNumber: 112,
      title: 'Redesign user dashboard components',
      authorGithubLogin: 'dev-carlos',
      state: 'OPEN' as const,
      changedFilesCount: 25,
      labels: ['frontend', 'design'],
      htmlUrl: 'https://github.com/myorg/frontend-ui/pull/112',
      isDraft: false,
      openedAt: hoursAgo(32),
    },
    {
      repositoryId: createdRepos[1].id,
      githubPrNumber: 115,
      title: 'Add dark mode toggle',
      authorGithubLogin: 'dev-marta',
      state: 'OPEN' as const,
      changedFilesCount: 4,
      labels: ['frontend'],
      htmlUrl: 'https://github.com/myorg/frontend-ui/pull/115',
      isDraft: false,
      openedAt: hoursAgo(3),
    },
    {
      repositoryId: createdRepos[2].id,
      githubPrNumber: 89,
      title: 'Migrate auth to OAuth2',
      authorGithubLogin: 'dev-alex',
      state: 'OPEN' as const,
      changedFilesCount: 42,
      labels: ['critical', 'security'],
      htmlUrl: 'https://github.com/myorg/api-gateway/pull/89',
      isDraft: false,
      openedAt: hoursAgo(50),
    },
    {
      repositoryId: createdRepos[2].id,
      githubPrNumber: 91,
      title: 'Update rate limiting config',
      authorGithubLogin: 'dev-sarah',
      state: 'OPEN' as const,
      changedFilesCount: 2,
      labels: [],
      htmlUrl: 'https://github.com/myorg/api-gateway/pull/91',
      isDraft: true, // Draft — should be ignored
      openedAt: hoursAgo(10),
    },
  ];

  for (const pr of prs) {
    const created = await prisma.pullRequest.upsert({
      where: {
        repositoryId_githubPrNumber: {
          repositoryId: pr.repositoryId,
          githubPrNumber: pr.githubPrNumber,
        },
      },
      create: pr,
      update: pr,
    });
    const draft = pr.isDraft ? ' (DRAFT)' : '';
    console.log(`✅ PR #${pr.githubPrNumber}: ${pr.title}${draft}`);

    // Add review requests (except for drafts)
    if (!pr.isDraft) {
      const reviewers = getReviewersForPR(pr.githubPrNumber);
      for (const reviewer of reviewers) {
        await prisma.reviewRequest.upsert({
          where: {
            pullRequestId_reviewerGithubLogin: {
              pullRequestId: created.id,
              reviewerGithubLogin: reviewer,
            },
          },
          create: {
            pullRequestId: created.id,
            reviewerGithubLogin: reviewer,
            status: 'PENDING',
          },
          update: {},
        });
        console.log(`   → Reviewer: ${reviewer}`);
      }
    }
  }

  // 4. Create user mappings (GitHub → Slack)
  const users = [
    { githubLogin: 'dev-alex', slackUserId: 'U_ALEX' },
    { githubLogin: 'dev-marta', slackUserId: 'U_MARTA' },
    { githubLogin: 'dev-sarah', slackUserId: 'U_SARAH' },
    { githubLogin: 'dev-carlos', slackUserId: 'U_CARLOS' },
  ];

  console.log('');
  for (const user of users) {
    await prisma.userMapping.upsert({
      where: {
        installationId_githubLogin: {
          installationId: installation.id,
          githubLogin: user.githubLogin,
        },
      },
      create: { ...user, installationId: installation.id },
      update: {},
    });
    console.log(`✅ User mapping: ${user.githubLogin} → ${user.slackUserId}`);
  }

  // 5. Create team config
  await prisma.teamConfig.upsert({
    where: {
      installationId_slackChannelId: {
        installationId: installation.id,
        slackChannelId: 'C_PR_REVIEWS',
      },
    },
    create: {
      installationId: installation.id,
      slackChannelId: 'C_PR_REVIEWS',
      staleThresholdHours: 24,
      digestCron: '0 9 * * 1-5',
      timezone: 'Europe/Madrid',
    },
    update: {},
  });
  console.log('\n✅ Team config: #pr-reviews, threshold 24h, digest 9am Mon-Fri');

  console.log('\n🎉 Seeding complete!\n');
  console.log('Summary:');
  console.log(`  • 1 installation`);
  console.log(`  • ${repos.length} repositories`);
  console.log(`  • ${prs.length} pull requests (1 draft)`);
  console.log(`  • ${users.length} user mappings`);
  console.log(`  • 1 team config`);
  console.log('\nExpected digest output:');
  console.log('  🔴 High priority: PR #342 (urgent + blocks-deployment), PR #89 (critical, 50h old)');
  console.log('  ⏰ Waiting > 24h: PR #112 (32h old)');
  console.log('  📝 Normal: PR #115 (3h old)');
  console.log('  ⚖️ Alex: 5 reviews, Marta: 1 review → imbalance detected');
}

/**
 * Assigns reviewers to simulate workload imbalance.
 * Alex gets 5 reviews, Marta gets 1 — to trigger the imbalance alert.
 */
function getReviewersForPR(prNumber: number): string[] {
  switch (prNumber) {
    case 342: return ['dev-alex', 'dev-marta']; // Alex +1, Marta +1
    case 112: return ['dev-alex'];               // Alex +1
    case 115: return ['dev-alex'];               // Alex +1
    case 89:  return ['dev-alex', 'dev-carlos']; // Alex +1
    default:  return ['dev-alex'];               // Alex +1
  }
}

seed()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
