import axios from 'axios';
import { API_CONFIG } from '@hotel-loyalty/shared';

const API_BASE = `${API_CONFIG.BASE_URL}/api/surveys`;

export interface SurveyQuestion {
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

export interface Survey {
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
  questions: SurveyQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface QuestionAnswer {
  questionId: string;
  answer: any;
  answeredAt?: string;
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  customerId: string;
  answers?: QuestionAnswer[];
  responses?: Array<{
    questionId: string;
    answer: any;
    answeredAt: string;
  }>;
  startedAt: string;
  completedAt?: string;
  isCompleted: boolean;
  ipAddress?: string;
  userAgent?: string;
  pointsAwarded: number;
  createdAt: string;
}

export interface SurveyWithProgress extends Survey {
  questionCount?: number;
  isStarted?: boolean;
  isCompleted?: boolean;
  progress?: number;
}

class SurveyService {
  private getAuthHeaders() {
    const token = localStorage.getItem('loyalty_token');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get active surveys for customer
   */
  async getActiveSurveys(): Promise<SurveyWithProgress[]> {
    try {
      const response = await axios.get(`${API_BASE}/active`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching active surveys:', error);
      throw error;
    }
  }

  /**
   * Get survey by code
   */
  async getSurveyByCode(code: string): Promise<Survey> {
    try {
      const response = await axios.get(`${API_BASE}/code/${code}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching survey by code:', error);
      throw error;
    }
  }

  /**
   * Start survey response
   */
  async startSurveyResponse(surveyId: string): Promise<SurveyResponse> {
    try {
      const response = await axios.post(`${API_BASE}/start`, {
        surveyId
      }, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error starting survey response:', error);
      throw error;
    }
  }

  /**
   * Submit answer to survey question
   */
  async submitAnswer(responseId: string, questionId: string, answer: any): Promise<void> {
    try {
      await axios.post(`${API_BASE}/submit-answer`, {
        responseId,
        questionId,
        answer
      }, {
        headers: this.getAuthHeaders()
      });
    } catch (error) {
      console.error('Error submitting answer:', error);
      throw error;
    }
  }

  /**
   * Complete survey response
   */
  async completeSurveyResponse(responseId: string, answers?: QuestionAnswer[]): Promise<{
    success: boolean;
    pointsAwarded: number;
    response: SurveyResponse;
  }> {
    try {
      const response = await axios.post(`${API_BASE}/complete`, {
        responseId,
        answers
      }, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error completing survey response:', error);
      throw error;
    }
  }

  /**
   * Get survey response
   */
  async getSurveyResponse(responseId: string): Promise<SurveyResponse> {
    try {
      const response = await axios.get(`${API_BASE}/response/${responseId}`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching survey response:', error);
      throw error;
    }
  }

  /**
   * Validate QR code
   */
  async validateQRCode(qrData: string): Promise<{
    survey: {
      id: string;
      title: string;
      description: string;
      estimatedTime: number;
      pointsReward: number;
    };
    valid: boolean;
    code: string;
  }> {
    try {
      const response = await axios.post(`${API_BASE}/validate-qr`, { qrData });
      return response.data.data;
    } catch (error) {
      console.error('Error validating QR code:', error);
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
   * Validate answer based on question type
   */
  validateAnswer(question: SurveyQuestion, answer: any): { isValid: boolean; error?: string } {
    if (question.isRequired && (answer === null || answer === undefined || answer === '')) {
      return { isValid: false, error: 'This question is required' };
    }

    if (!question.isRequired && (answer === null || answer === undefined || answer === '')) {
      return { isValid: true };
    }

    switch (question.type) {
      case 'text':
        if (typeof answer !== 'string') {
          return { isValid: false, error: 'Answer must be text' };
        }
        if (answer.length > 1000) {
          return { isValid: false, error: 'Answer must be less than 1000 characters' };
        }
        break;

      case 'number':
        if (typeof answer !== 'number' || isNaN(answer)) {
          return { isValid: false, error: 'Answer must be a valid number' };
        }
        break;

      case 'boolean':
        if (typeof answer !== 'boolean') {
          return { isValid: false, error: 'Please select Yes or No' };
        }
        break;

      case 'single_choice':
        if (!question.options?.includes(answer)) {
          return { isValid: false, error: 'Please select a valid option' };
        }
        break;

      case 'multiple_choice':
        if (!Array.isArray(answer)) {
          return { isValid: false, error: 'Please select at least one option' };
        }
        if (answer.length === 0) {
          return { isValid: false, error: 'Please select at least one option' };
        }
        if (!answer.every(choice => question.options?.includes(choice))) {
          return { isValid: false, error: 'Please select valid options only' };
        }
        break;

      case 'rating':
        if (typeof answer !== 'number' || answer < 1 || answer > 5) {
          return { isValid: false, error: 'Please select a rating between 1 and 5' };
        }
        break;

      default:
        return { isValid: false, error: 'Unknown question type' };
    }

    return { isValid: true };
  }

  /**
   * Calculate survey progress
   */
  calculateProgress(totalQuestions: number, answeredQuestions: number): number {
    if (totalQuestions === 0) return 0;
    return Math.round((answeredQuestions / totalQuestions) * 100);
  }

  /**
   * Check if survey is expired
   */
  isSurveyExpired(survey: Survey): boolean {
    return new Date() > new Date(survey.endDate);
  }

  /**
   * Check if survey is available
   */
  isSurveyAvailable(survey: Survey): boolean {
    const now = new Date();
    return survey.isActive && 
           now >= new Date(survey.startDate) && 
           now <= new Date(survey.endDate) &&
           (survey.maxResponses === null || survey.responseCount < survey.maxResponses);
  }

  /**
   * Get days until survey expires
   */
  getDaysUntilExpiry(survey: Survey): number {
    const now = new Date();
    const expiry = new Date(survey.endDate);
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Get survey by ID
   */
  async getSurvey(surveyId: string): Promise<Survey> {
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
   * Get survey questions
   */
  async getSurveyQuestions(surveyId: string): Promise<SurveyQuestion[]> {
    try {
      const response = await axios.get(`${API_BASE}/${surveyId}/questions`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching survey questions:', error);
      throw error;
    }
  }

  /**
   * Save survey progress
   */
  async saveSurveyProgress(responseId: string, answers: QuestionAnswer[]): Promise<void> {
    try {
      await axios.post(`${API_BASE}/save-progress`, {
        responseId,
        answers
      }, {
        headers: this.getAuthHeaders()
      });
    } catch (error) {
      console.error('Error saving survey progress:', error);
      throw error;
    }
  }
}

export const surveyService = new SurveyService();