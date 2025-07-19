import axios from 'axios';
import { API_CONFIG } from '@hotel-loyalty/shared';

const API_BASE = `${API_CONFIG.BASE_URL}/api/surveys`;

export interface AdminSurvey {
  id: string;
  title: string;
  description: string;
  code: string;
  isActive: boolean;
  startDate: string;
  endDate: string;
  maxResponses?: number;
  responseCount: number;
  pointsReward: number;
  targetAudience?: string;
  estimatedTime: number;
  qrCode?: string;
  questions: AdminSurveyQuestion[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSurveyQuestion {
  id: string;
  surveyId: string;
  type: 'text' | 'number' | 'single_choice' | 'multiple_choice' | 'rating' | 'boolean';
  title: string;
  description?: string;
  isRequired: boolean;
  order: number;
  options?: string[];
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface CreateSurveyData {
  title: string;
  description: string;
  code: string;
  isActive: boolean;
  startDate: string;
  endDate: string;
  maxResponses?: number;
  pointsReward: number;
  targetAudience?: string;
  estimatedTime: number;
  questions: CreateSurveyQuestionData[];
}

export interface CreateSurveyQuestionData {
  type: 'text' | 'number' | 'single_choice' | 'multiple_choice' | 'rating' | 'boolean';
  title: string;
  description?: string;
  isRequired: boolean;
  order: number;
  options?: string[];
  metadata?: Record<string, any>;
}

export interface SurveyAnalytics {
  survey: AdminSurvey;
  totalResponses: number;
  completionRate: number;
  averageTime: number;
  responsesByDay: Array<{
    date: string;
    count: number;
  }>;
  questionAnalytics: Array<{
    questionId: string;
    questionTitle: string;
    type: string;
    responses: number;
    answers: Array<{
      answer: string;
      count: number;
      percentage: number;
    }>;
  }>;
  customerSegments: Array<{
    segment: string;
    count: number;
    percentage: number;
  }>;
}

class AdminSurveyService {
  private getAuthHeaders() {
    const token = localStorage.getItem('loyalty_token');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get all surveys (admin only)
   */
  async getAllSurveys(): Promise<AdminSurvey[]> {
    try {
      const response = await axios.get(`${API_BASE}`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching all surveys:', error);
      throw error;
    }
  }

  /**
   * Create new survey
   */
  async createSurvey(surveyData: CreateSurveyData): Promise<AdminSurvey> {
    try {
      const response = await axios.post(`${API_BASE}`, surveyData, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error creating survey:', error);
      throw error;
    }
  }

  /**
   * Get survey by ID
   */
  async getSurvey(surveyId: string): Promise<AdminSurvey> {
    try {
      const response = await axios.get(`${API_BASE}/${surveyId}`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching survey:', error);
      throw error;
    }
  }

  /**
   * Update survey status
   */
  async updateSurveyStatus(surveyId: string, isActive: boolean): Promise<void> {
    try {
      await axios.patch(`${API_BASE}/${surveyId}/status`, { isActive }, {
        headers: this.getAuthHeaders()
      });
    } catch (error) {
      console.error('Error updating survey status:', error);
      throw error;
    }
  }

  /**
   * Get survey analytics
   */
  async getSurveyAnalytics(surveyId: string): Promise<SurveyAnalytics> {
    try {
      const response = await axios.get(`${API_BASE}/${surveyId}/analytics`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching survey analytics:', error);
      throw error;
    }
  }

  /**
   * Get survey responses
   */
  async getSurveyResponses(surveyId: string, page = 1, limit = 50): Promise<{
    responses: Array<{
      id: string;
      customerId: string;
      customerName: string;
      startedAt: string;
      completedAt?: string;
      isCompleted: boolean;
      pointsAwarded: number;
      answers: Array<{
        questionId: string;
        questionTitle: string;
        answer: any;
        answeredAt: string;
      }>;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    try {
      const response = await axios.get(`${API_BASE}/${surveyId}/responses`, {
        params: { page, limit },
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching survey responses:', error);
      throw error;
    }
  }

  /**
   * Export survey data
   */
  async exportSurveyData(surveyId: string, format: 'csv' | 'xlsx' = 'csv'): Promise<Blob> {
    try {
      const response = await axios.get(`${API_BASE}/${surveyId}/export`, {
        params: { format },
        headers: this.getAuthHeaders(),
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      console.error('Error exporting survey data:', error);
      throw error;
    }
  }

  /**
   * Format estimated time for display
   */
  formatEstimatedTime(minutes: number): string {
    if (minutes < 1) {
      return 'Less than 1 minute';
    } else if (minutes === 1) {
      return '1 minute';
    } else {
      return `${minutes} minutes`;
    }
  }

  /**
   * Get question type display name
   */
  getQuestionTypeDisplayName(type: string): string {
    const types = {
      text: 'Text Response',
      number: 'Number',
      single_choice: 'Single Choice',
      multiple_choice: 'Multiple Choice',
      rating: 'Rating (1-5)',
      boolean: 'Yes/No'
    };
    return types[type as keyof typeof types] || type;
  }

  /**
   * Check if survey is expired
   */
  isSurveyExpired(survey: AdminSurvey): boolean {
    return new Date() > new Date(survey.endDate);
  }

  /**
   * Check if survey is available
   */
  isSurveyAvailable(survey: AdminSurvey): boolean {
    const now = new Date();
    return survey.isActive && 
           now >= new Date(survey.startDate) && 
           now <= new Date(survey.endDate) &&
           (survey.maxResponses === null || survey.responseCount < survey.maxResponses);
  }

  /**
   * Calculate response rate
   */
  getResponseRate(survey: AdminSurvey): number {
    if (!survey.maxResponses) return 0;
    return (survey.responseCount / survey.maxResponses) * 100;
  }

  /**
   * Get days until survey expires
   */
  getDaysUntilExpiry(survey: AdminSurvey): number {
    const now = new Date();
    const expiry = new Date(survey.endDate);
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Generate survey code
   */
  generateSurveyCode(): string {
    return 'SUR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Validate question data
   */
  validateQuestion(question: CreateSurveyQuestionData): { isValid: boolean; error?: string } {
    if (!question.title.trim()) {
      return { isValid: false, error: 'Question title is required' };
    }

    if (['single_choice', 'multiple_choice'].includes(question.type)) {
      if (!question.options || question.options.length < 2) {
        return { isValid: false, error: 'Choice questions must have at least 2 options' };
      }
    }

    return { isValid: true };
  }
}

export const adminSurveyService = new AdminSurveyService();