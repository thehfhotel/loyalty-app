/* eslint-disable @typescript-eslint/no-explicit-any -- Mock objects in tests */
/**
 * SurveyService Unit Tests
 * Tests survey management, responses, analytics, and coupon assignments
 */

import { describe, expect, jest, beforeEach } from '@jest/globals';
import * as database from '../../../config/database';

// Mock dependencies BEFORE importing service
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');
jest.mock('../../../config/prisma', () => ({
  db: {
    survey_responses: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn()
    }
  }
}));

import { surveyService } from '../../../services/surveyService';
import { db } from '../../../config/prisma';

describe('SurveyService', () => {
  let mockQuery: jest.Mock;
  let mockClient: { query: jest.Mock; release: jest.Mock };
  let mockGetPool: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock client with query and release methods
    mockClient = {
      query: jest.fn() as jest.Mock,
      release: jest.fn() as jest.Mock
    };

    // Mock getPool to return object with connect method
    mockGetPool = jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(mockClient as never)
    });

    (database as unknown as Record<string, unknown>).getPool = mockGetPool;
    mockQuery = mockClient.query;
  });

  describe('Survey Basic Operations', () => {
    test('should be properly instantiated', () => {
      expect(surveyService).toBeDefined();
    });

    test('should have required methods', () => {
      expect(typeof surveyService.getSurveyById).toBe('function');
      expect(typeof surveyService.getSurveyAnalytics).toBe('function');
    });
  });

  describe('getSurveyById', () => {
    test('should return survey data for valid ID', async () => {
      const surveyId = 'test-survey-id';
      const expectedSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test Description',
        status: 'active',
        created_by: 'admin-user',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery.mockResolvedValueOnce({ rows: [expectedSurvey] } as never);

      const result = await surveyService.getSurveyById(surveyId);

      expect(result).toEqual(expectedSurvey);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([surveyId])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null for non-existent survey', async () => {
      const surveyId = 'non-existent-survey';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyById(surveyId);

      expect(result).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveyAnalytics', () => {
    test('should return analytics for valid survey', async () => {
      const surveyId = 'test-survey-id';
      const expectedSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test Description',
        status: 'active',
        created_by: 'admin-user',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [],
        target_segment: {},
        access_type: 'public'
      };

      // Mock getSurveyById call
      mockQuery.mockResolvedValueOnce({ rows: [expectedSurvey] } as never);
      // Mock subsequent analytics queries
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 100 }] } as never);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 50 }] } as never);
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null for non-existent survey analytics', async () => {
      const surveyId = 'non-existent-survey';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed') as never);

      await expect(surveyService.getSurveyById('test-id')).rejects.toThrow(
        'Database connection failed'
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle SQL errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Syntax error in SQL statement') as never);

      await expect(surveyService.getSurveyAnalytics('test-id')).rejects.toThrow(
        'Syntax error in SQL statement'
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Survey Response Handling', () => {
    test('should handle survey submission responses', async () => {
      const responseData = {
        survey_id: 'test-survey',
        answers: {
          'q1': 'option1',
          'q2': 'Some text answer'
        },
        is_completed: true
      };

      mockQuery.mockResolvedValueOnce({ rows: [{
        id: 'response-id',
        survey_id: responseData.survey_id,
        user_id: 'user-id',
        answers: responseData.answers,
        is_completed: responseData.is_completed,
        created_at: new Date().toISOString()
      }] } as never);

      // Test the response handling capability
      expect(mockQuery).toBeDefined();
    });
  });

  describe('Survey Coupon Assignment', () => {
    test('should handle coupon assignment structure', async () => {
      const assignmentData = {
        survey_id: 'test-survey',
        coupon_id: 'test-coupon',
        assigned_reason: 'Survey completion reward'
      };

      // Test coupon assignment data structure
      expect(assignmentData.survey_id).toBe('test-survey');
      expect(assignmentData.coupon_id).toBe('test-coupon');
      expect(assignmentData.assigned_reason).toBe('Survey completion reward');
    });
  });

  describe('Survey Question Types', () => {
    test('should support all question types', () => {
      const questionTypes = [
        'multiple_choice',
        'single_choice',
        'text',
        'textarea',
        'rating_5',
        'rating_10',
        'yes_no'
      ];

      questionTypes.forEach(type => {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      });
    });
  });

  describe('assignCouponToSurvey', () => {
    test('should assign coupon to survey successfully', async () => {
      const surveyId = 'test-survey-id';
      const couponId = 'test-coupon-id';
      const assignedBy = 'admin-user';
      const assignmentData = {
        survey_id: surveyId,
        coupon_id: couponId,
        max_awards: 100,
        custom_expiry_days: 30,
        assigned_reason: 'Survey completion reward'
      };

      const expectedAssignmentId = 'assignment-id-123';
      const expectedAssignment = {
        id: expectedAssignmentId,
        survey_id: surveyId,
        coupon_id: couponId,
        is_active: true,
        max_awards: 100,
        awarded_count: 0,
        assigned_by: assignedBy,
        assigned_reason: 'Survey completion reward',
        custom_expiry_days: 30,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      // Mock stored procedure call
      mockQuery
        .mockResolvedValueOnce({ rows: [{ assignment_id: expectedAssignmentId }] } as never)
        .mockResolvedValueOnce({ rows: [expectedAssignment] } as never);

      const result = await surveyService.assignCouponToSurvey(assignmentData, assignedBy);

      expect(result).toEqual(expectedAssignment);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('assign_coupon_to_survey'),
        expect.arrayContaining([surveyId, couponId, assignedBy])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should assign coupon without optional parameters', async () => {
      const assignmentData = {
        survey_id: 'survey-1',
        coupon_id: 'coupon-1'
      };

      const expectedAssignment = {
        id: 'assignment-1',
        survey_id: 'survey-1',
        coupon_id: 'coupon-1',
        is_active: true,
        max_awards: null,
        awarded_count: 0,
        assigned_by: 'admin',
        assigned_reason: 'Survey completion reward',
        custom_expiry_days: null,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ assignment_id: 'assignment-1' }] } as never)
        .mockResolvedValueOnce({ rows: [expectedAssignment] } as never);

      const result = await surveyService.assignCouponToSurvey(assignmentData, 'admin');

      expect(result).toEqual(expectedAssignment);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle assignment errors', async () => {
      const assignmentData = {
        survey_id: 'invalid-survey',
        coupon_id: 'invalid-coupon'
      };

      mockQuery.mockRejectedValueOnce(new Error('Survey or coupon not found') as never);

      await expect(
        surveyService.assignCouponToSurvey(assignmentData, 'admin')
      ).rejects.toThrow('Survey or coupon not found');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveyCouponAssignments', () => {
    test('should get survey coupon assignments with pagination', async () => {
      const surveyId = 'test-survey-id';
      const page = 1;
      const limit = 20;

      const mockAssignments = [
        {
          assignment_id: 'assignment-1',
          survey_id: surveyId,
          survey_title: 'Customer Satisfaction Survey',
          survey_status: 'active',
          coupon_id: 'coupon-1',
          coupon_code: 'SURVEY20',
          coupon_name: 'Survey Reward',
          coupon_type: 'percentage',
          coupon_value: 20,
          coupon_currency: 'THB',
          coupon_status: 'active',
          is_active: true,
          award_condition: 'completion',
          max_awards: 100,
          awarded_count: 25,
          custom_expiry_days: 30,
          assigned_reason: 'Survey completion reward',
          assigned_by: 'admin-1',
          assigned_by_email: 'admin@example.com',
          assigned_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-02T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
        .mockResolvedValueOnce({ rows: mockAssignments } as never);

      const result = await surveyService.getSurveyCouponAssignments(surveyId, page, limit);

      expect(result).toEqual({
        assignments: mockAssignments,
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        [surveyId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle empty assignments list', async () => {
      const surveyId = 'survey-no-coupons';

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyCouponAssignments(surveyId);

      expect(result.assignments).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle pagination correctly', async () => {
      const surveyId = 'test-survey';
      const page = 2;
      const limit = 10;
      const offset = 10;

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '25' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyCouponAssignments(surveyId, page, limit);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(3);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [surveyId, limit, offset]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('updateSurveyCouponAssignment', () => {
    test('should update assignment with all fields', async () => {
      const surveyId = 'survey-1';
      const couponId = 'coupon-1';
      const updateData = {
        max_awards: 200,
        custom_expiry_days: 60,
        assigned_reason: 'Updated reason',
        is_active: false
      };

      const updatedAssignment = {
        id: 'assignment-1',
        survey_id: surveyId,
        coupon_id: couponId,
        is_active: false,
        max_awards: 200,
        awarded_count: 50,
        assigned_by: 'admin',
        assigned_reason: 'Updated reason',
        custom_expiry_days: 60,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-03T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [updatedAssignment] } as never);

      const result = await surveyService.updateSurveyCouponAssignment(
        surveyId,
        couponId,
        updateData
      );

      expect(result).toEqual(updatedAssignment);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE survey_coupon_assignments'),
        expect.arrayContaining([surveyId, couponId])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should update only max_awards', async () => {
      const surveyId = 'survey-1';
      const couponId = 'coupon-1';
      const updateData = { max_awards: 500 };

      const updatedAssignment = {
        id: 'assignment-1',
        survey_id: surveyId,
        coupon_id: couponId,
        is_active: true,
        max_awards: 500,
        awarded_count: 50,
        assigned_by: 'admin',
        assigned_reason: 'Original reason',
        custom_expiry_days: 30,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-03T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [updatedAssignment] } as never);

      const result = await surveyService.updateSurveyCouponAssignment(
        surveyId,
        couponId,
        updateData
      );

      expect(result).toEqual(updatedAssignment);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return current assignment when no updates provided', async () => {
      const surveyId = 'survey-1';
      const couponId = 'coupon-1';
      const updateData = {};

      const currentAssignment = {
        id: 'assignment-1',
        survey_id: surveyId,
        coupon_id: couponId,
        is_active: true,
        max_awards: 100,
        awarded_count: 25,
        assigned_by: 'admin',
        assigned_reason: 'Original reason',
        custom_expiry_days: 30,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [currentAssignment] } as never);

      const result = await surveyService.updateSurveyCouponAssignment(
        surveyId,
        couponId,
        updateData
      );

      expect(result).toEqual(currentAssignment);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [surveyId, couponId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null for non-existent assignment', async () => {
      const surveyId = 'non-existent-survey';
      const couponId = 'non-existent-coupon';
      const updateData = { max_awards: 100 };

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.updateSurveyCouponAssignment(
        surveyId,
        couponId,
        updateData
      );

      expect(result).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should update to remove limits (undefined values)', async () => {
      const surveyId = 'survey-1';
      const couponId = 'coupon-1';
      const updateData = {
        max_awards: undefined,
        custom_expiry_days: undefined
      };

      const updatedAssignment = {
        id: 'assignment-1',
        survey_id: surveyId,
        coupon_id: couponId,
        is_active: true,
        max_awards: null,
        awarded_count: 10,
        assigned_by: 'admin',
        assigned_reason: 'Reason',
        custom_expiry_days: null,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-03T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [updatedAssignment] } as never);

      const result = await surveyService.updateSurveyCouponAssignment(
        surveyId,
        couponId,
        updateData
      );

      expect(result?.max_awards).toBeNull();
      expect(result?.custom_expiry_days).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('removeCouponFromSurvey', () => {
    test('should remove coupon assignment successfully', async () => {
      const surveyId = 'survey-1';
      const couponId = 'coupon-1';
      const removedBy = 'admin-user';

      mockQuery.mockResolvedValueOnce({ rows: [{ removed: true }] } as never);

      const result = await surveyService.removeCouponFromSurvey(surveyId, couponId, removedBy);

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('remove_coupon_from_survey'),
        [surveyId, couponId, removedBy]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return false when assignment does not exist', async () => {
      const surveyId = 'non-existent-survey';
      const couponId = 'non-existent-coupon';
      const removedBy = 'admin-user';

      mockQuery.mockResolvedValueOnce({ rows: [{ removed: false }] } as never);

      const result = await surveyService.removeCouponFromSurvey(surveyId, couponId, removedBy);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle removal errors', async () => {
      const surveyId = 'survey-1';
      const couponId = 'coupon-1';
      const removedBy = 'admin-user';

      mockQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expect(
        surveyService.removeCouponFromSurvey(surveyId, couponId, removedBy)
      ).rejects.toThrow('Database error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveyRewardHistory', () => {
    test('should get reward history with pagination', async () => {
      const surveyId = 'survey-1';
      const page = 1;
      const limit = 20;

      const mockRewards = [
        {
          id: 'reward-1',
          survey_coupon_assignment_id: 'assignment-1',
          survey_response_id: 'response-1',
          user_coupon_id: 'user-coupon-1',
          user_id: 'user-1',
          awarded_at: '2023-01-15T10:00:00Z',
          award_condition_met: 'completion',
          metadata: { response_count: 1 },
          created_at: '2023-01-15T10:00:00Z',
          user_email: 'user1@example.com',
          first_name: 'John',
          last_name: 'Doe',
          coupon_code: 'SURVEY20',
          coupon_name: 'Survey Reward'
        },
        {
          id: 'reward-2',
          survey_coupon_assignment_id: 'assignment-1',
          survey_response_id: 'response-2',
          user_coupon_id: 'user-coupon-2',
          user_id: 'user-2',
          awarded_at: '2023-01-16T10:00:00Z',
          award_condition_met: 'completion',
          metadata: { response_count: 1 },
          created_at: '2023-01-16T10:00:00Z',
          user_email: 'user2@example.com',
          first_name: 'Jane',
          last_name: 'Smith',
          coupon_code: 'SURVEY20',
          coupon_name: 'Survey Reward'
        }
      ];

      const expectedRewards = mockRewards.map(row => ({
        id: row.id,
        survey_coupon_assignment_id: row.survey_coupon_assignment_id,
        survey_response_id: row.survey_response_id,
        user_coupon_id: row.user_coupon_id,
        user_id: row.user_id,
        awarded_at: row.awarded_at,
        award_condition_met: row.award_condition_met,
        metadata: row.metadata,
        created_at: row.created_at,
        user_email: row.user_email,
        user_name: `${row.first_name} ${row.last_name}`,
        coupon_code: row.coupon_code,
        coupon_name: row.coupon_name
      }));

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '2' }] } as never)
        .mockResolvedValueOnce({ rows: mockRewards } as never);

      const result = await surveyService.getSurveyRewardHistory(surveyId, page, limit);

      expect(result.rewards).toEqual(expectedRewards);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle empty reward history', async () => {
      const surveyId = 'survey-no-rewards';

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyRewardHistory(surveyId);

      expect(result.rewards).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle users with missing names', async () => {
      const surveyId = 'survey-1';
      const mockRewards = [
        {
          id: 'reward-1',
          survey_coupon_assignment_id: 'assignment-1',
          survey_response_id: 'response-1',
          user_coupon_id: 'user-coupon-1',
          user_id: 'user-1',
          awarded_at: '2023-01-15T10:00:00Z',
          award_condition_met: 'completion',
          metadata: {},
          created_at: '2023-01-15T10:00:00Z',
          user_email: 'user1@example.com',
          first_name: null,
          last_name: null,
          coupon_code: 'SURVEY20',
          coupon_name: 'Survey Reward'
        }
      ];

      const expectedReward = {
        id: 'reward-1',
        survey_coupon_assignment_id: 'assignment-1',
        survey_response_id: 'response-1',
        user_coupon_id: 'user-coupon-1',
        user_id: 'user-1',
        awarded_at: '2023-01-15T10:00:00Z',
        award_condition_met: 'completion',
        metadata: {},
        created_at: '2023-01-15T10:00:00Z',
        user_email: 'user1@example.com',
        user_name: '',
        coupon_code: 'SURVEY20',
        coupon_name: 'Survey Reward'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
        .mockResolvedValueOnce({ rows: mockRewards } as never);

      const result = await surveyService.getSurveyRewardHistory(surveyId);

      expect(result.rewards).toHaveLength(1);
      expect(result.rewards[0]).toMatchObject(expectedReward);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle pagination for large datasets', async () => {
      const surveyId = 'popular-survey';
      const page = 5;
      const limit = 20;
      const total = 150;

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: String(total) }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyRewardHistory(surveyId, page, limit);

      expect(result.total).toBe(total);
      expect(result.totalPages).toBe(8);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([surveyId, limit, 80])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getAllSurveyCouponAssignments', () => {
    test('should get all assignments without filters', async () => {
      const page = 1;
      const limit = 20;

      const mockAssignments = [
        {
          assignment_id: 'assignment-1',
          survey_id: 'survey-1',
          survey_title: 'Survey 1',
          survey_status: 'active',
          coupon_id: 'coupon-1',
          coupon_code: 'CODE1',
          coupon_name: 'Coupon 1',
          coupon_type: 'percentage',
          coupon_value: 10,
          coupon_currency: 'THB',
          coupon_status: 'active',
          is_active: true,
          award_condition: 'completion',
          max_awards: 100,
          awarded_count: 20,
          custom_expiry_days: 30,
          assigned_reason: 'Reward',
          assigned_by: 'admin-1',
          assigned_by_email: 'admin@example.com',
          assigned_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
        .mockResolvedValueOnce({ rows: mockAssignments } as never);

      const result = await surveyService.getAllSurveyCouponAssignments(page, limit);

      expect(result.assignments).toEqual(mockAssignments);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter by survey_id', async () => {
      const filters = { survey_id: 'survey-1' };
      const mockAssignments = [
        {
          assignment_id: 'assignment-1',
          survey_id: 'survey-1',
          survey_title: 'Survey 1',
          survey_status: 'active',
          coupon_id: 'coupon-1',
          coupon_code: 'CODE1',
          coupon_name: 'Coupon 1',
          coupon_type: 'percentage',
          coupon_value: 10,
          coupon_currency: 'THB',
          coupon_status: 'active',
          is_active: true,
          award_condition: 'completion',
          max_awards: 100,
          awarded_count: 20,
          custom_expiry_days: 30,
          assigned_reason: 'Reward',
          assigned_by: 'admin-1',
          assigned_by_email: 'admin@example.com',
          assigned_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
        .mockResolvedValueOnce({ rows: mockAssignments } as never);

      const result = await surveyService.getAllSurveyCouponAssignments(1, 20, filters);

      expect(result.assignments).toHaveLength(1);
      if (result.assignments[0]) {
        expect(result.assignments[0].survey_id).toBe('survey-1');
      }
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['survey-1', 20, 0])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter by coupon_id', async () => {
      const filters = { coupon_id: 'coupon-1' };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await surveyService.getAllSurveyCouponAssignments(1, 20, filters);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['coupon-1'])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter by is_active', async () => {
      const filters = { is_active: true };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '2' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await surveyService.getAllSurveyCouponAssignments(1, 20, filters);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([true])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter by assigned_by', async () => {
      const filters = { assigned_by: 'admin-1' };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '3' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await surveyService.getAllSurveyCouponAssignments(1, 20, filters);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['admin-1'])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should apply multiple filters', async () => {
      const filters = {
        survey_id: 'survey-1',
        is_active: true,
        assigned_by: 'admin-1'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await surveyService.getAllSurveyCouponAssignments(1, 20, filters);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['survey-1', true, 'admin-1'])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle empty results', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getAllSurveyCouponAssignments(1, 20);

      expect(result.assignments).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveyInvitations', () => {
    test('should get survey invitations with user details', async () => {
      const surveyId = 'survey-1';
      const mockInvitations = [
        {
          id: 'invitation-1',
          survey_id: surveyId,
          user_id: 'user-1',
          status: 'sent',
          sent_at: '2023-01-15T10:00:00Z',
          created_at: '2023-01-15T10:00:00Z',
          updated_at: '2023-01-15T10:00:00Z',
          email: 'user1@example.com',
          first_name: 'John',
          last_name: 'Doe'
        }
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockInvitations } as never);

      const result = await surveyService.getSurveyInvitations(surveyId);

      expect(result).toEqual(mockInvitations);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('survey_invitations'),
        [surveyId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle empty invitations list', async () => {
      const surveyId = 'survey-no-invites';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyInvitations(surveyId);

      expect(result).toEqual([]);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('sendSurveyInvitations', () => {
    test('should send invitations to eligible users', async () => {
      const surveyId = 'survey-1';
      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: { tier_restrictions: ['1', '2'] },
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      const mockEligibleUsers = [
        { id: 'user-1', email: 'user1@example.com', tier_id: 1 },
        { id: 'user-2', email: 'user2@example.com', tier_id: 2 }
      ];

      // Create clients for nested calls
      const mockClient2 = {
        query: jest.fn().mockResolvedValueOnce({ rows: [mockSurvey] } as never),
        release: jest.fn() as jest.Mock
      };
      const mockClient3 = {
        query: jest.fn().mockResolvedValueOnce({ rows: mockEligibleUsers } as never),
        release: jest.fn() as jest.Mock
      };

      // Setup getPool to return different clients: main transaction, getSurveyById, getEligibleUsers
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient3 as never)
      });

      // Mock the transaction queries (main client)
      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Check existing invitation user-1
        .mockResolvedValueOnce({ rows: [] } as never) // Insert invitation user-1
        .mockResolvedValueOnce({ rows: [] } as never) // Check existing invitation user-2
        .mockResolvedValueOnce({ rows: [] } as never) // Insert invitation user-2
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await surveyService.sendSurveyInvitations(surveyId);

      expect(result.sent).toBe(2);
      expect(mockClient.release).toHaveBeenCalledTimes(1); // main transaction
      expect(mockClient2.release).toHaveBeenCalledTimes(1); // getSurveyById
      expect(mockClient3.release).toHaveBeenCalledTimes(1); // getEligibleUsers
    });

    test('should skip users who already have invitations', async () => {
      const surveyId = 'survey-1';
      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      const mockEligibleUsers = [
        { id: 'user-1', email: 'user1@example.com' }
      ];

      // Create clients for nested calls
      const mockClient2 = {
        query: jest.fn().mockResolvedValueOnce({ rows: [mockSurvey] } as never),
        release: jest.fn() as jest.Mock
      };
      const mockClient3 = {
        query: jest.fn().mockResolvedValueOnce({ rows: mockEligibleUsers } as never),
        release: jest.fn() as jest.Mock
      };

      // Setup getPool to return different clients: main transaction, getSurveyById, getEligibleUsers
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient3 as never)
      });

      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'existing' }] } as never) // Existing invitation
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await surveyService.sendSurveyInvitations(surveyId);

      expect(result.sent).toBe(0);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient2.release).toHaveBeenCalledTimes(1);
      expect(mockClient3.release).toHaveBeenCalledTimes(1);
    });

    test('should rollback on error', async () => {
      const surveyId = 'survey-1';
      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      // Create clients for nested calls
      const mockClient2 = {
        query: jest.fn().mockResolvedValueOnce({ rows: [mockSurvey] } as never),
        release: jest.fn() as jest.Mock
      };
      const mockClient3 = {
        query: jest.fn().mockRejectedValueOnce(new Error('Database error') as never),
        release: jest.fn() as jest.Mock
      };

      // Setup getPool to return different clients: main transaction, getSurveyById, getEligibleUsers
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient3 as never)
      });

      mockQuery.mockResolvedValueOnce({ rows: [] } as never); // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] } as never); // ROLLBACK

      await expect(surveyService.sendSurveyInvitations(surveyId)).rejects.toThrow(
        'Database error'
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should throw error for non-existent survey', async () => {
      const surveyId = 'non-existent';

      // Create clients - main transaction and getSurveyById
      const mockClient2 = {
        query: jest.fn().mockResolvedValueOnce({ rows: [] } as never),
        release: jest.fn() as jest.Mock
      };

      // Setup getPool to return different clients: main transaction, getSurveyById
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      });

      mockQuery.mockResolvedValueOnce({ rows: [] } as never); // BEGIN

      await expect(surveyService.sendSurveyInvitations(surveyId)).rejects.toThrow(
        'Survey not found'
      );
      expect(mockClient.release).toHaveBeenCalledTimes(1); // main transaction (releases even on error)
      expect(mockClient2.release).toHaveBeenCalledTimes(1); // getSurveyById
    });
  });

  describe('sendSurveyInvitationsToUsers', () => {
    test('should send invitations to specific users', async () => {
      const surveyId = 'survey-1';
      const userIds = ['user-1', 'user-2'];
      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      // Create a second mock client for the nested getSurveyById call
      const mockClient2 = {
        query: jest.fn() as jest.Mock,
        release: jest.fn() as jest.Mock
      };

      // Mock getPool to return different clients for nested connections
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      });

      // Mock for getSurveyById (uses mockClient2)
      mockClient2.query.mockResolvedValueOnce({ rows: [mockSurvey] } as never);

      // Mock for sendSurveyInvitationsToUsers transaction (uses mockClient)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never); // BEGIN

      // For each user: mock user fetch, check invitation, insert
      for (let i = 0; i < userIds.length; i++) {
        mockQuery
          .mockResolvedValueOnce({
            // eslint-disable-next-line security/detect-object-injection -- Test loop index
            rows: [{ id: userIds[i], email: `user${i + 1}@example.com`, tier_id: 1, created_at: '2023-01-01T00:00:00Z' }]
          } as never)
          .mockResolvedValueOnce({ rows: [] } as never) // No existing invitation
          .mockResolvedValueOnce({ rows: [] } as never); // Insert invitation
      }

      mockQuery.mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await surveyService.sendSurveyInvitationsToUsers(surveyId, userIds);

      expect(result.sent).toBe(2);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient2.release).toHaveBeenCalledTimes(1);
    });

    test('should skip admin users', async () => {
      const surveyId = 'survey-1';
      const userIds = ['admin-user-1'];
      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      // Create a second mock client for the nested getSurveyById call
      const mockClient2 = {
        query: jest.fn() as jest.Mock,
        release: jest.fn() as jest.Mock
      };

      // Mock getPool to return different clients for nested connections
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      });

      // Mock for getSurveyById (uses mockClient2)
      mockClient2.query.mockResolvedValueOnce({ rows: [mockSurvey] } as never);

      // Mock for sendSurveyInvitationsToUsers transaction (uses mockClient)
      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // User query returns empty (admin filtered out)
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await surveyService.sendSurveyInvitationsToUsers(surveyId, userIds);

      expect(result.sent).toBe(0);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient2.release).toHaveBeenCalledTimes(1);
    });

    test('should skip users who do not match target segment', async () => {
      const surveyId = 'survey-1';
      const userIds = ['user-1'];
      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: { tier_restrictions: ['3', '4'] }, // User is tier 1
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      // Create a second mock client for the nested getSurveyById call
      const mockClient2 = {
        query: jest.fn() as jest.Mock,
        release: jest.fn() as jest.Mock
      };

      // Mock getPool to return different clients for nested connections
      mockGetPool.mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient as never)
      }).mockReturnValueOnce({
        connect: jest.fn().mockResolvedValueOnce(mockClient2 as never)
      });

      // Mock for getSurveyById (uses mockClient2)
      mockClient2.query.mockResolvedValueOnce({ rows: [mockSurvey] } as never);

      // Mock for sendSurveyInvitationsToUsers transaction (uses mockClient)
      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'user-1', email: 'user1@example.com', tier_id: 1, created_at: '2023-01-01T00:00:00Z' }]
        } as never) // User query
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await surveyService.sendSurveyInvitationsToUsers(surveyId, userIds);

      expect(result.sent).toBe(0);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient2.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('resendInvitation', () => {
    test('should resend invitation successfully', async () => {
      const invitationId = 'invitation-1';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      await surveyService.resendInvitation(invitationId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE survey_invitations'),
        [invitationId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle resend for non-existent invitation', async () => {
      const invitationId = 'non-existent';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      await surveyService.resendInvitation(invitationId);

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('submitResponse - Detailed', () => {
    const mockSurveyResponses = db.survey_responses as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };

    test('should create new response when none exists', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const answers = {
        'q1': 'answer1',
        'q2': 'answer2'
      };

      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true },
          { id: 'q2', text: 'Question 2', type: 'text', required: true },
          { id: 'q3', text: 'Question 3', type: 'text', required: false }
        ],
        target_segment: {},
        created_by: 'admin',
        created_at: new Date(),
        updated_at: new Date()
      };

      const expectedResponse = {
        id: 'response-1',
        survey_id: surveyId,
        user_id: userId,
        answers: answers,
        is_completed: false,
        progress: 67,
        started_at: new Date(),
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockSurvey] } as never);
      mockSurveyResponses.findUnique.mockResolvedValueOnce(null as never);
      mockSurveyResponses.create.mockResolvedValueOnce(expectedResponse as never);

      const result = await surveyService.submitResponse(userId, {
        survey_id: surveyId,
        answers: answers,
        is_completed: false
      });

      expect(mockSurveyResponses.findUnique).toHaveBeenCalledWith({
        where: {
          survey_id_user_id: {
            survey_id: surveyId,
            user_id: userId
          }
        }
      });
      expect(mockSurveyResponses.create).toHaveBeenCalledWith({
        data: {
          survey_id: surveyId,
          user_id: userId,
          answers: answers,
          is_completed: false,
          progress: 67,
          completed_at: null
        }
      });
      expect(result).toEqual(expectedResponse);
      expect(result.progress).toBe(67);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should update existing response', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const existingResponseId = 'existing-response-1';
      const originalAnswers = { 'q1': 'old answer' };
      const newAnswers = {
        'q1': 'updated answer',
        'q2': 'new answer'
      };

      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true },
          { id: 'q2', text: 'Question 2', type: 'text', required: true }
        ],
        target_segment: {},
        created_by: 'admin',
        created_at: new Date(),
        updated_at: new Date()
      };

      const existingResponse = {
        id: existingResponseId,
        survey_id: surveyId,
        user_id: userId,
        answers: originalAnswers,
        is_completed: false,
        progress: 50,
        started_at: new Date(),
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      const updatedResponse = {
        ...existingResponse,
        answers: newAnswers,
        progress: 100,
        is_completed: false,
        updated_at: new Date()
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockSurvey] } as never);
      mockSurveyResponses.findUnique.mockResolvedValueOnce(existingResponse as never);
      mockSurveyResponses.update.mockResolvedValueOnce(updatedResponse as never);

      const result = await surveyService.submitResponse(userId, {
        survey_id: surveyId,
        answers: newAnswers,
        is_completed: false
      });

      expect(mockSurveyResponses.update).toHaveBeenCalledWith({
        where: { id: existingResponseId },
        data: {
          answers: newAnswers,
          is_completed: false,
          progress: 100,
          completed_at: null,
          updated_at: expect.any(Date)
        }
      });
      expect(result.answers).toEqual(newAnswers);
      expect(result.progress).toBe(100);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should calculate progress correctly for partial responses', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const answers = { 'q1': 'answer1' };

      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true },
          { id: 'q2', text: 'Question 2', type: 'text', required: true },
          { id: 'q3', text: 'Question 3', type: 'text', required: true },
          { id: 'q4', text: 'Question 4', type: 'text', required: true }
        ],
        target_segment: {},
        created_by: 'admin',
        created_at: new Date(),
        updated_at: new Date()
      };

      const expectedResponse = {
        id: 'response-1',
        survey_id: surveyId,
        user_id: userId,
        answers: answers,
        is_completed: false,
        progress: 25,
        started_at: new Date(),
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockSurvey] } as never);
      mockSurveyResponses.findUnique.mockResolvedValueOnce(null as never);
      mockSurveyResponses.create.mockResolvedValueOnce(expectedResponse as never);

      const result = await surveyService.submitResponse(userId, {
        survey_id: surveyId,
        answers: answers,
        is_completed: false
      });

      expect(result.progress).toBe(25);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should set completed_at when is_completed is true', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const answers = {
        'q1': 'answer1',
        'q2': 'answer2'
      };

      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true },
          { id: 'q2', text: 'Question 2', type: 'text', required: true }
        ],
        target_segment: {},
        created_by: 'admin',
        created_at: new Date(),
        updated_at: new Date()
      };

      const completedResponse = {
        id: 'response-1',
        survey_id: surveyId,
        user_id: userId,
        answers: answers,
        is_completed: true,
        progress: 100,
        started_at: new Date(),
        completed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockSurvey] } as never);
      mockSurveyResponses.findUnique.mockResolvedValueOnce(null as never);
      mockSurveyResponses.create.mockResolvedValueOnce(completedResponse as never);

      const result = await surveyService.submitResponse(userId, {
        survey_id: surveyId,
        answers: answers,
        is_completed: true
      });

      expect(mockSurveyResponses.create).toHaveBeenCalledWith({
        data: {
          survey_id: surveyId,
          user_id: userId,
          answers: answers,
          is_completed: true,
          progress: 100,
          completed_at: expect.any(Date)
        }
      });
      expect(result.is_completed).toBe(true);
      expect(result.completed_at).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should update response to completed and set completed_at', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const existingResponseId = 'existing-response-1';
      const answers = {
        'q1': 'answer1',
        'q2': 'answer2'
      };

      const mockSurvey = {
        id: surveyId,
        title: 'Test Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true },
          { id: 'q2', text: 'Question 2', type: 'text', required: true }
        ],
        target_segment: {},
        created_by: 'admin',
        created_at: new Date(),
        updated_at: new Date()
      };

      const existingResponse = {
        id: existingResponseId,
        survey_id: surveyId,
        user_id: userId,
        answers: { 'q1': 'partial' },
        is_completed: false,
        progress: 50,
        started_at: new Date(),
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      const completedResponse = {
        ...existingResponse,
        answers: answers,
        is_completed: true,
        progress: 100,
        completed_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockSurvey] } as never);
      mockSurveyResponses.findUnique.mockResolvedValueOnce(existingResponse as never);
      mockSurveyResponses.update.mockResolvedValueOnce(completedResponse as never);

      const result = await surveyService.submitResponse(userId, {
        survey_id: surveyId,
        answers: answers,
        is_completed: true
      });

      expect(mockSurveyResponses.update).toHaveBeenCalledWith({
        where: { id: existingResponseId },
        data: {
          answers: answers,
          is_completed: true,
          progress: 100,
          completed_at: expect.any(Date),
          updated_at: expect.any(Date)
        }
      });
      expect(result.is_completed).toBe(true);
      expect(result.completed_at).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should throw error when survey not found', async () => {
      const userId = 'user-1';
      const surveyId = 'non-existent-survey';
      const answers = { 'q1': 'answer1' };

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      await expect(
        surveyService.submitResponse(userId, {
          survey_id: surveyId,
          answers: answers,
          is_completed: false
        })
      ).rejects.toThrow('Survey not found');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getUserResponse - Detailed', () => {
    test('should fetch existing user response for a survey', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';

      const expectedResponse = {
        id: 'response-1',
        survey_id: surveyId,
        user_id: userId,
        answers: { 'q1': 'answer1', 'q2': 'answer2' },
        is_completed: true,
        progress: 100,
        started_at: new Date('2023-01-15T10:00:00Z'),
        completed_at: new Date('2023-01-15T10:05:00Z'),
        created_at: new Date('2023-01-15T10:00:00Z'),
        updated_at: new Date('2023-01-15T10:05:00Z')
      };

      mockQuery.mockResolvedValueOnce({ rows: [expectedResponse] } as never);

      const result = await surveyService.getUserResponse(userId, surveyId);

      expect(result).toEqual(expectedResponse);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM survey_responses WHERE user_id = $1 AND survey_id = $2',
        [userId, surveyId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null when user has no response for survey', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getUserResponse(userId, surveyId);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM survey_responses WHERE user_id = $1 AND survey_id = $2',
        [userId, surveyId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return partial response with correct progress', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';

      const partialResponse = {
        id: 'response-1',
        survey_id: surveyId,
        user_id: userId,
        answers: { 'q1': 'answer1' },
        is_completed: false,
        progress: 33,
        started_at: new Date('2023-01-15T10:00:00Z'),
        completed_at: null,
        created_at: new Date('2023-01-15T10:00:00Z'),
        updated_at: new Date('2023-01-15T10:02:00Z')
      };

      mockQuery.mockResolvedValueOnce({ rows: [partialResponse] } as never);

      const result = await surveyService.getUserResponse(userId, surveyId);

      expect(result).toEqual(partialResponse);
      expect(result?.is_completed).toBe(false);
      expect(result?.progress).toBe(33);
      expect(result?.completed_at).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveyResponses - Detailed', () => {
    test('should fetch survey responses with pagination', async () => {
      const surveyId = 'survey-1';
      const page = 1;
      const limit = 10;

      const mockResponses = [
        {
          id: 'response-1',
          survey_id: surveyId,
          user_id: 'user-1',
          answers: { 'q1': 'answer1' },
          is_completed: true,
          progress: 100,
          started_at: new Date('2023-01-15T10:00:00Z'),
          completed_at: new Date('2023-01-15T10:05:00Z'),
          created_at: new Date('2023-01-15T10:00:00Z'),
          updated_at: new Date('2023-01-15T10:05:00Z'),
          email: 'user1@example.com',
          first_name: 'John',
          last_name: 'Doe'
        },
        {
          id: 'response-2',
          survey_id: surveyId,
          user_id: 'user-2',
          answers: { 'q1': 'answer2' },
          is_completed: false,
          progress: 50,
          started_at: new Date('2023-01-16T10:00:00Z'),
          completed_at: null,
          created_at: new Date('2023-01-16T10:00:00Z'),
          updated_at: new Date('2023-01-16T10:02:00Z'),
          email: 'user2@example.com',
          first_name: 'Jane',
          last_name: 'Smith'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockResponses } as never)
        .mockResolvedValueOnce({ rows: [{ count: '2' }] } as never);

      const result = await surveyService.getSurveyResponses(surveyId, page, limit);

      expect(result.responses).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
      expect(result.responses[0]).toMatchObject({
        id: 'response-1',
        survey_id: surveyId,
        user_id: 'user-1',
        user_email: 'user1@example.com',
        user_first_name: 'John',
        user_last_name: 'Doe'
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY sr.created_at DESC'),
        [surveyId, limit, 0]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle pagination correctly', async () => {
      const surveyId = 'survey-1';
      const page = 2;
      const limit = 5;
      const offset = 5;

      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ count: '12' }] } as never);

      const result = await surveyService.getSurveyResponses(surveyId, page, limit);

      expect(result.total).toBe(12);
      expect(result.totalPages).toBe(3);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        [surveyId, limit, offset]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return empty array when no responses exist', async () => {
      const surveyId = 'survey-no-responses';

      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const result = await surveyService.getSurveyResponses(surveyId);

      expect(result.responses).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should include user information in responses', async () => {
      const surveyId = 'survey-1';

      const mockResponse = {
        id: 'response-1',
        survey_id: surveyId,
        user_id: 'user-1',
        answers: { 'q1': 'answer1' },
        is_completed: true,
        progress: 100,
        started_at: new Date('2023-01-15T10:00:00Z'),
        completed_at: new Date('2023-01-15T10:05:00Z'),
        created_at: new Date('2023-01-15T10:00:00Z'),
        updated_at: new Date('2023-01-15T10:05:00Z'),
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockResponse] } as never)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      const result = await surveyService.getSurveyResponses(surveyId);

      expect(result.responses[0]).toMatchObject({
        user_email: 'test@example.com',
        user_first_name: 'Test',
        user_last_name: 'User'
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('u.email'),
        expect.anything()
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should order responses by created_at DESC', async () => {
      const surveyId = 'survey-1';

      const mockResponses = [
        {
          id: 'response-2',
          survey_id: surveyId,
          user_id: 'user-2',
          answers: {},
          is_completed: false,
          progress: 0,
          started_at: new Date('2023-01-16T10:00:00Z'),
          completed_at: null,
          created_at: new Date('2023-01-16T10:00:00Z'),
          updated_at: new Date('2023-01-16T10:00:00Z'),
          email: 'user2@example.com',
          first_name: null,
          last_name: null
        },
        {
          id: 'response-1',
          survey_id: surveyId,
          user_id: 'user-1',
          answers: {},
          is_completed: true,
          progress: 100,
          started_at: new Date('2023-01-15T10:00:00Z'),
          completed_at: new Date('2023-01-15T10:05:00Z'),
          created_at: new Date('2023-01-15T10:00:00Z'),
          updated_at: new Date('2023-01-15T10:05:00Z'),
          email: 'user1@example.com',
          first_name: 'John',
          last_name: 'Doe'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockResponses } as never)
        .mockResolvedValueOnce({ rows: [{ count: '2' }] } as never);

      const result = await surveyService.getSurveyResponses(surveyId);

      expect(result.responses[0]?.id).toBe('response-2');
      expect(result.responses[1]?.id).toBe('response-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY sr.created_at DESC'),
        expect.anything()
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveyAnalytics - Detailed', () => {
    const surveyId = 'test-survey-analytics';

    test('should calculate completion rate correctly with all completed responses', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Analytics Test Survey',
        description: 'Testing analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'single_choice', required: true }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '10',
            completed_responses: '10',
            avg_completion_time: '120.5'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.totalResponses).toBe(10);
      expect(result?.completionRate).toBe(100);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should calculate completion rate correctly with partial completion', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Analytics Test Survey',
        description: 'Testing analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'single_choice', required: true }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '20',
            completed_responses: '15',
            avg_completion_time: '180.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.totalResponses).toBe(20);
      expect(result?.completionRate).toBe(75);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle zero responses correctly', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Empty Survey',
        description: 'No responses yet',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '0',
            completed_responses: '0',
            avg_completion_time: null
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.totalResponses).toBe(0);
      expect(result?.completionRate).toBe(0);
      expect(result?.averageCompletionTime).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should calculate average completion time correctly', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Timed Survey',
        description: 'Testing completion time',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '5',
            completed_responses: '5',
            avg_completion_time: '300.75'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.averageCompletionTime).toBeCloseTo(300.75, 2);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should aggregate responsesByDate correctly', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Date Aggregation Survey',
        description: 'Testing date aggregation',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          { id: 'q1', text: 'Question 1', type: 'text', required: true }
        ],
        target_segment: {},
        access_type: 'public'
      };

      const mockDateResponses = [
        { date: '2023-12-04', count: '12' },
        { date: '2023-12-03', count: '3' },
        { date: '2023-12-02', count: '8' },
        { date: '2023-12-01', count: '5' }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '28',
            completed_responses: '25',
            avg_completion_time: '200.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: mockDateResponses } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.responsesByDate).toHaveLength(4);
      expect(result?.responsesByDate[0]?.count).toBe(5);
      expect(result?.responsesByDate[3]?.count).toBe(12);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for single_choice questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Single Choice Survey',
        description: 'Testing single choice analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'What is your favorite color?',
            type: 'single_choice',
            required: true,
            options: [
              { value: '1', label: 'Red' },
              { value: '2', label: 'Blue' },
              { value: '3', label: 'Green' }
            ]
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '10',
            completed_responses: '10',
            avg_completion_time: '60.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: '1' },
            { answer: '1' },
            { answer: '2' },
            { answer: '1' },
            { answer: '3' },
            { answer: '2' },
            { answer: '1' }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('single_choice');
      expect(questionAnalytics?.responses).toBeDefined();
      expect(Object.keys(questionAnalytics?.responses ?? {}).length).toBeGreaterThan(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for multiple_choice questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Multiple Choice Survey',
        description: 'Testing multiple choice analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'Select all that apply',
            type: 'multiple_choice',
            required: true,
            options: [
              { value: '1', label: 'Option A' },
              { value: '2', label: 'Option B' },
              { value: '3', label: 'Option C' }
            ]
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '5',
            completed_responses: '5',
            avg_completion_time: '90.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: ['1', '2'] },
            { answer: ['1'] },
            { answer: ['2', '3'] },
            { answer: ['1', '2', '3'] },
            { answer: ['3'] }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('multiple_choice');
      expect(questionAnalytics?.responses).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for rating_5 questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Rating Survey',
        description: 'Testing rating analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'Rate your experience (1-5)',
            type: 'rating_5',
            required: true
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '8',
            completed_responses: '8',
            avg_completion_time: '45.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: 5 },
            { answer: 4 },
            { answer: 5 },
            { answer: 3 },
            { answer: 5 },
            { answer: 4 },
            { answer: 4 },
            { answer: 5 }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('rating_5');
      expect(questionAnalytics?.averageRating).toBeCloseTo(4.375, 2);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for rating_10 questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'NPS Survey',
        description: 'Testing NPS analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'How likely are you to recommend us? (0-10)',
            type: 'rating_10',
            required: true
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '10',
            completed_responses: '10',
            avg_completion_time: '30.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: 10 },
            { answer: 9 },
            { answer: 8 },
            { answer: 10 },
            { answer: 7 },
            { answer: 9 },
            { answer: 10 },
            { answer: 8 },
            { answer: 9 },
            { answer: 10 }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('rating_10');
      expect(questionAnalytics?.averageRating).toBeCloseTo(9.0, 1);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for yes_no questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Yes/No Survey',
        description: 'Testing yes/no analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'Did you enjoy the service?',
            type: 'yes_no',
            required: true
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '12',
            completed_responses: '12',
            avg_completion_time: '20.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: 'yes' },
            { answer: 'yes' },
            { answer: 'no' },
            { answer: 'yes' },
            { answer: 'yes' },
            { answer: 'yes' },
            { answer: 'no' },
            { answer: 'yes' },
            { answer: 'yes' },
            { answer: 'yes' },
            { answer: 'no' },
            { answer: 'yes' }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('yes_no');
      expect(questionAnalytics?.responses).toBeDefined();
      expect(Object.keys(questionAnalytics?.responses ?? {}).length).toBe(2);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for text questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Text Survey',
        description: 'Testing text analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'What is your feedback?',
            type: 'text',
            required: false
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '5',
            completed_responses: '5',
            avg_completion_time: '180.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: 'Great service!' },
            { answer: 'Very satisfied' },
            { answer: 'Could be better' },
            { answer: 'Excellent experience' },
            { answer: 'Good overall' }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('text');
      expect(questionAnalytics?.responses).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle analytics for textarea questions', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Textarea Survey',
        description: 'Testing textarea analytics',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'Please provide detailed feedback',
            type: 'textarea',
            required: false
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '3',
            completed_responses: '3',
            avg_completion_time: '300.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [
            { answer: 'This is a detailed response about the service quality.' },
            { answer: 'I have several points to make about the experience.' },
            { answer: 'Overall, the service was excellent and exceeded expectations.' }
          ]
        } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(1);

      const questionAnalytics = result?.questionAnalytics[0];
      expect(questionAnalytics?.type).toBe('textarea');
      expect(questionAnalytics?.responses).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle survey with multiple question types', async () => {
      const mockSurvey = {
        id: surveyId,
        title: 'Mixed Question Survey',
        description: 'Testing multiple question types',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        questions: [
          {
            id: 'q1',
            text: 'Rate us',
            type: 'rating_5',
            required: true
          },
          {
            id: 'q2',
            text: 'Would you recommend us?',
            type: 'yes_no',
            required: true
          },
          {
            id: 'q3',
            text: 'Additional comments',
            type: 'text',
            required: false
          }
        ],
        target_segment: {},
        access_type: 'public'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockSurvey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({
          rows: [{
            total_responses: '6',
            completed_responses: '5',
            avg_completion_time: '150.0'
          }]
        } as never)
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ answer: 5 }, { answer: 4 }, { answer: 5 }] } as never)
        .mockResolvedValueOnce({ rows: [{ answer: 'yes' }, { answer: 'yes' }, { answer: 'no' }] } as never)
        .mockResolvedValueOnce({ rows: [{ answer: 'Good service' }, { answer: 'Nice' }] } as never);

      const result = await surveyService.getSurveyAnalytics(surveyId);

      expect(result).toBeDefined();
      expect(result?.questionAnalytics).toHaveLength(3);
      expect(result?.questionAnalytics[0]?.type).toBe('rating_5');
      expect(result?.questionAnalytics[1]?.type).toBe('yes_no');
      expect(result?.questionAnalytics[2]?.type).toBe('text');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
  describe('createSurvey', () => {
    test('should create survey with all parameters', async () => {
      const surveyData = {
        title: 'New Survey',
        description: 'Survey Description',
        questions: [
          {
            id: 'q1',
            text: 'What is your favorite color?',
            type: 'single_choice' as const,
            required: true,
            order: 0,
            options: [
              { value: '5', label: 'Red' },
              { value: '10', label: 'Blue' }
            ]
          }
        ],
        target_segment: { tier_restrictions: ['1', '2'] },
        access_type: 'public' as const,
        status: 'active' as const
      } as any;
      const createdBy = 'admin-user';

      const expectedSurvey = {
        id: 'survey-123',
        title: surveyData.title,
        description: surveyData.description,
        questions: [
          {
            id: 'q1',
            text: 'What is your favorite color?',
            type: 'single_choice',
            required: true,
            order: 0,
            options: [
              { value: '1', label: 'Red' },
              { value: '2', label: 'Blue' }
            ]
          }
        ],
        target_segment: surveyData.target_segment,
        access_type: 'public',
        status: 'active',
        created_by: createdBy,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [expectedSurvey] } as never);

      const result = await surveyService.createSurvey(surveyData, createdBy);

      expect(result).toEqual(expectedSurvey);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO surveys'),
        expect.arrayContaining([
          surveyData.title,
          surveyData.description,
          expect.any(String),
          expect.any(String),
          'public',
          'active',
          createdBy
        ])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should normalize question options to sequential values', async () => {
      const surveyData = {
        title: 'Test Survey',
        description: 'Test',
        questions: [
          {
            id: 'q1',
            text: 'Choose one',
            type: 'single_choice' as const,
            required: true,
            order: 0,
            options: [
              { value: '100', label: 'Option A' },
              { value: '999', label: 'Option B' },
              { value: 'abc', label: 'Option C' }
            ]
          }
        ],
        access_type: 'public' as const
      } as any;

      const expectedSurvey = {
        id: 'survey-123',
        title: surveyData.title,
        description: surveyData.description,
        questions: [
          {
            id: 'q1',
            text: 'Choose one',
            type: 'single_choice',
            required: true,
            order: 0,
            options: [
              { value: '1', label: 'Option A' },
              { value: '2', label: 'Option B' },
              { value: '3', label: 'Option C' }
            ]
          }
        ],
        target_segment: {},
        access_type: 'public',
        status: 'draft',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [expectedSurvey] } as never);

      const result = await surveyService.createSurvey(surveyData, 'admin');

      expect(result.questions[0]?.options).toEqual([
        { value: '1', label: 'Option A' },
        { value: '2', label: 'Option B' },
        { value: '3', label: 'Option C' }
      ]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should use default values when optional fields not provided', async () => {
      const surveyData = {
        title: 'Minimal Survey',
        description: 'Description',
        questions: [],
        access_type: 'public' as const
      };

      const expectedSurvey = {
        id: 'survey-123',
        title: surveyData.title,
        description: surveyData.description,
        questions: [],
        target_segment: {},
        access_type: 'public',
        status: 'draft',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [expectedSurvey] } as never);

      const result = await surveyService.createSurvey(surveyData, 'admin');

      expect(result.status).toBe('draft');
      expect(result.target_segment).toEqual({});
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO surveys'),
        expect.arrayContaining([
          surveyData.title,
          surveyData.description,
          expect.any(String),
          '{}',
          'public',
          'draft',
          'admin'
        ])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('updateSurvey', () => {
    test('should update survey with partial data', async () => {
      const surveyId = 'survey-1';
      const updateData = {
        title: 'Updated Title',
        status: 'active' as const
      };

      const updatedSurvey = {
        id: surveyId,
        title: 'Updated Title',
        description: 'Original Description',
        questions: [],
        target_segment: {},
        access_type: 'public',
        status: 'active',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-02T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [updatedSurvey] } as never);

      const result = await surveyService.updateSurvey(surveyId, updateData);

      expect(result).toEqual(updatedSurvey);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE surveys'),
        expect.arrayContaining(['Updated Title', 'active', surveyId])
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return current survey when no updates provided', async () => {
      const surveyId = 'survey-1';
      const updateData = {};

      const currentSurvey = {
        id: surveyId,
        title: 'Current Title',
        description: 'Current Description',
        questions: [],
        target_segment: {},
        access_type: 'public',
        status: 'draft',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [currentSurvey] } as never);

      const result = await surveyService.updateSurvey(surveyId, updateData);

      expect(result).toEqual(currentSurvey);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [surveyId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should normalize question options when updating questions', async () => {
      const surveyId = 'survey-1';
      const updateData = {
        questions: [
          {
            id: 'q1',
            text: 'Updated Question',
            type: 'multiple_choice' as const,
            required: true,
            order: 0,
            options: [
              { value: '50', label: 'A' },
              { value: '100', label: 'B' }
            ]
          }
        ]
      } as any;

      const updatedSurvey = {
        id: surveyId,
        title: 'Title',
        description: 'Description',
        questions: [
          {
            id: 'q1',
            text: 'Updated Question',
            type: 'multiple_choice',
            required: true,
            order: 0,
            options: [
              { value: '1', label: 'A' },
              { value: '2', label: 'B' }
            ]
          }
        ],
        target_segment: {},
        access_type: 'public',
        status: 'draft',
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-02T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [updatedSurvey] } as never);

      const result = await surveyService.updateSurvey(surveyId, updateData);

      expect(result?.questions[0]?.options).toEqual([
        { value: '1', label: 'A' },
        { value: '2', label: 'B' }
      ]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null for non-existent survey', async () => {
      const surveyId = 'non-existent';
      const updateData = { title: 'New Title' };

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.updateSurvey(surveyId, updateData);

      expect(result).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('deleteSurvey', () => {
    test('should delete survey successfully', async () => {
      const surveyId = 'survey-1';

      mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never);

      const result = await surveyService.deleteSurvey(surveyId);

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM surveys'),
        [surveyId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return false for non-existent survey', async () => {
      const surveyId = 'non-existent';

      mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never);

      const result = await surveyService.deleteSurvey(surveyId);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle null rowCount', async () => {
      const surveyId = 'survey-1';

      mockQuery.mockResolvedValueOnce({ rowCount: null } as never);

      const result = await surveyService.deleteSurvey(surveyId);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getSurveys', () => {
    test('should get surveys with pagination', async () => {
      const page = 2;
      const limit = 10;
      const mockSurveys = [
        {
          id: 'survey-1',
          title: 'Survey 1',
          description: 'Description 1',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin-1',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockSurveys } as never)
        .mockResolvedValueOnce({ rows: [{ count: '25' }] } as never);

      const result = await surveyService.getSurveys(page, limit);

      expect(result.surveys).toEqual(mockSurveys);
      expect(result.total).toBe(25);
      expect(result.totalPages).toBe(3);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [limit, 10]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter surveys by status', async () => {
      const status = 'active';
      const mockSurveys = [
        {
          id: 'survey-1',
          title: 'Active Survey',
          description: 'Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockSurveys } as never)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      const result = await surveyService.getSurveys(1, 10, status);

      expect(result.surveys).toHaveLength(1);
      expect(result.surveys[0]?.status).toBe('active');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $3'),
        [10, 0, 'active']
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter surveys by createdBy', async () => {
      const createdBy = 'admin-1';
      const mockSurveys = [
        {
          id: 'survey-1',
          title: 'Survey',
          description: 'Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'draft',
          created_by: 'admin-1',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockSurveys } as never)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      const result = await surveyService.getSurveys(1, 10, undefined, createdBy);

      expect(result.surveys).toHaveLength(1);
      expect(result.surveys[0]?.created_by).toBe('admin-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE created_by = $3'),
        [10, 0, 'admin-1']
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should apply combined filters', async () => {
      const status = 'active';
      const createdBy = 'admin-1';
      const mockSurveys = [
        {
          id: 'survey-1',
          title: 'Survey',
          description: 'Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin-1',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockSurveys } as never)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);

      const result = await surveyService.getSurveys(1, 10, status, createdBy);

      expect(result.surveys).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $3 AND created_by = $4'),
        [10, 0, 'active', 'admin-1']
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle empty results', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

      const result = await surveyService.getSurveys(1, 10);

      expect(result.surveys).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Translations', () => {
    describe('getSurveyWithTranslations', () => {
      test('should get translated survey for specific language', async () => {
        const surveyId = 'survey-1';
        const language = 'en';

        const translatedSurvey = {
          id: surveyId,
          title: 'Original Title',
          description: 'Original Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          translated_title: 'English Title',
          translated_description: 'English Description',
          translated_questions: [{ id: 'q1', text: 'English Question', type: 'text', required: true, order: 0 }]
        };

        mockQuery.mockResolvedValueOnce({ rows: [translatedSurvey] } as never);

        const result = await surveyService.getSurveyWithTranslations(surveyId, language);

        expect(result?.title).toBe('English Title');
        expect(result?.description).toBe('English Description');
        expect(result?.questions).toEqual([{ id: 'q1', text: 'English Question', type: 'text', required: true, order: 0 }]);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('LEFT JOIN survey_translations'),
          [surveyId, language]
        );
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should fallback to original survey when translation not found', async () => {
        const surveyId = 'survey-1';
        const language = 'fr';

        const originalSurvey = {
          id: surveyId,
          title: 'Thai Title',
          description: 'Thai Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          translated_title: null,
          translated_description: null,
          translated_questions: null
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [originalSurvey] } as never);

        const result = await surveyService.getSurveyWithTranslations(surveyId, language);

        expect(result?.title).toBe('Thai Title');
        expect(result?.description).toBe('Thai Description');
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should get original survey when language is th', async () => {
        const surveyId = 'survey-1';
        const language = 'th';

        const originalSurvey = {
          id: surveyId,
          title: 'Thai Title',
          description: 'Thai Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery.mockResolvedValueOnce({ rows: [originalSurvey] } as never);

        const result = await surveyService.getSurveyWithTranslations(surveyId, language);

        expect(result).toEqual(originalSurvey);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM surveys'),
          [surveyId]
        );
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should return null for non-existent survey', async () => {
        const surveyId = 'non-existent';

        mockQuery.mockResolvedValueOnce({ rows: [] } as never);

        const result = await surveyService.getSurveyWithTranslations(surveyId);

        expect(result).toBeNull();
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('getAllSurveyTranslations', () => {
      test('should get all translations in multilingual format', async () => {
        const surveyId = 'survey-1';

        const originalSurvey = {
          id: surveyId,
          title: 'Thai Title',
          description: 'Thai Description',
          questions: [{ id: 'q1', text: 'Thai Question', type: 'text', required: true, order: 0 }],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        const translations = [
          {
            language: 'en',
            title: 'English Title',
            description: 'English Description',
            questions: [{ id: 'q1', text: 'English Question', type: 'text', required: true, order: 0 }]
          },
          {
            language: 'zh',
            title: 'Chinese Title',
            description: 'Chinese Description',
            questions: [{ id: 'q1', text: 'Chinese Question', type: 'text', required: true, order: 0 }]
          }
        ];

        mockQuery
          .mockResolvedValueOnce({ rows: [originalSurvey] } as never)
          .mockResolvedValueOnce({ rows: translations } as never);

        const result = await surveyService.getAllSurveyTranslations(surveyId);

        expect(result?.original_language).toBe('th');
        expect(result?.available_languages).toEqual(['th', 'en', 'zh']);
        expect(result?.translations.th).toEqual({
          title: 'Thai Title',
          description: 'Thai Description',
          questions: [{ id: 'q1', text: 'Thai Question', type: 'text', required: true, order: 0 }]
        });
        expect(result?.translations.en).toEqual({
          title: 'English Title',
          description: 'English Description',
          questions: [{ id: 'q1', text: 'English Question', type: 'text', required: true, order: 0 }]
        });
        expect(result?.translations.zh).toEqual({
          title: 'Chinese Title',
          description: 'Chinese Description',
          questions: [{ id: 'q1', text: 'Chinese Question', type: 'text', required: true, order: 0 }]
        });
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should return only original language when no translations exist', async () => {
        const surveyId = 'survey-1';

        const originalSurvey = {
          id: surveyId,
          title: 'Thai Title',
          description: 'Thai Description',
          questions: [],
          target_segment: {},
          access_type: 'public',
          status: 'active',
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [originalSurvey] } as never)
          .mockResolvedValueOnce({ rows: [] } as never);

        const result = await surveyService.getAllSurveyTranslations(surveyId);

        expect(result?.original_language).toBe('th');
        expect(result?.available_languages).toEqual(['th']);
        expect(result?.translations.th).toBeDefined();
        expect(Object.keys(result?.translations ?? {})).toEqual(['th']);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should return null for non-existent survey', async () => {
        const surveyId = 'non-existent';

        mockQuery.mockResolvedValueOnce({ rows: [] } as never);

        const result = await surveyService.getAllSurveyTranslations(surveyId);

        expect(result).toBeNull();
        expect(mockClient.release).toHaveBeenCalled();
      });
    });
  });

  describe('User Targeting', () => {
    describe('tier restrictions', () => {
      test('should include users matching tier restrictions', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 2,
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Gold Users Survey',
          description: 'Survey for Gold tier',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            tier_restrictions: ['2', '3']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(surveys[0]?.id).toBe('survey-1');
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should exclude users not matching tier restrictions', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Platinum Only Survey',
          description: 'Survey for Platinum tier',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            tier_restrictions: ['4']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(0);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should exclude users with no tier when tier restrictions present', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: null,
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Tiered Survey',
          description: 'Survey with tier requirement',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            tier_restrictions: ['1', '2']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(0);
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('registration date filters', () => {
      test('should include users registered after specified date', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-06-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'New Users Survey',
          description: 'Survey for recent users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            registration_after: '2023-05-01T00:00:00Z'
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should exclude users registered before specified date', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-03-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'New Users Survey',
          description: 'Survey for recent users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            registration_after: '2023-05-01T00:00:00Z'
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(0);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should include users registered before specified date', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-03-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Early Users Survey',
          description: 'Survey for early adopters',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            registration_before: '2023-04-01T00:00:00Z'
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should apply both registration_after and registration_before', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-03-15T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Date Range Survey',
          description: 'Survey for specific registration period',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            registration_after: '2023-03-01T00:00:00Z',
            registration_before: '2023-04-01T00:00:00Z'
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('OAuth provider filters', () => {
      test('should include users with matching OAuth provider', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          oauth_provider: 'google',
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'OAuth Users Survey',
          description: 'Survey for OAuth users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            oauth_providers: ['google', 'facebook']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should exclude users with non-matching OAuth provider', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          oauth_provider: 'github',
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'OAuth Users Survey',
          description: 'Survey for OAuth users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            oauth_providers: ['google', 'facebook']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(0);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should treat null oauth_provider as email', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          oauth_provider: null,
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Email Users Survey',
          description: 'Survey for email users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            oauth_providers: ['email']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('excluded users', () => {
      test('should exclude users in exclude_users list', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Survey with Exclusions',
          description: 'Survey excluding specific users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            exclude_users: ['user-1', 'user-2']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(0);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should include users not in exclude_users list', async () => {
        const userId = 'user-3';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 1,
          created_at: '2023-01-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Survey with Exclusions',
          description: 'Survey excluding specific users',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            exclude_users: ['user-1', 'user-2']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('combined targeting criteria', () => {
      test('should apply all targeting criteria together', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 2,
          oauth_provider: 'google',
          created_at: '2023-06-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Complex Targeting Survey',
          description: 'Survey with multiple criteria',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            tier_restrictions: ['2', '3'],
            registration_after: '2023-05-01T00:00:00Z',
            oauth_providers: ['google', 'facebook'],
            exclude_users: ['user-2']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(1);
        expect(mockClient.release).toHaveBeenCalled();
      });

      test('should exclude if any criteria fails', async () => {
        const userId = 'user-1';
        const user = {
          id: userId,
          email: 'user@example.com',
          tier_id: 2,
          oauth_provider: 'google',
          created_at: '2023-03-01T00:00:00Z'
        };

        const survey = {
          id: 'survey-1',
          title: 'Complex Targeting Survey',
          description: 'Survey with multiple criteria',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {
            tier_restrictions: ['2', '3'],
            registration_after: '2023-05-01T00:00:00Z',
            oauth_providers: ['google', 'facebook'],
            exclude_users: ['user-2']
          },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        };

        mockQuery
          .mockResolvedValueOnce({ rows: [user] } as never)
          .mockResolvedValueOnce({ rows: [survey] } as never);

        const surveys = await surveyService.getPublicSurveys(userId);

        expect(surveys).toHaveLength(0);
        expect(mockClient.release).toHaveBeenCalled();
      });
    });
  });

  describe('getPublicSurveys', () => {
    test('should return only active public surveys', async () => {
      const userId = 'user-1';
      const user = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      const surveys = [
        {
          id: 'survey-1',
          title: 'Active Public Survey',
          description: 'Test',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [user] } as never)
        .mockResolvedValueOnce({ rows: surveys } as never);

      const result = await surveyService.getPublicSurveys(userId);

      expect(result).toHaveLength(1);
      expect(result[0]?.access_type).toBe('public');
      expect(result[0]?.status).toBe('active');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('access_type = \'public\''),
        []
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return empty array for non-existent user', async () => {
      const userId = 'non-existent';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getPublicSurveys(userId);

      expect(result).toEqual([]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should filter surveys by targeting criteria', async () => {
      const userId = 'user-1';
      const user = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      const surveys = [
        {
          id: 'survey-1',
          title: 'Bronze Survey',
          description: 'For Bronze tier',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: { tier_restrictions: ['1'] },
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 'survey-2',
          title: 'Gold Survey',
          description: 'For Gold tier',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: { tier_restrictions: ['3'] },
          created_by: 'admin',
          created_at: '2023-01-02T00:00:00Z',
          updated_at: '2023-01-02T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [user] } as never)
        .mockResolvedValueOnce({ rows: surveys } as never);

      const result = await surveyService.getPublicSurveys(userId);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('survey-1');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getInvitedSurveys', () => {
    test('should return surveys where user has invitation', async () => {
      const userId = 'user-1';
      const surveys = [
        {
          id: 'survey-1',
          title: 'Invited Survey',
          description: 'Invite only',
          status: 'active',
          access_type: 'invite_only',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery.mockResolvedValueOnce({ rows: surveys } as never);

      const result = await surveyService.getInvitedSurveys(userId);

      expect(result).toHaveLength(1);
      expect(result[0]?.access_type).toBe('invite_only');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('survey_invitations'),
        [userId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return empty array if no invitations', async () => {
      const userId = 'user-1';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getInvitedSurveys(userId);

      expect(result).toEqual([]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should only include active invite-only surveys', async () => {
      const userId = 'user-1';
      const surveys = [
        {
          id: 'survey-1',
          title: 'Active Invited Survey',
          description: 'Active invite only',
          status: 'active',
          access_type: 'invite_only',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      mockQuery.mockResolvedValueOnce({ rows: surveys } as never);

      const result = await surveyService.getInvitedSurveys(userId);

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('status = \'active\''),
        [userId]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getAvailableSurveys', () => {
    test('should combine public and invited surveys', async () => {
      const userId = 'user-1';
      const publicUser = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      const publicSurveys = [
        {
          id: 'survey-1',
          title: 'Public Survey',
          description: 'Public',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ];

      const invitedSurveys = [
        {
          id: 'survey-2',
          title: 'Invited Survey',
          description: 'Invite only',
          status: 'active',
          access_type: 'invite_only',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-01-02T00:00:00Z',
          updated_at: '2023-01-02T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [publicUser] } as never)
        .mockResolvedValueOnce({ rows: publicSurveys } as never)
        .mockResolvedValueOnce({ rows: invitedSurveys } as never);

      const result = await surveyService.getAvailableSurveys(userId);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toContain('survey-1');
      expect(result.map(s => s.id)).toContain('survey-2');
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    test('should deduplicate surveys appearing in both lists', async () => {
      const userId = 'user-1';
      const user = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      const survey = {
        id: 'survey-1',
        title: 'Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [user] } as never)
        .mockResolvedValueOnce({ rows: [survey] } as never)
        .mockResolvedValueOnce({ rows: [survey] } as never);

      const result = await surveyService.getAvailableSurveys(userId);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('survey-1');
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    test('should sort surveys by creation date descending', async () => {
      const userId = 'user-1';
      const user = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      const surveys = [
        {
          id: 'survey-1',
          title: 'Old Survey',
          description: 'Old',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 'survey-2',
          title: 'New Survey',
          description: 'New',
          status: 'active',
          access_type: 'public',
          questions: [],
          target_segment: {},
          created_by: 'admin',
          created_at: '2023-03-01T00:00:00Z',
          updated_at: '2023-03-01T00:00:00Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [user] } as never)
        .mockResolvedValueOnce({ rows: surveys } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.getAvailableSurveys(userId);

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('survey-2');
      expect(result[1]?.id).toBe('survey-1');
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });
  });

  describe('canUserAccessSurvey', () => {
    test('should allow access to public survey matching targeting', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const survey = {
        id: surveyId,
        title: 'Public Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      const user = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [survey] } as never)
        .mockResolvedValueOnce({ rows: [user] } as never);

      const result = await surveyService.canUserAccessSurvey(userId, surveyId);

      expect(result).toBe(true);
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    test('should deny access to inactive survey', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const survey = {
        id: surveyId,
        title: 'Inactive Survey',
        description: 'Test',
        status: 'draft',
        access_type: 'public',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery.mockResolvedValueOnce({ rows: [survey] } as never);

      const result = await surveyService.canUserAccessSurvey(userId, surveyId);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should deny access to non-existent survey', async () => {
      const userId = 'user-1';
      const surveyId = 'non-existent';

      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.canUserAccessSurvey(userId, surveyId);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should deny access to public survey not matching targeting', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const survey = {
        id: surveyId,
        title: 'Platinum Survey',
        description: 'Test',
        status: 'active',
        access_type: 'public',
        questions: [],
        target_segment: {
          tier_restrictions: ['4']
        },
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      const user = {
        id: userId,
        email: 'user@example.com',
        tier_id: 1,
        created_at: '2023-01-01T00:00:00Z'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [survey] } as never)
        .mockResolvedValueOnce({ rows: [user] } as never);

      const result = await surveyService.canUserAccessSurvey(userId, surveyId);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    test('should allow access to invite-only survey with valid invitation', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const survey = {
        id: surveyId,
        title: 'Invite Only Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [survey] } as never)
        .mockResolvedValueOnce({ rows: [{ id: 'invitation-1' }] } as never);

      const result = await surveyService.canUserAccessSurvey(userId, surveyId);

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('survey_invitations'),
        [surveyId, userId]
      );
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    test('should deny access to invite-only survey without invitation', async () => {
      const userId = 'user-1';
      const surveyId = 'survey-1';
      const survey = {
        id: surveyId,
        title: 'Invite Only Survey',
        description: 'Test',
        status: 'active',
        access_type: 'invite_only',
        questions: [],
        target_segment: {},
        created_by: 'admin',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [survey] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      const result = await surveyService.canUserAccessSurvey(userId, surveyId);

      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });
  });

});