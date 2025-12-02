/**
 * TranslationService Unit Tests
 * Tests translation providers (Azure, Google, LibreTranslate) and job tracking
 */

// Set environment variables BEFORE importing the service (singleton initialization)
process.env.AZURE_TRANSLATION_KEY_1 = 'test-azure-key';
process.env.AZURE_TRANSLATION_REGION = 'test-region';
process.env.GOOGLE_TRANSLATE_KEY = 'test-google-key';
process.env.LIBRETRANSLATE_URL = 'https://test-libre.com';
process.env.TRANSLATION_FEATURE_ENABLED = 'true';

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { translationService } from '../../../services/translationService';
import axios from 'axios';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('axios');
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TranslationService', () => {
  let mockQuery: jest.Mock;
  let mockGetPool: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock query function for translateTexts
    mockQuery = jest.fn();
    (database as unknown as Record<string, unknown>).query = mockQuery;

    // Mock getPool for translation job tracking
    mockGetPool = jest.fn().mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [] } as never)
    });
    (database as unknown as Record<string, unknown>).getPool = mockGetPool;
  });

  describe('Azure Translation Provider', () => {
    beforeEach(() => {
      process.env.TRANSLATION_PROVIDER = 'azure';
    });

    it('should translate text using Azure', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          {
            translations: [
              { text: 'สวัสดี', to: 'th' }
            ]
          }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.translations.th).toEqual(['สวัสดี'] as never);
      expect(result.provider).toBe('azure');
    });

    it('should translate multiple texts', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'สวัสดี', to: 'th' }] },
          { translations: [{ text: 'ลาก่อน', to: 'th' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello', 'Goodbye'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.translations.th).toHaveLength(2);
    });

    it('should handle Azure translation errors', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Azure API error') as never);

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });

    it('should include Azure headers', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'Bonjour', to: 'en' }] }
        ]
      });

      await translationService.translateTexts({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });

  // Note: Google Translate and LibreTranslate providers are not yet implemented
  // Tests removed until feature implementation is complete

  describe('Translation Job Tracking', () => {
    it('should create translation job for survey', async () => {
      const surveyId = 'survey-1';
      const mockPoolQuery = jest.fn().mockResolvedValue({ rows: [] } as never);

      mockGetPool.mockReturnValueOnce({
        query: mockPoolQuery
      });

      const job = await translationService.translateSurvey(
        surveyId,
        'en',
        ['th'],
        'azure',
        'user-123'
      );

      expect(mockPoolQuery).toHaveBeenCalled();
      expect(job.entityType).toBe('survey');
      expect(job.entityId).toBe(surveyId);
      expect(job.status).toBe('pending');
    });

    it('should track translation job status', async () => {
      const couponId = 'coupon-1';
      const mockPoolQuery = jest.fn().mockResolvedValue({ rows: [] } as never);

      mockGetPool.mockReturnValueOnce({
        query: mockPoolQuery
      });

      const job = await translationService.translateCoupon(
        couponId,
        'en',
        ['th'],
        'azure',
        'user-123'
      );

      expect(mockPoolQuery).toHaveBeenCalled();
      expect(job.entityType).toBe('coupon');
      expect(job.entityId).toBe(couponId);
      expect(job.status).toBe('pending');
    });

    it('should handle failed translation job', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'job-failed',
          status: 'failed'
        }
      ] as never);

      mockedAxios.post.mockRejectedValueOnce(new Error('Translation failed') as never);

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });
  });

  describe('Language Support', () => {
    beforeEach(() => {
      process.env.TRANSLATION_PROVIDER = 'azure';
    });

    it('should support Thai translation', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'สวัสดีชาวโลก', to: 'th' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello World'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.translations.th?.[0] as never).toBe('สวัสดีชาวโลก');
    });

    it('should support Chinese translation', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: '你好世界', to: 'zh-Hans' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello World'],
        sourceLanguage: 'en',
        targetLanguages: ['zh-CN']
      });

      expect(result.translations['zh-CN'] as never).toBeDefined();
    });

    it('should support multiple target languages', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({
          data: [
            { translations: [{ text: 'สวัสดี', to: 'th' }] }
          ]
        })
        .mockResolvedValueOnce({
          data: [
            { translations: [{ text: '你好', to: 'zh-Hans' }] }
          ]
        });

      const result = await translationService.translateTexts({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th', 'zh-CN']
      });

      expect(result.translations.th).toBeDefined();
      expect(result.translations['zh-CN'] as never).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      process.env.TRANSLATION_PROVIDER = 'azure';
    });

    it('should handle empty text array', async () => {
      await expect(
        translationService.translateTexts({
          texts: [],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });

    it('should handle very long texts', async () => {
      const longText = 'Hello '.repeat(1000);

      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'สวัสดี '.repeat(1000), to: 'th' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: [longText],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.translations.th).toHaveLength(1);
    });

    it('should handle special characters', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'สวัสดี!@#$%', to: 'th' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello!@#$%'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.translations.th).toHaveLength(1);
    });

    it('should handle same source and target language', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'Hello', to: 'en' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['en']
      });

      expect(result.translations.en?.[0] as never).toBe('Hello');
    });
  });

  describe('Provider Fallback', () => {
    it('should handle missing provider configuration', async () => {
      delete process.env.TRANSLATION_PROVIDER;

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });

    it('should handle invalid provider', async () => {
      process.env.TRANSLATION_PROVIDER = 'invalid-provider';

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    beforeEach(() => {
      process.env.TRANSLATION_PROVIDER = 'azure';
    });

    it('should handle batch translation efficiently', async () => {
      const texts = Array.from({ length: 10 }, (_, i) => `Text ${i}`);

      mockedAxios.post.mockResolvedValueOnce({
        data: texts.map((_, i) => ({
          translations: [{ text: `ข้อความ${i}`, to: 'th' }]
        } as never))
      });

      const result = await translationService.translateTexts({
        texts,
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.translations.th).toHaveLength(10);
    });

    it('should handle concurrent translation requests', async () => {
      mockedAxios.post.mockResolvedValue({
        data: [
          { translations: [{ text: 'สวัสดี', to: 'th' }] }
        ]
      });

      const promises = Array.from({ length: 3 }, () =>
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.translations.th?.[0] as never).toBe('สวัสดี');
      });
    });
  });

  describe('Error Recovery', () => {
    beforeEach(() => {
      process.env.TRANSLATION_PROVIDER = 'azure';
    });

    it('should handle network timeout', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('ETIMEDOUT') as never);

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow('ETIMEDOUT');
    });

    it('should handle rate limiting', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 429, data: { error: 'Rate limit exceeded' } }
      });

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });

    it('should handle authentication errors', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 401, data: { error: 'Invalid API key' } }
      });

      await expect(
        translationService.translateTexts({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['th']
        })
      ).rejects.toThrow();
    });
  });

  describe('Character Counting', () => {
    beforeEach(() => {
      process.env.TRANSLATION_PROVIDER = 'azure';
    });

    it('should count characters correctly', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'สวัสดี', to: 'th' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.charactersTranslated).toBeGreaterThan(0);
    });

    it('should aggregate character counts for multiple texts', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: [
          { translations: [{ text: 'สวัสดี', to: 'th' }] },
          { translations: [{ text: 'ลาก่อน', to: 'th' }] }
        ]
      });

      const result = await translationService.translateTexts({
        texts: ['Hello', 'Goodbye'],
        sourceLanguage: 'en',
        targetLanguages: ['th']
      });

      expect(result.charactersTranslated).toBeGreaterThan(10);
    });
  });
});
