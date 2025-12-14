/* eslint-disable no-console -- Service layer uses console for translation debugging */
/* eslint-disable security/detect-object-injection -- Safe object property access with validated language keys */
import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import { API_BASE_URL } from '../utils/apiConfig';
import {
  TranslationRequest,
  TranslationResponse,
  SupportedLanguage,
  TranslationServiceConfig,
  TranslationJob
} from '../types/multilingual';

// Create axios instance with auth interceptor
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

addAuthTokenInterceptor(api);

class TranslationService {
  private config: TranslationServiceConfig;
  private translationEnabled: boolean;

  constructor() {
    this.translationEnabled = import.meta.env.VITE_TRANSLATION_ENABLED === 'true';
    this.config = {
      provider: 'azure'
    };
  }

  private ensureEnabled() {
    if (!this.translationEnabled) {
      throw new Error('Translation feature is disabled');
    }
  }

  /**
   * Translate multiple texts from source language to target languages
   */
  async translateTexts(request: TranslationRequest): Promise<TranslationResponse> {
    try {
      this.ensureEnabled();
      const response = await api.post('/translation/translate', {
        texts: request.texts,
        sourceLanguage: request.sourceLanguage,
        targetLanguages: request.targetLanguages,
        provider: this.config.provider
      });

      return response.data;
    } catch (error) {
      console.error('Translation service error:', error);
      throw error;
    }
  }

  /**
   * Translate a single text to multiple languages
   */
  async translateText(
    text: string, 
    sourceLanguage: SupportedLanguage, 
    targetLanguages: SupportedLanguage[]
  ): Promise<{ [language: string]: string }> {
    const response = await this.translateTexts({
      texts: [text],
      sourceLanguage,
      targetLanguages
    });

    const result: { [language: string]: string } = {};
    for (const [language, translations] of Object.entries(response.translations)) {
      result[language] = translations[0] ?? text;
    }
    
    return result;
  }

  /**
   * Start a translation job for a survey
   */
  async translateSurvey(
    surveyId: string, 
    sourceLanguage: SupportedLanguage, 
    targetLanguages: SupportedLanguage[]
  ): Promise<TranslationJob> {
    try {
      this.ensureEnabled();
      const response = await api.post(`/translation/survey/${surveyId}/translate`, {
        sourceLanguage,
        targetLanguages,
        provider: this.config.provider
      });

      return response.data;
    } catch (error) {
      console.error('Survey translation error:', error);
      throw error;
    }
  }

  /**
   * Start a translation job for a coupon
   */
  async translateCoupon(
    couponId: string, 
    sourceLanguage: SupportedLanguage, 
    targetLanguages: SupportedLanguage[]
  ): Promise<TranslationJob> {
    try {
      this.ensureEnabled();
      const response = await api.post(`/translation/coupon/${couponId}/translate`, {
        sourceLanguage,
        targetLanguages,
        provider: this.config.provider
      });

      return response.data;
    } catch (error) {
      console.error('Coupon translation error:', error);
      throw error;
    }
  }

  /**
   * Get the status of a translation job
   */
  async getTranslationJobStatus(jobId: string): Promise<TranslationJob> {
    try {
      const response = await api.get(`/translation/job/${jobId}`);
      return response.data;
    } catch (error) {
      console.error('Translation job status error:', error);
      throw error;
    }
  }

  /**
   * Alias for getTranslationJobStatus for compatibility
   */
  async getTranslationJob(jobId: string): Promise<TranslationJob> {
    return this.getTranslationJobStatus(jobId);
  }

  /**
   * Get all translation jobs
   */
  async getTranslationJobs(): Promise<TranslationJob[]> {
    try {
      const response = await api.get('/translation/jobs');
      return response.data.jobs ?? [];
    } catch (error) {
      console.error('Translation jobs error:', error);
      throw error;
    }
  }

  /**
   * Get survey with translations
   */
  async getSurveyTranslations(surveyId: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await api.get(`/translation/survey/${surveyId}/translations`);
      return response.data;
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status: number } };
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      console.error('Survey translations error:', error);
      return null;
    }
  }

  /**
   * Get coupon with translations
   */
  async getCouponTranslations(couponId: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await api.get(`/translation/coupon/${couponId}/translations`);
      return response.data;
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status: number } };
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      console.error('Coupon translations error:', error);
      return null;
    }
  }

  /**
   * Get translation service status
   */
  async getServiceStatus(): Promise<{ available: boolean; provider: string; charactersRemaining?: number }> {
    try {
      if (!this.translationEnabled) {
        return { available: false, provider: 'disabled' };
      }
      const response = await api.get('/translation/status');
      return response.data;
    } catch (error) {
      console.error('Service status error:', error);
      return { available: false, provider: 'none' };
    }
  }

  /**
   * Check if translation service is configured
   */
  isConfigured(): boolean {
    return this.translationEnabled;
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return ['th', 'en', 'zh-CN'];
  }

  /**
   * Get language display name
   */
  getLanguageDisplayName(language: SupportedLanguage): string {
    const names: { [key in SupportedLanguage]: string } = {
      'th': 'ไทย',
      'en': 'English',
      'zh-CN': '中文'
    };
    return names[language] ?? language;
  }

  /**
   * Validate if language is supported
   */
  isLanguageSupported(language: string): language is SupportedLanguage {
    return this.getSupportedLanguages().includes(language as SupportedLanguage);
  }

  /**
   * Get default language based on browser locale
   */
  getDefaultLanguage(): SupportedLanguage {
    const browserLang = navigator.language.toLowerCase();
    
    if (browserLang.startsWith('th')) {return 'th';}
    if (browserLang.startsWith('zh')) {return 'zh-CN';}
    return 'en'; // Default fallback
  }

  /**
   * Estimate translation cost (characters)
   */
  estimateTranslationCost(texts: string[], targetLanguageCount: number): number {
    const totalCharacters = texts.reduce((sum, text) => sum + text.length, 0);
    return totalCharacters * targetLanguageCount;
  }

  /**
   * Check if text needs translation
   */
  needsTranslation(text: string): boolean {
    return !!(text && text.trim().length > 0);
  }

  /**
   * Extract translatable texts from survey
   */
  extractSurveyTexts(survey: Record<string, unknown>): string[] {
    const texts: string[] = [];

    if (typeof survey.title === 'string') {texts.push(survey.title);}
    if (typeof survey.description === 'string') {texts.push(survey.description);}

    if (Array.isArray(survey.questions)) {
      survey.questions.forEach((question: unknown) => {
        if (question && typeof question === 'object') {
          const q = question as Record<string, unknown>;
          if (typeof q.text === 'string') {texts.push(q.text);}
          if (typeof q.description === 'string') {texts.push(q.description);}

          if (Array.isArray(q.options)) {
            q.options.forEach((option: unknown) => {
              if (option && typeof option === 'object') {
                const opt = option as Record<string, unknown>;
                if (typeof opt.text === 'string') {texts.push(opt.text);}
              }
            });
          }
        }
      });
    }

    return texts.filter(text => this.needsTranslation(text));
  }

  /**
   * Extract translatable texts from coupon
   */
  extractCouponTexts(coupon: Record<string, unknown>): string[] {
    const texts: string[] = [];

    if (typeof coupon.name === 'string') {texts.push(coupon.name);}
    if (typeof coupon.description === 'string') {texts.push(coupon.description);}
    if (typeof coupon.termsAndConditions === 'string') {texts.push(coupon.termsAndConditions);}

    return texts.filter(text => this.needsTranslation(text));
  }
}

export const translationService = new TranslationService();
