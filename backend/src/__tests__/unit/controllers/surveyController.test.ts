import { Request, Response } from 'express';
import { surveyController } from '../../../controllers/surveyController';
import { surveyService } from '../../../services/surveyService';

// Mock surveyService
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
    canUserAccessSurvey: jest.fn(),
    getSurveyInvitations: jest.fn(),
    sendSurveyInvitations: jest.fn(),
    sendSurveyInvitationsToUsers: jest.fn(),
    resendInvitation: jest.fn(),
    assignCouponToSurvey: jest.fn(),
    getSurveyCouponAssignments: jest.fn(),
    updateSurveyCouponAssignment: jest.fn(),
    removeCouponFromSurvey: jest.fn(),
    getSurveyRewardHistory: jest.fn(),
    getAllSurveyCouponAssignments: jest.fn(),
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

const mockSurveyService = surveyService as jest.Mocked<typeof surveyService>;

describe('SurveyController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };
  const superAdminUser = { id: 'super-1', role: 'super_admin' as const, email: 'super@test.com' };

  const validSurveyData = {
    title: 'Test Survey',
    questions: [
      {
        id: 'q1',
        text: 'What is your name?',
        type: 'text' as const,
        required: true,
        order: 1,
      },
    ],
    access_type: 'public',
  };

  const mockSurvey = {
    id: 'survey-1',
    title: 'Test Survey',
    description: 'A test survey',
    questions: validSurveyData.questions,
    target_segment: {},
    access_type: 'public',
    status: 'active',
    created_by: 'admin-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    mockRes = {
      json: jsonMock,
      status: statusMock,
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    mockReq = {
      body: {},
      params: {},
      query: {},
      user: adminUser,
    };
  });

  // ========== createSurvey Tests ==========
  describe('createSurvey', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.body = validSurveyData;

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        message: 'Access denied. Admin privileges required.',
      });
    });

    it('should return 403 when user is undefined', async () => {
      mockReq.user = undefined;
      mockReq.body = validSurveyData;

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 400 for empty title', async () => {
      mockReq.body = { ...validSurveyData, title: '' };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Validation failed',
          validationErrors: expect.arrayContaining([
            expect.objectContaining({ field: 'title' }),
          ]),
        })
      );
    });

    it('should return 400 for missing title', async () => {
      mockReq.body = { questions: validSurveyData.questions, access_type: 'public' };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for non-string title', async () => {
      mockReq.body = { ...validSurveyData, title: 123 };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              field: 'title',
              message: 'Title must be a string',
            }),
          ]),
        })
      );
    });

    it('should return 400 for missing questions', async () => {
      mockReq.body = { title: 'Test', access_type: 'public' };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for empty questions array', async () => {
      mockReq.body = { ...validSurveyData, questions: [] };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for questions not being an array', async () => {
      mockReq.body = { ...validSurveyData, questions: 'not-array' };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing question id', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [{ text: 'Test', type: 'text', required: true, order: 1 }],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing question text', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [{ id: 'q1', type: 'text', required: true, order: 1 }],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing question type', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [{ id: 'q1', text: 'Test', required: true, order: 1 }],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing question required field', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [{ id: 'q1', text: 'Test', type: 'text', order: 1 }],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for non-numeric question order', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [{ id: 'q1', text: 'Test', type: 'text', required: true, order: 'first' }],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for choice question without options', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [
          { id: 'q1', text: 'Choose one', type: 'single_choice', required: true, order: 1 },
        ],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for choice question with empty options', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [
          { id: 'q1', text: 'Choose one', type: 'multiple_choice', required: true, order: 1, options: [] },
        ],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for option without id', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [
          {
            id: 'q1',
            text: 'Choose one',
            type: 'single_choice',
            required: true,
            order: 1,
            options: [{ text: 'Option 1', value: 1 }],
          },
        ],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for option without text', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [
          {
            id: 'q1',
            text: 'Choose one',
            type: 'single_choice',
            required: true,
            order: 1,
            options: [{ id: 'o1', value: 1 }],
          },
        ],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for option without value', async () => {
      mockReq.body = {
        ...validSurveyData,
        questions: [
          {
            id: 'q1',
            text: 'Choose one',
            type: 'single_choice',
            required: true,
            order: 1,
            options: [{ id: 'o1', text: 'Option 1' }],
          },
        ],
      };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing access_type', async () => {
      mockReq.body = { title: 'Test', questions: validSurveyData.questions };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid access_type', async () => {
      mockReq.body = { ...validSurveyData, access_type: 'invalid' };

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should create survey successfully for admin', async () => {
      mockReq.body = validSurveyData;
      mockSurveyService.createSurvey.mockResolvedValue(mockSurvey);

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({ survey: mockSurvey });
      expect(mockSurveyService.createSurvey).toHaveBeenCalledWith(validSurveyData, 'admin-1');
    });

    it('should create survey successfully for super_admin', async () => {
      mockReq.user = superAdminUser;
      mockReq.body = validSurveyData;
      mockSurveyService.createSurvey.mockResolvedValue(mockSurvey);

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
    });

    it('should return 500 on service error', async () => {
      mockReq.body = validSurveyData;
      mockSurveyService.createSurvey.mockRejectedValue(new Error('Database error'));

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to create survey',
          error: 'Database error',
        })
      );
    });

    it('should handle PostgreSQL errors with details', async () => {
      mockReq.body = validSurveyData;
      const pgError = Object.assign(new Error('Constraint violation'), {
        detail: 'Key already exists',
        code: '23505',
        constraint: 'surveys_title_unique',
      });
      mockSurveyService.createSurvey.mockRejectedValue(pgError);

      await surveyController.createSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          details: 'Key already exists',
          errorCode: '23505',
          constraint: 'surveys_title_unique',
        })
      );
    });
  });

  // ========== getSurvey Tests ==========
  describe('getSurvey', () => {
    it('should return 404 when survey not found', async () => {
      mockReq.params = { id: 'non-existent' };
      mockSurveyService.getSurveyById.mockResolvedValue(null);

      await surveyController.getSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ message: 'Survey not found' });
    });

    it('should return survey for admin without access check', async () => {
      mockReq.params = { id: 'survey-1' };
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);

      await surveyController.getSurvey(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ survey: mockSurvey });
      expect(mockSurveyService.canUserAccessSurvey).not.toHaveBeenCalled();
    });

    it('should check access for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { id: 'survey-1' };
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);

      await surveyController.getSurvey(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.canUserAccessSurvey).toHaveBeenCalledWith('customer-1', 'survey-1');
      expect(jsonMock).toHaveBeenCalledWith({ survey: mockSurvey });
    });

    it('should return 403 when non-admin has no access', async () => {
      mockReq.user = customerUser;
      mockReq.params = { id: 'survey-1' };
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(false);

      await surveyController.getSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { id: 'survey-1' };
      mockSurveyService.getSurveyById.mockRejectedValue(new Error('Database error'));

      await surveyController.getSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getSurveys Tests ==========
  describe('getSurveys', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;

      await surveyController.getSurveys(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return surveys with pagination for admin', async () => {
      mockReq.query = { page: '2', limit: '20', status: 'active' };
      mockSurveyService.getSurveys.mockResolvedValue({
        surveys: [mockSurvey],
        total: 50,
        totalPages: 3,
      });

      await surveyController.getSurveys(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getSurveys).toHaveBeenCalledWith(2, 20, 'active', undefined);
      expect(jsonMock).toHaveBeenCalledWith({
        surveys: [mockSurvey],
        pagination: {
          total: 50,
          page: 2,
          limit: 20,
          totalPages: 3,
        },
      });
    });

    it('should use default pagination values', async () => {
      mockSurveyService.getSurveys.mockResolvedValue({
        surveys: [],
        total: 0,
        totalPages: 0,
      });

      await surveyController.getSurveys(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getSurveys).toHaveBeenCalledWith(1, 10, undefined, undefined);
    });

    it('should return 500 on service error', async () => {
      mockSurveyService.getSurveys.mockRejectedValue(new Error('Database error'));

      await surveyController.getSurveys(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== updateSurvey Tests ==========
  describe('updateSurvey', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { id: 'survey-1' };

      await surveyController.updateSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 404 when survey not found', async () => {
      mockReq.params = { id: 'non-existent' };
      mockReq.body = { title: 'Updated' };
      mockSurveyService.updateSurvey.mockResolvedValue(null);

      await surveyController.updateSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should update survey successfully', async () => {
      mockReq.params = { id: 'survey-1' };
      mockReq.body = { title: 'Updated Survey' };
      const updatedSurvey = { ...mockSurvey, title: 'Updated Survey' };
      mockSurveyService.updateSurvey.mockResolvedValue(updatedSurvey);

      await surveyController.updateSurvey(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ survey: updatedSurvey });
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { id: 'survey-1' };
      mockReq.body = { title: 'Updated' };
      mockSurveyService.updateSurvey.mockRejectedValue(new Error('Database error'));

      await surveyController.updateSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== deleteSurvey Tests ==========
  describe('deleteSurvey', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { id: 'survey-1' };

      await surveyController.deleteSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 404 when survey not found', async () => {
      mockReq.params = { id: 'non-existent' };
      mockSurveyService.deleteSurvey.mockResolvedValue(false);

      await surveyController.deleteSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should delete survey successfully', async () => {
      mockReq.params = { id: 'survey-1' };
      mockSurveyService.deleteSurvey.mockResolvedValue(true);

      await surveyController.deleteSurvey(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ message: 'Survey deleted successfully' });
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { id: 'survey-1' };
      mockSurveyService.deleteSurvey.mockRejectedValue(new Error('Database error'));

      await surveyController.deleteSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== submitResponse Tests ==========
  describe('submitResponse', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await surveyController.submitResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return 400 for missing survey_id', async () => {
      mockReq.user = customerUser;
      mockReq.body = { answers: { q1: 'answer' } };

      await surveyController.submitResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for missing answers', async () => {
      mockReq.user = customerUser;
      mockReq.body = { survey_id: 'survey-1' };

      await surveyController.submitResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 403 when user has no access to survey', async () => {
      mockReq.user = customerUser;
      mockReq.body = { survey_id: 'survey-1', answers: { q1: 'answer' } };
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(false);

      await surveyController.submitResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should submit response successfully', async () => {
      mockReq.user = customerUser;
      mockReq.body = { survey_id: 'survey-1', answers: { q1: 'answer' } };
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      const mockResponse = { id: 'response-1', is_completed: true };
      mockSurveyService.submitResponse.mockResolvedValue(mockResponse as any);

      await surveyController.submitResponse(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ response: mockResponse });
    });

    it('should return 500 on service error', async () => {
      mockReq.user = customerUser;
      mockReq.body = { survey_id: 'survey-1', answers: { q1: 'answer' } };
      mockSurveyService.canUserAccessSurvey.mockResolvedValue(true);
      mockSurveyService.submitResponse.mockRejectedValue(new Error('Database error'));

      await surveyController.submitResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getUserResponse Tests ==========
  describe('getUserResponse', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.getUserResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return user response successfully', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };
      const mockResponse = { id: 'response-1', answers: { q1: 'answer' } };
      mockSurveyService.getUserResponse.mockResolvedValue(mockResponse as any);

      await surveyController.getUserResponse(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getUserResponse).toHaveBeenCalledWith('customer-1', 'survey-1');
      expect(jsonMock).toHaveBeenCalledWith({ response: mockResponse });
    });

    it('should return 500 on service error', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getUserResponse.mockRejectedValue(new Error('Database error'));

      await surveyController.getUserResponse(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getSurveyResponses Tests ==========
  describe('getSurveyResponses', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.getSurveyResponses(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return responses with pagination', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.query = { page: '2', limit: '25' };
      mockSurveyService.getSurveyResponses.mockResolvedValue({
        responses: [],
        total: 100,
        totalPages: 4,
      });

      await surveyController.getSurveyResponses(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getSurveyResponses).toHaveBeenCalledWith('survey-1', 2, 25);
      expect(jsonMock).toHaveBeenCalledWith({
        responses: [],
        pagination: {
          total: 100,
          page: 2,
          limit: 25,
          totalPages: 4,
        },
      });
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyResponses.mockRejectedValue(new Error('Database error'));

      await surveyController.getSurveyResponses(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getAvailableSurveys Tests ==========
  describe('getAvailableSurveys', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await surveyController.getAvailableSurveys(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return available surveys', async () => {
      mockReq.user = customerUser;
      mockSurveyService.getAvailableSurveys.mockResolvedValue([mockSurvey]);

      await surveyController.getAvailableSurveys(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getAvailableSurveys).toHaveBeenCalledWith('customer-1');
      expect(jsonMock).toHaveBeenCalledWith({ surveys: [mockSurvey] });
    });

    it('should return 500 on service error', async () => {
      mockReq.user = customerUser;
      mockSurveyService.getAvailableSurveys.mockRejectedValue(new Error('Database error'));

      await surveyController.getAvailableSurveys(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getPublicSurveys Tests ==========
  describe('getPublicSurveys', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await surveyController.getPublicSurveys(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return public surveys', async () => {
      mockReq.user = customerUser;
      mockSurveyService.getPublicSurveys.mockResolvedValue([mockSurvey]);

      await surveyController.getPublicSurveys(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ surveys: [mockSurvey] });
    });
  });

  // ========== getInvitedSurveys Tests ==========
  describe('getInvitedSurveys', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await surveyController.getInvitedSurveys(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return invited surveys', async () => {
      mockReq.user = customerUser;
      mockSurveyService.getInvitedSurveys.mockResolvedValue([mockSurvey]);

      await surveyController.getInvitedSurveys(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ surveys: [mockSurvey] });
    });
  });

  // ========== getSurveyAnalytics Tests ==========
  describe('getSurveyAnalytics', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.getSurveyAnalytics(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 404 when analytics not found', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyAnalytics.mockResolvedValue(null);

      await surveyController.getSurveyAnalytics(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should return analytics successfully', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      const mockAnalytics = { totalResponses: 100, completionRate: 85 };
      mockSurveyService.getSurveyAnalytics.mockResolvedValue(mockAnalytics as any);

      await surveyController.getSurveyAnalytics(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(mockAnalytics);
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyAnalytics.mockRejectedValue(new Error('Database error'));

      await surveyController.getSurveyAnalytics(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== exportSurveyResponses Tests ==========
  describe('exportSurveyResponses', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.exportSurveyResponses(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 404 when survey not found', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyById.mockResolvedValue(null);

      await surveyController.exportSurveyResponses(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should export CSV successfully', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);
      mockSurveyService.getSurveyResponses.mockResolvedValue({
        responses: [
          {
            id: 'resp-1',
            user_email: 'user@test.com',
            user_first_name: 'Test',
            user_last_name: 'User',
            is_completed: true,
            progress: 100,
            started_at: '2024-01-01T00:00:00Z',
            completed_at: '2024-01-01T01:00:00Z',
            answers: { q1: 'Answer' },
          },
        ] as any,
        total: 1,
        totalPages: 1,
      });

      await surveyController.exportSurveyResponses(mockReq as Request, mockRes as Response);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="survey-survey-1-responses.csv"'
      );
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('should handle array answers in CSV', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyById.mockResolvedValue(mockSurvey);
      mockSurveyService.getSurveyResponses.mockResolvedValue({
        responses: [
          {
            id: 'resp-1',
            is_completed: true,
            progress: 100,
            started_at: '2024-01-01',
            answers: { q1: ['Option 1', 'Option 2'] },
          },
        ] as any,
        total: 1,
        totalPages: 1,
      });

      await surveyController.exportSurveyResponses(mockReq as Request, mockRes as Response);

      const csvContent = (mockRes.send as jest.Mock).mock.calls[0][0];
      expect(csvContent).toContain('Option 1; Option 2');
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockSurveyService.getSurveyById.mockRejectedValue(new Error('Database error'));

      await surveyController.exportSurveyResponses(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getSurveyInvitations Tests ==========
  describe('getSurveyInvitations', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.getSurveyInvitations(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return invitations successfully', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      const mockInvitations = [{ id: 'inv-1', user_id: 'user-1' }];
      mockSurveyService.getSurveyInvitations.mockResolvedValue(mockInvitations as any);

      await surveyController.getSurveyInvitations(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ invitations: mockInvitations });
    });
  });

  // ========== sendSurveyInvitations Tests ==========
  describe('sendSurveyInvitations', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.sendSurveyInvitations(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should send invitations successfully', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      const result = { sent: 10, failed: 0 };
      mockSurveyService.sendSurveyInvitations.mockResolvedValue(result);

      await surveyController.sendSurveyInvitations(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(result);
    });
  });

  // ========== sendSurveyInvitationsToUsers Tests ==========
  describe('sendSurveyInvitationsToUsers', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.sendSurveyInvitationsToUsers(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 400 for missing userIds', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.body = {};

      await surveyController.sendSurveyInvitationsToUsers(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for empty userIds array', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.body = { userIds: [] };

      await surveyController.sendSurveyInvitationsToUsers(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for non-array userIds', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.body = { userIds: 'user-1' };

      await surveyController.sendSurveyInvitationsToUsers(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should send invitations to specific users successfully', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.body = { userIds: ['user-1', 'user-2'] };
      const result = { sent: 2, failed: 0 };
      mockSurveyService.sendSurveyInvitationsToUsers.mockResolvedValue(result);

      await surveyController.sendSurveyInvitationsToUsers(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.sendSurveyInvitationsToUsers).toHaveBeenCalledWith('survey-1', ['user-1', 'user-2']);
      expect(jsonMock).toHaveBeenCalledWith(result);
    });
  });

  // ========== resendInvitation Tests ==========
  describe('resendInvitation', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { invitationId: 'inv-1' };

      await surveyController.resendInvitation(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should resend invitation successfully', async () => {
      mockReq.params = { invitationId: 'inv-1' };
      mockSurveyService.resendInvitation.mockResolvedValue(undefined);

      await surveyController.resendInvitation(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ success: true });
    });
  });

  // ========== assignCouponToSurvey Tests ==========
  describe('assignCouponToSurvey', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 400 for missing survey_id', async () => {
      mockReq.body = { coupon_id: 'coupon-1' };

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: 'Survey ID is required' });
    });

    it('should return 400 for missing coupon_id', async () => {
      mockReq.body = { survey_id: 'survey-1' };

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: 'Coupon ID is required' });
    });

    it('should return 400 for invalid max_awards', async () => {
      mockReq.body = { survey_id: 'survey-1', coupon_id: 'coupon-1', max_awards: 0 };

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: 'Max awards must be a positive number' });
    });

    it('should return 400 for invalid custom_expiry_days', async () => {
      mockReq.body = { survey_id: 'survey-1', coupon_id: 'coupon-1', custom_expiry_days: -1 };

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: 'Custom expiry days must be a positive number' });
    });

    it('should assign coupon successfully', async () => {
      mockReq.body = { survey_id: 'survey-1', coupon_id: 'coupon-1', max_awards: 100 };
      const mockAssignment = { id: 'assignment-1' };
      mockSurveyService.assignCouponToSurvey.mockResolvedValue(mockAssignment as any);

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({ assignment: mockAssignment });
    });

    it('should return 404 when survey or coupon not found', async () => {
      mockReq.body = { survey_id: 'survey-1', coupon_id: 'coupon-1' };
      mockSurveyService.assignCouponToSurvey.mockRejectedValue(new Error('Survey not found'));

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should return 400 when coupon is not active', async () => {
      mockReq.body = { survey_id: 'survey-1', coupon_id: 'coupon-1' };
      mockSurveyService.assignCouponToSurvey.mockRejectedValue(new Error('Coupon is not active'));

      await surveyController.assignCouponToSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  // ========== getSurveyCouponAssignments Tests ==========
  describe('getSurveyCouponAssignments', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.getSurveyCouponAssignments(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return assignments with pagination', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.query = { page: '2', limit: '15' };
      const result = { assignments: [], total: 30, totalPages: 2, page: 2, limit: 15 };
      mockSurveyService.getSurveyCouponAssignments.mockResolvedValue(result);

      await surveyController.getSurveyCouponAssignments(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getSurveyCouponAssignments).toHaveBeenCalledWith('survey-1', 2, 15);
      expect(jsonMock).toHaveBeenCalledWith(result);
    });
  });

  // ========== updateSurveyCouponAssignment Tests ==========
  describe('updateSurveyCouponAssignment', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };

      await surveyController.updateSurveyCouponAssignment(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 400 for invalid max_awards', async () => {
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };
      mockReq.body = { max_awards: 0 };

      await surveyController.updateSurveyCouponAssignment(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid custom_expiry_days', async () => {
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };
      mockReq.body = { custom_expiry_days: 0 };

      await surveyController.updateSurveyCouponAssignment(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 404 when assignment not found', async () => {
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };
      mockReq.body = { is_active: false };
      mockSurveyService.updateSurveyCouponAssignment.mockResolvedValue(null);

      await surveyController.updateSurveyCouponAssignment(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should update assignment successfully', async () => {
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };
      mockReq.body = { max_awards: 200 };
      const mockAssignment = { id: 'assignment-1', max_awards: 200 };
      mockSurveyService.updateSurveyCouponAssignment.mockResolvedValue(mockAssignment as any);

      await surveyController.updateSurveyCouponAssignment(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ assignment: mockAssignment });
    });
  });

  // ========== removeCouponFromSurvey Tests ==========
  describe('removeCouponFromSurvey', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };

      await surveyController.removeCouponFromSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return 404 when assignment not found', async () => {
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };
      mockSurveyService.removeCouponFromSurvey.mockResolvedValue(false);

      await surveyController.removeCouponFromSurvey(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should remove assignment successfully', async () => {
      mockReq.params = { surveyId: 'survey-1', couponId: 'coupon-1' };
      mockSurveyService.removeCouponFromSurvey.mockResolvedValue(true);

      await surveyController.removeCouponFromSurvey(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.removeCouponFromSurvey).toHaveBeenCalledWith('survey-1', 'coupon-1', 'admin-1');
      expect(jsonMock).toHaveBeenCalledWith({ message: 'Coupon assignment removed successfully' });
    });
  });

  // ========== getSurveyRewardHistory Tests ==========
  describe('getSurveyRewardHistory', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.params = { surveyId: 'survey-1' };

      await surveyController.getSurveyRewardHistory(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return reward history with pagination', async () => {
      mockReq.params = { surveyId: 'survey-1' };
      mockReq.query = { page: '1', limit: '20' };
      const result = { rewards: [], total: 50, totalPages: 3 };
      mockSurveyService.getSurveyRewardHistory.mockResolvedValue(result);

      await surveyController.getSurveyRewardHistory(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getSurveyRewardHistory).toHaveBeenCalledWith('survey-1', 1, 20);
      expect(jsonMock).toHaveBeenCalledWith(result);
    });
  });

  // ========== getAllSurveyCouponAssignments Tests ==========
  describe('getAllSurveyCouponAssignments', () => {
    it('should return 403 for non-admin users', async () => {
      mockReq.user = customerUser;

      await surveyController.getAllSurveyCouponAssignments(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should return all assignments with filters', async () => {
      mockReq.query = {
        page: '1',
        limit: '20',
        survey_id: 'survey-1',
        is_active: 'true',
      };
      const result = { assignments: [], total: 10, totalPages: 1, page: 1, limit: 20 };
      mockSurveyService.getAllSurveyCouponAssignments.mockResolvedValue(result);

      await surveyController.getAllSurveyCouponAssignments(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getAllSurveyCouponAssignments).toHaveBeenCalledWith(1, 20, {
        survey_id: 'survey-1',
        coupon_id: undefined,
        is_active: true,
        assigned_by: undefined,
      });
      expect(jsonMock).toHaveBeenCalledWith(result);
    });

    it('should handle is_active=false filter', async () => {
      mockReq.query = { is_active: 'false' };
      mockSurveyService.getAllSurveyCouponAssignments.mockResolvedValue({ assignments: [], total: 0, totalPages: 0, page: 1, limit: 20 });

      await surveyController.getAllSurveyCouponAssignments(mockReq as Request, mockRes as Response);

      expect(mockSurveyService.getAllSurveyCouponAssignments).toHaveBeenCalledWith(
        1,
        20,
        expect.objectContaining({ is_active: false })
      );
    });
  });
});
