import { Request, Response } from 'express';
import { surveyService } from '../services/surveyService';
import { CreateSurveyRequest, UpdateSurveyRequest, SubmitResponseRequest } from '../types/survey';

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
      
      // Validate required fields
      if (!surveyData.title || !surveyData.questions || surveyData.questions.length === 0) {
        res.status(400).json({ message: 'Title and questions are required.' });
        return;
      }

      const survey = await surveyService.createSurvey(surveyData, user.id);
      res.status(201).json({ survey });
    } catch (error: any) {
      console.error('Error creating survey:', error);
      res.status(500).json({ message: 'Failed to create survey', error: error.message });
    }
  }

  // Get survey by ID
  async getSurvey(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const survey = await surveyService.getSurveyById(id);
      
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      res.json({ survey });
    } catch (error: any) {
      console.error('Error fetching survey:', error);
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
      console.error('Error fetching surveys:', error);
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
      const survey = await surveyService.updateSurvey(id, updateData);
      
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      res.json({ survey });
    } catch (error: any) {
      console.error('Error updating survey:', error);
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
      console.error('Error deleting survey:', error);
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

      const response = await surveyService.submitResponse(user.id, responseData);
      res.json({ response });
    } catch (error: any) {
      console.error('Error submitting response:', error);
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

      const response = await surveyService.getUserResponse(user.id, surveyId);
      res.json({ response });
    } catch (error: any) {
      console.error('Error fetching user response:', error);
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
      console.error('Error fetching survey responses:', error);
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

      const surveys = await surveyService.getAvailableSurveys(user.id);
      res.json({ surveys });
    } catch (error: any) {
      console.error('Error fetching available surveys:', error);
      res.status(500).json({ message: 'Failed to fetch surveys', error: error.message });
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
      console.error('Error fetching survey analytics:', error);
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
      console.error('Error exporting survey responses:', error);
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
      console.error('Error fetching survey invitations:', error);
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
      console.error('Error sending survey invitations:', error);
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
      console.error('Error resending invitation:', error);
      res.status(500).json({ message: 'Failed to resend invitation', error: error.message });
    }
  }
}

export const surveyController = new SurveyController();