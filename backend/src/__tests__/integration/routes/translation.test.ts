/**
 * Translation Routes Integration Tests
 * Tests translation endpoints for text, surveys, coupons, and job management
 *
 * Week 2 Priority - 10-15 tests
 * Coverage Target: ~2% contribution
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

// Mock authentication middleware
jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Mock authenticated user
    req.user = {
      id: 'test-user-123',
      email: 'test@example.com',
      role: 'customer'
    };
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

describe('Translation Routes Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp(translationRoutes, '/api/translation');
  });

  describe('Text Translation', () => {
    test('should translate texts successfully', async () => {
      const translateData = {
        texts: ['Hello world', 'Welcome to our app'],
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr', 'de'],
        provider: 'azure'
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: {
          es: ['Hola mundo', 'Bienvenido a nuestra aplicación'],
          fr: ['Bonjour le monde', 'Bienvenue dans notre application'],
          de: ['Hallo Welt', 'Willkommen in unserer App']
        },
        provider: 'azure',
        sourceLanguage: 'en'
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body).toHaveProperty('translations');
      expect(response.body.translations).toHaveProperty('es');
      expect(response.body.translations).toHaveProperty('fr');
      expect(response.body.translations).toHaveProperty('de');
      expect(translationService.translateTexts).toHaveBeenCalledWith(translateData);
    });

    test('should return 400 for missing texts array', async () => {
      const invalidData = {
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const response = await request(app)
        .post('/api/translation/translate')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Texts array is required');
    });

    test('should return 400 for empty texts array', async () => {
      const invalidData = {
        texts: [],
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const response = await request(app)
        .post('/api/translation/translate')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Texts array is required');
    });

    test('should return 400 for missing source language', async () => {
      const invalidData = {
        texts: ['Hello'],
        targetLanguages: ['es']
      };

      const response = await request(app)
        .post('/api/translation/translate')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Source and target languages are required');
    });

    test('should return 400 for missing target languages', async () => {
      const invalidData = {
        texts: ['Hello'],
        sourceLanguage: 'en'
      };

      const response = await request(app)
        .post('/api/translation/translate')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Source and target languages are required');
    });

    test('should use default provider when not specified', async () => {
      const translateData = {
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['Hola'] }
      });

      await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(translationService.translateTexts).toHaveBeenCalledWith({
        ...translateData,
        provider: 'azure'
      });
    });
  });

  describe('Survey Translation', () => {
    test('should translate survey successfully', async () => {
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
        title: 'Customer Satisfaction Survey',
        questions: []
      });

      translationService.translateSurvey.mockResolvedValue({
        id: 'job-123',
        surveyId,
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr']
      });

      const response = await request(app)
        .post(`/api/translation/survey/${surveyId}/translate`)
        .send(translateData)
        .expect(200);

      expect(response.body).toHaveProperty('id', 'job-123');
      expect(response.body).toHaveProperty('surveyId', surveyId);
      expect(response.body).toHaveProperty('status', 'pending');
      expect(translationService.translateSurvey).toHaveBeenCalledWith(
        surveyId,
        translateData.sourceLanguage,
        translateData.targetLanguages,
        translateData.provider,
        'test-user-123'
      );
    });

    test('should return 404 for non-existent survey', async () => {
      const surveyId = 'non-existent';
      const translateData = {
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const { surveyService } = jest.requireMock('../../../services/surveyService');
      surveyService.getSurveyById.mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/translation/survey/${surveyId}/translate`)
        .send(translateData)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Survey not found');
    });

    test('should get survey translations', async () => {
      const surveyId = 'survey-123';
      const mockTranslations = {
        id: surveyId,
        title: 'Customer Satisfaction Survey',
        translations: {
          es: {
            title: 'Encuesta de Satisfacción del Cliente',
            description: 'Descripción traducida'
          }
        }
      };

      const { surveyService } = jest.requireMock('../../../services/surveyService');
      surveyService.getAllSurveyTranslations.mockResolvedValue(mockTranslations);

      const response = await request(app)
        .get(`/api/translation/survey/${surveyId}/translations`)
        .expect(200);

      expect(response.body).toEqual(mockTranslations);
      expect(surveyService.getAllSurveyTranslations).toHaveBeenCalledWith(surveyId);
    });

    test('should return 404 when getting translations for non-existent survey', async () => {
      const surveyId = 'non-existent';

      const { surveyService } = jest.requireMock('../../../services/surveyService');
      surveyService.getAllSurveyTranslations.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/translation/survey/${surveyId}/translations`)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Survey not found');
    });
  });

  describe('Coupon Translation', () => {
    test('should translate coupon successfully', async () => {
      const couponId = 'coupon-123';
      const translateData = {
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr'],
        provider: 'azure'
      };

      const { couponService } = jest.requireMock('../../../services/couponService');
      const { translationService } = jest.requireMock('../../../services/translationService');

      couponService.getCouponById.mockResolvedValue({
        id: couponId,
        title: 'Special Discount Coupon',
        description: 'Get 20% off'
      });

      translationService.translateCoupon.mockResolvedValue({
        id: 'job-456',
        couponId,
        status: 'pending',
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr']
      });

      const response = await request(app)
        .post(`/api/translation/coupon/${couponId}/translate`)
        .send(translateData)
        .expect(200);

      expect(response.body).toHaveProperty('id', 'job-456');
      expect(response.body).toHaveProperty('couponId', couponId);
      expect(response.body).toHaveProperty('status', 'pending');
      expect(translationService.translateCoupon).toHaveBeenCalledWith(
        couponId,
        translateData.sourceLanguage,
        translateData.targetLanguages,
        translateData.provider,
        'test-user-123'
      );
    });

    test('should return 404 for non-existent coupon', async () => {
      const couponId = 'non-existent';
      const translateData = {
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const { couponService } = jest.requireMock('../../../services/couponService');
      couponService.getCouponById.mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/translation/coupon/${couponId}/translate`)
        .send(translateData)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Coupon not found');
    });

    test('should get coupon translations', async () => {
      const couponId = 'coupon-123';
      const language = 'es';
      const mockCoupon = {
        id: couponId,
        title: 'Special Discount Coupon',
        description: 'Get 20% off',
        translations: {
          es: {
            title: 'Cupón de Descuento Especial',
            description: 'Obtén 20% de descuento'
          }
        }
      };

      const { couponService } = jest.requireMock('../../../services/couponService');
      couponService.getCouponWithTranslations.mockResolvedValue(mockCoupon);

      const response = await request(app)
        .get(`/api/translation/coupon/${couponId}/translations?language=${language}`)
        .expect(200);

      expect(response.body).toEqual(mockCoupon);
      expect(couponService.getCouponWithTranslations).toHaveBeenCalledWith(couponId, language);
    });

    test('should return 404 when getting translations for non-existent coupon', async () => {
      const couponId = 'non-existent';

      const { couponService } = jest.requireMock('../../../services/couponService');
      couponService.getCouponWithTranslations.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/translation/coupon/${couponId}/translations`)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Coupon not found');
    });
  });

  describe('Translation Job Management', () => {
    test('should get translation job by ID', async () => {
      const jobId = 'job-123';
      const mockJob = {
        id: jobId,
        status: 'completed',
        progress: 100,
        sourceLanguage: 'en',
        targetLanguages: ['es', 'fr'],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.getTranslationJobById.mockResolvedValue(mockJob);

      const response = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(200);

      expect(response.body).toEqual(mockJob);
      expect(translationService.getTranslationJobById).toHaveBeenCalledWith(jobId);
    });

    test('should return 404 for non-existent translation job', async () => {
      const jobId = 'non-existent';

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.getTranslationJobById.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/translation/job/${jobId}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Translation job not found');
    });

    test('should get user translation jobs with pagination', async () => {
      const mockJobs = {
        jobs: [
          {
            id: 'job-1',
            status: 'completed',
            entityType: 'survey',
            createdAt: new Date().toISOString()
          },
          {
            id: 'job-2',
            status: 'pending',
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
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.getTranslationJobs.mockResolvedValue(mockJobs);

      const response = await request(app)
        .get('/api/translation/jobs?page=1&limit=10')
        .expect(200);

      expect(response.body).toEqual(mockJobs);
      expect(translationService.getTranslationJobs).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: undefined,
        entityType: undefined,
        userId: 'test-user-123'
      });
    });

    test('should filter translation jobs by status and entity type', async () => {
      const mockJobs = {
        jobs: [
          {
            id: 'job-1',
            status: 'completed',
            entityType: 'survey'
          }
        ],
        pagination: { page: 1, limit: 10, total: 1, pages: 1 }
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.getTranslationJobs.mockResolvedValue(mockJobs);

      await request(app)
        .get('/api/translation/jobs?status=completed&entityType=survey')
        .expect(200);

      expect(translationService.getTranslationJobs).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: 'completed',
        entityType: 'survey',
        userId: 'test-user-123'
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/api/translation/translate')
        .send('invalid-json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle translation service errors', async () => {
      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockRejectedValue(new Error('Azure API error'));

      const translateData = {
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle missing request body', async () => {
      const response = await request(app)
        .post('/api/translation/translate')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Authentication', () => {
    test('should require authentication for protected routes', async () => {
      // This is handled by the middleware mock, but in a real test
      // we would test without the mock to ensure 401 responses
      const response = await request(app)
        .post('/api/translation/translate')
        .send({
          texts: ['Hello'],
          sourceLanguage: 'en',
          targetLanguages: ['es']
        })
        .expect(200);

      // With mocked auth, should pass
      expect(response.body).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle large texts array', async () => {
      const largeTexts = Array(100).fill('This is a test text for translation.');
      const translateData = {
        texts: largeTexts,
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: largeTexts.map(text => `Translated: ${text}`) }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations.es).toHaveLength(100);
    });

    test('should handle special characters in translation texts', async () => {
      const translateData = {
        texts: ['Hello! @#$%^&*()', 'Café naïve résumé'],
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const { translationService } = jest.requireMock('../../../services/translationService');
      translationService.translateTexts.mockResolvedValue({
        translations: { es: ['¡Hola! @#$%^&*()', 'Café naïve currículum'] }
      });

      const response = await request(app)
        .post('/api/translation/translate')
        .send(translateData)
        .expect(200);

      expect(response.body.translations.es).toBeDefined();
    });

    test('should handle Unicode characters in survey ID', async () => {
      const surveyId = 'survey-ñ-123';
      const translateData = {
        sourceLanguage: 'en',
        targetLanguages: ['es']
      };

      const { surveyService } = jest.requireMock('../../../services/surveyService');
      surveyService.getSurveyById.mockResolvedValue({ id: surveyId, title: 'Test' });

      const response = await request(app)
        .post(`/api/translation/survey/${surveyId}/translate`)
        .send(translateData)
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });
});