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
  
  // Redis configuration
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL').optional(),
  
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
  RATE_LIMIT_MAX_REQUESTS: z.string().regex(/^\d+$/, 'RATE_LIMIT_MAX_REQUESTS must be a number').default('100'),
}).refine((data) => {
  // Production-specific validations
  if (data.NODE_ENV === 'production') {
    // In production, require strong secrets
    if (!data.JWT_SECRET || data.JWT_SECRET.length < 64) {
      return false;
    }
    if (!data.JWT_REFRESH_SECRET || data.JWT_REFRESH_SECRET.length < 64) {
      return false;
    }
    if (!data.SESSION_SECRET || data.SESSION_SECRET.length < 64) {
      return false;
    }
  }
  return true;
}, {
  message: 'Production environment requires secrets to be at least 64 characters long',
});

// Environment type inference
export type Environment = z.infer<typeof envSchema>;

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
        received: err.code === 'invalid_type' ? typeof (error as any).received : undefined,
      })),
    });
    
    // Print detailed error for debugging
    console.error('\n🚨 ENVIRONMENT VALIDATION FAILED 🚨');
    console.error('The following environment variables are invalid or missing:\n');
    
    error.errors.forEach((err, index) => {
      console.error(`${index + 1}. ${err.path.join('.')}: ${err.message}`);
    });
    
    console.error('\nPlease check your .env file and ensure all required variables are set correctly.');
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
      console.error('\n⚠️  SECURITY WARNINGS IN PRODUCTION ⚠️');
      warnings.forEach((warning, index) => {
        console.error(`${index + 1}. ${warning}`);
      });
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