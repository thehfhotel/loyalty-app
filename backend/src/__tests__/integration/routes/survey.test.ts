/**
 * Survey Routes Integration Tests
 * Tests survey creation, responses, invitations, and coupon rewards
 *
 * Week 2 Priority - 20-25 tests
 * Coverage Target: ~2-3% contribution
 */

import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import surveyRoutes from '../../../routes/survey';
import { errorHandler } from '../../../middleware/errorHandler';
import { surveyController } from '../../../controllers/surveyController';

// Mock dependencies
jest.mock('../../../controllers/surveyController');

describe('Survey Routes Integration Tests', () => {
  let app: Express;
  let mockSurveyController: jest.Mocked<typeof surveyController>;

  // Mock authenticate middleware
  const mockAuthenticate = (role: 'customer' | 'admin' | 'super_admin' = 'customer') => (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: role,
    };
    next();
  };

  beforeAll(() => {
    // Create Express app with routes
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    jest.mock('../../../middleware/auth', () => ({
      authenticate: mockAuthenticate('customer'),
    }));

    app.use('/api/surveys', surveyRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    mockSurveyController = surveyController as jest.Mocked<typeof surveyController>;
    jest.clearAllMocks();
  });

  describe('POST /api/surveys (Admin)', () => {
    it('should create survey with valid data', async () => {
      mockSurveyController.createSurvey = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.status(201).json({
          success: true,
          message: 'Survey created successfully',
          data: {
            id: 'survey-123',
            title: 'Customer Satisfaction Survey',
            status: 'draft',
          },
        });
      }) as unknown as typeof mockSurveyController.createSurvey;

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
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Customer Satisfaction Survey');
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
      mockSurveyController.createSurvey = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.status(201).json({
          success: true,
          data: {
            id: 'survey-456',
            title: 'VIP Survey',
            target_segment: {
              tier_restrictions: ['Gold', 'Platinum'],
            },
          },
        });
      }) as unknown as typeof mockSurveyController.createSurvey;

      const response = await request(app)
        .post('/api/surveys')
        .send({
          title: 'VIP Survey',
          questions: [
            {
              id: 'q1',
              type: 'text',
              text: 'Your feedback',
              required: false,
              order: 1,
            },
          ],
          target_segment: {
            tier_restrictions: ['Gold', 'Platinum'],
            min_points: 5000,
          },
          access_type: 'invite_only',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.target_segment.tier_restrictions).toContain('Gold');
    });
  });

  describe('GET /api/surveys', () => {
    it('should get all surveys', async () => {
      mockSurveyController.getSurveys = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            { id: '1', title: 'Survey 1', status: 'active' },
            { id: '2', title: 'Survey 2', status: 'draft' },
          ],
        });
      }) as unknown as typeof mockSurveyController.getSurveys;

      const response = await request(app)
        .get('/api/surveys');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should support pagination', async () => {
      mockSurveyController.getSurveys = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 10, total: 0 },
        });
      }) as unknown as typeof mockSurveyController.getSurveys;

      const response = await request(app)
        .get('/api/surveys')
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/surveys/:id', () => {
    it('should get specific survey', async () => {
      mockSurveyController.getSurvey = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            id: 'survey-123',
            title: 'Feedback Survey',
            questions: [],
            status: 'active',
          },
        });
      }) as unknown as typeof mockSurveyController.getSurvey;

      const response = await request(app)
        .get('/api/surveys/survey-123');

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Feedback Survey');
    });

    it('should handle survey not found', async () => {
      mockSurveyController.getSurvey = jest.fn((
        _req: Request,
        _res: Response,
        next: NextFunction
      ) => {
        next(new Error('Survey not found'));
      }) as unknown as typeof mockSurveyController.getSurvey;

      const response = await request(app)
        .get('/api/surveys/nonexistent');

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /api/surveys/:id (Admin)', () => {
    it('should update survey', async () => {
      mockSurveyController.updateSurvey = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Survey updated successfully',
          data: {
            id: 'survey-123',
            title: 'Updated Survey',
            status: 'active',
          },
        });
      }) as unknown as typeof mockSurveyController.updateSurvey;

      const response = await request(app)
        .put('/api/surveys/survey-123')
        .send({
          title: 'Updated Survey',
          status: 'active',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Updated Survey');
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
      mockSurveyController.deleteSurvey = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Survey deleted successfully',
        });
      }) as unknown as typeof mockSurveyController.deleteSurvey;

      const response = await request(app)
        .delete('/api/surveys/survey-to-delete');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/surveys/responses', () => {
    it('should submit survey response', async () => {
      mockSurveyController.submitResponse = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.status(201).json({
          success: true,
          message: 'Response submitted successfully',
          data: {
            responseId: 'response-123',
            couponAwarded: true,
            coupon: {
              code: 'SURVEY10',
              qrCode: 'QR-SURVEY-ABC',
            },
          },
        });
      }) as unknown as typeof mockSurveyController.submitResponse;

      const response = await request(app)
        .post('/api/surveys/responses')
        .send({
          survey_id: '550e8400-e29b-41d4-a716-446655440000',
          answers: {
            q1: '5',
            q2: 'Great service!',
          },
          is_completed: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.couponAwarded).toBe(true);
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
      mockSurveyController.submitResponse = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.status(201).json({
          success: true,
          data: {
            responseId: 'partial-response',
            isCompleted: false,
          },
        });
      }) as unknown as typeof mockSurveyController.submitResponse;

      const response = await request(app)
        .post('/api/surveys/responses')
        .send({
          survey_id: '550e8400-e29b-41d4-a716-446655440000',
          answers: { q1: 'answer' },
          is_completed: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.isCompleted).toBe(false);
    });
  });

  describe('GET /api/surveys/responses/:surveyId/user', () => {
    it('should get user response for survey', async () => {
      mockSurveyController.getUserResponse = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            id: 'response-123',
            surveyId: 'survey-456',
            answers: { q1: '5', q2: 'Excellent' },
            completedAt: '2024-01-15',
          },
        });
      }) as unknown as typeof mockSurveyController.getUserResponse;

      const response = await request(app)
        .get('/api/surveys/responses/survey-456/user');

      expect(response.status).toBe(200);
      expect(response.body.data.surveyId).toBe('survey-456');
    });

    it('should return null for survey with no user response', async () => {
      mockSurveyController.getUserResponse = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: null });
      }) as unknown as typeof mockSurveyController.getUserResponse;

      const response = await request(app)
        .get('/api/surveys/responses/survey-no-response/user');

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });
  });

  describe('GET /api/surveys/:surveyId/responses (Admin)', () => {
    it('should get all survey responses', async () => {
      mockSurveyController.getSurveyResponses = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            { id: 'r1', userId: 'user-1', completedAt: '2024-01-10' },
            { id: 'r2', userId: 'user-2', completedAt: '2024-01-11' },
          ],
        });
      }) as unknown as typeof mockSurveyController.getSurveyResponses;

      const response = await request(app)
        .get('/api/surveys/survey-123/responses');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/surveys/available/user', () => {
    it('should get available surveys for user', async () => {
      mockSurveyController.getAvailableSurveys = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            { id: '1', title: 'Feedback Survey', status: 'active' },
            { id: '2', title: 'Product Review', status: 'active' },
          ],
        });
      }) as unknown as typeof mockSurveyController.getAvailableSurveys;

      const response = await request(app)
        .get('/api/surveys/available/user');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/surveys/public/user', () => {
    it('should get public surveys', async () => {
      mockSurveyController.getPublicSurveys = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            { id: '1', title: 'Public Survey', access_type: 'public' },
          ],
        });
      }) as unknown as typeof mockSurveyController.getPublicSurveys;

      const response = await request(app)
        .get('/api/surveys/public/user');

      expect(response.status).toBe(200);
      expect(response.body.data[0].access_type).toBe('public');
    });
  });

  describe('GET /api/surveys/invited/user', () => {
    it('should get invited surveys for user', async () => {
      mockSurveyController.getInvitedSurveys = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            { id: '1', title: 'VIP Survey', access_type: 'invite_only' },
          ],
        });
      }) as unknown as typeof mockSurveyController.getInvitedSurveys;

      const response = await request(app)
        .get('/api/surveys/invited/user');

      expect(response.status).toBe(200);
      expect(response.body.data[0].access_type).toBe('invite_only');
    });
  });

  describe('GET /api/surveys/:surveyId/analytics (Admin)', () => {
    it('should get survey analytics', async () => {
      mockSurveyController.getSurveyAnalytics = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            totalResponses: 150,
            completionRate: 85,
            averageRating: 4.5,
            topAnswers: [],
          },
        });
      }) as unknown as typeof mockSurveyController.getSurveyAnalytics;

      const response = await request(app)
        .get('/api/surveys/survey-123/analytics');

      expect(response.status).toBe(200);
      expect(response.body.data.totalResponses).toBe(150);
      expect(response.body.data.completionRate).toBe(85);
    });
  });

  describe('GET /api/surveys/:surveyId/export (Admin)', () => {
    it('should export survey responses', async () => {
      mockSurveyController.exportSurveyResponses = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.setHeader('Content-Type', 'text/csv');
        res.send('userId,answer1,answer2\nuser-1,5,Great\n');
      }) as unknown as typeof mockSurveyController.exportSurveyResponses;

      const response = await request(app)
        .get('/api/surveys/survey-123/export');

      expect(response.status).toBe(200);
      expect(response.header['content-type']).toContain('text/csv');
    });
  });

  describe('POST /api/surveys/:surveyId/invitations/send (Admin)', () => {
    it('should send survey invitations', async () => {
      mockSurveyController.sendSurveyInvitations = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Invitations sent successfully',
          data: {
            invited: 50,
            failed: 0,
          },
        });
      }) as unknown as typeof mockSurveyController.sendSurveyInvitations;

      const response = await request(app)
        .post('/api/surveys/survey-123/invitations/send');

      expect(response.status).toBe(200);
      expect(response.body.data.invited).toBe(50);
    });
  });

  describe('POST /api/surveys/coupon-assignments (Admin)', () => {
    it('should assign coupon to survey', async () => {
      mockSurveyController.assignCouponToSurvey = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.status(201).json({
          success: true,
          message: 'Coupon assigned to survey',
          data: {
            surveyId: 'survey-123',
            couponId: 'coupon-456',
            max_awards: 100,
          },
        });
      }) as unknown as typeof mockSurveyController.assignCouponToSurvey;

      const response = await request(app)
        .post('/api/surveys/coupon-assignments')
        .send({
          survey_id: '550e8400-e29b-41d4-a716-446655440000',
          coupon_id: '660e8400-e29b-41d4-a716-446655440000',
          max_awards: 100,
          custom_expiry_days: 30,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
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
      mockSurveyController.getSurveyCouponAssignments = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            {
              couponId: 'coupon-1',
              code: 'SURVEY10',
              max_awards: 100,
              awarded: 45,
            },
          ],
        });
      }) as unknown as typeof mockSurveyController.getSurveyCouponAssignments;

      const response = await request(app)
        .get('/api/surveys/survey-123/coupon-assignments');

      expect(response.status).toBe(200);
      expect(response.body.data[0].awarded).toBe(45);
    });
  });

  describe('GET /api/surveys/:surveyId/reward-history (Admin)', () => {
    it('should get survey reward history', async () => {
      mockSurveyController.getSurveyRewardHistory = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            {
              userId: 'user-1',
              couponCode: 'SURVEY10',
              awardedAt: '2024-01-15',
            },
            {
              userId: 'user-2',
              couponCode: 'SURVEY10',
              awardedAt: '2024-01-16',
            },
          ],
        });
      }) as unknown as typeof mockSurveyController.getSurveyRewardHistory;

      const response = await request(app)
        .get('/api/surveys/survey-123/reward-history');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/surveys/admin/coupon-assignments (Admin)', () => {
    it('should get all survey coupon assignments', async () => {
      mockSurveyController.getAllSurveyCouponAssignments = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            {
              surveyId: 'survey-1',
              surveyTitle: 'Feedback Survey',
              coupons: [{ couponCode: 'SURVEY10', awarded: 25 }],
            },
            {
              surveyId: 'survey-2',
              surveyTitle: 'Product Review',
              coupons: [{ couponCode: 'REVIEW15', awarded: 10 }],
            },
          ],
        });
      }) as unknown as typeof mockSurveyController.getAllSurveyCouponAssignments;

      const response = await request(app)
        .get('/api/surveys/admin/coupon-assignments');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });
});
