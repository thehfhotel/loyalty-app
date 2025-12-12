// This file MUST be imported before any Prisma modules
// It sets the DATABASE_URL fallback for CI environments where the env var may not be set
// The fallback URL is only used for schema parsing during prisma generate, not actual connections
process.env.DATABASE_URL ??= 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
