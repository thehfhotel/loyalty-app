/**
 * Logger Unit Tests
 * Tests Winston logger configuration, exports, and basic functionality
 */

import { describe, it, expect } from '@jest/globals';
import { logger } from '../../../utils/logger';
import winston from 'winston';

describe('Logger Utils', () => {
  describe('Logger export', () => {
    it('should export logger instance', () => {
      expect(logger).toBeDefined();
    });

    it('should be a Winston logger instance', () => {
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('error');
      expect(logger).toHaveProperty('warn');
      expect(logger).toHaveProperty('debug');
    });

    it('should have log method', () => {
      expect(typeof logger.log).toBe('function');
    });

    it('should have info method', () => {
      expect(typeof logger.info).toBe('function');
    });

    it('should have error method', () => {
      expect(typeof logger.error).toBe('function');
    });

    it('should have warn method', () => {
      expect(typeof logger.warn).toBe('function');
    });

    it('should have debug method', () => {
      expect(typeof logger.debug).toBe('function');
    });
  });

  describe('Logger configuration', () => {
    it('should have a log level configured', () => {
      expect(logger.level).toBeDefined();
      expect(typeof logger.level).toBe('string');
    });

    it('should have valid log level', () => {
      const validLevels = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'];
      expect(validLevels).toContain(logger.level);
    });

    it('should have transports configured', () => {
      expect(logger.transports).toBeDefined();
      expect(Array.isArray(logger.transports)).toBe(true);
      expect(logger.transports.length).toBeGreaterThan(0);
    });

    it('should have at least console transport', () => {
      const hasConsoleTransport = logger.transports.some(
        transport => transport instanceof winston.transports.Console
      );
      expect(hasConsoleTransport).toBe(true);
    });
  });

  describe('Logging methods', () => {
    it('should not throw when logging info message', () => {
      expect(() => {
        logger.info('Test info message');
      }).not.toThrow();
    });

    it('should not throw when logging error message', () => {
      expect(() => {
        logger.error('Test error message');
      }).not.toThrow();
    });

    it('should not throw when logging warn message', () => {
      expect(() => {
        logger.warn('Test warn message');
      }).not.toThrow();
    });

    it('should not throw when logging debug message', () => {
      expect(() => {
        logger.debug('Test debug message');
      }).not.toThrow();
    });

    it('should handle logging with metadata', () => {
      expect(() => {
        logger.info('Test message with metadata', { userId: '123', action: 'test' });
      }).not.toThrow();
    });

    it('should handle logging errors with stack traces', () => {
      const testError = new Error('Test error');
      expect(() => {
        logger.error('Error occurred', testError);
      }).not.toThrow();
    });

    it('should handle logging undefined', () => {
      expect(() => {
        logger.info('Value is undefined', { value: undefined });
      }).not.toThrow();
    });

    it('should handle logging null', () => {
      expect(() => {
        logger.info('Value is null', { value: null });
      }).not.toThrow();
    });

    it('should handle logging empty string', () => {
      expect(() => {
        logger.info('');
      }).not.toThrow();
    });

    it('should handle logging objects', () => {
      expect(() => {
        logger.info('Object log', { complex: { nested: { object: true } } });
      }).not.toThrow();
    });

    it('should handle logging arrays', () => {
      expect(() => {
        logger.info('Array log', { items: [1, 2, 3, 'test'] });
      }).not.toThrow();
    });

    it('should handle multiple arguments', () => {
      expect(() => {
        logger.info('Multiple', 'arguments', { test: true });
      }).not.toThrow();
    });
  });

  describe('Log levels', () => {
    it('should respect log level hierarchy', () => {
      const levels = ['error', 'warn', 'info', 'debug'];
      expect(levels).toContain(logger.level);
    });

    it('should have Winston default levels', () => {
      expect(logger.levels).toBeDefined();
    });
  });

  describe('Transport configuration', () => {
    it('should have at least one transport', () => {
      expect(logger.transports.length).toBeGreaterThan(0);
    });

    it('should have console transport for development', () => {
      const consoleTransport = logger.transports.find(
        t => t instanceof winston.transports.Console
      );
      expect(consoleTransport).toBeDefined();
    });

    it('should have working transports', () => {
      logger.transports.forEach(transport => {
        expect(transport).toHaveProperty('level');
      });
    });
  });

  describe('Error handling', () => {
    it('should detect circular reference in logged object', () => {
      const circular: Record<string, unknown> = { name: 'test' };
      circular.self = circular;

      // Winston console format will throw on circular references during JSON.stringify
      expect(() => {
        logger.info('Circular object', { data: circular });
      }).toThrow();
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      expect(() => {
        logger.info(longString);
      }).not.toThrow();
    });

    it('should handle special characters', () => {
      expect(() => {
        logger.info('Special chars: \n\t\r\0');
      }).not.toThrow();
    });

    it('should handle unicode characters', () => {
      expect(() => {
        logger.info('Unicode: 你好 мир 🌍');
      }).not.toThrow();
    });

    it('should handle Error objects', () => {
      const error = new Error('Test error');
      error.stack = 'Test stack trace';

      expect(() => {
        logger.error('Error test', { error });
      }).not.toThrow();
    });

    it('should handle non-Error exceptions', () => {
      expect(() => {
        logger.error('String exception', 'This is a string error');
      }).not.toThrow();
    });

    it('should handle logging functions', () => {
      expect(() => {
        logger.info('Function log', { fn: () => {} });
      }).not.toThrow();
    });

    it('should handle logging symbols', () => {
      expect(() => {
        logger.info('Symbol log', { sym: Symbol('test') });
      }).not.toThrow();
    });
  });

  describe('Integration scenarios', () => {
    it('should log multiple messages in sequence', () => {
      expect(() => {
        logger.info('Message 1');
        logger.warn('Message 2');
        logger.error('Message 3');
        logger.debug('Message 4');
      }).not.toThrow();
    });

    it('should handle rapid sequential logging', () => {
      expect(() => {
        for (let i = 0; i < 100; i++) {
          logger.info(`Rapid log ${i}`);
        }
      }).not.toThrow();
    });

    it('should support logging with consistent metadata', () => {
      const metadata = { requestId: '12345', userId: '67890' };

      expect(() => {
        logger.info('Start request', metadata);
        logger.info('Processing request', metadata);
        logger.info('End request', metadata);
      }).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle logging without message', () => {
      expect(() => {
        logger.info('');
      }).not.toThrow();
    });

    it('should handle logging only metadata', () => {
      expect(() => {
        logger.log({ level: 'info', message: '', metadata: { test: true } });
      }).not.toThrow();
    });

    it('should handle deeply nested objects', () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };

      expect(() => {
        logger.info('Deep object', deep);
      }).not.toThrow();
    });

    it('should handle large arrays', () => {
      const largeArray = Array(1000).fill('test');

      expect(() => {
        logger.info('Large array', { arr: largeArray });
      }).not.toThrow();
    });

    it('should handle mixed type arguments', () => {
      expect(() => {
        logger.info('Mixed', 123, true, null, undefined, { obj: 'test' });
      }).not.toThrow();
    });

    it('should handle Buffer objects', () => {
      const buffer = Buffer.from('test');

      expect(() => {
        logger.info('Buffer log', { buffer });
      }).not.toThrow();
    });

    it('should handle Date objects', () => {
      expect(() => {
        logger.info('Date log', { date: new Date() });
      }).not.toThrow();
    });

    it('should handle RegExp objects', () => {
      expect(() => {
        logger.info('RegExp log', { pattern: /test/i });
      }).not.toThrow();
    });

    it('should handle Map objects', () => {
      const map = new Map([['key', 'value']]);

      expect(() => {
        logger.info('Map log', { map });
      }).not.toThrow();
    });

    it('should handle Set objects', () => {
      const set = new Set([1, 2, 3]);

      expect(() => {
        logger.info('Set log', { set });
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle high frequency logging efficiently', () => {
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        logger.info(`Performance test ${i}`);
      }

      const duration = Date.now() - startTime;
      // Should complete within reasonable time (generous limit for CI)
      expect(duration).toBeLessThan(5000);
    });

    it('should handle large metadata objects efficiently', () => {
      const largeMeta = {
        data: Array(100).fill(0).map((_, i) => ({ id: i, value: `test${i}` }))
      };

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        logger.info('Large metadata', largeMeta);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000);
    });
  });
});
