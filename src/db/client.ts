import { PrismaClient } from '.prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

const pool = new Pool({ connectionString: config.database.url });
const adapter = new PrismaPg(pool as any);

export const prisma = new PrismaClient({
  adapter,
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
});

prisma.$on('error' as any, (e: any) => {
  logger.error('Prisma error', { message: e.message });
});

prisma.$on('warn' as any, (e: any) => {
  logger.warn('Prisma warning', { message: e.message });
});
