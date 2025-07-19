import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { body, query, param, validationResult } from 'express-validator';
import { SurveyService } from '../services/surveyService.js';
import { logger } from '../utils/logger.js';
import { 
  HttpStatus, 
  ERROR_CODES 
} from '@hotel-loyalty/shared';

export class SurveyController {
  constructor(private surveyService: SurveyService) {}

  /**
   * Create a new survey
   */
  createSurvey = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const survey = await this.surveyService.createSurvey(req.body);
      
      res.status(HttpStatus.CREATED).json({
        success: true,
        data: survey,
        message: 'Survey created successfully'
      });
    } catch (error) {
      logger.error('Error creating survey:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || 'Failed to create survey'
      });
    }
  });

  /**
   * Get survey by ID
   */
  getSurvey = asyncHandler(async (req: Request, res: Response) => {
    try {
      const survey = await this.surveyService.getSurveyById(req.params.id);
      
      if (!survey) {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      res.json({
        success: true,
        data: survey
      });
    } catch (error) {
      logger.error('Error getting survey:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve survey'
      });
    }
  });

  /**
   * Get active surveys
   */
  getActiveSurveys = asyncHandler(async (req: Request, res: Response) => {
    try {
      const customerId = req.user?.id;
      const surveys = await this.surveyService.getActiveSurveys(customerId);
      
      res.json({
        success: true,
        data: surveys
      });
    } catch (error) {
      logger.error('Error getting active surveys:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve surveys'
      });
    }
  });

  /**
   * Get survey by code
   */
  getSurveyByCode = asyncHandler(async (req: Request, res: Response) => {
    try {
      const survey = await this.surveyService.getSurveyByCode(req.params.code);
      
      if (!survey) {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Survey not found or not active'
        });
      }
      
      res.json({
        success: true,
        data: survey
      });
    } catch (error) {
      logger.error('Error getting survey by code:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve survey'
      });
    }
  });

  /**
   * Start survey response
   */
  startSurveyResponse = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const customerId = req.user?.id;
      if (!customerId) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: 'Customer not authenticated'
        });
      }

      const { surveyId } = req.body;
      const metadata = {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      };
      
      const response = await this.surveyService.startSurveyResponse(
        surveyId,
        customerId,
        metadata
      );
      
      res.status(HttpStatus.CREATED).json({
        success: true,
        data: response,
        message: 'Survey response started'
      });
    } catch (error) {
      logger.error('Error starting survey response:', error);
      
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      if (error.message === ERROR_CODES.RESOURCE_NOT_FOUND) {
        statusCode = HttpStatus.NOT_FOUND;
      } else if (error.message.includes('already started')) {
        statusCode = HttpStatus.CONFLICT;
      }
      
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to start survey response'
      });
    }
  });

  /**
   * Submit survey answer
   */
  submitAnswer = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const { responseId, questionId, answer } = req.body;
      
      await this.surveyService.submitAnswer(responseId, questionId, answer);
      
      res.json({
        success: true,
        message: 'Answer submitted successfully'
      });
    } catch (error) {
      logger.error('Error submitting answer:', error);
      res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to submit answer'
      });
    }
  });

  /**
   * Complete survey response
   */
  completeSurveyResponse = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const { responseId, answers } = req.body;
      
      const result = await this.surveyService.completeSurveyResponse(responseId, answers);
      
      res.json({
        success: true,
        data: result,
        message: `Survey completed! You earned ${result.pointsAwarded} points.`
      });
    } catch (error) {
      logger.error('Error completing survey response:', error);
      res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to complete survey'
      });
    }
  });

  /**
   * Get survey response
   */
  getSurveyResponse = asyncHandler(async (req: Request, res: Response) => {
    try {
      const response = await this.surveyService.getSurveyResponse(req.params.responseId);
      
      if (!response) {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Survey response not found'
        });
      }
      
      // Check if user owns this response or is admin
      if (req.user?.id !== response.customerId && req.user?.role !== 'admin') {
        return res.status(HttpStatus.FORBIDDEN).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      logger.error('Error getting survey response:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve survey response'
      });
    }
  });

  /**
   * Get survey analytics
   */
  getSurveyAnalytics = asyncHandler(async (req: Request, res: Response) => {
    try {
      const analytics = await this.surveyService.getSurveyAnalytics(req.params.id);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting survey analytics:', error);
      
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      if (error.message === ERROR_CODES.RESOURCE_NOT_FOUND) {
        statusCode = HttpStatus.NOT_FOUND;
      }
      
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to retrieve analytics'
      });
    }
  });

  /**
   * Validate survey QR code
   */
  validateQRCode = asyncHandler(async (req: Request, res: Response) => {
    try {
      const { qrData } = req.body;
      
      const result = await this.surveyService.validateQRCode(qrData);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error validating QR code:', error);
      res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Invalid QR code'
      });
    }
  });


  /**
   * Get survey questions
   */
  getSurveyQuestions = asyncHandler(async (req: Request, res: Response) => {
    try {
      const questions = await this.surveyService.getSurveyQuestions(req.params.id);
      
      res.json({
        success: true,
        data: questions
      });
    } catch (error) {
      logger.error('Error getting survey questions:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve survey questions'
      });
    }
  });

  /**
   * Save survey progress
   */
  saveSurveyProgress = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const { responseId, answers } = req.body;
      
      await this.surveyService.saveSurveyProgress(responseId, answers);
      
      res.json({
        success: true,
        message: 'Progress saved successfully'
      });
    } catch (error) {
      logger.error('Error saving survey progress:', error);
      res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: error.message || 'Failed to save progress'
      });
    }
  });
}

