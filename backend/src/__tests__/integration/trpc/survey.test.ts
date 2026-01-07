/**
 * tRPC Survey Router Integration Tests
 * Tests all survey router procedures with real database interactions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TRPCError } from '@trpc/server';
import { surveyRouter } from '../../../trpc/routers/survey';
import { surveyService } from '../../../services/surveyService';
import { createAuthenticatedCaller, createUnauthenticatedCaller } from './helpers';

// Mock logger to reduce noise
jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('tRPC Survey Router - Integration Tests', () => {
  const SURVEY_ID = '12345678-1234-1234-1234-123456789012';
  const SURVEY_ID_2 = '12345678-1234-1234-1234-123456789013';

  const mockSurvey = {
    id: SURVEY_ID,
    title: 'Customer Satisfaction Survey',
    description: 'Help us improve our service',
    status: 'active',
    access_type: 'public',
    questions: [
      {
        id: 'q1',
        type: 'single_choice',
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
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    created_by: 'admin-test-id',
  } as any;

  const mockPublicSurvey = {
    ...mockSurvey,
    id: SURVEY_ID_2,
    title: 'Public Survey',
    access_type: 'public',
  } as any;

  const mockInvitedSurvey = {
    ...mockSurvey,
    id: SURVEY_ID,
    title: 'Invited Survey',
    access_type: 'invite_only',
  } as any;

  const mockSurveyResponse = {
    id: 'response-1',
    survey_id: SURVEY_ID,
    user_id: 'customer-test-id',
    answers: { q1: '5' },
    is_completed: true,
    progress: 100,
    started_at: new Date('2025-01-10'),
    completed_at: new Date('2025-01-10'),
    created_at: new Date('2025-01-10'),
    updated_at: new Date('2025-01-10'),
  } as any;

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
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getActiveSurveys Tests ==========
  describe('getActiveSurveys', () => {
    it('should return active surveys for authenticated customer', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      const mockSurveys = [mockSurvey];
      jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue(mockSurveys);

      const result = await caller.getActiveSurveys();

      expect(surveyService.getAvailableSurveys).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(mockSurveys);
      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe('Customer Satisfaction Survey');
    });

    it('should return active surveys for authenticated admin', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      const mockSurveys = [mockSurvey, mockPublicSurvey];
      jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue(mockSurveys);

      const result = await caller.getActiveSurveys();

      expect(surveyService.getAvailableSurveys).toHaveBeenCalledWith('admin-test-id');
      expect(result).toEqual(mockSurveys);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no surveys available', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue([]);

      const result = await caller.getActiveSurveys();

      expect(surveyService.getAvailableSurveys).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual([]);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(caller.getActiveSurveys()).rejects.toThrow(TRPCError);
      await expect(caller.getActiveSurveys()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle database errors gracefully', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getAvailableSurveys').mockRejectedValue(new Error('Database connection failed'));

      await expect(caller.getActiveSurveys()).rejects.toThrow('Database connection failed');
    });
  });

  // ========== getPublicSurveys Tests ==========
  describe('getPublicSurveys', () => {
    it('should return public surveys for authenticated user', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      const mockSurveys = [mockPublicSurvey];
      jest.spyOn(surveyService, 'getPublicSurveys').mockResolvedValue(mockSurveys);

      const result = await caller.getPublicSurveys();

      expect(surveyService.getPublicSurveys).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(mockSurveys);
      expect(result[0]?.access_type).toBe('public');
    });

    it('should return empty array when no public surveys exist', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getPublicSurveys').mockResolvedValue([]);

      const result = await caller.getPublicSurveys();

      expect(result).toEqual([]);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(caller.getPublicSurveys()).rejects.toThrow(TRPCError);
      await expect(caller.getPublicSurveys()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      jest.spyOn(surveyService, 'getPublicSurveys').mockResolvedValue([mockPublicSurvey]);

      const result = await caller.getPublicSurveys();

      expect(surveyService.getPublicSurveys).toHaveBeenCalledWith('admin-test-id');
      expect(result).toHaveLength(1);
    });
  });

  // ========== getInvitedSurveys Tests ==========
  describe('getInvitedSurveys', () => {
    it('should return invited surveys for authenticated user', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      const mockSurveys = [mockInvitedSurvey];
      jest.spyOn(surveyService, 'getInvitedSurveys').mockResolvedValue(mockSurveys);

      const result = await caller.getInvitedSurveys();

      expect(surveyService.getInvitedSurveys).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(mockSurveys);
      expect(result[0]?.access_type).toBe('invite_only');
    });

    it('should return empty array when no invitations exist', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getInvitedSurveys').mockResolvedValue([]);

      const result = await caller.getInvitedSurveys();

      expect(result).toEqual([]);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(caller.getInvitedSurveys()).rejects.toThrow(TRPCError);
      await expect(caller.getInvitedSurveys()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      jest.spyOn(surveyService, 'getInvitedSurveys').mockResolvedValue([mockInvitedSurvey]);

      const result = await caller.getInvitedSurveys();

      expect(surveyService.getInvitedSurveys).toHaveBeenCalledWith('admin-test-id');
      expect(result).toHaveLength(1);
    });
  });

  // ========== getSurveyById Tests ==========
  describe('getSurveyById', () => {
    it('should return survey when user has access', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'getSurveyById').mockResolvedValue(mockSurvey);

      const result = await caller.getSurveyById({ surveyId: SURVEY_ID });

      expect(surveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-test-id', SURVEY_ID);
      expect(surveyService.getSurveyById).toHaveBeenCalledWith(SURVEY_ID);
      expect(result).toEqual(mockSurvey);
      expect(result.id).toBe(SURVEY_ID);
    });

    it('should return survey with translations when language specified', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      const translatedSurvey = { ...mockSurvey, title: 'แบบสำรวจความพึงพอใจ' };
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'getSurveyWithTranslations').mockResolvedValue(translatedSurvey as any);

      const result = await caller.getSurveyById({ surveyId: SURVEY_ID, language: 'th' });

      expect(surveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-test-id', SURVEY_ID);
      expect(surveyService.getSurveyWithTranslations).toHaveBeenCalledWith(SURVEY_ID, 'th');
      expect(result).toEqual(translatedSurvey);
      expect(result.title).toBe('แบบสำรวจความพึงพอใจ');
    });

    it('should allow admin to access any survey regardless of permissions', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(false);
      jest.spyOn(surveyService, 'getSurveyById').mockResolvedValue(mockSurvey);

      const result = await caller.getSurveyById({ surveyId: SURVEY_ID });

      expect(surveyService.canUserAccessSurvey).toHaveBeenCalledWith('admin-test-id', SURVEY_ID);
      expect(surveyService.getSurveyById).toHaveBeenCalledWith(SURVEY_ID);
      expect(result).toEqual(mockSurvey);
    });

    it('should throw error when customer does not have access', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(false);

      await expect(
        caller.getSurveyById({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Access denied: You do not have permission to view this survey');
    });

    it('should throw error when survey not found', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'getSurveyById').mockResolvedValue(null);

      await expect(caller.getSurveyById({ surveyId: SURVEY_ID })).rejects.toThrow('Survey not found');
    });

    it('should validate UUID format for surveyId', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getSurveyById({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(
        caller.getSurveyById({ surveyId: SURVEY_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getSurveyById({ surveyId: SURVEY_ID })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== submitResponse Tests ==========
  describe('submitResponse', () => {
    it('should submit complete response when user has access', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'submitResponse').mockResolvedValue(mockSurveyResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: true,
      });

      expect(surveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-test-id', SURVEY_ID);
      expect(surveyService.submitResponse).toHaveBeenCalledWith('customer-test-id', {
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: true,
      });
      expect(result).toEqual(mockSurveyResponse);
      expect(result.is_completed).toBe(true);
    });

    it('should submit partial response', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      const partialResponse = { ...mockSurveyResponse, is_completed: false, progress: 50, completed_at: null } as any;
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'submitResponse').mockResolvedValue(partialResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
        is_completed: false,
      });

      expect(result.is_completed).toBe(false);
      expect(result.progress).toBe(50);
      expect(result.completed_at).toBeNull();
    });

    it('should submit response without is_completed flag (defaults to false)', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'submitResponse').mockResolvedValue(mockSurveyResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
      });

      expect(surveyService.submitResponse).toHaveBeenCalledWith('customer-test-id', {
        survey_id: SURVEY_ID,
        answers: { q1: '5' },
      });
      expect(result).toEqual(mockSurveyResponse);
    });

    it('should accept empty answers object for partial submission', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      const partialResponse = { ...mockSurveyResponse, answers: {}, is_completed: false } as any;
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'submitResponse').mockResolvedValue(partialResponse);

      const result = await caller.submitResponse({
        survey_id: SURVEY_ID,
        answers: {},
      });

      expect(result.answers).toEqual({});
    });

    it('should throw error when user does not have access', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(false);

      await expect(
        caller.submitResponse({
          survey_id: SURVEY_ID,
          answers: { q1: '5' },
        })
      ).rejects.toThrow('Access denied: You do not have permission to submit responses to this survey');
    });

    it('should validate UUID format for survey_id', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.submitResponse({
          survey_id: 'not-a-uuid',
          answers: { q1: '5' },
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(
        caller.submitResponse({
          survey_id: SURVEY_ID,
          answers: { q1: '5' },
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.submitResponse({
          survey_id: SURVEY_ID,
          answers: { q1: '5' },
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle survey service errors', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
      jest.spyOn(surveyService, 'submitResponse').mockRejectedValue(new Error('Failed to save response'));

      await expect(
        caller.submitResponse({
          survey_id: SURVEY_ID,
          answers: { q1: '5' },
        })
      ).rejects.toThrow('Failed to save response');
    });
  });

  // ========== getUserResponse Tests ==========
  describe('getUserResponse', () => {
    it('should return user response for specific survey', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(mockSurveyResponse);

      const result = await caller.getUserResponse({ surveyId: SURVEY_ID });

      expect(surveyService.getUserResponse).toHaveBeenCalledWith('customer-test-id', SURVEY_ID);
      expect(result).toEqual(mockSurveyResponse);
      expect(result?.survey_id).toBe(SURVEY_ID);
    });

    it('should return null when no response found', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(null);

      const result = await caller.getUserResponse({ surveyId: SURVEY_ID });

      expect(surveyService.getUserResponse).toHaveBeenCalledWith('customer-test-id', SURVEY_ID);
      expect(result).toBeNull();
    });

    it('should validate UUID format for surveyId', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getUserResponse({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(
        caller.getUserResponse({ surveyId: SURVEY_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getUserResponse({ surveyId: SURVEY_ID })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== getMyResponses Tests ==========
  describe('getMyResponses', () => {
    it('should return response for specific survey', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(mockSurveyResponse);

      const result = await caller.getMyResponses({ surveyId: SURVEY_ID });

      expect(surveyService.getUserResponse).toHaveBeenCalledWith('customer-test-id', SURVEY_ID);
      expect(result).toEqual({
        responses: [mockSurveyResponse],
        total: 1,
        page: 1,
        pageSize: 1,
        totalPages: 1,
      });
    });

    it('should return empty when no response found for specific survey', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');
      jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(null);

      const result = await caller.getMyResponses({ surveyId: SURVEY_ID });

      expect(result).toEqual({
        responses: [],
        total: 0,
        page: 1,
        pageSize: 1,
        totalPages: 0,
      });
    });

    it('should return paginated structure when querying all responses', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

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
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      const result = await caller.getMyResponses({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('should accept custom pagination values', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      const result = await caller.getMyResponses({ page: 2, pageSize: 50 });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(50);
    });

    it('should enforce maximum pageSize of 100', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await caller.getMyResponses({ page: 1, pageSize: 100 });
      // Should not throw
    });

    it('should reject pageSize greater than 100', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getMyResponses({ page: 1, pageSize: 101 })
      ).rejects.toThrow();
    });

    it('should reject negative page number', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getMyResponses({ page: -1, pageSize: 20 })
      ).rejects.toThrow();
    });

    it('should reject zero page number', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getMyResponses({ page: 0, pageSize: 20 })
      ).rejects.toThrow();
    });

    it('should validate UUID format for surveyId when provided', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getMyResponses({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(caller.getMyResponses({})).rejects.toThrow(TRPCError);
      await expect(caller.getMyResponses({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== getSurveyAnalytics Tests (Admin Only) ==========
  describe('getSurveyAnalytics', () => {
    it('should return analytics for admin', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      jest.spyOn(surveyService, 'getSurveyAnalytics').mockResolvedValue(mockAnalytics);

      const result = await caller.getSurveyAnalytics({ surveyId: SURVEY_ID });

      expect(surveyService.getSurveyAnalytics).toHaveBeenCalledWith(SURVEY_ID);
      expect(result).toEqual(mockAnalytics);
      expect(result.totalResponses).toBe(1);
      expect(result.completionRate).toBe(100);
    });

    it('should throw error when survey not found', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      jest.spyOn(surveyService, 'getSurveyAnalytics').mockResolvedValue(null);

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Survey not found or analytics unavailable');
    });

    it('should validate UUID format for surveyId', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');

      await expect(
        caller.getSurveyAnalytics({ surveyId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(surveyRouter);

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to get analytics', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'customer');

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(surveyRouter, 'admin');
      jest.spyOn(surveyService, 'getSurveyAnalytics').mockRejectedValue(new Error('Analytics generation failed'));

      await expect(
        caller.getSurveyAnalytics({ surveyId: SURVEY_ID })
      ).rejects.toThrow('Analytics generation failed');
    });
  });

  // ========== Nullable Fields Handling Tests ==========
  describe('nullable fields handling', () => {
    describe('getActiveSurveys with null fields', () => {
      it('should handle survey with null description', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const surveyWithNullDesc = {
          ...mockSurvey,
          description: null,
        };
        jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue([surveyWithNullDesc]);

        const result = await caller.getActiveSurveys();

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]!.description).toBeNull();
      });

      it('should handle survey with null target_segment', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const surveyWithNullSegment = {
          ...mockSurvey,
          target_segment: null,
        };
        jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue([surveyWithNullSegment]);

        const result = await caller.getActiveSurveys();

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]!.target_segment).toBeNull();
      });

      it('should handle survey with empty target_segment', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const surveyWithEmptySegment = {
          ...mockSurvey,
          target_segment: {},
        };
        jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue([surveyWithEmptySegment]);

        const result = await caller.getActiveSurveys();

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]!.target_segment).toEqual({});
      });

      it('should handle survey with all optional fields null', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const surveyWithAllNulls = {
          id: SURVEY_ID,
          title: 'Minimal Survey',
          description: null,
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: null,
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          created_by: 'admin-test-id',
        };
        jest.spyOn(surveyService, 'getAvailableSurveys').mockResolvedValue([surveyWithAllNulls] as any);

        const result = await caller.getActiveSurveys();

        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result[0]!.description).toBeNull();
        expect(result[0]!.target_segment).toBeNull();
      });
    });

    describe('getSurveyById with null fields', () => {
      it('should handle survey with null description', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const surveyWithNullDesc = {
          ...mockSurvey,
          description: null,
        };
        jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
        jest.spyOn(surveyService, 'getSurveyById').mockResolvedValue(surveyWithNullDesc);

        const result = await caller.getSurveyById({ surveyId: SURVEY_ID });

        expect(result).not.toBeNull();
        expect(result.description).toBeNull();
        expect(result.id).toBe(SURVEY_ID);
      });

      it('should handle survey with null target_segment', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const surveyWithNullSegment = {
          ...mockSurvey,
          target_segment: null,
        };
        jest.spyOn(surveyService, 'canUserAccessSurvey').mockResolvedValue(true);
        jest.spyOn(surveyService, 'getSurveyById').mockResolvedValue(surveyWithNullSegment);

        const result = await caller.getSurveyById({ surveyId: SURVEY_ID });

        expect(result).not.toBeNull();
        expect(result.target_segment).toBeNull();
      });
    });

    describe('getMyResponses with null fields', () => {
      it('should handle response with partial answers', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const responseWithPartialAnswers = {
          ...mockSurveyResponse,
          answers: { q1: '5' }, // Missing answers for other questions
          is_completed: false,
          progress: 50,
          completed_at: null,
        };
        jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(responseWithPartialAnswers);

        const result = await caller.getMyResponses({ surveyId: SURVEY_ID, page: 1, pageSize: 10 });

        expect(result).not.toBeNull();
        expect(result.responses).toHaveLength(1);
        expect(result.responses[0]!.is_completed).toBe(false);
        expect(result.responses[0]!.completed_at).toBeNull();
        expect(result.responses[0]!.progress).toBe(50);
      });

      it('should handle response with null completed_at (in progress)', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const inProgressResponse = {
          ...mockSurveyResponse,
          is_completed: false,
          completed_at: null,
        };
        jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(inProgressResponse);

        const result = await caller.getMyResponses({ surveyId: SURVEY_ID, page: 1, pageSize: 10 });

        expect(result).not.toBeNull();
        expect(result.responses).toHaveLength(1);
        expect(result.responses[0]!.completed_at).toBeNull();
      });

      it('should handle response with empty answers object', async () => {
        const caller = createAuthenticatedCaller(surveyRouter, 'customer');
        const responseWithEmptyAnswers = {
          ...mockSurveyResponse,
          answers: {},
          is_completed: false,
          progress: 0,
        };
        jest.spyOn(surveyService, 'getUserResponse').mockResolvedValue(responseWithEmptyAnswers);

        const result = await caller.getMyResponses({ surveyId: SURVEY_ID, page: 1, pageSize: 10 });

        expect(result).not.toBeNull();
        expect(result.responses).toHaveLength(1);
        expect(result.responses[0]!.answers).toEqual({});
        expect(result.responses[0]!.progress).toBe(0);
      });
    });
  });
});
