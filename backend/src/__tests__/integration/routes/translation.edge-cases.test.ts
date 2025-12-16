/**
 * Translation Routes Edge Cases Integration Tests
 * Tests edge cases for translation endpoints including multiple languages,
 * provider fallback, rate limiting, long text, admin permissions, concurrent jobs,
 * and job status transitions
 *
 * Coverage Target: Edge case scenarios not covered in main test suite
 */

import request from 'supertest';
import express, { Express } from 'express';
import translationRoutes from '../../../routes/translation';
import { createTestApp } from '../../fixtures';

// Mock translationService
jest.mock('../../../services/translationService');
jest.mock('../../../services/surveyService');
jest.mock('../../../services/couponService');
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Create mutable user for role testing
let currentUser: {
  id: string;
  email: string;
  role: 'customer' | 'admin' | 'super_admin';
} = {
  id: 'test-user-123',
  email: 'test@example.com',
  role: 'customer'
};

// Mock authentication middleware
jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { ...currentUser };
    next();
  }
}));

// Mock validateRequest middleware
jest.mock('../../../middleware/validateRequest', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateRequest: (_schema: unknown) => (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  }
}));

describe('Translation Routes Edge Cases Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp(translationRoutes, '/api/translation');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to default customer user
    currentUser = {
      id: 'test-user-123',
      email: 'test@example.com',
      role: 'customer'
    };
  });

  describe('Multiple Target Languages Validation', () => {
    test('should handle translation to 10+ target languages', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ko', 'ar', 'hi', 'tr'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      const mockTranslations: Record<string, string[]> = {};
      translateData.targetLanguages.forEach(lang => {
        mockTranslations[lang] = ['Translated text'];
      });

      translationService.translateTexts.mockResolvedValue({
        translations: mockTranslations,
        provider: 'azure',
        sourceLanguage: 'en'
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations).toHaveProperty('es');
      expect(response.body.translations).toHaveProperty('ja');
      expect(response.body.translations).toHaveProperty('ar');
      expect(Object.keys(response.body.translations).length).toBe(12);
    });

    test('should handle empty target languages array', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: [],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('At least one target language is required')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle duplicate target languages', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es', 'es', 'fr', 'fr', 'de'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: {
          es: ['Hola mundo'],
          fr: ['Bonjour le monde'],
          de: ['Hallo Welt']
        }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      // Service should handle deduplication
      expect(response.body.translations).toBeDefined();
    });

    test('should handle invalid language codes in target languages', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['invalid-lang', 'xyz123', '@@@@'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Invalid language code: invalid-lang')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle same source and target language', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['en'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: {
          en: ['Hello world']
        }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations.en[0]).toBe('Hello world');
    });
  });

  describe('Provider Fallback Scenarios', () => {
    test('should handle provider failure and indicate error', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Azure Translation API is unavailable')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle unsupported provider', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'unsupported-provider'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Unsupported translation provider')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle provider timeout', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Translation request timeout')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle provider authentication failure', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Authentication failed: Invalid API key')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Rate Limiting Simulation', () => {
    test('should handle rate limit exceeded error', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Rate limit exceeded. Please try again later.')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle quota exceeded error', async () => {
      const translateData = {
        texts: ['Hello world'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Monthly quota exceeded')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle multiple rapid translation requests', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['Hola'] }
      });

      const requests = Array(20).fill(null).map(() =>
        request(app)
          .post('/api/translation/translate')
          .send({
            texts: ['Hello'],
            sourceLanguage: 'en',
            targetLanguages: ['es']
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect([200, 500]).toContain(response.status);
      });
    });
  });

  describe('Very Long Text Translation', () => {
    test('should handle very long single text (10000+ characters)', async () => {
      const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200); // ~11,400 chars
      const translateData = {
        texts: [longText],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: [longText] }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations.es[0].length).toBeGreaterThan(10000);
    });

    test('should handle text exceeding provider limits', async () => {
      const veryLongText = 'A'.repeat(100000); // 100k characters
      const translateData = {
        texts: [veryLongText],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(
        new Error('Text exceeds maximum length of 50000 characters')
      );

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle empty strings in texts array', async () => {
      const translateData = {
        texts: ['', 'Hello', '', 'World'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['', 'Hola', '', 'Mundo'] }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations.es).toHaveLength(4);
    });

    test('should handle texts with only whitespace', async () => {
      const translateData = {
        texts: ['   ', '\n\n\n', '\t\t'],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['   ', '\n\n\n', '\t\t'] }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations).toBeDefined();
    });

    test('should handle text with complex formatting and HTML', async () => {
      const complexText = '<div><p>Hello <strong>world</strong></p><ul><li>Item 1</li><li>Item 2</li></ul></div>';
      const translateData = {
        texts: [complexText],
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['<div><p>Hola <strong>mundo</strong></p><ul><li>Elemento 1</li><li>Elemento 2</li></ul></div>'] }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations.es[0]).toContain('<div>');
    });
  });

  describe('Admin Role Permissions', () => {
    test('should allow admin user to translate survey', async () => {
      currentUser = {
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin'
      };

      const surveyId = 'survey-123';
      const translateData = {
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr'],
        provider: 'azure'
      };

      const { surveyService } = jest.requireMock('../../../services/surveyService');
      const { translationService } = jest.requireMock('../../../services/translationService');

      surveyService.getSurveyById.mockResolvedValue({
        id: surveyId,
        title: 'Admin Survey',
        questions: []
      });

      translationService.translateSurvey.mockResolvedValue({
        id: 'job-admin-123',
        surveyId,
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr']
      });

      const response = await request(app)
        .post(`/api/translation/survey/${surveyId}/translate`)
        .send(translateData)
        .expect(200);

      expect(response.body).toHaveProperty('id', 'job-admin-123');
      expect(translationService.translateSurvey).toHaveBeenCalledWith(
        surveyId,
        translateData.sourceLanguage,
        translateData.targetLanguages,
        translateData.provider,
        'admin-user-123'
      );
    });

    test('should allow admin user to translate coupon', async () => {
      currentUser = {
        id: 'admin-user-123',
        email: 'admin@example.com',
        role: 'admin'
      };

      const couponId = 'coupon-123';
      const translateData = {
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        provider: 'azure'
      };

      const { couponService } = jest.requireMock('../../../services/couponService');
      const { translationService } = jest.requireMock('../../../services/translationService');

      couponService.getCouponById.mockResolvedValue({
        id: couponId,
        title: 'Admin Coupon',
        description: 'Admin discount'
      });

      translationService.translateCoupon.mockResolvedValue({
        id: 'job-admin-456',
        couponId,
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['es']
      });

      const response = await request(app)
        .post(`/api/translation/coupon/${couponId}/translate`)
        .send(translateData)
        .expect(200);

      expect(response.body).toHaveProperty('id', 'job-admin-456');
    });

    test('should allow super_admin user to access all translation features', async () => {
      currentUser = {
        id: 'super-admin-123',
        email: 'superadmin@example.com',
        role: 'super_admin'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['Hola'] }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['es']
        })
        .expect(200);

      expect(response.body.translations).toBeDefined();
    });
  });

  describe('Concurrent Translation Jobs', () => {
    test('should handle multiple concurrent survey translation jobs', async () => {
      const { surveyService } = jest.requireMock('../../../services/surveyService');
      const { translationService } = jest.requireMock('../../../services/translationService');

      surveyService.getSurveyById.mockResolvedValue({
        id: 'survey-123',
        title: 'Test Survey',
        questions: []
      });

      const jobs = Array(5).fill(null).map((_, i) => ({
        id: `job-${i}`,
        surveyId: 'survey-123',
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['es']
      }));

      jobs.forEach((job) => {
        translationService.translateSurvey.mockResolvedValueOnce(job);
      });

      const requests = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/translation/survey/survey-123/translate')
          .send({
            sourceLanguage: 'en',
            targetLanguages: ['es']
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'pending');
      });
    });

    test('should handle multiple concurrent coupon translation jobs', async () => {
      const { couponService } = jest.requireMock('../../../services/couponService');
      const { translationService } = jest.requireMock('../../../services/translationService');

      couponService.getCouponById.mockResolvedValue({
        id: 'coupon-123',
        title: 'Test Coupon',
        description: 'Test description'
      });

      const jobs = Array(5).fill(null).map((_, i) => ({
        id: `job-${i}`,
        couponId: 'coupon-123',
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['fr']
      }));

      jobs.forEach((job) => {
        translationService.translateCoupon.mockResolvedValueOnce(job);
      });

      const requests = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/translation/coupon/coupon-123/translate')
          .send({
            sourceLanguage: 'en',
            targetLanguages: ['fr']
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'pending');
      });
    });

    test('should handle concurrent translation job status queries', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      const jobs = Array(10).fill(null).map((_, i) => ({
        id: `job-${i}`,
        status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'pending' : 'failed',
        progress: i % 3 === 0 ? 100 : i % 3 === 1 ? 50 : 0,
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        createdAt: new Date().toISOString()
      }));

      jobs.forEach((job) => {
        translationService.getTranslationJobById.mockResolvedValueOnce(job);
      });

      const requests = jobs.map((job) =>
        request(app).get(`/api/translation/job/${job.id}`)
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(['completed', 'pending', 'failed']).toContain(response.body.status);
      });
    });
  });

  describe('Job Status Transitions', () => {
    test('should handle job status transition from pending to processing', async () => {
      const jobId = 'job-123';
      const { translationService } = jest.requireMock('../../../services/translationService');

      // First call: pending
      translationService.getTranslationJobById.mockResolvedValueOnce({
        id: jobId,
        status: 'pending',
        progress: 0,
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        createdAt: new Date().toISOString()
      });

      const response1 = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response1.body.status).toBe('pending');

      // Second call: processing
      translationService.getTranslationJobById.mockResolvedValueOnce({
        id: jobId,
        status: 'processing',
        progress: 50,
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        createdAt: new Date().toISOString()
      });

      const response2 = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response2.body.status).toBe('processing');
      expect(response2.body.progress).toBe(50);
    });

    test('should handle job status transition from processing to completed', async () => {
      const jobId = 'job-456';
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobById.mockResolvedValueOnce({
        id: jobId,
        status: 'processing',
        progress: 75,
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr'],
        createdAt: new Date().toISOString()
      });

      const response1 = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response1.body.status).toBe('processing');

      translationService.getTranslationJobById.mockResolvedValueOnce({
        id: jobId,
        status: 'completed',
        progress: 100,
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr'],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });

      const response2 = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response2.body.status).toBe('completed');
      expect(response2.body.progress).toBe(100);
      expect(response2.body).toHaveProperty('completedAt');
    });

    test('should handle job status transition from processing to failed', async () => {
      const jobId = 'job-789';
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobById.mockResolvedValueOnce({
        id: jobId,
        status: 'processing',
        progress: 30,
        sourceLanguage: 'en',
        targetLanguages: ['de'],
        createdAt: new Date().toISOString()
      });

      const response1 = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response1.body.status).toBe('processing');

      translationService.getTranslationJobById.mockResolvedValueOnce({
        id: jobId,
        status: 'failed',
        progress: 30,
        error: 'Translation API error',
        sourceLanguage: 'en',
        targetLanguages: ['de'],
        createdAt: new Date().toISOString(),
        failedAt: new Date().toISOString()
      });

      const response2 = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response2.body.status).toBe('failed');
      expect(response2.body).toHaveProperty('error');
      expect(response2.body).toHaveProperty('failedAt');
    });

    test('should filter jobs by status', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobs.mockResolvedValue({
        jobs: [
          {
            id: 'job-1',
            status: 'completed',
            entityType: 'survey',
            createdAt: new Date().toISOString()
          },
          {
            id: 'job-2',
            status: 'completed',
            entityType: 'coupon',
            createdAt: new Date().toISOString()
          }
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          pages: 1
        }
      });

      const response = await request(app)
        .get('/api/translation/jobs?status=completed')
        .expect(200);

      expect(response.body.jobs).toHaveLength(2);
      response.body.jobs.forEach((job: { status: string }) => {
        expect(job.status).toBe('completed');
      });
    });

    test('should handle job status query for all statuses', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      const statuses = ['pending', 'processing', 'completed', 'failed'];

      for (const status of statuses) {
        translationService.getTranslationJobs.mockResolvedValueOnce({
          jobs: [
            {
              id: `job-${status}`,
              status: status,
              entityType: 'survey',
              createdAt: new Date().toISOString()
            }
          ],
          pagination: { page: 1, limit: 10, total: 1, pages: 1 }
        });

        const response = await request(app)
          .get(`/api/translation/jobs?status=${status}`)
          .expect(200);

        expect(response.body.jobs[0].status).toBe(status);
      }
    });

    test('should handle empty job list with specific status filter', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobs.mockResolvedValue({
        jobs: [],
        pagination: { page: 1, limit: 10, total: 0, pages: 0 }
      });

      const response = await request(app)
        .get('/api/translation/jobs?status=failed')
        .expect(200);

      expect(response.body.jobs).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });
  });

  describe('Additional Edge Cases', () => {
    test('should handle survey translation with missing provider (default to azure)', async () => {
      const surveyId = 'survey-123';
      const { surveyService } = jest.requireMock('../../../services/surveyService');
      const { translationService } = jest.requireMock('../../../services/translationService');

      surveyService.getSurveyById.mockResolvedValue({
        id: surveyId,
        title: 'Test Survey',
        questions: []
      });

      translationService.translateSurvey.mockResolvedValue({
        id: 'job-123',
        surveyId,
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['es']
      });

      await request(app)
        .post(`/api/translation/survey/${surveyId}/translate`)
        .send({
          sourceLanguage: 'en',
          targetLanguages: ['es']
        })
        .expect(200);

      expect(translationService.translateSurvey).toHaveBeenCalledWith(
        surveyId,
        'en',
        ['es'],
        'azure',
        'test-user-123'
      );
    });

    test('should handle pagination with large page numbers', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobs.mockResolvedValue({
        jobs: [],
        pagination: { page: 9999, limit: 10, total: 0, pages: 0 }
      });

      const response = await request(app)
        .get('/api/translation/jobs?page=9999&limit=10')
        .expect(200);

      expect(response.body.jobs).toEqual([]);
      expect(response.body.pagination.page).toBe(9999);
    });

    test('should handle pagination with very large limit', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobs.mockResolvedValue({
        jobs: Array(1000).fill(null).map((_, i) => ({
          id: `job-${i}`,
          status: 'completed',
          entityType: 'survey',
          createdAt: new Date().toISOString()
        })),
        pagination: { page: 1, limit: 1000, total: 1000, pages: 1 }
      });

      const response = await request(app)
        .get('/api/translation/jobs?page=1&limit=1000')
        .expect(200);

      expect(response.body.jobs.length).toBe(1000);
    });

    test('should handle invalid pagination parameters', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobs.mockResolvedValue({
        jobs: [],
        pagination: { page: 1, limit: 10, total: 0, pages: 0 }
      });

      const response = await request(app)
        .get('/api/translation/jobs?page=-1&limit=-10')
        .expect(200);

      // Service should handle validation
      expect(response.body).toHaveProperty('pagination');
    });

    test('should handle translation job with partial completion data', async () => {
      const jobId = 'job-partial';
      const { translationService } = jest.requireMock('../../../services/translationService');

      translationService.getTranslationJobById.mockResolvedValue({
        id: jobId,
        status: 'processing',
        progress: 60,
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr', 'de'],
        createdAt: new Date().toISOString(),
        partialResults: {
          es: 'completed',
          fr: 'processing',
          de: 'pending'
        }
      });

      const response = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response.body.progress).toBe(60);
      expect(response.body).toHaveProperty('partialResults');
    });

    test('should handle coupon translation with language query parameter', async () => {
      const couponId = 'coupon-123';
      const { couponService } = jest.requireMock('../../../services/couponService');

      couponService.getCouponWithTranslations.mockResolvedValue({
        id: couponId,
        title: 'Test Coupon',
        description: 'Test description',
        translations: {
          es: {
            title: 'Cupón de Prueba',
            description: 'Descripción de prueba'
          }
        }
      });

      const response = await request(app)
        .get(`/api/translation/coupon/${couponId}/translations?language=es`)
        .expect(200);

      expect(response.body.translations).toHaveProperty('es');
      expect(couponService.getCouponWithTranslations).toHaveBeenCalledWith(couponId, 'es');
    });

    test('should handle survey translation without language query parameter', async () => {
      const surveyId = 'survey-123';
      const { surveyService } = jest.requireMock('../../../services/surveyService');

      surveyService.getAllSurveyTranslations.mockResolvedValue({
        id: surveyId,
        title: 'Test Survey',
        translations: {
          es: { title: 'Encuesta de Prueba' },
          fr: { title: 'Enquête de Test' }
        }
      });

      const response = await request(app)
        .get(`/api/translation/survey/${surveyId}/translations`)
        .expect(200);

      expect(response.body.translations).toHaveProperty('es');
      expect(response.body.translations).toHaveProperty('fr');
    });
  });
});
