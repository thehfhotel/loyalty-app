import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Use process.env with fallback for CI environments where DATABASE_URL may not be set
// during client generation (which doesn't require an actual database connection).
// The fallback URL is only used for schema parsing, not actual connections.
const databaseUrl = process.env.DATABASE_URL || 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
