/* eslint-disable no-console -- Service layer uses console for API debugging */
import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import { API_BASE_URL } from '../utils/apiConfig';
import {
  Survey,
  SurveyResponse,
  SurveyInvitation,
  SurveyQuestion,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  SurveyListResponse,
  SurveyResponseListResponse,
  SurveyAnalytics,
  AssignCouponToSurveyRequest,
  UpdateSurveyCouponAssignmentRequest,
  SurveyCouponAssignmentListResponse,
  SurveyRewardHistoryResponse,
  SurveyCouponAssignment
} from '../types/survey';

// Create axios instance for surveys and add auth interceptor
const surveyAxios = axios.create({
  baseURL: API_BASE_URL,
});
addAuthTokenInterceptor(surveyAxios);

class SurveyService {
  // Admin Survey Management
  async createSurvey(data: CreateSurveyRequest): Promise<Survey> {
    const response = await surveyAxios.post('/surveys', data);
    return response.data.survey;
  }

  async getSurveys(
    page = 1, 
    limit = 10, 
    status?: string,
    createdBy?: string
  ): Promise<SurveyListResponse> {
    try {
      // Validate status parameter against known valid statuses
      const validStatuses = ['draft', 'active', 'paused', 'completed', 'archived'];
      if (status && !validStatuses.includes(status)) {
        console.warn(`Invalid survey status '${status}'. Valid statuses:`, validStatuses);
        throw new Error(`Invalid survey status: ${status}`);
      }

      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      if (status) {params.append('status', status);}
      if (createdBy) {params.append('created_by', createdBy);}

      const response = await surveyAxios.get(`/surveys?${params}`);
      return response.data;
    } catch (error) {
      console.error('Error in getSurveys:', error);
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status: number; data: unknown } };
        if (axiosError.response) {
          console.error('Response error:', axiosError.response.status, axiosError.response.data);
        }
      }
      throw error;
    }
  }

  async getSurveyById(id: string): Promise<Survey> {
    const response = await surveyAxios.get(`/surveys/${id}`);
    return response.data.survey;
  }

  async getSurveyWithTranslations(id: string, language?: string): Promise<Survey> {
    const params = language ? `?language=${language}` : '';
    const response = await surveyAxios.get(`/surveys/${id}/translations${params}`);
    return response.data.survey;
  }

  async updateSurvey(id: string, data: UpdateSurveyRequest): Promise<Survey> {
    const response = await surveyAxios.put(`/surveys/${id}`, data);
    return response.data.survey;
  }

  async deleteSurvey(id: string): Promise<void> {
    await surveyAxios.delete(`/surveys/${id}`);
  }

  // Customer Survey Experience
  async getAvailableSurveys(): Promise<Survey[]> {
    const response = await surveyAxios.get('/surveys/available/user');
    return response.data.surveys;
  }

  async getPublicSurveys(): Promise<Survey[]> {
    const response = await surveyAxios.get('/surveys/public/user');
    return response.data.surveys;
  }

  async getInvitedSurveys(): Promise<Survey[]> {
    const response = await surveyAxios.get('/surveys/invited/user');
    return response.data.surveys;
  }

  async submitResponse(data: SubmitResponseRequest): Promise<SurveyResponse> {
    const response = await surveyAxios.post('/surveys/responses', data);
    return response.data.response;
  }

  async getUserResponse(surveyId: string): Promise<SurveyResponse | null> {
    try {
      const response = await surveyAxios.get(`/surveys/responses/${surveyId}/user`);
      return response.data.response;
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status: number } };
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      throw error;
    }
  }

  // Admin Response Management
  async getSurveyResponses(
    surveyId: string, 
    page = 1, 
    limit = 10
  ): Promise<SurveyResponseListResponse> {
    const response = await surveyAxios.get(
      `/surveys/${surveyId}/responses?page=${page}&limit=${limit}`
    );
    return response.data;
  }

  async getSurveyAnalytics(surveyId: string): Promise<SurveyAnalytics> {
    const response = await surveyAxios.get(`/surveys/${surveyId}/analytics`);
    return response.data;
  }

  async exportSurveyResponses(surveyId: string): Promise<Blob> {
    const response = await surveyAxios.get(`/surveys/${surveyId}/export`, {
      responseType: 'blob'
    });
    return response.data;
  }

  // Survey Invitations Management
  async getSurveyInvitations(surveyId: string): Promise<SurveyInvitation[]> {
    const response = await surveyAxios.get(`/surveys/${surveyId}/invitations`);
    return response.data.invitations;
  }

  async sendSurveyInvitations(surveyId: string): Promise<{ sent: number }> {
    const response = await surveyAxios.post(`/surveys/${surveyId}/invitations/send`);
    return response.data;
  }

  async sendSurveyInvitationsToUsers(surveyId: string, userIds: string[]): Promise<{ sent: number }> {
    const response = await surveyAxios.post(`/surveys/${surveyId}/invitations/send-to-users`, {
      userIds
    });
    return response.data;
  }

  async resendInvitation(invitationId: string): Promise<void> {
    await surveyAxios.post(`/surveys/invitations/${invitationId}/resend`);
  }

  // Survey Coupon Assignment Management
  async assignCouponToSurvey(data: AssignCouponToSurveyRequest): Promise<SurveyCouponAssignment> {
    const response = await surveyAxios.post('/surveys/coupon-assignments', data);
    return response.data.assignment;
  }

  async getSurveyCouponAssignments(
    surveyId: string,
    page = 1,
    limit = 20
  ): Promise<SurveyCouponAssignmentListResponse> {
    const response = await surveyAxios.get(
      `/surveys/${surveyId}/coupon-assignments?page=${page}&limit=${limit}`
    );
    return response.data;
  }

  async updateSurveyCouponAssignment(
    surveyId: string,
    couponId: string,
    data: UpdateSurveyCouponAssignmentRequest
  ): Promise<SurveyCouponAssignment> {
    const response = await surveyAxios.put(
      `/surveys/${surveyId}/coupon-assignments/${couponId}`,
      data
    );
    return response.data.assignment;
  }

  async removeCouponFromSurvey(surveyId: string, couponId: string): Promise<void> {
    await surveyAxios.delete(`/surveys/${surveyId}/coupon-assignments/${couponId}`);
  }

  async getSurveyRewardHistory(
    surveyId: string,
    page = 1,
    limit = 20
  ): Promise<SurveyRewardHistoryResponse> {
    const response = await surveyAxios.get(
      `/surveys/${surveyId}/reward-history?page=${page}&limit=${limit}`
    );
    return response.data;
  }

  async getAllSurveyCouponAssignments(
    page = 1,
    limit = 20,
    filters: {
      survey_id?: string;
      coupon_id?: string;
      is_active?: boolean;
      assigned_by?: string;
    } = {}
  ): Promise<SurveyCouponAssignmentListResponse> {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    
    if (filters.survey_id) {params.append('survey_id', filters.survey_id);}
    if (filters.coupon_id) {params.append('coupon_id', filters.coupon_id);}
    if (filters.is_active !== undefined) {params.append('is_active', filters.is_active.toString());}
    if (filters.assigned_by) {params.append('assigned_by', filters.assigned_by);}

    const response = await surveyAxios.get(`/surveys/admin/coupon-assignments?${params}`);
    return response.data;
  }

  // Utility methods
  generateQuestionId(): string {
    return 'q_' + Math.random().toString(36).substr(2, 9);
  }

  generateOptionId(): string {
    return 'opt_' + Math.random().toString(36).substr(2, 9);
  }

  calculateProgress(answers: Record<string, unknown>, totalQuestions: number): number {
    const answeredQuestions = Object.keys(answers).length;
    return Math.round((answeredQuestions / totalQuestions) * 100);
  }

  validateAnswer(question: SurveyQuestion, answer: unknown): boolean {
    if (question.required && (answer === undefined || answer === null || answer === '')) {
      return false;
    }

    if (answer === undefined || answer === null || answer === '') {
      return true; // Optional question, no answer is valid
    }

    switch (question.type) {
      case 'multiple_choice':
        return Array.isArray(answer) && answer.length > 0;
      case 'single_choice':
      case 'yes_no':
        return typeof answer === 'string' || typeof answer === 'number';
      case 'text':
      case 'textarea':
        return typeof answer === 'string' && answer.trim().length > 0;
      case 'rating_5':
        return typeof answer === 'number' && answer >= 1 && answer <= 5;
      case 'rating_10':
        return typeof answer === 'number' && answer >= 1 && answer <= 10;
      default:
        return false;
    }
  }

  isResponseComplete(survey: Survey, answers: Record<string, unknown>): boolean {
    return survey.questions.every(question =>
      this.validateAnswer(question, answers[question.id])
    );
  }
}

export const surveyService = new SurveyService();