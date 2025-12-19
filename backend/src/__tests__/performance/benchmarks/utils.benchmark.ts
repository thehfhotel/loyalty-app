/**
 * Consolidated utility performance benchmarks
 * Run via: npm run test:perf
 *
 * These tests were moved from unit tests to prevent flaky CI failures.
 * Unit tests should verify correctness, not speed.
 */

import {
  formatDateToDDMMYYYY,
  isValidDDMMYYYYFormat,
  parseDDMMYYYY,
} from '../../../utils/dateFormatter';
import {
  isValidEmojiAvatar,
  getRandomEmojiAvatar,
  extractEmojiFromUrl,
} from '../../../utils/emojiUtils';

describe('Utility Performance Benchmarks', () => {
  const ITERATIONS = 1000;
  // Relaxed thresholds for CI variability (5x normal expectations)
  const RELAXED_THRESHOLD = 500;

  describe('Date Formatter', () => {
    it('formatDateToDDMMYYYY benchmark', () => {
      const date = new Date('2025-06-15');
      const start = Date.now();

      for (let i = 0; i < ITERATIONS; i++) {
        formatDateToDDMMYYYY(date);
      }

      const duration = Date.now() - start;
      console.log(`formatDateToDDMMYYYY: ${ITERATIONS}x in ${duration}ms`);
      expect(duration).toBeLessThan(RELAXED_THRESHOLD);
    });

    it('isValidDDMMYYYYFormat benchmark', () => {
      const start = Date.now();

      for (let i = 0; i < ITERATIONS; i++) {
        isValidDDMMYYYYFormat('31/12/2025');
      }

      const duration = Date.now() - start;
      console.log(`isValidDDMMYYYYFormat: ${ITERATIONS}x in ${duration}ms`);
      expect(duration).toBeLessThan(RELAXED_THRESHOLD);
    });

    it('parseDDMMYYYY benchmark', () => {
      const start = Date.now();

      for (let i = 0; i < ITERATIONS; i++) {
        parseDDMMYYYY('31/12/2025');
      }

      const duration = Date.now() - start;
      console.log(`parseDDMMYYYY: ${ITERATIONS}x in ${duration}ms`);
      expect(duration).toBeLessThan(RELAXED_THRESHOLD);
    });
  });

  describe('Emoji Utils', () => {
    it('isValidEmojiAvatar benchmark', () => {
      const start = Date.now();

      for (let i = 0; i < ITERATIONS; i++) {
        isValidEmojiAvatar('😀');
      }

      const duration = Date.now() - start;
      console.log(`isValidEmojiAvatar: ${ITERATIONS}x in ${duration}ms`);
      expect(duration).toBeLessThan(RELAXED_THRESHOLD);
    });

    it('getRandomEmojiAvatar benchmark', () => {
      const start = Date.now();

      for (let i = 0; i < ITERATIONS; i++) {
        getRandomEmojiAvatar();
      }

      const duration = Date.now() - start;
      console.log(`getRandomEmojiAvatar: ${ITERATIONS}x in ${duration}ms`);
      expect(duration).toBeLessThan(RELAXED_THRESHOLD);
    });

    it('extractEmojiFromUrl benchmark', () => {
      const start = Date.now();

      for (let i = 0; i < ITERATIONS; i++) {
        extractEmojiFromUrl('emoji:😀');
      }

      const duration = Date.now() - start;
      console.log(`extractEmojiFromUrl: ${ITERATIONS}x in ${duration}ms`);
      expect(duration).toBeLessThan(RELAXED_THRESHOLD);
    });
  });
});
