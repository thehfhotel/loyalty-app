/**
 * Environment Configuration Unit Tests
 * Tests environment variable validation, type coercion, and security checks
 *
 * Note: This module performs validation at import time with process.exit(1) on failure.
 * Tests focus on successful scenarios and exported values.
 */

import { describe, it, expect, jest } from '@jest/globals';

// Mock logger before importing environment
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Set valid environment variables before any imports
process.env.NODE_ENV = 'development';
process.env.PORT = '4000';
process.env.HOST = 'localhost';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-sixty-four-characters-long-exactly';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-that-is-at-least-sixty-four-characters';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-sixty-four-characters-long';
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5438/test_db';
process.env.REDIS_URL = 'redis://localhost:6383';
process.env.LOG_LEVEL = 'info';
process.env.MAX_FILE_SIZE = '5242880';
process.env.RATE_LIMIT_WINDOW_MS = '900000';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';

import {
  env,
  isProduction,
  isDevelopment,
  isStaging,
  serverConfig,
  authConfig,
  databaseConfig,
  securityConfig,
} from '../../../config/environment';

describe('Environment Configuration', () => {
  describe('Environment Variables', () => {
    it('should load NODE_ENV correctly', () => {
      expect(env.NODE_ENV).toBeDefined();
      expect(['development', 'staging', 'production', 'test']).toContain(env.NODE_ENV);
    });

    it('should load PORT with default or custom value', () => {
      expect(env.PORT).toBeDefined();
      expect(env.PORT).toMatch(/^\d+$/);
    });

    it('should load HOST with default or custom value', () => {
      expect(env.HOST).toBeDefined();
      expect(typeof env.HOST).toBe('string');
    });

    it('should load JWT_SECRET', () => {
      expect(env.JWT_SECRET).toBeDefined();
      expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('should load JWT_REFRESH_SECRET', () => {
      expect(env.JWT_REFRESH_SECRET).toBeDefined();
      expect(env.JWT_REFRESH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('should load DATABASE_URL', () => {
      expect(env.DATABASE_URL).toBeDefined();
      expect(env.DATABASE_URL).toContain('postgresql://');
    });

    it('should load REDIS_URL when provided', () => {
      if (env.REDIS_URL) {
        expect(env.REDIS_URL).toMatch(/^redis(s)?:\/\//);
      }
    });

    it('should load LOG_LEVEL with valid value', () => {
      expect(env.LOG_LEVEL).toBeDefined();
      expect(['error', 'warn', 'info', 'debug']).toContain(env.LOG_LEVEL);
    });

    it('should load MAX_FILE_SIZE as numeric string', () => {
      expect(env.MAX_FILE_SIZE).toBeDefined();
      expect(env.MAX_FILE_SIZE).toMatch(/^\d+$/);
    });

    it('should load RATE_LIMIT_WINDOW_MS as numeric string', () => {
      expect(env.RATE_LIMIT_WINDOW_MS).toBeDefined();
      expect(env.RATE_LIMIT_WINDOW_MS).toMatch(/^\d+$/);
    });

    it('should load RATE_LIMIT_MAX_REQUESTS as numeric string', () => {
      expect(env.RATE_LIMIT_MAX_REQUESTS).toBeDefined();
      expect(env.RATE_LIMIT_MAX_REQUESTS).toMatch(/^\d+$/);
    });
  });

  describe('Default Values', () => {
    it('should have default PORT value', () => {
      expect(env.PORT).toBeTruthy();
      // PORT should be either custom or default
      expect(typeof env.PORT).toBe('string');
    });

    it('should have default HOST value', () => {
      expect(env.HOST).toBeTruthy();
      expect(typeof env.HOST).toBe('string');
    });

    it('should have default LOG_LEVEL value', () => {
      expect(env.LOG_LEVEL).toBeTruthy();
      expect(['error', 'warn', 'info', 'debug']).toContain(env.LOG_LEVEL);
    });

    it('should have default MAX_FILE_SIZE value', () => {
      expect(env.MAX_FILE_SIZE).toBeTruthy();
      expect(parseInt(env.MAX_FILE_SIZE, 10)).toBeGreaterThan(0);
    });

    it('should have default RATE_LIMIT_WINDOW_MS value', () => {
      expect(env.RATE_LIMIT_WINDOW_MS).toBeTruthy();
      expect(parseInt(env.RATE_LIMIT_WINDOW_MS, 10)).toBeGreaterThan(0);
    });

    it('should have default RATE_LIMIT_MAX_REQUESTS value', () => {
      expect(env.RATE_LIMIT_MAX_REQUESTS).toBeTruthy();
      expect(parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10)).toBeGreaterThan(0);
    });
  });

  describe('Exported Config Sections', () => {
    describe('serverConfig', () => {
      it('should export port as number', () => {
        expect(serverConfig.port).toBeDefined();
        expect(typeof serverConfig.port).toBe('number');
        expect(serverConfig.port).toBeGreaterThan(0);
        expect(serverConfig.port).toBeLessThan(65536);
      });

      it('should export host as string', () => {
        expect(serverConfig.host).toBeDefined();
        expect(typeof serverConfig.host).toBe('string');
      });
    });

    describe('authConfig', () => {
      it('should export JWT secrets', () => {
        expect(authConfig.jwtSecret).toBeDefined();
        expect(authConfig.jwtSecret.length).toBeGreaterThanOrEqual(32);

        expect(authConfig.jwtRefreshSecret).toBeDefined();
        expect(authConfig.jwtRefreshSecret.length).toBeGreaterThanOrEqual(32);
      });

      it('should export session secret when provided', () => {
        if (authConfig.sessionSecret) {
          expect(authConfig.sessionSecret.length).toBeGreaterThanOrEqual(32);
        }
      });
    });

    describe('databaseConfig', () => {
      it('should export database URL', () => {
        expect(databaseConfig.url).toBeDefined();
        expect(databaseConfig.url).toContain('postgresql://');
      });
    });

    describe('securityConfig', () => {
      it('should export maxFileSize as number', () => {
        expect(securityConfig.maxFileSize).toBeDefined();
        expect(typeof securityConfig.maxFileSize).toBe('number');
        expect(securityConfig.maxFileSize).toBeGreaterThan(0);
      });

      it('should export rateLimitWindowMs as number', () => {
        expect(securityConfig.rateLimitWindowMs).toBeDefined();
        expect(typeof securityConfig.rateLimitWindowMs).toBe('number');
        expect(securityConfig.rateLimitWindowMs).toBeGreaterThan(0);
      });

      it('should export rateLimitMaxRequests as number', () => {
        expect(securityConfig.rateLimitMaxRequests).toBeDefined();
        expect(typeof securityConfig.rateLimitMaxRequests).toBe('number');
        expect(securityConfig.rateLimitMaxRequests).toBeGreaterThan(0);
      });

      it('should parse string values to numbers correctly', () => {
        // Verify that numeric strings are converted to actual numbers
        expect(Number.isNaN(securityConfig.maxFileSize)).toBe(false);
        expect(Number.isNaN(securityConfig.rateLimitWindowMs)).toBe(false);
        expect(Number.isNaN(securityConfig.rateLimitMaxRequests)).toBe(false);
      });
    });
  });

  describe('Environment Helper Functions', () => {
    it('should correctly identify environment', () => {
      const isProd = isProduction();
      const isDev = isDevelopment();
      const isStage = isStaging();

      // Exactly one should be true
      const trueCount = [isProd, isDev, isStage].filter(Boolean).length;
      expect(trueCount).toBe(1);
    });

    it('should return boolean values', () => {
      expect(typeof isProduction()).toBe('boolean');
      expect(typeof isDevelopment()).toBe('boolean');
      expect(typeof isStaging()).toBe('boolean');
    });

    it('should match NODE_ENV value', () => {
      if (env.NODE_ENV === 'production') {
        expect(isProduction()).toBe(true);
        expect(isDevelopment()).toBe(false);
        expect(isStaging()).toBe(false);
      } else if (env.NODE_ENV === 'development') {
        expect(isProduction()).toBe(false);
        expect(isDevelopment()).toBe(true);
        expect(isStaging()).toBe(false);
      } else if (env.NODE_ENV === 'staging') {
        expect(isProduction()).toBe(false);
        expect(isDevelopment()).toBe(false);
        expect(isStaging()).toBe(true);
      }
    });
  });

  describe('Optional Variables', () => {
    it('should handle optional REDIS_URL', () => {
      // REDIS_URL may or may not be set
      if (env.REDIS_URL) {
        expect(typeof env.REDIS_URL).toBe('string');
        expect(env.REDIS_URL.length).toBeGreaterThan(0);
      }
    });

    it('should handle optional OAuth credentials', () => {
      if (env.GOOGLE_CLIENT_ID) {
        expect(typeof env.GOOGLE_CLIENT_ID).toBe('string');
        expect(env.GOOGLE_CLIENT_ID.length).toBeGreaterThan(0);
      }

      if (env.GOOGLE_CLIENT_SECRET) {
        expect(typeof env.GOOGLE_CLIENT_SECRET).toBe('string');
        expect(env.GOOGLE_CLIENT_SECRET.length).toBeGreaterThan(0);
      }

      if (env.LINE_CHANNEL_ID) {
        expect(typeof env.LINE_CHANNEL_ID).toBe('string');
        expect(env.LINE_CHANNEL_ID.length).toBeGreaterThan(0);
      }

      if (env.LINE_CHANNEL_SECRET) {
        expect(typeof env.LINE_CHANNEL_SECRET).toBe('string');
        expect(env.LINE_CHANNEL_SECRET.length).toBeGreaterThan(0);
      }
    });

    it('should handle optional SESSION_SECRET', () => {
      if (env.SESSION_SECRET) {
        expect(typeof env.SESSION_SECRET).toBe('string');
        expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
      }
    });
  });

  describe('Type Safety', () => {
    it('should have PORT as string in env object', () => {
      expect(typeof env.PORT).toBe('string');
    });

    it('should have port as number in serverConfig', () => {
      expect(typeof serverConfig.port).toBe('number');
    });

    it('should have MAX_FILE_SIZE as string in env object', () => {
      expect(typeof env.MAX_FILE_SIZE).toBe('string');
    });

    it('should have maxFileSize as number in securityConfig', () => {
      expect(typeof securityConfig.maxFileSize).toBe('number');
    });

    it('should correctly parse all numeric configurations', () => {
      const port = parseInt(env.PORT, 10);
      expect(port).toBe(serverConfig.port);

      const maxFileSize = parseInt(env.MAX_FILE_SIZE, 10);
      expect(maxFileSize).toBe(securityConfig.maxFileSize);

      const rateLimitWindowMs = parseInt(env.RATE_LIMIT_WINDOW_MS, 10);
      expect(rateLimitWindowMs).toBe(securityConfig.rateLimitWindowMs);

      const rateLimitMaxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10);
      expect(rateLimitMaxRequests).toBe(securityConfig.rateLimitMaxRequests);
    });
  });

  describe('Security Requirements', () => {
    it('should enforce minimum JWT_SECRET length', () => {
      expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('should enforce minimum JWT_REFRESH_SECRET length', () => {
      expect(env.JWT_REFRESH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('should enforce minimum SESSION_SECRET length when provided', () => {
      if (env.SESSION_SECRET) {
        expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
      }
    });

    it('should validate DATABASE_URL format', () => {
      expect(env.DATABASE_URL).toMatch(/^postgresql:\/\//);
    });

    it('should validate REDIS_URL format when provided', () => {
      if (env.REDIS_URL) {
        expect(env.REDIS_URL).toMatch(/^redis(s)?:\/\//);
      }
    });
  });

  describe('Configuration Consistency', () => {
    it('should have consistent values across env and config sections', () => {
      expect(serverConfig.port).toBe(parseInt(env.PORT, 10));
      expect(serverConfig.host).toBe(env.HOST);
      expect(authConfig.jwtSecret).toBe(env.JWT_SECRET);
      expect(authConfig.jwtRefreshSecret).toBe(env.JWT_REFRESH_SECRET);
      expect(databaseConfig.url).toBe(env.DATABASE_URL);
    });

    it('should have all required properties defined', () => {
      expect(env).toHaveProperty('NODE_ENV');
      expect(env).toHaveProperty('PORT');
      expect(env).toHaveProperty('HOST');
      expect(env).toHaveProperty('JWT_SECRET');
      expect(env).toHaveProperty('JWT_REFRESH_SECRET');
      expect(env).toHaveProperty('DATABASE_URL');
      expect(env).toHaveProperty('LOG_LEVEL');
      expect(env).toHaveProperty('MAX_FILE_SIZE');
      expect(env).toHaveProperty('RATE_LIMIT_WINDOW_MS');
      expect(env).toHaveProperty('RATE_LIMIT_MAX_REQUESTS');
    });
  });

  describe('Environment-Specific Logic', () => {
    it('should handle development environment', () => {
      expect(env.NODE_ENV).toBe('development');
      expect(isDevelopment()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(isStaging()).toBe(false);
    });

    it('should validate PORT is within valid range', () => {
      const port = serverConfig.port;
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
      expect(Number.isInteger(port)).toBe(true);
    });

    it('should handle empty REDIS_URL', () => {
      // REDIS_URL can be undefined or empty string
      if (!env.REDIS_URL || env.REDIS_URL === '') {
        expect(env.REDIS_URL).toBeFalsy();
      } else {
        expect(env.REDIS_URL).toMatch(/^redis(s)?:\/\//);
      }
    });

    it('should validate DATABASE_URL is postgresql protocol', () => {
      expect(env.DATABASE_URL).toMatch(/^postgresql:\/\//);
      expect(env.DATABASE_URL).toContain('@');
      expect(env.DATABASE_URL).toContain('/');
    });

    it('should handle all LOG_LEVEL values', () => {
      const validLevels = ['error', 'warn', 'info', 'debug'];
      expect(validLevels).toContain(env.LOG_LEVEL);
    });

    it('should validate numeric string conversions', () => {
      // Verify string values are numeric
      expect(parseInt(env.PORT, 10)).not.toBeNaN();
      expect(parseInt(env.MAX_FILE_SIZE, 10)).not.toBeNaN();
      expect(parseInt(env.RATE_LIMIT_WINDOW_MS, 10)).not.toBeNaN();
      expect(parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10)).not.toBeNaN();
    });

    it('should validate secret lengths for development', () => {
      // In development, minimum is 32 characters
      expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(env.JWT_REFRESH_SECRET.length).toBeGreaterThanOrEqual(32);
      if (env.SESSION_SECRET) {
        expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
      }
    });
  });

  describe('Security Configuration', () => {
    it('should have reasonable security limits', () => {
      // MAX_FILE_SIZE should be reasonable (not too small, not too large)
      const maxFileSize = securityConfig.maxFileSize;
      expect(maxFileSize).toBeGreaterThan(1024); // > 1KB
      expect(maxFileSize).toBeLessThanOrEqual(100 * 1024 * 1024); // <= 100MB
    });

    it('should have reasonable rate limits', () => {
      const windowMs = securityConfig.rateLimitWindowMs;
      const maxRequests = securityConfig.rateLimitMaxRequests;

      expect(windowMs).toBeGreaterThan(0);
      expect(maxRequests).toBeGreaterThan(0);

      // Window should be reasonable (not too short)
      expect(windowMs).toBeGreaterThanOrEqual(60000); // >= 1 minute
    });

    it('should validate secret complexity requirements', () => {
      // Secrets should not be trivial
      expect(env.JWT_SECRET).not.toBe('');
      expect(env.JWT_REFRESH_SECRET).not.toBe('');

      // Should be different from each other
      expect(env.JWT_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
    });

    it('should handle optional OAuth credentials', () => {
      // These are optional, but if present should be non-empty
      if (env.GOOGLE_CLIENT_ID) {
        expect(env.GOOGLE_CLIENT_ID.length).toBeGreaterThan(0);
        expect(typeof env.GOOGLE_CLIENT_ID).toBe('string');
      }

      if (env.GOOGLE_CLIENT_SECRET) {
        expect(env.GOOGLE_CLIENT_SECRET.length).toBeGreaterThan(0);
        expect(typeof env.GOOGLE_CLIENT_SECRET).toBe('string');
      }

      if (env.LINE_CHANNEL_ID) {
        expect(env.LINE_CHANNEL_ID.length).toBeGreaterThan(0);
        expect(typeof env.LINE_CHANNEL_ID).toBe('string');
      }

      if (env.LINE_CHANNEL_SECRET) {
        expect(env.LINE_CHANNEL_SECRET.length).toBeGreaterThan(0);
        expect(typeof env.LINE_CHANNEL_SECRET).toBe('string');
      }
    });
  });

  describe('Config Export Completeness', () => {
    it('should export all server config properties', () => {
      expect(serverConfig).toHaveProperty('port');
      expect(serverConfig).toHaveProperty('host');
      expect(Object.keys(serverConfig)).toHaveLength(2);
    });

    it('should export all auth config properties', () => {
      expect(authConfig).toHaveProperty('jwtSecret');
      expect(authConfig).toHaveProperty('jwtRefreshSecret');
      expect(authConfig).toHaveProperty('sessionSecret');
    });

    it('should export all database config properties', () => {
      expect(databaseConfig).toHaveProperty('url');
      expect(Object.keys(databaseConfig)).toHaveLength(1);
    });

    it('should export all security config properties', () => {
      expect(securityConfig).toHaveProperty('maxFileSize');
      expect(securityConfig).toHaveProperty('rateLimitWindowMs');
      expect(securityConfig).toHaveProperty('rateLimitMaxRequests');
      expect(Object.keys(securityConfig)).toHaveLength(3);
    });

    it('should have readonly config objects at compile time', () => {
      // Config objects use const assertions for TypeScript type safety
      // They are readonly at compile-time but not runtime-frozen
      expect(serverConfig).toBeDefined();
      expect(authConfig).toBeDefined();
      expect(databaseConfig).toBeDefined();
      expect(securityConfig).toBeDefined();
    });
  });

  describe('Environment Variable Edge Cases', () => {
    it('should handle PORT as string correctly', () => {
      expect(typeof env.PORT).toBe('string');
      expect(env.PORT).toMatch(/^\d+$/);
      const parsed = parseInt(env.PORT, 10);
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThan(65536);
    });

    it('should handle numeric limits as strings', () => {
      expect(typeof env.MAX_FILE_SIZE).toBe('string');
      expect(typeof env.RATE_LIMIT_WINDOW_MS).toBe('string');
      expect(typeof env.RATE_LIMIT_MAX_REQUESTS).toBe('string');

      // All should parse to valid numbers
      expect(Number.isNaN(parseInt(env.MAX_FILE_SIZE, 10))).toBe(false);
      expect(Number.isNaN(parseInt(env.RATE_LIMIT_WINDOW_MS, 10))).toBe(false);
      expect(Number.isNaN(parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10))).toBe(false);
    });

    it('should handle HOST as string', () => {
      expect(typeof env.HOST).toBe('string');
      expect(env.HOST.length).toBeGreaterThan(0);
    });

    it('should validate NODE_ENV enum values', () => {
      const validEnvs = ['development', 'staging', 'production'];
      expect(validEnvs).toContain(env.NODE_ENV);
    });

    it('should validate LOG_LEVEL enum values', () => {
      const validLevels = ['error', 'warn', 'info', 'debug'];
      expect(validLevels).toContain(env.LOG_LEVEL);
    });
  });

  describe('Type Conversions and Validations', () => {
    it('should convert PORT string to number correctly', () => {
      const portString = env.PORT;
      const portNumber = serverConfig.port;

      expect(typeof portString).toBe('string');
      expect(typeof portNumber).toBe('number');
      expect(parseInt(portString, 10)).toBe(portNumber);
    });

    it('should convert MAX_FILE_SIZE correctly', () => {
      const maxFileSizeString = env.MAX_FILE_SIZE;
      const maxFileSizeNumber = securityConfig.maxFileSize;

      expect(parseInt(maxFileSizeString, 10)).toBe(maxFileSizeNumber);
    });

    it('should convert RATE_LIMIT_WINDOW_MS correctly', () => {
      const windowMsString = env.RATE_LIMIT_WINDOW_MS;
      const windowMsNumber = securityConfig.rateLimitWindowMs;

      expect(parseInt(windowMsString, 10)).toBe(windowMsNumber);
    });

    it('should convert RATE_LIMIT_MAX_REQUESTS correctly', () => {
      const maxRequestsString = env.RATE_LIMIT_MAX_REQUESTS;
      const maxRequestsNumber = securityConfig.rateLimitMaxRequests;

      expect(parseInt(maxRequestsString, 10)).toBe(maxRequestsNumber);
    });

    it('should handle base 10 parsing explicitly', () => {
      // Ensure all parseInt calls use radix 10
      const portParsed = parseInt(env.PORT, 10);
      const maxFileSizeParsed = parseInt(env.MAX_FILE_SIZE, 10);
      const windowMsParsed = parseInt(env.RATE_LIMIT_WINDOW_MS, 10);
      const maxRequestsParsed = parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10);

      expect(portParsed).toBe(serverConfig.port);
      expect(maxFileSizeParsed).toBe(securityConfig.maxFileSize);
      expect(windowMsParsed).toBe(securityConfig.rateLimitWindowMs);
      expect(maxRequestsParsed).toBe(securityConfig.rateLimitMaxRequests);
    });
  });

  describe('URL Validation', () => {
    it('should validate DATABASE_URL structure', () => {
      const dbUrl = env.DATABASE_URL;

      expect(dbUrl).toContain('://');
      expect(dbUrl).toContain('@');
      expect(dbUrl.split('://')[0]).toBe('postgresql');
    });

    it('should handle REDIS_URL when present', () => {
      if (env.REDIS_URL && env.REDIS_URL !== '') {
        expect(env.REDIS_URL).toContain('://');
        expect(['redis', 'rediss']).toContain(env.REDIS_URL.split('://')[0]!);
      }
    });

    it('should validate URL protocols', () => {
      expect(env.DATABASE_URL.startsWith('postgresql://')).toBe(true);

      if (env.REDIS_URL) {
        const hasValidProtocol =
          env.REDIS_URL.startsWith('redis://') ||
          env.REDIS_URL.startsWith('rediss://');
        expect(hasValidProtocol).toBe(true);
      }
    });
  });

  describe('Helper Function Coverage', () => {
    it('should have isProduction return false for development', () => {
      expect(isProduction()).toBe(false);
    });

    it('should have isDevelopment return true for development', () => {
      expect(isDevelopment()).toBe(true);
    });

    it('should have isStaging return false for development', () => {
      expect(isStaging()).toBe(false);
    });

    it('should have exactly one environment helper return true', () => {
      const results = [isProduction(), isDevelopment(), isStaging()];
      const trueCount = results.filter(r => r === true).length;
      expect(trueCount).toBe(1);
    });

    it('should have environment helpers return boolean values', () => {
      expect(typeof isProduction()).toBe('boolean');
      expect(typeof isDevelopment()).toBe('boolean');
      expect(typeof isStaging()).toBe('boolean');
    });
  });

  describe('Default Value Behavior', () => {
    it('should use default PORT value when provided', () => {
      // PORT is set to 4000 in test setup
      expect(env.PORT).toBe('4000');
    });

    it('should use default HOST value when provided', () => {
      // HOST is set to localhost in test setup
      expect(env.HOST).toBe('localhost');
    });

    it('should use default LOG_LEVEL value when provided', () => {
      // LOG_LEVEL is set to info in test setup
      expect(env.LOG_LEVEL).toBe('info');
    });

    it('should use default MAX_FILE_SIZE value when provided', () => {
      // MAX_FILE_SIZE is set in test setup
      expect(env.MAX_FILE_SIZE).toBe('5242880');
    });

    it('should use default RATE_LIMIT_WINDOW_MS when provided', () => {
      expect(env.RATE_LIMIT_WINDOW_MS).toBe('900000');
    });

    it('should use default RATE_LIMIT_MAX_REQUESTS when provided', () => {
      expect(env.RATE_LIMIT_MAX_REQUESTS).toBe('10000');
    });
  });

  describe('Config Type Safety', () => {
    it('should have serverConfig with correct types', () => {
      expect(typeof serverConfig.port).toBe('number');
      expect(typeof serverConfig.host).toBe('string');
      expect(serverConfig.port).toBeGreaterThan(0);
      expect(serverConfig.host.length).toBeGreaterThan(0);
    });

    it('should have authConfig with correct types', () => {
      expect(typeof authConfig.jwtSecret).toBe('string');
      expect(typeof authConfig.jwtRefreshSecret).toBe('string');
      expect(authConfig.jwtSecret.length).toBeGreaterThanOrEqual(32);
      expect(authConfig.jwtRefreshSecret.length).toBeGreaterThanOrEqual(32);
    });

    it('should have databaseConfig with correct types', () => {
      expect(typeof databaseConfig.url).toBe('string');
      expect(databaseConfig.url).toContain('postgresql://');
    });

    it('should have securityConfig with correct types', () => {
      expect(typeof securityConfig.maxFileSize).toBe('number');
      expect(typeof securityConfig.rateLimitWindowMs).toBe('number');
      expect(typeof securityConfig.rateLimitMaxRequests).toBe('number');
      expect(securityConfig.maxFileSize).toBeGreaterThan(0);
      expect(securityConfig.rateLimitWindowMs).toBeGreaterThan(0);
      expect(securityConfig.rateLimitMaxRequests).toBeGreaterThan(0);
    });
  });
});