// Validation middleware
export const surveyValidation = {
  createSurvey: [
    body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required and must be less than 200 characters'),
    body('description').trim().isLength({ min: 1, max: 1000 }).withMessage('Description is required and must be less than 1000 characters'),
    body('startDate').isISO8601().withMessage('Valid start date is required'),
    body('endDate').isISO8601().withMessage('Valid end date is required'),
    body('maxResponses').optional().isInt({ min: 1 }).withMessage('Max responses must be a positive integer'),
    body('pointsReward').optional().isInt({ min: 0 }).withMessage('Points reward must be a non-negative integer'),
    body('estimatedTime').isInt({ min: 1 }).withMessage('Estimated time is required and must be positive'),
    body('questions').isArray({ min: 1 }).withMessage('At least one question is required'),
    body('questions.*.type').isIn(['text', 'number', 'single_choice', 'multiple_choice', 'rating', 'boolean']).withMessage('Invalid question type'),
    body('questions.*.title').trim().isLength({ min: 1, max: 200 }).withMessage('Question title is required'),
    body('questions.*.isRequired').isBoolean().withMessage('isRequired must be boolean'),
    body('questions.*.order').isInt({ min: 0 }).withMessage('Order must be a non-negative integer')
  ],

  startSurveyResponse: [
    body('surveyId').isUUID().withMessage('Valid survey ID is required')
  ],

  submitAnswer: [
    body('responseId').isUUID().withMessage('Valid response ID is required'),
    body('questionId').isUUID().withMessage('Valid question ID is required'),
    body('answer').notEmpty().withMessage('Answer is required')
  ],

  completeSurveyResponse: [
    body('responseId').isUUID().withMessage('Valid response ID is required'),
    body('answers').optional().isArray().withMessage('Answers must be an array'),
    body('answers.*.questionId').optional().isUUID().withMessage('Valid question ID is required'),
    body('answers.*.answer').optional().notEmpty().withMessage('Answer is required')
  ],

  getSurvey: [
    param('id').isUUID().withMessage('Valid survey ID is required')
  ],

  getSurveyByCode: [
    param('code').trim().isLength({ min: 6, max: 10 }).withMessage('Valid survey code is required')
  ],

  getSurveyResponse: [
    param('responseId').isUUID().withMessage('Valid response ID is required')
  ],

  saveSurveyProgress: [
    body('responseId').isUUID().withMessage('Valid response ID is required'),
    body('answers').isArray().withMessage('Answers must be an array'),
    body('answers.*.questionId').isUUID().withMessage('Valid question ID is required'),
    body('answers.*.answer').notEmpty().withMessage('Answer is required')
  ]
};