import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import {
  Survey,
  SurveyResponse,
  SurveyInvitation,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  SurveyListResponse,
  SurveyResponseListResponse,
  SurveyAnalytics
} from '../types/survey';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

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
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (status) params.append('status', status);
    if (createdBy) params.append('created_by', createdBy);

    const response = await surveyAxios.get(`/surveys?${params}`);
    return response.data;
  }

  async getSurveyById(id: string): Promise<Survey> {
    const response = await surveyAxios.get(`/surveys/${id}`);
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
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
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

  async resendInvitation(invitationId: string): Promise<void> {
    await surveyAxios.post(`/surveys/invitations/${invitationId}/resend`);
  }

  // Utility methods
  generateQuestionId(): string {
    return 'q_' + Math.random().toString(36).substr(2, 9);
  }

  generateOptionId(): string {
    return 'opt_' + Math.random().toString(36).substr(2, 9);
  }

  calculateProgress(answers: Record<string, any>, totalQuestions: number): number {
    const answeredQuestions = Object.keys(answers).length;
    return Math.round((answeredQuestions / totalQuestions) * 100);
  }

  validateAnswer(question: any, answer: any): boolean {
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

  isResponseComplete(survey: Survey, answers: Record<string, any>): boolean {
    return survey.questions.every(question => 
      this.validateAnswer(question, answers[question.id])
    );
  }
}

export const surveyService = new SurveyService();