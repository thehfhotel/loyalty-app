/**
 * Environment Configuration and Validation
 * Validates all environment variables with Zod schemas for security
 */

import { z } from 'zod';
import { logger } from '../utils/logger';

// Environment schema with security validations
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'staging', 'production'], {
    errorMap: () => ({ message: 'NODE_ENV must be development, staging, or production' }),
  }),

  // Server configuration
  PORT: z.string().regex(/^\d+$/, 'PORT must be a valid number').default('4000'),
  HOST: z.string().default('localhost'),

  // Security secrets (enforce minimum lengths)
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters for security'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT refresh secret must be at least 32 characters'),
  
  // Database configuration
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  
  // Redis configuration (optional, fallback to localhost:6379)
  REDIS_URL: z.string().optional().refine((val) => {
    if (!val || val === '') return true; // Allow empty/undefined
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, 'REDIS_URL must be a valid URL when provided'),
  
  // External API keys (validate presence in production)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LINE_CHANNEL_ID: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
  
  // Session configuration
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters').optional(),
  
  // Logging level
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // File upload limits
  MAX_FILE_SIZE: z.string().regex(/^\d+$/, 'MAX_FILE_SIZE must be a number').default('5242880'), // 5MB
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/, 'RATE_LIMIT_WINDOW_MS must be a number').default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().regex(/^\d+$/, 'RATE_LIMIT_MAX_REQUESTS must be a number').default('10000'), // 100x increase: 100 -> 10,000
}).refine((data) => {
  // Production-specific validations
  if (data.NODE_ENV === 'production') {
    const errors: string[] = [];
    
    // Check each secret and provide specific feedback
    if (!data.JWT_SECRET || data.JWT_SECRET.length < 64) {
      errors.push(`JWT_SECRET length: ${data.JWT_SECRET?.length ?? 0}/64 required`);
    }
    if (!data.JWT_REFRESH_SECRET || data.JWT_REFRESH_SECRET.length < 64) {
      errors.push(`JWT_REFRESH_SECRET length: ${data.JWT_REFRESH_SECRET?.length ?? 0}/64 required`);
    }
    if (!data.SESSION_SECRET || data.SESSION_SECRET.length < 64) {
      errors.push(`SESSION_SECRET length: ${data.SESSION_SECRET?.length ?? 0}/64 required`);
    }
    
    if (errors.length > 0) {
      logger.error('🔐 Production Secret Length Validation:', { errors });
      return false;
    }
  }
  return true;
}, {
  message: 'Production environment requires secrets to be at least 64 characters long',
});

// Environment type inference
export type Environment = z.infer<typeof envSchema>;

// Debug environment variables in production
if (process.env.NODE_ENV === 'production') {
  logger.info('🔍 Environment Debug Info:', {
    nodeEnv: process.env.NODE_ENV,
    redisUrl: process.env.REDIS_URL ? 'configured' : 'missing',
    jwtSecretLength: process.env.JWT_SECRET?.length ?? 0,
    jwtRefreshSecretLength: process.env.JWT_REFRESH_SECRET?.length ?? 0,
    sessionSecretLength: process.env.SESSION_SECRET?.length ?? 0,
  });
}

// Validate environment variables
let env: Environment;

try {
  env = envSchema.parse(process.env);
  logger.info('Environment validation passed', { 
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    logger.error('Environment validation failed:', {
      errors: error.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message,
        received: err.code === 'invalid_type' ? typeof err.received : undefined,
      })),
    });
    
    // Print detailed error for debugging (keep console for critical startup errors)
    // eslint-disable-next-line no-console -- Critical startup error must be visible before logger initialization
    console.error('\n🚨 ENVIRONMENT VALIDATION FAILED 🚨');
    // eslint-disable-next-line no-console -- Critical startup error must be visible before logger initialization
    console.error('The following environment variables are invalid or missing:\n');

    error.errors.forEach((err, index) => {
      // eslint-disable-next-line no-console -- Critical startup error must be visible before logger initialization
      console.error(`${index + 1}. ${err.path.join('.')}: ${err.message}`);
    });

    // eslint-disable-next-line no-console -- Critical startup error must be visible before logger initialization
    console.error('\nPlease check your .env file and ensure all required variables are set correctly.');
    // eslint-disable-next-line no-console -- Critical startup error must be visible before logger initialization
    console.error('See docs/ENVIRONMENT.md for detailed configuration instructions.\n');
    
    process.exit(1);
  } else {
    logger.error('Unexpected error during environment validation:', error);
    process.exit(1);
  }
}

// Security checks for sensitive data
const performSecurityChecks = () => {
  const warnings: string[] = [];
  
  // Check for default/weak secrets
  const defaultSecrets = [
    'your-secret-key',
    'your-refresh-secret', 
    'default-secret',
    'changeme',
    'secret',
    '123456',
  ];
  
  if (defaultSecrets.includes(env.JWT_SECRET)) {
    warnings.push('JWT_SECRET appears to be a default value. Use a strong, random secret.');
  }
  
  if (env.JWT_REFRESH_SECRET && defaultSecrets.includes(env.JWT_REFRESH_SECRET)) {
    warnings.push('JWT_REFRESH_SECRET appears to be a default value. Use a strong, random secret.');
  }
  
  // Check for development database in production
  if (env.NODE_ENV === 'production' && env.DATABASE_URL.includes('localhost')) {
    warnings.push('Production environment should not use localhost database.');
  }
  
  // Check for HTTP URLs in production
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL.startsWith('postgresql://')) {
    warnings.push('Production database URL should use secure connection.');
  }
  
  // Log warnings
  if (warnings.length > 0) {
    logger.warn('Security warnings detected:', { warnings });

    if (env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console -- Critical production security warning must be visible
      console.error('\n⚠️  SECURITY WARNINGS IN PRODUCTION ⚠️');
      warnings.forEach((warning, index) => {
        // eslint-disable-next-line no-console -- Critical production security warning must be visible
        console.error(`${index + 1}. ${warning}`);
      });
      // eslint-disable-next-line no-console -- Critical production security warning must be visible
      console.error('\nThese issues should be resolved before production deployment.\n');
    }
  }
};

// Run security checks
performSecurityChecks();

// Export validated environment
export { env };

// Utility function to check if we're in production
export const isProduction = () => env.NODE_ENV === 'production';
export const isDevelopment = () => env.NODE_ENV === 'development';
export const isStaging = () => env.NODE_ENV === 'staging';

// Export individual config sections for convenience
export const serverConfig = {
  port: parseInt(env.PORT, 10),
  host: env.HOST,
} as const;

export const authConfig = {
  jwtSecret: env.JWT_SECRET,
  jwtRefreshSecret: env.JWT_REFRESH_SECRET,
  sessionSecret: env.SESSION_SECRET,
} as const;

export const databaseConfig = {
  url: env.DATABASE_URL,
} as const;

export const securityConfig = {
  maxFileSize: parseInt(env.MAX_FILE_SIZE, 10),
  rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS, 10),
  rateLimitMaxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10),
} as const;