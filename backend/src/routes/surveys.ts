import { Router } from 'express';
import { Pool } from 'pg';
import { SurveyController, surveyValidation } from '../controllers/surveyController.js';
import { SurveyService } from '../services/surveyService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export function createSurveyRoutes(db: Pool): Router {
  const router = Router();
  const surveyService = new SurveyService(db);
  const surveyController = new SurveyController(surveyService);

  // Public routes
  
  /**
   * @route POST /api/surveys/validate-qr
   * @desc Validate survey QR code
   * @access Public
   */
  router.post('/validate-qr', surveyController.validateQRCode);

  /**
   * @route GET /api/surveys/code/:code
   * @desc Get survey by code
   * @access Public
   */
  router.get('/code/:code',
    surveyValidation.getSurveyByCode,
    surveyController.getSurveyByCode
  );

  // Customer routes (require authentication)
  
  /**
   * @route GET /api/surveys/active
   * @desc Get active surveys for customer
   * @access Private (Customer)
   */
  router.get('/active',
    authenticateToken,
    surveyController.getActiveSurveys
  );

  /**
   * @route POST /api/surveys/start
   * @desc Start a survey response
   * @access Private (Customer)
   */
  router.post('/start',
    authenticateToken,
    surveyValidation.startSurveyResponse,
    surveyController.startSurveyResponse
  );

  /**
   * @route POST /api/surveys/submit-answer
   * @desc Submit an answer to a survey question
   * @access Private (Customer)
   */
  router.post('/submit-answer',
    authenticateToken,
    surveyValidation.submitAnswer,
    surveyController.submitAnswer
  );

  /**
   * @route POST /api/surveys/complete
   * @desc Complete a survey response
   * @access Private (Customer)
   */
  router.post('/complete',
    authenticateToken,
    surveyValidation.completeSurveyResponse,
    surveyController.completeSurveyResponse
  );

  /**
   * @route GET /api/surveys/response/:responseId
   * @desc Get survey response
   * @access Private (Customer/Admin)
   */
  router.get('/response/:responseId',
    authenticateToken,
    surveyValidation.getSurveyResponse,
    surveyController.getSurveyResponse
  );

  /**
   * @route POST /api/surveys/save-progress
   * @desc Save survey progress
   * @access Private (Customer)
   */
  router.post('/save-progress',
    authenticateToken,
    surveyValidation.saveSurveyProgress,
    surveyController.saveSurveyProgress
  );

  // Admin routes (require admin role)
  
  /**
   * @route POST /api/surveys
   * @desc Create a new survey
   * @access Private (Admin)
   */
  router.post('/',
    authenticateToken,
    requireRole('admin'),
    surveyValidation.createSurvey,
    surveyController.createSurvey
  );

  /**
   * @route GET /api/surveys/:id
   * @desc Get survey by ID
   * @access Private (Customer/Admin)
   */
  router.get('/:id',
    authenticateToken,
    surveyValidation.getSurvey,
    surveyController.getSurvey
  );

  /**
   * @route GET /api/surveys/:id/questions
   * @desc Get survey questions
   * @access Private (Customer/Admin)
   */
  router.get('/:id/questions',
    authenticateToken,
    surveyValidation.getSurvey,
    surveyController.getSurveyQuestions
  );

  /**
   * @route GET /api/surveys/:id/analytics
   * @desc Get survey analytics
   * @access Private (Admin)
   */
  router.get('/:id/analytics',
    authenticateToken,
    requireRole('admin'),
    surveyValidation.getSurvey,
    surveyController.getSurveyAnalytics
  );

  /**
   * @route POST /api/surveys/:id/generate-qr
   * @desc Generate new QR code for survey
   * @access Private (Admin)
   */
  router.post('/:id/generate-qr',
    authenticateToken,
    requireRole('admin'),
    surveyValidation.getSurvey,
    surveyController.generateQRCode
  );

  return router;
}

export default createSurveyRoutes;