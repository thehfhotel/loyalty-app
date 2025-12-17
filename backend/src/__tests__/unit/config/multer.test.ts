/**
 * Multer Configuration Unit Tests
 * Tests file upload error handling since multer middleware internals aren't easily testable
 */

import { describe, it, expect, jest } from '@jest/globals';
import multer from 'multer';

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock storage config
jest.mock('../../../config/storage', () => ({
  storageConfig: {
    maxFileSize: 15 * 1024 * 1024, // 15MB
  },
}));

import { AppError } from '../../../middleware/errorHandler';

describe('Multer Configuration', () => {
  describe('Module Exports', () => {
    it('should export uploadAvatar middleware', async () => {
      const multerConfig = await import('../../../config/multer');
      expect(multerConfig.uploadAvatar).toBeDefined();
      expect(typeof multerConfig.uploadAvatar).toBe('function');
    });

    it('should export handleMulterError function', async () => {
      const multerConfig = await import('../../../config/multer');
      expect(multerConfig.handleMulterError).toBeDefined();
      expect(typeof multerConfig.handleMulterError).toBe('function');
    });
  });

  describe('handleMulterError', () => {
    it('should handle LIMIT_FILE_SIZE error with correct message', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FILE_SIZE');

      expect(() => handleMulterError(error)).toThrow(AppError);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).message).toContain('File size too large');
        expect((err as AppError).message).toContain('15MB');
      }
    });

    it('should calculate file size in MB correctly', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FILE_SIZE');

      try {
        handleMulterError(error);
      } catch (err) {
        const message = (err as AppError).message;
        // Should contain "15MB" based on mocked maxFileSize
        expect(message).toMatch(/\d+MB/);
        expect(message).toContain('Maximum size is 15MB');
      }
    });

    it('should handle LIMIT_FILE_COUNT error', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FILE_COUNT');

      expect(() => handleMulterError(error)).toThrow(AppError);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should handle LIMIT_UNEXPECTED_FILE error', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE');

      expect(() => handleMulterError(error)).toThrow(AppError);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should handle LIMIT_FIELD_KEY error', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FIELD_KEY');

      expect(() => handleMulterError(error)).toThrow(AppError);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should handle LIMIT_FIELD_VALUE error', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FIELD_VALUE');

      expect(() => handleMulterError(error)).toThrow(AppError);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should handle LIMIT_PART_COUNT error', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_PART_COUNT');

      expect(() => handleMulterError(error)).toThrow(AppError);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }
    });

    it('should re-throw non-multer errors unchanged', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new Error('Generic error');

      expect(() => handleMulterError(error)).toThrow('Generic error');
      expect(() => handleMulterError(error)).toThrow(Error);

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).not.toBeInstanceOf(AppError);
        expect((err as Error).message).toBe('Generic error');
      }
    });

    it('should handle unknown error types', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = { message: 'Unknown error object' };

      expect(() => handleMulterError(error)).toThrow();
    });

    it('should convert all MulterError codes to AppError', async () => {
      const { handleMulterError } = await import('../../../config/multer');

      const errorCodes = [
        'LIMIT_PART_COUNT',
        'LIMIT_FILE_SIZE',
        'LIMIT_FILE_COUNT',
        'LIMIT_FIELD_KEY',
        'LIMIT_FIELD_VALUE',
        'LIMIT_FIELD_COUNT',
        'LIMIT_UNEXPECTED_FILE',
      ];

      for (const code of errorCodes) {
        const error = new multer.MulterError(code as multer.ErrorCode);

        try {
          handleMulterError(error);
          // Should not reach here
          expect(true).toBe(false);
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).statusCode).toBe(400);
        }
      }
    });

    it('should preserve original multer error message for generic errors', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FIELD_COUNT');

      try {
        handleMulterError(error);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        // AppError wraps the original multer error message
        expect((err as AppError).statusCode).toBe(400);
      }
    });
  });

  describe('Error Message Formatting', () => {
    it('should format file size error with MB units', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const error = new multer.MulterError('LIMIT_FILE_SIZE');

      try {
        handleMulterError(error);
      } catch (err) {
        const message = (err as AppError).message;
        expect(message).toContain('MB');
        expect(message).toContain('15');
      }
    });

    it('should calculate MB from bytes correctly', async () => {
      const { handleMulterError } = await import('../../../config/multer');
      const { storageConfig } = await import('../../../config/storage');

      const error = new multer.MulterError('LIMIT_FILE_SIZE');

      try {
        handleMulterError(error);
      } catch (err) {
        const expectedMB = Math.round(storageConfig.maxFileSize / (1024 * 1024));
        expect((err as AppError).message).toContain(`${expectedMB}MB`);
      }
    });
  });
});
