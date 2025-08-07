import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import { 
  TranslationRequest, 
  TranslationResponse, 
  SupportedLanguage, 
  TranslationServiceConfig,
  TranslationJob 
} from '../types/multilingual';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4001/api';

// Create axios instance with auth interceptor
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

addAuthTokenInterceptor(api);

class TranslationService {
  private config: TranslationServiceConfig;

  constructor() {
    // Default to Azure Translator for the generous free tier
    this.config = {
      provider: 'azure',
      apiKey: import.meta.env.VITE_AZURE_TRANSLATION_KEY_1,
      endpoint: import.meta.env.VITE_AZURE_TRANSLATION_TEXT_URI ?? 'https://api.cognitive.microsofttranslator.com',
      region: import.meta.env.VITE_AZURE_TRANSLATION_REGION ?? 'global'
    };
  }

  /**
   * Translate multiple texts from source language to target languages
   */
  async translateTexts(request: TranslationRequest): Promise<TranslationResponse> {
    try {
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
  async getSurveyTranslations(surveyId: string): Promise<any> {
    try {
      const response = await api.get(`/translation/survey/${surveyId}/translations`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('Survey translations error:', error);
      return null;
    }
  }

  /**
   * Get coupon with translations
   */
  async getCouponTranslations(couponId: string): Promise<any> {
    try {
      const response = await api.get(`/translation/coupon/${couponId}/translations`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
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
    return !!(this.config.apiKey ?? this.config.endpoint);
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
  extractSurveyTexts(survey: any): string[] {
    const texts: string[] = [];
    
    if (survey.title) {texts.push(survey.title);}
    if (survey.description) {texts.push(survey.description);}
    
    survey.questions?.forEach((question: any) => {
      if (question.text) {texts.push(question.text);}
      if (question.description) {texts.push(question.description);}
      
      question.options?.forEach((option: any) => {
        if (option.text) {texts.push(option.text);}
      });
    });
    
    return texts.filter(text => this.needsTranslation(text));
  }

  /**
   * Extract translatable texts from coupon
   */
  extractCouponTexts(coupon: any): string[] {
    const texts: string[] = [];
    
    if (coupon.name) {texts.push(coupon.name);}
    if (coupon.description) {texts.push(coupon.description);}
    if (coupon.termsAndConditions) {texts.push(coupon.termsAndConditions);}
    
    return texts.filter(text => this.needsTranslation(text));
  }
}

export const translationService = new TranslationService();