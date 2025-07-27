// Multi-language support types for surveys and coupons

export type SupportedLanguage = 'th' | 'en' | 'zh-CN';

export interface MultilingualText {
  th: string;
  en: string;
  'zh-CN': string;
}

export interface TranslationRequest {
  sourceLanguage: SupportedLanguage;
  targetLanguages: SupportedLanguage[];
  texts: string[];
}

export interface TranslationResponse {
  translations: {
    [language: string]: string[];
  };
  originalTexts: string[];
  sourceLanguage: string;
}

// Extended survey types with multi-language support
export interface MultilingualQuestionOption {
  id: string;
  text: MultilingualText;
  value: string | number;
}

export interface MultilingualSurveyQuestion {
  id: string;
  type: import('./survey').QuestionType;
  text: MultilingualText;
  description?: MultilingualText;
  required: boolean;
  options?: MultilingualQuestionOption[];
  min_rating?: number;
  max_rating?: number;
  order: number;
}

export interface MultilingualSurvey {
  id: string;
  title: MultilingualText;
  description?: MultilingualText;
  questions: MultilingualSurveyQuestion[];
  target_segment: import('./survey').TargetSegment;
  status: import('./survey').SurveyStatus;
  access_type: import('./survey').SurveyAccessType;
  scheduled_start?: string;
  scheduled_end?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  // Translation metadata
  originalLanguage: SupportedLanguage;
  availableLanguages: SupportedLanguage[];
  lastTranslated?: string;
  translationStatus: 'none' | 'pending' | 'completed' | 'error';
}

// Extended coupon types with multi-language support
export interface MultilingualCoupon {
  id: string;
  code: string;
  name: MultilingualText;
  description?: MultilingualText;
  termsAndConditions?: MultilingualText;
  type: import('./coupon').CouponType;
  value?: number;
  currency: string;
  minimumSpend?: number;
  maximumDiscount?: number;
  
  // Availability
  validFrom: string;
  validUntil?: string;
  usageLimit?: number;
  usageLimitPerUser: number;
  usedCount: number;
  
  // Targeting
  tierRestrictions: string[];
  customerSegment: Record<string, any>;
  
  // Metadata
  status: import('./coupon').CouponStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  
  // Translation metadata
  originalLanguage: SupportedLanguage;
  availableLanguages: SupportedLanguage[];
  lastTranslated?: string;
  translationStatus: 'none' | 'pending' | 'completed' | 'error';
}

// Request types for creating multilingual content
export interface CreateMultilingualSurveyRequest {
  title: string;
  description?: string;
  questions: Array<{
    type: import('./survey').QuestionType;
    text: string;
    description?: string;
    required: boolean;
    options?: Array<{
      text: string;
      value: string | number;
    }>;
    min_rating?: number;
    max_rating?: number;
  }>;
  target_segment?: import('./survey').TargetSegment;
  access_type: import('./survey').SurveyAccessType;
  status?: import('./survey').SurveyStatus;
  scheduled_start?: string;
  scheduled_end?: string;
  originalLanguage: SupportedLanguage;
  autoTranslate?: boolean;
  targetLanguages?: SupportedLanguage[];
}

export interface CreateMultilingualCouponRequest {
  code: string;
  name: string;
  description?: string;
  termsAndConditions?: string;
  type: import('./coupon').CouponType;
  value?: number;
  currency?: string;
  minimumSpend?: number;
  maximumDiscount?: number;
  validFrom?: string;
  validUntil?: string;
  usageLimit?: number;
  usageLimitPerUser?: number;
  tierRestrictions?: string[];
  customerSegment?: Record<string, any>;
  originalLanguage: SupportedLanguage;
  autoTranslate?: boolean;
  targetLanguages?: SupportedLanguage[];
}

// Translation service types
export interface TranslationServiceConfig {
  provider: 'azure' | 'google' | 'libretranslate';
  apiKey?: string;
  endpoint?: string;
  region?: string;
}

export interface TranslationJob {
  id: string;
  entityType: 'survey' | 'coupon';
  entityId: string;
  sourceLanguage: SupportedLanguage;
  targetLanguages: SupportedLanguage[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// UI component props
export interface LanguageTabsProps {
  languages: SupportedLanguage[];
  currentLanguage: SupportedLanguage;
  onLanguageChange: (language: SupportedLanguage) => void;
  translationStatus: { [key in SupportedLanguage]?: 'original' | 'translated' | 'pending' | 'error' };
}

export interface TranslationButtonProps {
  onTranslate: () => void;
  isTranslating: boolean;
  disabled?: boolean;
  availableLanguages: SupportedLanguage[];
}

// Helper function types
export type GetTextInLanguage = (
  multilingualText: MultilingualText | string | undefined,
  language: SupportedLanguage,
  fallbackLanguage?: SupportedLanguage
) => string;

export type CreateMultilingualText = (
  originalText: string,
  originalLanguage: SupportedLanguage
) => MultilingualText;