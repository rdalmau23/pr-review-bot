import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    url: process.env.DATABASE_URL!,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  github: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  },

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    appToken: process.env.SLACK_APP_TOKEN,
  },

  defaults: {
    staleThresholdHours: parseInt(process.env.DEFAULT_STALE_THRESHOLD_HOURS || '24', 10),
    digestCron: process.env.DEFAULT_DIGEST_CRON || '0 9 * * 1-5',
    timezone: process.env.DEFAULT_TIMEZONE || 'UTC',
  },
} as const;
