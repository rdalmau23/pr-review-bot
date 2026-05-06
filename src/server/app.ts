import express from 'express';
import { githubRouter } from './routes/github';
import { logger } from '../utils/logger';

/**
 * Creates and configures the Express application.
 */
export function createApp(): express.Application {
  const app = express();

  // Parse JSON bodies (needed for GitHub webhooks)
  // We capture the raw body buffer for signature verification
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // GitHub webhook endpoint
  app.use('/webhooks/github', githubRouter);

  // Request logging middleware
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  return app;
}
