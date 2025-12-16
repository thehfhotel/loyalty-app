import { Request, Response, NextFunction } from 'express';
import { translationController } from '../../../controllers/translationController';
import { translationService } from '../../../services/translationService';
import { surveyService } from '../../../services/surveyService';
import { couponService } from '../../../services/couponService';

jest.mock('../../../services/translationService', () => ({
  translationService: {
    translateTexts: jest.fn(),
    translateSurvey: jest.fn(),
    translateCoupon: jest.fn(),
    getTranslationJobById: jest.fn(),
    getTranslationJobs: jest.fn(),
    getServiceStatus: jest.fn(),
  },
}));

jest.mock('../../../services/surveyService', () => ({
  surveyService: {
    getSurveyById: jest.fn(),
    getAllSurveyTranslations: jest.fn(),
  },
}));

jest.mock('../../../services/couponService', () => ({
  couponService: {
    getCouponById: jest.fn(),
    getCouponWithTranslations: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockTranslationService = translationService as jest.Mocked<typeof translationService>;
const mockSurveyService = surveyService as jest.Mocked<typeof surveyService>;
const mockCouponService = couponService as jest.Mocked<typeof couponService>;

describe('TranslationController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    mockNext = jest.fn();
    mockRes = {
      json: jsonMock,
      status: statusMock,
    };
    mockReq = {
      body: {},
      params: {},
      query: {},
      user: adminUser,
    };
  });

  // ========== translateTexts Tests ==========
  describe('translateTexts', () => {
    it('should reject empty texts array', async () => {
      mockReq.body = {
        texts: [],
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
      };

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Texts array is required' });
    });

    it('should reject missing texts field', async () => {
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
      };

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Texts array is required' });
    });

    it('should reject non-array texts', async () => {
      mockReq.body = {
        texts: 'not an array',
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
      };

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Texts array is required' });
    });

    it('should reject missing targetLanguages', async () => {
      mockReq.body = {
        texts: ['Hello', 'World'],
        sourceLanguage: 'en',
      };

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Source and target languages are required',
      });
    });

    it('should reject non-array targetLanguages', async () => {
      mockReq.body = {
        texts: ['Hello', 'World'],
        sourceLanguage: 'en',
        targetLanguages: 'th',
      };

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Source and target languages are required',
      });
    });

    it('should successfully translate texts with default provider', async () => {
      const mockResult = {
        translations: {
          th: ['สวัสดี'],
          ja: ['こんにちは'],
        },
        originalTexts: ['Hello'],
        sourceLanguage: 'en',
        provider: 'azure' as const,
        charactersTranslated: 5,
      };

      mockReq.body = {
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
      };

      mockTranslationService.translateTexts.mockResolvedValue(mockResult);

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.translateTexts).toHaveBeenCalledWith({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
        provider: 'azure',
      });
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should successfully translate texts with custom provider', async () => {
      const mockResult = {
        translations: { th: ['สวัสดี'] },
        originalTexts: ['Hello'],
        sourceLanguage: 'en',
        provider: 'google' as const,
        charactersTranslated: 5,
      };
      mockReq.body = {
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th'],
        provider: 'google',
      };

      mockTranslationService.translateTexts.mockResolvedValue(mockResult);

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.translateTexts).toHaveBeenCalledWith({
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th'],
        provider: 'google',
      });
    });

    it('should handle service errors', async () => {
      const error = new Error('Translation service error');
      mockReq.body = {
        texts: ['Hello'],
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockTranslationService.translateTexts.mockRejectedValue(error);

      await translationController.translateTexts(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== translateSurvey Tests ==========
  describe('translateSurvey', () => {
    const surveyId = 'survey-123';
    const mockSurvey = { id: surveyId, title: 'Test Survey' };

    it('should reject missing targetLanguages', async () => {
      mockReq.params = { id: surveyId };
      mockReq.body = { sourceLanguage: 'en' };

      await translationController.translateSurvey(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Source and target languages are required',
      });
    });

    it('should return 404 when survey not found', async () => {
      mockReq.params = { id: surveyId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockSurveyService.getSurveyById.mockResolvedValue(null);

      await translationController.translateSurvey(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockSurveyService.getSurveyById).toHaveBeenCalledWith(surveyId);
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Survey not found' });
    });

    it('should successfully start survey translation job', async () => {
      const mockJob = {
        id: 'job-123',
        entityType: 'survey',
        entityId: surveyId,
        status: 'pending',
        userId: adminUser.id,
      };

      mockReq.params = { id: surveyId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
        provider: 'azure',
      };

      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey as any);
      mockTranslationService.translateSurvey.mockResolvedValue(mockJob as any);

      await translationController.translateSurvey(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockSurveyService.getSurveyById).toHaveBeenCalledWith(surveyId);
      expect(mockTranslationService.translateSurvey).toHaveBeenCalledWith(
        surveyId,
        'en',
        ['th', 'ja'],
        'azure',
        adminUser.id
      );
      expect(jsonMock).toHaveBeenCalledWith(mockJob);
    });

    it('should use default provider when not specified', async () => {
      const mockJob = { id: 'job-123', status: 'pending' };
      mockReq.params = { id: surveyId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey as any);
      mockTranslationService.translateSurvey.mockResolvedValue(mockJob as any);

      await translationController.translateSurvey(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.translateSurvey).toHaveBeenCalledWith(
        surveyId,
        'en',
        ['th'],
        'azure',
        adminUser.id
      );
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockReq.params = { id: surveyId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey as any);
      mockTranslationService.translateSurvey.mockRejectedValue(error);

      await translationController.translateSurvey(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== getSurveyTranslations Tests ==========
  describe('getSurveyTranslations', () => {
    const surveyId = 'survey-123';

    it('should return 404 when survey not found', async () => {
      mockReq.params = { id: surveyId };
      mockSurveyService.getAllSurveyTranslations.mockResolvedValue(null);

      await translationController.getSurveyTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockSurveyService.getAllSurveyTranslations).toHaveBeenCalledWith(surveyId);
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Survey not found' });
    });

    it('should successfully return survey translations', async () => {
      const mockTranslations = {
        survey: { id: surveyId, title: 'Test Survey' },
        translations: {
          th: { title: 'แบบสำรวจทดสอบ' },
          ja: { title: 'テストアンケート' },
        },
      };

      mockReq.params = { id: surveyId };
      mockSurveyService.getAllSurveyTranslations.mockResolvedValue(mockTranslations as any);

      await translationController.getSurveyTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(mockTranslations);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockReq.params = { id: surveyId };
      mockSurveyService.getAllSurveyTranslations.mockRejectedValue(error);

      await translationController.getSurveyTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== translateCoupon Tests ==========
  describe('translateCoupon', () => {
    const couponId = 'coupon-123';
    const mockCoupon = { id: couponId, title: 'Test Coupon' };

    it('should reject missing sourceLanguage', async () => {
      mockReq.params = { id: couponId };
      mockReq.body = { targetLanguages: ['th'] };

      await translationController.translateCoupon(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Source and target languages are required',
      });
    });

    it('should return 404 when coupon not found', async () => {
      mockReq.params = { id: couponId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockCouponService.getCouponById.mockResolvedValue(null);

      await translationController.translateCoupon(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockCouponService.getCouponById).toHaveBeenCalledWith(couponId);
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Coupon not found' });
    });

    it('should successfully start coupon translation job', async () => {
      const mockJob = {
        id: 'job-456',
        entityType: 'coupon',
        entityId: couponId,
        status: 'pending',
        userId: adminUser.id,
      };

      mockReq.params = { id: couponId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th', 'ja'],
        provider: 'azure',
      };

      mockCouponService.getCouponById.mockResolvedValue(mockCoupon as any);
      mockTranslationService.translateCoupon.mockResolvedValue(mockJob as any);

      await translationController.translateCoupon(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockCouponService.getCouponById).toHaveBeenCalledWith(couponId);
      expect(mockTranslationService.translateCoupon).toHaveBeenCalledWith(
        couponId,
        'en',
        ['th', 'ja'],
        'azure',
        adminUser.id
      );
      expect(jsonMock).toHaveBeenCalledWith(mockJob);
    });

    it('should use default provider when not specified', async () => {
      const mockJob = { id: 'job-456', status: 'pending' };
      mockReq.params = { id: couponId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockCouponService.getCouponById.mockResolvedValue(mockCoupon as any);
      mockTranslationService.translateCoupon.mockResolvedValue(mockJob as any);

      await translationController.translateCoupon(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.translateCoupon).toHaveBeenCalledWith(
        couponId,
        'en',
        ['th'],
        'azure',
        adminUser.id
      );
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockReq.params = { id: couponId };
      mockReq.body = {
        sourceLanguage: 'en',
        targetLanguages: ['th'],
      };

      mockCouponService.getCouponById.mockResolvedValue(mockCoupon as any);
      mockTranslationService.translateCoupon.mockRejectedValue(error);

      await translationController.translateCoupon(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== getCouponTranslations Tests ==========
  describe('getCouponTranslations', () => {
    const couponId = 'coupon-123';

    it('should return 404 when coupon not found', async () => {
      mockReq.params = { id: couponId };
      mockReq.query = { language: 'th' };
      mockCouponService.getCouponWithTranslations.mockResolvedValue(null);

      await translationController.getCouponTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockCouponService.getCouponWithTranslations).toHaveBeenCalledWith(
        couponId,
        'th'
      );
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Coupon not found' });
    });

    it('should successfully return coupon with translations', async () => {
      const mockCouponData = {
        id: couponId,
        title: 'Test Coupon',
        translations: {
          th: { title: 'คูปองทดสอบ' },
        },
      };

      mockReq.params = { id: couponId };
      mockReq.query = { language: 'th' };
      mockCouponService.getCouponWithTranslations.mockResolvedValue(mockCouponData as any);

      await translationController.getCouponTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(mockCouponData);
    });

    it('should work without language query parameter', async () => {
      const mockCouponData = { id: couponId, title: 'Test Coupon' };
      mockReq.params = { id: couponId };
      mockReq.query = {};
      mockCouponService.getCouponWithTranslations.mockResolvedValue(mockCouponData as any);

      await translationController.getCouponTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockCouponService.getCouponWithTranslations).toHaveBeenCalledWith(
        couponId,
        undefined
      );
      expect(jsonMock).toHaveBeenCalledWith(mockCouponData);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockReq.params = { id: couponId };
      mockReq.query = {};
      mockCouponService.getCouponWithTranslations.mockRejectedValue(error);

      await translationController.getCouponTranslations(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== getTranslationJob Tests ==========
  describe('getTranslationJob', () => {
    const jobId = 'job-123';

    it('should return 404 when job not found', async () => {
      mockReq.params = { id: jobId };
      mockTranslationService.getTranslationJobById.mockResolvedValue(null);

      await translationController.getTranslationJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.getTranslationJobById).toHaveBeenCalledWith(jobId);
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Translation job not found' });
    });

    it('should successfully return translation job', async () => {
      const mockJob = {
        id: jobId,
        entityType: 'survey',
        entityId: 'survey-123',
        status: 'completed',
        userId: adminUser.id,
      };

      mockReq.params = { id: jobId };
      mockTranslationService.getTranslationJobById.mockResolvedValue(mockJob as any);

      await translationController.getTranslationJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(mockJob);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockReq.params = { id: jobId };
      mockTranslationService.getTranslationJobById.mockRejectedValue(error);

      await translationController.getTranslationJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== getTranslationJobs Tests ==========
  describe('getTranslationJobs', () => {
    it('should return jobs with default pagination', async () => {
      const mockResult = {
        jobs: [],
        total: 0,
        page: 1,
        limit: 10,
      };

      mockReq.query = {};
      mockTranslationService.getTranslationJobs.mockResolvedValue(mockResult as any);

      await translationController.getTranslationJobs(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.getTranslationJobs).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: undefined,
        entityType: undefined,
        userId: adminUser.id,
      });
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should return jobs with custom pagination and filters', async () => {
      const mockResult = {
        jobs: [{ id: 'job-1' }, { id: 'job-2' }],
        total: 2,
        page: 2,
        limit: 5,
      };

      mockReq.query = {
        page: '2',
        limit: '5',
        status: 'completed',
        entityType: 'survey',
      };
      mockTranslationService.getTranslationJobs.mockResolvedValue(mockResult as any);

      await translationController.getTranslationJobs(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.getTranslationJobs).toHaveBeenCalledWith({
        page: 2,
        limit: 5,
        status: 'completed',
        entityType: 'survey',
        userId: adminUser.id,
      });
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should filter by user ID from request', async () => {
      const customUser = { id: 'user-999', role: 'admin' as const, email: 'test@test.com' };
      mockReq.user = customUser;
      mockReq.query = {};

      const mockResult = { jobs: [], total: 0, page: 1, limit: 10 };
      mockTranslationService.getTranslationJobs.mockResolvedValue(mockResult as any);

      await translationController.getTranslationJobs(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.getTranslationJobs).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: undefined,
        entityType: undefined,
        userId: customUser.id,
      });
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockReq.query = {};
      mockTranslationService.getTranslationJobs.mockRejectedValue(error);

      await translationController.getTranslationJobs(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  // ========== getServiceStatus Tests ==========
  describe('getServiceStatus', () => {
    it('should successfully return service status', async () => {
      const mockStatus = {
        azure: { available: true, latency: 50 },
        google: { available: true, latency: 45 },
      };

      mockTranslationService.getServiceStatus.mockResolvedValue(mockStatus as any);

      await translationController.getServiceStatus(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockTranslationService.getServiceStatus).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(mockStatus);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockTranslationService.getServiceStatus.mockRejectedValue(error);

      await translationController.getServiceStatus(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
