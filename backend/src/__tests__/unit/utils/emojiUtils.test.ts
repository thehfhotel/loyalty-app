/**
 * Emoji Utils Unit Tests
 * Tests emoji avatar validation, generation, and utility functions
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  PROFILE_EMOJIS,
  getRandomEmojiAvatar,
  isValidEmojiAvatar,
  generateEmojiAvatarUrl,
  extractEmojiFromUrl,
  validateEmojiAvatar,
} from '../../../utils/emojiUtils';

describe('Emoji Utils', () => {
  describe('PROFILE_EMOJIS constant', () => {
    it('should contain emoji characters', () => {
      expect(PROFILE_EMOJIS.length).toBeGreaterThan(0);
      expect(Array.isArray(PROFILE_EMOJIS)).toBe(true);
    });

    it('should contain only string values', () => {
      PROFILE_EMOJIS.forEach((emoji) => {
        expect(typeof emoji).toBe('string');
      });
    });

    it('should not contain empty strings', () => {
      PROFILE_EMOJIS.forEach((emoji) => {
        expect(emoji.length).toBeGreaterThan(0);
      });
    });

    it('should have duplicates tracked (implementation detail)', () => {
      const uniqueEmojis = new Set(PROFILE_EMOJIS);
      // Note: The PROFILE_EMOJIS list intentionally contains some duplicates
      // This test documents the current state
      expect(uniqueEmojis.size).toBeLessThan(PROFILE_EMOJIS.length);
      expect(PROFILE_EMOJIS.length).toBe(299);
      expect(uniqueEmojis.size).toBe(273);
    });

    it('should contain common face emojis', () => {
      expect(PROFILE_EMOJIS).toContain('😀');
      expect(PROFILE_EMOJIS).toContain('😊');
      expect(PROFILE_EMOJIS).toContain('🙂');
    });

    it('should contain animal emojis', () => {
      expect(PROFILE_EMOJIS).toContain('🐶');
      expect(PROFILE_EMOJIS).toContain('🐱');
      expect(PROFILE_EMOJIS).toContain('🦊');
    });

    it('should have a reasonable size for variety', () => {
      expect(PROFILE_EMOJIS.length).toBeGreaterThan(100);
    });
  });

  describe('getRandomEmojiAvatar', () => {
    it('should return a valid emoji', () => {
      const emoji = getRandomEmojiAvatar();
      expect(PROFILE_EMOJIS).toContain(emoji);
    });

    it('should return a string', () => {
      const emoji = getRandomEmojiAvatar();
      expect(typeof emoji).toBe('string');
    });

    it('should return non-empty string', () => {
      const emoji = getRandomEmojiAvatar();
      expect(emoji.length).toBeGreaterThan(0);
    });

    it('should return different emojis on multiple calls (statistical)', () => {
      const emojis = new Set<string>();
      for (let i = 0; i < 50; i++) {
        emojis.add(getRandomEmojiAvatar());
      }
      // With 50 calls and 100+ emojis, we should get some variety
      expect(emojis.size).toBeGreaterThan(5);
    });

    it('should handle multiple consecutive calls', () => {
      for (let i = 0; i < 10; i++) {
        const emoji = getRandomEmojiAvatar();
        expect(PROFILE_EMOJIS).toContain(emoji);
      }
    });

    it('should throw error if emoji generation fails', () => {
      // Mock Math.random to return invalid index
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 1) as unknown as () => number;

      // Should throw when emoji is undefined
      expect(() => {
        getRandomEmojiAvatar();
      }).toThrow('Failed to generate random emoji avatar');

      Math.random = originalRandom;
    });

    it('should work with mocked Math.random at boundary values', () => {
      const originalRandom = Math.random;

      // Test at 0
      Math.random = jest.fn(() => 0) as unknown as () => number;
      const firstEmoji = getRandomEmojiAvatar();
      expect(PROFILE_EMOJIS).toContain(firstEmoji);

      // Test at near 1 (but not exactly 1)
      Math.random = jest.fn(() => 0.999999) as unknown as () => number;
      const lastEmoji = getRandomEmojiAvatar();
      expect(PROFILE_EMOJIS).toContain(lastEmoji);

      Math.random = originalRandom;
    });
  });

  describe('isValidEmojiAvatar', () => {
    it('should return true for valid emojis', () => {
      expect(isValidEmojiAvatar('😀')).toBe(true);
      expect(isValidEmojiAvatar('🐶')).toBe(true);
      expect(isValidEmojiAvatar('👨‍💻')).toBe(true);
    });

    it('should return false for invalid emojis', () => {
      expect(isValidEmojiAvatar('🚀')).toBe(false); // Not in list
      expect(isValidEmojiAvatar('🏠')).toBe(false); // Not in list
    });

    it('should return false for non-emoji strings', () => {
      expect(isValidEmojiAvatar('abc')).toBe(false);
      expect(isValidEmojiAvatar('123')).toBe(false);
      expect(isValidEmojiAvatar('text')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidEmojiAvatar('')).toBe(false);
    });

    it('should return false for whitespace', () => {
      expect(isValidEmojiAvatar(' ')).toBe(false);
      expect(isValidEmojiAvatar('  ')).toBe(false);
      expect(isValidEmojiAvatar('\t')).toBe(false);
      expect(isValidEmojiAvatar('\n')).toBe(false);
    });

    it('should return false for special characters', () => {
      expect(isValidEmojiAvatar('@')).toBe(false);
      expect(isValidEmojiAvatar('#')).toBe(false);
      expect(isValidEmojiAvatar('$')).toBe(false);
    });

    it('should handle multi-character emoji sequences', () => {
      // Some emojis are multi-character sequences
      const multiCharEmoji = PROFILE_EMOJIS.find((e) => e.length > 2);
      if (multiCharEmoji) {
        expect(isValidEmojiAvatar(multiCharEmoji)).toBe(true);
      }
    });

    it('should be case-sensitive for text', () => {
      expect(isValidEmojiAvatar('ABC')).toBe(false);
      expect(isValidEmojiAvatar('abc')).toBe(false);
    });

    it('should reject emoji with extra characters', () => {
      expect(isValidEmojiAvatar('😀 ')).toBe(false);
      expect(isValidEmojiAvatar(' 😀')).toBe(false);
      expect(isValidEmojiAvatar('😀😊')).toBe(false);
    });

    it('should validate all emojis in PROFILE_EMOJIS', () => {
      PROFILE_EMOJIS.forEach((emoji) => {
        expect(isValidEmojiAvatar(emoji)).toBe(true);
      });
    });
  });

  describe('generateEmojiAvatarUrl', () => {
    it('should generate URL with emoji: prefix', () => {
      const url = generateEmojiAvatarUrl('😀');
      expect(url).toBe('emoji:😀');
    });

    it('should handle various valid emojis', () => {
      expect(generateEmojiAvatarUrl('😀')).toBe('emoji:😀');
      expect(generateEmojiAvatarUrl('🐶')).toBe('emoji:🐶');
      expect(generateEmojiAvatarUrl('👨‍💻')).toBe('emoji:👨‍💻');
    });

    it('should not validate input emoji', () => {
      // Function doesn't validate, just formats
      expect(generateEmojiAvatarUrl('invalid')).toBe('emoji:invalid');
      expect(generateEmojiAvatarUrl('')).toBe('emoji:');
    });

    it('should handle multi-character emoji sequences', () => {
      const url = generateEmojiAvatarUrl('👨‍⚕️');
      expect(url).toBe('emoji:👨‍⚕️');
    });

    it('should handle empty string', () => {
      const url = generateEmojiAvatarUrl('');
      expect(url).toBe('emoji:');
    });

    it('should handle special characters', () => {
      const url = generateEmojiAvatarUrl('test@#$');
      expect(url).toBe('emoji:test@#$');
    });

    it('should not add extra whitespace', () => {
      const url = generateEmojiAvatarUrl('😀');
      expect(url).not.toContain(' ');
    });

    it('should be reversible with extractEmojiFromUrl', () => {
      const emoji = '😀';
      const url = generateEmojiAvatarUrl(emoji);
      const extracted = extractEmojiFromUrl(url);
      expect(extracted).toBe(emoji);
    });
  });

  describe('extractEmojiFromUrl', () => {
    it('should extract emoji from valid URL', () => {
      expect(extractEmojiFromUrl('emoji:😀')).toBe('😀');
      expect(extractEmojiFromUrl('emoji:🐶')).toBe('🐶');
      expect(extractEmojiFromUrl('emoji:👨‍💻')).toBe('👨‍💻');
    });

    it('should return null for non-emoji URLs', () => {
      expect(extractEmojiFromUrl('https://example.com/avatar.jpg')).toBeNull();
      expect(extractEmojiFromUrl('/storage/avatars/user.jpg')).toBeNull();
      expect(extractEmojiFromUrl('data:image/png;base64,abc')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(extractEmojiFromUrl(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(extractEmojiFromUrl(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractEmojiFromUrl('')).toBeNull();
    });

    it('should validate extracted emoji', () => {
      // Valid emoji
      expect(extractEmojiFromUrl('emoji:😀')).toBe('😀');

      // Invalid emoji (not in PROFILE_EMOJIS)
      expect(extractEmojiFromUrl('emoji:🚀')).toBeNull();
      expect(extractEmojiFromUrl('emoji:invalid')).toBeNull();
    });

    it('should handle URLs with emoji: but invalid emoji', () => {
      expect(extractEmojiFromUrl('emoji:abc')).toBeNull();
      expect(extractEmojiFromUrl('emoji:123')).toBeNull();
      expect(extractEmojiFromUrl('emoji:')).toBeNull();
    });

    it('should handle URLs without emoji: prefix', () => {
      expect(extractEmojiFromUrl('😀')).toBeNull();
      expect(extractEmojiFromUrl('notanemojiurl')).toBeNull();
    });

    it('should handle whitespace in URLs', () => {
      expect(extractEmojiFromUrl('emoji: 😀')).toBeNull(); // Space after colon
      expect(extractEmojiFromUrl('emoji:😀 ')).toBeNull(); // Space after emoji
      expect(extractEmojiFromUrl(' emoji:😀')).toBeNull(); // Space before prefix
    });

    it('should handle case sensitivity', () => {
      expect(extractEmojiFromUrl('EMOJI:😀')).toBeNull();
      expect(extractEmojiFromUrl('Emoji:😀')).toBeNull();
    });

    it('should extract multi-character emoji sequences', () => {
      const emoji = '👨‍⚕️';
      const url = generateEmojiAvatarUrl(emoji);
      expect(extractEmojiFromUrl(url)).toBe(emoji);
    });
  });

  describe('validateEmojiAvatar', () => {
    it('should validate correct emoji', () => {
      const result = validateEmojiAvatar('😀');
      expect(result.isValid).toBe(true);
      expect(result.emoji).toBe('😀');
      expect(result.error).toBeUndefined();
    });

    it('should validate multiple correct emojis', () => {
      ['😀', '🐶', '👨‍💻', '🦊'].forEach((emoji) => {
        if (PROFILE_EMOJIS.includes(emoji)) {
          const result = validateEmojiAvatar(emoji);
          expect(result.isValid).toBe(true);
          expect(result.emoji).toBe(emoji);
        }
      });
    });

    it('should reject empty string', () => {
      const result = validateEmojiAvatar('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Emoji is required');
      expect(result.emoji).toBeUndefined();
    });

    it('should reject invalid emoji', () => {
      const result = validateEmojiAvatar('🚀');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid emoji selection');
      expect(result.emoji).toBeUndefined();
    });

    it('should reject non-emoji strings', () => {
      const result = validateEmojiAvatar('not-an-emoji');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid emoji selection');
      expect(result.emoji).toBeUndefined();
    });

    it('should reject whitespace', () => {
      const result = validateEmojiAvatar('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid emoji selection');
    });

    it('should reject special characters', () => {
      ['@', '#', '$', '%', '^'].forEach((char) => {
        const result = validateEmojiAvatar(char);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Invalid emoji selection');
      });
    });

    it('should reject numbers', () => {
      const result = validateEmojiAvatar('123');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid emoji selection');
    });

    it('should have consistent error structure', () => {
      const invalidResult = validateEmojiAvatar('invalid');
      expect(invalidResult).toHaveProperty('isValid');
      expect(invalidResult).toHaveProperty('error');

      const validResult = validateEmojiAvatar('😀');
      expect(validResult).toHaveProperty('isValid');
      expect(validResult).toHaveProperty('emoji');
    });

    it('should validate all profile emojis', () => {
      PROFILE_EMOJIS.forEach((emoji) => {
        const result = validateEmojiAvatar(emoji);
        expect(result.isValid).toBe(true);
        expect(result.emoji).toBe(emoji);
      });
    });

    it('should handle multi-character emoji sequences', () => {
      const emoji = '👨‍💻';
      if (PROFILE_EMOJIS.includes(emoji)) {
        const result = validateEmojiAvatar(emoji);
        expect(result.isValid).toBe(true);
        expect(result.emoji).toBe(emoji);
      }
    });
  });

  describe('Integration scenarios', () => {
    it('should support complete avatar workflow', () => {
      // Generate random emoji
      const emoji = getRandomEmojiAvatar();

      // Validate it
      const validationResult = validateEmojiAvatar(emoji);
      expect(validationResult.isValid).toBe(true);

      // Generate URL
      const url = generateEmojiAvatarUrl(emoji);
      expect(url).toContain('emoji:');

      // Extract and verify
      const extracted = extractEmojiFromUrl(url);
      expect(extracted).toBe(emoji);
    });

    it('should handle invalid emoji in workflow', () => {
      const invalidEmoji = '🚀';

      // Validation should fail
      const validationResult = validateEmojiAvatar(invalidEmoji);
      expect(validationResult.isValid).toBe(false);

      // URL generation works (doesn't validate)
      const url = generateEmojiAvatarUrl(invalidEmoji);
      expect(url).toBe('emoji:🚀');

      // Extraction fails validation
      const extracted = extractEmojiFromUrl(url);
      expect(extracted).toBeNull();
    });

    it('should validate random emoji generation', () => {
      for (let i = 0; i < 10; i++) {
        const emoji = getRandomEmojiAvatar();
        expect(isValidEmojiAvatar(emoji)).toBe(true);
      }
    });

    it('should handle roundtrip conversion', () => {
      const originalEmoji = '😊';
      const url = generateEmojiAvatarUrl(originalEmoji);
      const extractedEmoji = extractEmojiFromUrl(url);
      expect(extractedEmoji).toBe(originalEmoji);
    });

    it('should maintain emoji integrity through full cycle', () => {
      // Pick random emoji from list
      const randomIndex = Math.floor(Math.random() * PROFILE_EMOJIS.length);
      const emoji = PROFILE_EMOJIS[randomIndex];

      if (emoji) {
        // Validate
        expect(isValidEmojiAvatar(emoji)).toBe(true);

        // Generate URL
        const url = generateEmojiAvatarUrl(emoji);

        // Extract
        const extracted = extractEmojiFromUrl(url);

        // Verify
        expect(extracted).toBe(emoji);

        // Validate again
        const validation = validateEmojiAvatar(extracted ?? '');
        expect(validation.isValid).toBe(true);
      }
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle emoji with skin tone modifiers', () => {
      // Test if skin tone modifiers are in the list
      const skinToneEmojis = PROFILE_EMOJIS.filter((e) => e.includes('\u{1F3FB}') || e.includes('\u{1F3FC}'));

      skinToneEmojis.forEach((emoji) => {
        expect(isValidEmojiAvatar(emoji)).toBe(true);
        const url = generateEmojiAvatarUrl(emoji);
        const extracted = extractEmojiFromUrl(url);
        expect(extracted).toBe(emoji);
      });
    });

    it('should handle zero-width joiners in emoji', () => {
      // Some emojis use zero-width joiners (ZWJ)
      const zwjEmojis = PROFILE_EMOJIS.filter((e) => e.includes('\u200D'));

      expect(zwjEmojis.length).toBeGreaterThan(0);

      zwjEmojis.forEach((emoji) => {
        expect(isValidEmojiAvatar(emoji)).toBe(true);
      });
    });

    it('should handle emoji variation selectors', () => {
      // Some emojis have variation selectors
      const variationEmojis = PROFILE_EMOJIS.filter((e) => e.includes('\uFE0F'));

      variationEmojis.forEach((emoji) => {
        expect(isValidEmojiAvatar(emoji)).toBe(true);
      });
    });

    it('should reject concatenated emojis', () => {
      const concatenated = '😀😊';
      expect(isValidEmojiAvatar(concatenated)).toBe(false);
    });

    it('should handle very long invalid strings', () => {
      const longString = 'invalid'.repeat(1000);
      expect(isValidEmojiAvatar(longString)).toBe(false);

      const result = validateEmojiAvatar(longString);
      expect(result.isValid).toBe(false);
    });
  });

  // Performance tests moved to: __tests__/performance/benchmarks/utils.benchmark.ts
});
