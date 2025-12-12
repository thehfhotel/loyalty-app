// Import env initialization FIRST - sets DATABASE_URL fallback for CI environments
// This MUST be the first import to ensure env is set before Prisma modules load
import './prisma-env-init';

import path from 'path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load .env file if it exists - overrides the fallback if present
config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
