import { TRPCError } from '@trpc/server';

// Create mock surveyService instance
const mockSurveyService = {
  getAvailableSurveys: jest.fn(),
  getSurveyById: jest.fn(),
  getSurveyWithTranslations: jest.fn(),
  canUserAccessSurvey: jest.fn(),
  submitResponse: jest.fn(),
  getUserResponse: jest.fn(),
  getSurveyAnalytics: jest.fn(),
};

// Mock the surveyService before importing the router
jest.mock('../../../services/surveyService', () => ({
  surveyService: mockSurveyService,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import router and tRPC test caller after mocks are set up
import { surveyRouter } from '../../../trpc/routers/survey';
import type { Context } from '../../../trpc/context';

/**
 * Helper to create a tRPC caller with context
 */
const createCaller = (ctx: Context) => {
  return surveyRouter.createCaller(ctx);
};

describe('tRPC Survey Router', () => {
  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  const SURVEY_ID = '12345678-1234-1234-1234-123456789012';

  const mockSurvey = {
    id: SURVEY_ID,
    title: 'Customer Satisfaction Survey',
    description: 'Help us improve our service',
    status: 'active' as const,
    access_type: 'public' as const,
    questions: [
      {
        id: 'q1',
        type: 'single_choice' as const,
        text: 'How satisfied are you?',
        required: true,
        options: [
          { id: 'opt1', text: 'Very satisfied', value: '5' },
          { id: 'opt2', text: 'Satisfied', value: '4' },
        ],
        order: 1,
      },
    ],
    target_segment: {},
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
    created_by: 'admin-1',
  };

  const mockSurveyResponse = {
    id: 'response-1',
    survey_id: SURVEY_ID,
    user_id: 'customer-1',
    answers: { q1: '5' },
    is_completed: true,
    progress: 100,
    started_at: new Date('2025-01-10'),
    completed_at: new Date('2025-01-10'),
    created_at: new Date('2025-01-10'),
    updated_at: new Date('2025-01-10'),
  };

  const mockAnalytics = {
    survey: mockSurvey,
    responses: [mockSurveyResponse],
    totalResponses: 1,
    completionRate: 100,
    averageCompletionTime: 120,
    responsesByDate: [{ date: '10/01/2025', count: 1 }],
    questionAnalytics: [
      {
        questionId: 'q1',
        question: 'How satisfied are you?',
        type: 'single_choice',
        responses: { '5': 1 },
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getActiveSurveys Tests ==========
  describe('getActiveSurveys', () => {
    it('should return active surveys for authenticated user', async () => {
      const caller = createCaller({ user: customerUser });
      const mockSurveys = [mockSurvey];
      mockSurveyService.getAvailableSurveys.mockResolvedValue(mockSurveys);

      const result = await caller.getActiveSurveys();

      expect(mockSurveyService.getAvailableSurveys).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual(mockSurveys);
    });

    it('should return empty array when no surveys available', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.getAvailableSurveys.mockResolvedValue([]);

      const result = await caller.getActiveSurveys();

      expect(mockSurveyService.getAvailableSurveys).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual([]);
    });

    it('should work for admin users', async () => {
      const caller = createCaller({ user: adminUser });
      const mockSurveys = [mockSurvey];
      mockSurveyService.getAvailableSurveys.mockResolvedValue(mockSurveys);

      const result = await caller.getActiveSurveys();

      expect(mockSurveyService.getAvailableSurveys).toHaveBeenCalledWith('admin-1');
      expect(result).toEqual(mockSurveys);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getActiveSurveys()).rejects.toThrow(TRPCError);
      await expect(caller.getActiveSurveys()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.getAvailableSurveys.mockRejectedValue(new Error('Database error'));

      await expect(caller.getActiveSurveys()).rejects.toThrow('Database error');
    });
  });

  // ========== getSurveyById Tests ==========
  describe('getSurveyById', () => {
    it('should return survey when user has access', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);

      const result = await caller.getSurveyById({ surveyId: SURVEY_ID });

      expect(mockSurveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-1', SURVEY_ID);
      expect(mockSurveyService.getSurveyById).toHaveBeenCalledWith(SURVEY_ID);
      expect(result).toEqual(mockSurvey);
    });

    it('should return survey with translations when language specified', async () => {
      const caller = createCaller({ user: customerUser });
      const translatedSurvey = { ...mockSurvey, title: 'แบบสำรวจความพึงพอใจ' };
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.getSurveyWithTranslations.mockResolvedValue(translatedSurvey);

      const result = await caller.getSurveyById({ surveyId: SURVEY_ID, language: 'en' });

      expect(mockSurveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-1', SURVEY_ID);
      expect(mockSurveyService.getSurveyWithTranslations).toHaveBeenCalledWith(SURVEY_ID, 'en');
      expect(result).toEqual(translatedSurvey);
    });

    it('should allow admin to access any survey', async () => {
      const caller = createCaller({ user: adminUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(false);
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);

      const result = await caller.getSurveyById({ surveyId: SURVEY_ID });

      expect(mockSurveyService.canUserAccessSurvey).toHaveBeenCalledWith('admin-1', SURVEY_ID);
      expect(mockSurveyService.getSurveyById).toHaveBeenCalledWith(SURVEY_ID);
      expect(result).toEqual(mockSurvey);
    });

    it('should throw error when customer does not have access', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(false);

      await expect(
        caller.getSurveyById({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Access denied: You do not have permission to view this survey');
    });

    it('should throw error when survey not found', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.getSurveyById.mockResolvedValue(null);

      await expect(caller.getSurveyById({ surveyId: SURVEY_ID })).rejects.toThrow('Survey not found');
    });

    it('should require valid UUID for surveyId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getSurveyById({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.getSurveyById({ surveyId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getSurveyById({ surveyId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockRejectedValue(new Error('Database error'));

      await expect(caller.getSurveyById({ surveyId: SURVEY_ID })).rejects.toThrow('Database error');
    });
  });

  // ========== submitResponse Tests ==========
  describe('submitResponse', () => {
    it('should submit response when user has access', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.submitResponse.mockResolvedValue(mockSurveyResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: true,
      });

      expect(mockSurveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-1', SURVEY_ID);
      expect(mockSurveyService.submitResponse).toHaveBeenCalledWith('customer-1', {
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: true,
      });
      expect(result).toEqual(mockSurveyResponse);
    });

    it('should submit partial response', async () => {
      const caller = createCaller({ user: customerUser });
      const partialResponse = { ...mockSurveyResponse, is_completed: false, progress: 50 };
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.submitResponse.mockResolvedValue(partialResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: false,
      });

      expect(mockSurveyService.submitResponse).toHaveBeenCalledWith('customer-1', {
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: false,
      });
      expect(result).toEqual(partialResponse);
    });

    it('should submit response without is_completed flag', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.submitResponse.mockResolvedValue(mockSurveyResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
      });

      expect(mockSurveyService.submitResponse).toHaveBeenCalledWith('customer-1', {
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
      });
      expect(result).toEqual(mockSurveyResponse);
    });

    it('should throw error when user does not have access', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(false);

      await expect(
        caller.submitResponse({
          survey_id: SURVEY_ID,
          answers: { q1: '5' },
        })
      ).rejects.toThrow('Access denied: You do not have permission to submit responses to this survey');
    });

    it('should accept empty answers object', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.submitResponse.mockResolvedValue({ ...mockSurveyResponse, answers: {} });

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: {},
      });

      expect(mockSurveyService.submitResponse).toHaveBeenCalledWith('customer-1', {
        survey_id: SURVEY_ID,
        answers: {},
      });
      expect(result.answers).toEqual({});
    });

    it('should require valid UUID for survey_id', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.submitResponse({
          survey_id: 'not-a-uuid',
          answers: { q1: '5' },
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.submitResponse({
          survey_id: '12345678-1234-1234-1234-123456789012',
          answers: { q1: '5' },
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.submitResponse({
          survey_id: '12345678-1234-1234-1234-123456789012',
          answers: { q1: '5' },
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.submitResponse.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.submitResponse({
          survey_id: SURVEY_ID,
          answers: { q1: '5' },
        })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== getMyResponses Tests ==========
  describe('getMyResponses', () => {
    it('should return response for specific survey', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.getUserResponse.mockResolvedValue(mockSurveyResponse);

      const result = await caller.getMyResponses({ surveyId: SURVEY_ID });

      expect(mockSurveyService.getUserResponse).toHaveBeenCalledWith('customer-1', SURVEY_ID);
      expect(result).toEqual({
        responses: [mockSurveyResponse],
        total: 1,
        page: 1,
        pageSize: 1,
        totalPages: 1,
      });
    });

    it('should return empty when no response found for specific survey', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.getUserResponse.mockResolvedValue(null);

      const result = await caller.getMyResponses({ surveyId: SURVEY_ID });

      expect(mockSurveyService.getUserResponse).toHaveBeenCalledWith('customer-1', SURVEY_ID);
      expect(result).toEqual({
        responses: [],
        total: 0,
        page: 1,
        pageSize: 1,
        totalPages: 0,
      });
    });

    it('should return empty list when querying all responses', async () => {
      const caller = createCaller({ user: customerUser });

      const result = await caller.getMyResponses({ page: 1, pageSize: 20 });

      expect(result).toEqual({
        responses: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
    });

    it('should use default pagination values', async () => {
      const caller = createCaller({ user: customerUser });

      const result = await caller.getMyResponses({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should accept custom pagination values', async () => {
      const caller = createCaller({ user: customerUser });

      const result = await caller.getMyResponses({ page: 2, pageSize: 50 });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(50);
    });

    it('should enforce maximum pageSize of 100', async () => {
      const caller = createCaller({ user: customerUser });

      await caller.getMyResponses({ page: 1, pageSize: 100 });

      // Should not throw
    });

    it('should reject pageSize greater than 100', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getMyResponses({ page: 1, pageSize: 101 })
      ).rejects.toThrow();
    });

    it('should reject negative page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getMyResponses({ page: -1, pageSize: 20 })
      ).rejects.toThrow();
    });

    it('should reject zero page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getMyResponses({ page: 0, pageSize: 20 })
      ).rejects.toThrow();
    });

    it('should require valid UUID for surveyId when provided', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getMyResponses({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getMyResponses({})).rejects.toThrow(TRPCError);
      await expect(caller.getMyResponses({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockSurveyService.getUserResponse.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.getMyResponses({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== getSurveyAnalytics Tests (Admin Only) ==========
  describe('getSurveyAnalytics', () => {
    it('should return analytics for admin', async () => {
      const caller = createCaller({ user: adminUser });
      mockSurveyService.getSurveyAnalytics.mockResolvedValue(mockAnalytics);

      const result = await caller.getSurveyAnalytics({ surveyId: SURVEY_ID });

      expect(mockSurveyService.getSurveyAnalytics).toHaveBeenCalledWith(SURVEY_ID);
      expect(result).toEqual(mockAnalytics);
    });

    it('should throw error when survey not found', async () => {
      const caller = createCaller({ user: adminUser });
      mockSurveyService.getSurveyAnalytics.mockResolvedValue(null);

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Survey not found or analytics unavailable');
    });

    it('should require valid UUID for surveyId', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.getSurveyAnalytics({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.getSurveyAnalytics({ surveyId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getSurveyAnalytics({ surveyId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to get analytics', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: adminUser });
      mockSurveyService.getSurveyAnalytics.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Database error');
    });
  });
});
