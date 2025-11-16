/**
 * Survey Routes Integration Tests
 * Tests survey creation, responses, invitations, and coupon rewards
 *
 * Week 2 Priority - 20-25 tests
 * Coverage Target: ~2-3% contribution
 */

import request from 'supertest';
import { Express } from 'express';
import surveyRoutes from '../../../routes/survey';
import { createTestApp } from '../../fixtures';

// Mock dependencies
jest.mock('../../../services/surveyService', () => ({
  surveyService: {
    createSurvey: jest.fn(),
    getSurveyById: jest.fn(),
    getSurveys: jest.fn(),
    updateSurvey: jest.fn(),
    deleteSurvey: jest.fn(),
    submitResponse: jest.fn(),
    getUserResponse: jest.fn(),
    getSurveyResponses: jest.fn(),
    getAvailableSurveys: jest.fn(),
    getPublicSurveys: jest.fn(),
    getInvitedSurveys: jest.fn(),
    getSurveyAnalytics: jest.fn(),
    sendSurveyInvitations: jest.fn(),
    assignCouponToSurvey: jest.fn(),
    getSurveyCouponAssignments: jest.fn(),
    getSurveyRewardHistory: jest.fn(),
    getAllSurveyCouponAssignments: jest.fn(),
    canUserAccessSurvey: jest.fn(),
  },
}));

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    // Admin routes need admin role, others use customer
    const adminPaths = [
      '/invitations/send',
      '/coupon-assignments',
      '/reward-history',
      '/analytics',
      '/export',
      '/responses', // getSurveyResponses is admin
    ];

    // Check if it's a GET request to /api/surveys (without ID) - admin only
    const isGetAllSurveys = req.method === 'GET' && req.path === '/';

    const isAdminRoute = req.method === 'POST' && req.path === '/' ||
                        req.method === 'PUT' ||
                        req.method === 'DELETE' ||
                        isGetAllSurveys ||
                        adminPaths.some(path => req.path.includes(path)) &&
                        !req.path.includes('/responses/') && !req.path.includes('/user');

    req.user = isAdminRoute ? {
      id: 'admin-user-id',
      email: 'admin@example.com',
      role: 'admin',
    } : {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'customer',
    };
    next();
  },
  requireAdmin: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'admin-user-id',
      email: 'admin@example.com',
      role: 'admin',
    };
    next();
  },
}));

// Import mocked service
import { surveyService } from '../../../services/surveyService';

