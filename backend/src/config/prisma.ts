import { PrismaClient } from '../generated/prisma';
import { logger } from '../utils/logger';

let prisma: PrismaClient;

declare global {
  // Allow global `var` declarations
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    // In development, store in global to prevent multiple instances during hot reloads
    if (process.env.NODE_ENV === 'development') {
      if (!global.__prisma) {
        global.__prisma = new PrismaClient({
          log: ['query', 'info', 'warn', 'error'],
        });
      }
      prisma = global.__prisma;
    } else {
      // In production, create a new instance
      prisma = new PrismaClient({
        log: ['warn', 'error'],
      });
    }

    // Add error handling for connection issues
    prisma.$on('error', (e) => {
      logger.error('Prisma error:', e);
    });

    logger.info('Prisma client initialized');
  }

  return prisma;
}

export async function connectPrisma(): Promise<void> {
  try {
    const client = getPrismaClient();
    await client.$connect();
    logger.info('Prisma connected successfully to PostgreSQL');
  } catch (error) {
    logger.error('Prisma connection failed:', error);
    throw error;
  }
}

export async function disconnectPrisma(): Promise<void> {
  try {
    if (prisma) {
      await prisma.$disconnect();
      logger.info('Prisma disconnected');
    }
  } catch (error) {
    logger.error('Prisma disconnect error:', error);
  }
}

// Export the Prisma client instance
export const db = getPrismaClient();