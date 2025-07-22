import { Request, Response } from 'express';
import { surveyService } from '../services/surveyService';
import { CreateSurveyRequest, UpdateSurveyRequest, SubmitResponseRequest } from '../types/survey';
import { logger } from '../utils/logger';

export class SurveyController {
  // Create a new survey (Admin only)
  async createSurvey(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const surveyData: CreateSurveyRequest = req.body;
      
      
      // Comprehensive validation
      const validationErrors = [];
      
      if (!surveyData.title) {
        validationErrors.push({ field: 'title', message: 'Title is required', value: surveyData.title });
      } else if (typeof surveyData.title !== 'string') {
        validationErrors.push({ field: 'title', message: 'Title must be a string', value: surveyData.title, type: typeof surveyData.title });
      } else if (surveyData.title.trim().length === 0) {
        validationErrors.push({ field: 'title', message: 'Title cannot be empty', value: surveyData.title });
      }
      
      if (!surveyData.questions) {
        validationErrors.push({ field: 'questions', message: 'Questions are required', value: surveyData.questions });
      } else if (!Array.isArray(surveyData.questions)) {
        validationErrors.push({ field: 'questions', message: 'Questions must be an array', value: surveyData.questions, type: typeof surveyData.questions });
      } else if (surveyData.questions.length === 0) {
        validationErrors.push({ field: 'questions', message: 'At least one question is required', value: surveyData.questions });
      } else {
        // Validate each question
        surveyData.questions.forEach((question, index) => {
          if (!question.id) {
            validationErrors.push({ field: `questions[${index}].id`, message: 'Question ID is required', value: question.id });
          }
          if (!question.text) {
            validationErrors.push({ field: `questions[${index}].text`, message: 'Question text is required', value: question.text });
          } else if (typeof question.text !== 'string') {
            validationErrors.push({ field: `questions[${index}].text`, message: 'Question text must be a string', value: question.text, type: typeof question.text });
          }
          if (!question.type) {
            validationErrors.push({ field: `questions[${index}].type`, message: 'Question type is required', value: question.type });
          }
          if (question.required === undefined || question.required === null) {
            validationErrors.push({ field: `questions[${index}].required`, message: 'Question required field must be specified', value: question.required });
          }
          if (typeof question.order !== 'number') {
            validationErrors.push({ field: `questions[${index}].order`, message: 'Question order must be a number', value: question.order, type: typeof question.order });
          }
          
          // Validate options for choice questions
          if (['single_choice', 'multiple_choice'].includes(question.type)) {
            if (!question.options || !Array.isArray(question.options)) {
              validationErrors.push({ field: `questions[${index}].options`, message: 'Options are required for choice questions', value: question.options });
            } else if (question.options.length === 0) {
              validationErrors.push({ field: `questions[${index}].options`, message: 'At least one option is required for choice questions', value: question.options });
            } else {
              question.options.forEach((option, optIndex) => {
                if (!option.id) {
                  validationErrors.push({ field: `questions[${index}].options[${optIndex}].id`, message: 'Option ID is required', value: option.id });
                }
                if (!option.text) {
                  validationErrors.push({ field: `questions[${index}].options[${optIndex}].text`, message: 'Option text is required', value: option.text });
                } else if (typeof option.text !== 'string') {
                  validationErrors.push({ field: `questions[${index}].options[${optIndex}].text`, message: 'Option text must be a string', value: option.text, type: typeof option.text });
                }
                if (option.value === undefined || option.value === null) {
                  validationErrors.push({ field: `questions[${index}].options[${optIndex}].value`, message: 'Option value is required', value: option.value });
                }
              });
            }
          }
        });
      }
      
      if (!surveyData.access_type) {
        validationErrors.push({ field: 'access_type', message: 'Access type is required', value: surveyData.access_type });
      } else if (!['public', 'invite_only'].includes(surveyData.access_type)) {
        validationErrors.push({ field: 'access_type', message: 'Access type must be "public" or "invite_only"', value: surveyData.access_type });
      }
      
      if (validationErrors.length > 0) {
        res.status(400).json({ 
          message: 'Validation failed', 
          validationErrors,
          details: `Found ${validationErrors.length} validation error(s)`,
          receivedData: {
            title: surveyData.title,
            titleType: typeof surveyData.title,
            questionsCount: surveyData.questions?.length,
            questionsType: typeof surveyData.questions,
            accessType: surveyData.access_type
          }
        });
        return;
      }

      const survey = await surveyService.createSurvey(surveyData, user.userId);
      res.status(201).json({ survey });
    } catch (error: any) {
      
      res.status(500).json({ 
        message: 'Failed to create survey', 
        error: error.message,
        details: error.detail || error.hint || 'Internal server error',
        errorCode: error.code,
        constraint: error.constraint
      });
    }
  }

  // Get survey by ID
  async getSurvey(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { user } = req as any;
      
      const survey = await surveyService.getSurveyById(id);
      
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      // For non-admin users, check access permissions
      if (user && !['admin', 'super_admin'].includes(user.role)) {
        const hasAccess = await surveyService.canUserAccessSurvey(user.userId, id);
        if (!hasAccess) {
          res.status(403).json({ 
            message: 'Access denied. You do not have permission to access this survey.' 
          });
          return;
        }
      }

      res.json({ survey });
    } catch (error: any) {
      logger.error('Error fetching survey:', error);
      res.status(500).json({ message: 'Failed to fetch survey', error: error.message });
    }
  }

  // Get all surveys with pagination (Admin only)
  async getSurveys(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;
      const createdBy = req.query.created_by as string;

      const result = await surveyService.getSurveys(page, limit, status, createdBy);
      
      res.json({
        surveys: result.surveys,
        pagination: {
          total: result.total,
          page,
          limit,
          totalPages: result.totalPages
        }
      });
    } catch (error: any) {
      logger.error('Error fetching surveys:', error);
      res.status(500).json({ message: 'Failed to fetch surveys', error: error.message });
    }
  }

  // Update survey (Admin only)
  async updateSurvey(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { id } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const updateData: UpdateSurveyRequest = req.body;
      
      // Enhanced logging for update operations too
      
      const survey = await surveyService.updateSurvey(id, updateData);
      
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      res.json({ survey });
    } catch (error: any) {
      logger.error('Error updating survey:', error);
      res.status(500).json({ message: 'Failed to update survey', error: error.message });
    }
  }

  // Delete survey (Admin only)
  async deleteSurvey(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { id } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const deleted = await surveyService.deleteSurvey(id);
      
      if (!deleted) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      res.json({ message: 'Survey deleted successfully' });
    } catch (error: any) {
      logger.error('Error deleting survey:', error);
      res.status(500).json({ message: 'Failed to delete survey', error: error.message });
    }
  }

  // Submit survey response (Customer)
  async submitResponse(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const responseData: SubmitResponseRequest = req.body;
      
      // Validate required fields
      if (!responseData.survey_id || !responseData.answers) {
        res.status(400).json({ message: 'Survey ID and answers are required.' });
        return;
      }

      // Check if user has access to this survey
      const hasAccess = await surveyService.canUserAccessSurvey(user.userId, responseData.survey_id);
      if (!hasAccess) {
        res.status(403).json({ 
          message: 'Access denied. You do not have permission to respond to this survey.' 
        });
        return;
      }

      const response = await surveyService.submitResponse(user.userId, responseData);
      res.json({ response });
    } catch (error: any) {
      logger.error('Error submitting response:', error);
      res.status(500).json({ message: 'Failed to submit response', error: error.message });
    }
  }

  // Get user's response to a survey
  async getUserResponse(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { surveyId } = req.params;
      
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const response = await surveyService.getUserResponse(user.userId, surveyId);
      res.json({ response });
    } catch (error: any) {
      logger.error('Error fetching user response:', error);
      res.status(500).json({ message: 'Failed to fetch response', error: error.message });
    }
  }

  // Get all responses for a survey (Admin only)
  async getSurveyResponses(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { surveyId } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await surveyService.getSurveyResponses(surveyId, page, limit);
      
      res.json({
        responses: result.responses,
        pagination: {
          total: result.total,
          page,
          limit,
          totalPages: result.totalPages
        }
      });
    } catch (error: any) {
      logger.error('Error fetching survey responses:', error);
      res.status(500).json({ message: 'Failed to fetch responses', error: error.message });
    }
  }

  // Get surveys available to current user
  async getAvailableSurveys(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const surveys = await surveyService.getAvailableSurveys(user.userId);
      res.json({ surveys });
    } catch (error: any) {
      logger.error('Error fetching available surveys:', error);
      res.status(500).json({ message: 'Failed to fetch surveys', error: error.message });
    }
  }

  // Get public surveys available to current user
  async getPublicSurveys(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const surveys = await surveyService.getPublicSurveys(user.userId);
      res.json({ surveys });
    } catch (error: any) {
      logger.error('Error fetching public surveys:', error);
      res.status(500).json({ message: 'Failed to fetch public surveys', error: error.message });
    }
  }

  // Get invited surveys available to current user
  async getInvitedSurveys(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      
      if (!user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const surveys = await surveyService.getInvitedSurveys(user.userId);
      res.json({ surveys });
    } catch (error: any) {
      logger.error('Error fetching invited surveys:', error);
      res.status(500).json({ message: 'Failed to fetch invited surveys', error: error.message });
    }
  }

  // Get survey analytics (Admin only)
  async getSurveyAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { surveyId } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const analytics = await surveyService.getSurveyAnalytics(surveyId);
      
      if (!analytics) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      res.json(analytics);
    } catch (error: any) {
      logger.error('Error fetching survey analytics:', error);
      res.status(500).json({ message: 'Failed to fetch analytics', error: error.message });
    }
  }

  // Export survey responses as CSV (Admin only)
  async exportSurveyResponses(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { surveyId } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      // Get survey and all responses
      const survey = await surveyService.getSurveyById(surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      // Get all responses (without pagination)
      const result = await surveyService.getSurveyResponses(surveyId, 1, 10000);
      const responses = result.responses;

      // Generate CSV header
      const csvHeaders = ['User Email', 'First Name', 'Last Name', 'Completed', 'Progress', 'Started At', 'Completed At'];
      survey.questions.forEach(q => csvHeaders.push(`Q${q.order}: ${q.text}`));

      // Generate CSV rows
      const csvRows = responses.map(response => {
        const row = [
          (response as any).user_email || '',
          (response as any).user_first_name || '',
          (response as any).user_last_name || '',
          response.is_completed ? 'Yes' : 'No',
          `${response.progress}%`,
          response.started_at,
          response.completed_at || ''
        ];

        // Add answer for each question
        survey.questions.forEach(question => {
          const answer = response.answers[question.id];
          if (Array.isArray(answer)) {
            row.push(answer.join('; '));
          } else if (answer !== undefined && answer !== null) {
            row.push(String(answer));
          } else {
            row.push('');
          }
        });

        return row;
      });

      // Create CSV content
      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      // Set response headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="survey-${surveyId}-responses.csv"`);
      
      res.send(csvContent);
    } catch (error: any) {
      logger.error('Error exporting survey responses:', error);
      res.status(500).json({ message: 'Failed to export responses', error: error.message });
    }
  }

  // Get survey invitations (Admin only)
  async getSurveyInvitations(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { surveyId } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const invitations = await surveyService.getSurveyInvitations(surveyId);
      res.json({ invitations });
    } catch (error: any) {
      logger.error('Error fetching survey invitations:', error);
      res.status(500).json({ message: 'Failed to fetch invitations', error: error.message });
    }
  }

  // Send survey invitations (Admin only)
  async sendSurveyInvitations(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { surveyId } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      const result = await surveyService.sendSurveyInvitations(surveyId);
      res.json(result);
    } catch (error: any) {
      logger.error('Error sending survey invitations:', error);
      res.status(500).json({ message: 'Failed to send invitations', error: error.message });
    }
  }

  // Resend invitation (Admin only)
  async resendInvitation(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      const { invitationId } = req.params;
      
      // Check if user is admin
      if (!user || !['admin', 'super_admin'].includes(user.role)) {
        res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        return;
      }

      await surveyService.resendInvitation(invitationId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error('Error resending invitation:', error);
      res.status(500).json({ message: 'Failed to resend invitation', error: error.message });
    }
  }
}

export const surveyController = new SurveyController();