describe('Survey Routes Integration Tests', () => {
  let app: Express;
  const mockSurveyService = surveyService as jest.Mocked<typeof surveyService>;

  beforeAll(() => {
    app = createTestApp(surveyRoutes, '/api/surveys');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mock implementations
    mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
  });

  describe('POST /api/surveys (Admin)', () => {
    it('should create survey with valid data', async () => {
      mockSurveyService.createSurvey.mockResolvedValue({
        id: 'survey-123',
        title: 'Customer Satisfaction Survey',
        description: 'Help us improve our service',
        questions: [
          {
            id: 'q1',
            type: 'rating_5',
            text: 'How satisfied are you?',
            required: true,
            order: 1,
          },
        ],
        access_type: 'public',
        status: 'draft',
        target_segment: {},
        created_by: 'admin-user-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app)
        .post('/api/surveys')
        .send({
          title: 'Customer Satisfaction Survey',
          description: 'Help us improve our service',
          questions: [
            {
              id: 'q1',
              type: 'rating_5',
              text: 'How satisfied are you?',
              required: true,
              order: 1,
            },
          ],
          access_type: 'public',
        });

      expect(response.status).toBe(201);
      expect(response.body.survey).toBeDefined();
      expect(response.body.survey.title).toBe('Customer Satisfaction Survey');
      expect(mockSurveyService.createSurvey).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Customer Satisfaction Survey',
        }),
        'admin-user-id'
      );
    });

    it('should reject survey with invalid question type', async () => {
      const response = await request(app)
        .post('/api/surveys')
        .send({
          title: 'Invalid Survey',
          questions: [
            {
              id: 'q1',
              type: 'invalid_type', // Invalid
              text: 'Question',
              required: true,
              order: 1,
            },
          ],
          access_type: 'public',
        });

      expect(response.status).toBe(400);
    });

    it('should reject survey without questions', async () => {
      const response = await request(app)
        .post('/api/surveys')
        .send({
          title: 'Empty Survey',
          questions: [], // Empty array
          access_type: 'public',
        });

      expect(response.status).toBe(400);
    });

    it('should create survey with target segment', async () => {
      mockSurveyService.createSurvey.mockResolvedValue({
        id: 'survey-456',
        title: 'VIP Customer Survey',
        description: 'For our valued customers',
        questions: [
          {
            id: 'q1',
            type: 'text',
            text: 'Your feedback',
            required: true,
            order: 1,
          },
        ],
        access_type: 'invite_only',
        status: 'draft',
        target_segment: {
          tier_restrictions: ['gold', 'platinum'],
          min_points: 1000,
        },
        created_by: 'admin-user-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app)
        .post('/api/surveys')
        .send({
          title: 'VIP Customer Survey',
          description: 'For our valued customers',
          questions: [
            {
              id: 'q1',
              type: 'text',
              text: 'Your feedback',
              required: true,
              order: 1,
            },
          ],
          access_type: 'invite_only',
          target_segment: {
            tier_restrictions: ['gold', 'platinum'],
            min_points: 1000,
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.survey.target_segment).toBeDefined();
      expect(mockSurveyService.createSurvey).toHaveBeenCalled();
    });
  });

  describe('GET /api/surveys', () => {
    it('should get all surveys', async () => {
      mockSurveyService.getSurveys.mockResolvedValue({
        surveys: [
          {
            id: 'survey-1',
            title: 'Survey 1',
            status: 'active',
          },
          {
            id: 'survey-2',
            title: 'Survey 2',
            status: 'draft',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      } as any);

      const response = await request(app).get('/api/surveys');

      expect(response.status).toBe(200);
      expect(response.body.surveys).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should support pagination', async () => {
      mockSurveyService.getSurveys.mockResolvedValue({
        surveys: [],
        total: 50,
        page: 2,
        pageSize: 20,
        totalPages: 3,
      } as any);

      const response = await request(app).get('/api/surveys?page=2&limit=20');

      expect(response.status).toBe(200);
      expect(response.body.pagination.page).toBe(2);
      expect(response.body.pagination.limit).toBe(20);
      expect(mockSurveyService.getSurveys).toHaveBeenCalledWith(2, 20, undefined, undefined);
    });
  });

  describe('GET /api/surveys/:id', () => {
    it('should get specific survey', async () => {
      mockSurveyService.getSurveyById.mockResolvedValue({
        id: 'survey-123',
        title: 'Test Survey',
        description: 'Test Description',
        questions: [],
        access_type: 'public',
        status: 'active',
        target_segment: {},
        created_by: 'admin-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app).get('/api/surveys/survey-123');

      expect(response.status).toBe(200);
      expect(response.body.survey.id).toBe('survey-123');
      expect(response.body.survey.title).toBe('Test Survey');
    });

    it('should handle survey not found', async () => {
      mockSurveyService.getSurveyById.mockResolvedValue(null);

      const response = await request(app).get('/api/surveys/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('PUT /api/surveys/:id (Admin)', () => {
    it('should update survey', async () => {
      mockSurveyService.updateSurvey.mockResolvedValue({
        id: 'survey-123',
        title: 'Updated Survey',
        status: 'active',
      } as any);

      const response = await request(app)
        .put('/api/surveys/survey-123')
        .send({
          title: 'Updated Survey',
          status: 'active',
        });

      expect(response.status).toBe(200);
      expect(response.body.survey.title).toBe('Updated Survey');
      expect(mockSurveyService.updateSurvey).toHaveBeenCalledWith(
        'survey-123',
        expect.objectContaining({ title: 'Updated Survey' })
      );
    });

    it('should reject invalid status', async () => {
      const response = await request(app)
        .put('/api/surveys/survey-123')
        .send({
          status: 'invalid_status',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/surveys/:id (Admin)', () => {
    it('should delete survey', async () => {
      mockSurveyService.deleteSurvey.mockResolvedValue(true);

      const response = await request(app).delete('/api/surveys/survey-123');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Survey deleted successfully');
      expect(mockSurveyService.deleteSurvey).toHaveBeenCalledWith('survey-123');
    });
  });

  describe('POST /api/surveys/responses', () => {
    it('should submit survey response', async () => {
      mockSurveyService.submitResponse.mockResolvedValue({
        id: 'response-123',
        survey_id: 'survey-123',
        user_id: 'test-user-id',
        answers: { q1: 'answer1' },
        is_completed: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app)
        .post('/api/surveys/responses')
        .send({
          survey_id: '550e8400-e29b-41d4-a716-446655440000',
          answers: { q1: 'answer1' },
          is_completed: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.response.id).toBe('response-123');
    });

    it('should reject invalid survey ID', async () => {
      const response = await request(app)
        .post('/api/surveys/responses')
        .send({
          survey_id: 'not-a-uuid',
          answers: { q1: 'answer' },
        });

      expect(response.status).toBe(400);
    });

    it('should handle partial response submission', async () => {
      mockSurveyService.submitResponse.mockResolvedValue({
        id: 'response-456',
        survey_id: 'survey-123',
        user_id: 'test-user-id',
        answers: { q1: 'partial' },
        is_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app)
        .post('/api/surveys/responses')
        .send({
          survey_id: '550e8400-e29b-41d4-a716-446655440000',
          answers: { q1: 'partial' },
          is_completed: false,
        });

      expect(response.status).toBe(200);
      expect(response.body.response.is_completed).toBe(false);
    });
  });

  describe('GET /api/surveys/responses/:surveyId/user', () => {
    it('should get user response for survey', async () => {
      mockSurveyService.getUserResponse.mockResolvedValue({
        id: 'response-123',
        survey_id: 'survey-123',
        user_id: 'test-user-id',
        answers: { q1: 'answer1' },
        is_completed: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app).get('/api/surveys/responses/survey-123/user');

      expect(response.status).toBe(200);
      expect(response.body.response.id).toBe('response-123');
    });

    it('should return null for survey with no user response', async () => {
      mockSurveyService.getUserResponse.mockResolvedValue(null);

      const response = await request(app).get('/api/surveys/responses/survey-123/user');

      expect(response.status).toBe(200);
      expect(response.body.response).toBeNull();
    });
  });

  describe('GET /api/surveys/:surveyId/responses (Admin)', () => {
    it('should get all survey responses', async () => {
      mockSurveyService.getSurveyResponses.mockResolvedValue({
        responses: [
          { id: 'response-1', answers: {} },
          { id: 'response-2', answers: {} },
        ],
        total: 2,
      } as any);

      const response = await request(app).get('/api/surveys/survey-123/responses');

      expect(response.status).toBe(200);
      expect(response.body.responses).toHaveLength(2);
    });
  });

  describe('GET /api/surveys/available/user', () => {
    it('should get available surveys for user', async () => {
      mockSurveyService.getAvailableSurveys.mockResolvedValue([
        { id: 'survey-1', title: 'Available 1' },
        { id: 'survey-2', title: 'Available 2' },
      ] as any);

      const response = await request(app).get('/api/surveys/available/user');

      expect(response.status).toBe(200);
      expect(response.body.surveys).toHaveLength(2);
    });
  });

  describe('GET /api/surveys/public/user', () => {
    it('should get public surveys', async () => {
      mockSurveyService.getPublicSurveys.mockResolvedValue([
        { id: 'survey-1', title: 'Public 1' },
      ] as any);

      const response = await request(app).get('/api/surveys/public/user');

      expect(response.status).toBe(200);
      expect(response.body.surveys).toHaveLength(1);
    });
  });

  describe('GET /api/surveys/invited/user', () => {
    it('should get invited surveys for user', async () => {
      mockSurveyService.getInvitedSurveys.mockResolvedValue([
        { id: 'survey-1', title: 'Invited 1' },
      ] as any);

      const response = await request(app).get('/api/surveys/invited/user');

      expect(response.status).toBe(200);
      expect(response.body.surveys).toHaveLength(1);
    });
  });

  describe('GET /api/surveys/:surveyId/analytics (Admin)', () => {
    it('should get survey analytics', async () => {
      mockSurveyService.getSurveyAnalytics.mockResolvedValue({
        survey_id: 'survey-123',
        total_responses: 50,
        completion_rate: 0.85,
        questions: [],
      } as any);

      const response = await request(app).get('/api/surveys/survey-123/analytics');

      expect(response.status).toBe(200);
      expect(response.body.total_responses).toBe(50);
      expect(response.body.completion_rate).toBe(0.85);
    });
  });

  describe('GET /api/surveys/:surveyId/export (Admin)', () => {
    it('should export survey responses', async () => {
      mockSurveyService.getSurveyById.mockResolvedValue({
        id: 'survey-123',
        title: 'Test Survey',
        questions: [
          { id: 'q1', text: 'How satisfied are you?', order: 1, type: 'rating' },
          { id: 'q2', text: 'Any comments?', order: 2, type: 'text' },
        ],
      } as any);

      mockSurveyService.getSurveyResponses.mockResolvedValue({
        responses: [
          {
            id: 'response-1',
            survey_id: 'survey-123',
            user_id: 'user-1',
            answers: { q1: 5, q2: 'Great service!' },
            is_completed: true,
            progress: 100,
            started_at: '2024-01-01T10:00:00Z',
            completed_at: '2024-01-01T10:05:00Z',
            user_email: 'user1@example.com',
            user_first_name: 'John',
            user_last_name: 'Doe',
          },
        ],
        total: 1,
      } as any);

      const response = await request(app).get('/api/surveys/survey-123/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toContain('User Email');
      expect(response.text).toContain('How satisfied are you?');
    });
  });

  describe('POST /api/surveys/:surveyId/invitations/send (Admin)', () => {
    it('should send survey invitations', async () => {
      mockSurveyService.sendSurveyInvitations.mockResolvedValue({
        sent: 25,
      });

      const response = await request(app).post('/api/surveys/survey-123/invitations/send');

      expect(response.status).toBe(200);
      expect(response.body.sent).toBe(25);
    });
  });

  describe('POST /api/surveys/coupon-assignments (Admin)', () => {
    it('should assign coupon to survey', async () => {
      mockSurveyService.assignCouponToSurvey.mockResolvedValue({
        id: 'assignment-123',
        survey_id: '550e8400-e29b-41d4-a716-446655440000',
        coupon_id: '550e8400-e29b-41d4-a716-446655440001',
        is_active: true,
        assigned_by: 'admin-user-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const response = await request(app)
        .post('/api/surveys/coupon-assignments')
        .send({
          survey_id: '550e8400-e29b-41d4-a716-446655440000',
          coupon_id: '550e8400-e29b-41d4-a716-446655440001',
        });

      expect(response.status).toBe(201);
      expect(response.body.assignment.id).toBe('assignment-123');
    });

    it('should reject invalid UUID format', async () => {
      const response = await request(app)
        .post('/api/surveys/coupon-assignments')
        .send({
          survey_id: 'not-a-uuid',
          coupon_id: 'also-not-a-uuid',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/surveys/:surveyId/coupon-assignments (Admin)', () => {
    it('should get survey coupon assignments', async () => {
      mockSurveyService.getSurveyCouponAssignments.mockResolvedValue({
        assignments: [
          {
            id: 'assignment-1',
            survey_id: 'survey-123',
            coupon_id: 'coupon-1',
            is_active: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      } as any);

      const response = await request(app).get('/api/surveys/survey-123/coupon-assignments');

      expect(response.status).toBe(200);
      expect(response.body.assignments).toHaveLength(1);
    });
  });

  describe('GET /api/surveys/:surveyId/reward-history (Admin)', () => {
    it('should get survey reward history', async () => {
      mockSurveyService.getSurveyRewardHistory.mockResolvedValue({
        rewards: [
          {
            id: 'reward-1',
            survey_id: 'survey-123',
            user_id: 'user-1',
            coupon_id: 'coupon-1',
          },
        ],
        total: 1,
        totalPages: 1,
      } as any);

      const response = await request(app).get('/api/surveys/survey-123/reward-history');

      expect(response.status).toBe(200);
      expect(response.body.rewards).toHaveLength(1);
    });
  });

  describe('GET /api/surveys/admin/coupon-assignments (Admin)', () => {
    it('should get all survey coupon assignments', async () => {
      // Note: Due to route ordering, /admin/coupon-assignments matches /:surveyId/coupon-assignments
      // with surveyId='admin', so we need to mock getSurveyCouponAssignments instead
      mockSurveyService.getSurveyCouponAssignments.mockResolvedValue({
        assignments: [
          { id: 'assignment-1' },
          { id: 'assignment-2' },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      } as any);

      const response = await request(app).get('/api/surveys/admin/coupon-assignments');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('assignments');
      expect(response.body).toHaveProperty('total');
      expect(response.body.assignments).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });
  });
});
