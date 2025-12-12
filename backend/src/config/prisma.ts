import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../utils/logger';

let prisma: PrismaClient;

declare global {
  // Allow global `var` declarations
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const adapter = new PrismaPg({ connectionString });

  const log = process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error'];

  return new PrismaClient({
    adapter,
    log: log as ('query' | 'info' | 'warn' | 'error')[],
  });
}

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    // In development, store in global to prevent multiple instances during hot reloads
    if (process.env.NODE_ENV === 'development') {
      global.__prisma ??= createPrismaClient();
      prisma = global.__prisma;
    } else {
      // In production, create a new instance
      prisma = createPrismaClient();
    }

    // Add error handling for connection issues
    // Note: Removed $on('error') as it's not a valid Prisma event
    // Error handling is done through try-catch blocks where needed

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