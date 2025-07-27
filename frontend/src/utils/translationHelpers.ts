import { MultilingualText, SupportedLanguage } from '../types/multilingual';

/**
 * Get text in specified language with fallback
 */
export const getTextInLanguage = (
  multilingualText: MultilingualText | string | undefined,
  language: SupportedLanguage,
  fallbackLanguage: SupportedLanguage = 'en'
): string => {
  if (!multilingualText) return '';
  
  if (typeof multilingualText === 'string') {
    return multilingualText;
  }
  
  // Try requested language first
  if (multilingualText[language]) {
    return multilingualText[language];
  }
  
  // Try fallback language
  if (multilingualText[fallbackLanguage]) {
    return multilingualText[fallbackLanguage];
  }
  
  // Try any available language
  const availableLanguages: SupportedLanguage[] = ['th', 'en', 'zh-CN'];
  for (const lang of availableLanguages) {
    if (multilingualText[lang]) {
      return multilingualText[lang];
    }
  }
  
  return '';
};

/**
 * Create multilingual text object from original text
 */
export const createMultilingualText = (
  originalText: string,
  originalLanguage: SupportedLanguage
): MultilingualText => {
  const result: Partial<MultilingualText> = {};
  result[originalLanguage] = originalText;
  
  // Initialize other languages as empty strings
  const allLanguages: SupportedLanguage[] = ['th', 'en', 'zh-CN'];
  allLanguages.forEach(lang => {
    if (lang !== originalLanguage) {
      result[lang] = '';
    }
  });
  
  return result as MultilingualText;
};

/**
 * Update multilingual text with new translation
 */
export const updateMultilingualText = (
  multilingualText: MultilingualText,
  language: SupportedLanguage,
  newText: string
): MultilingualText => {
  return {
    ...multilingualText,
    [language]: newText
  };
};

/**
 * Check if multilingual text has translation for language
 */
export const hasTranslation = (
  multilingualText: MultilingualText | string | undefined,
  language: SupportedLanguage
): boolean => {
  if (!multilingualText) return false;
  
  if (typeof multilingualText === 'string') {
    return true; // String text is considered available for any language
  }
  
  return !!(multilingualText[language] && multilingualText[language].trim().length > 0);
};

/**
 * Get available languages from multilingual text
 */
export const getAvailableLanguages = (
  multilingualText: MultilingualText | string | undefined
): SupportedLanguage[] => {
  if (!multilingualText) return [];
  
  if (typeof multilingualText === 'string') {
    return ['th', 'en', 'zh-CN']; // String text is available for all languages
  }
  
  const languages: SupportedLanguage[] = [];
  const allLanguages: SupportedLanguage[] = ['th', 'en', 'zh-CN'];
  
  allLanguages.forEach(lang => {
    if (multilingualText[lang] && multilingualText[lang].trim().length > 0) {
      languages.push(lang);
    }
  });
  
  return languages;
};

/**
 * Convert legacy string text to multilingual format
 */
export const convertToMultilingual = (
  text: string,
  originalLanguage: SupportedLanguage
): MultilingualText => {
  return createMultilingualText(text, originalLanguage);
};

/**
 * Check if all required languages have translations
 */
export const isFullyTranslated = (
  multilingualText: MultilingualText | string | undefined,
  requiredLanguages: SupportedLanguage[]
): boolean => {
  if (!multilingualText) return false;
  
  if (typeof multilingualText === 'string') {
    return requiredLanguages.length === 1; // String can only satisfy one language
  }
  
  return requiredLanguages.every(lang => hasTranslation(multilingualText, lang));
};

/**
 * Get translation completion percentage
 */
export const getTranslationCompleteness = (
  multilingualText: MultilingualText | string | undefined,
  requiredLanguages: SupportedLanguage[]
): number => {
  if (!multilingualText || requiredLanguages.length === 0) return 0;
  
  if (typeof multilingualText === 'string') {
    return requiredLanguages.length === 1 ? 100 : (100 / requiredLanguages.length);
  }
  
  const translatedCount = requiredLanguages.filter(lang => hasTranslation(multilingualText, lang)).length;
  return Math.round((translatedCount / requiredLanguages.length) * 100);
};

/**
 * Extract all text content that needs translation from an object
 */
export const extractTextForTranslation = (
  obj: any,
  textFields: string[],
  currentLanguage: SupportedLanguage
): string[] => {
  const texts: string[] = [];
  
  const extractFromObject = (item: any, fields: string[]) => {
    fields.forEach(field => {
      if (item[field]) {
        const text = getTextInLanguage(item[field], currentLanguage);
        if (text && text.trim().length > 0) {
          texts.push(text);
        }
      }
    });
  };
  
  if (Array.isArray(obj)) {
    obj.forEach(item => extractFromObject(item, textFields));
  } else {
    extractFromObject(obj, textFields);
  }
  
  return texts;
};

/**
 * Apply translations back to multilingual object
 */
export const applyTranslations = (
  originalObj: any,
  translations: string[],
  textFields: string[],
  targetLanguage: SupportedLanguage,
  originalLanguage: SupportedLanguage
): any => {
  let translationIndex = 0;
  
  const applyToObject = (item: any, fields: string[]) => {
    const result = { ...item };
    
    fields.forEach(field => {
      if (item[field] && translationIndex < translations.length) {
        const currentText = item[field];
        
        if (typeof currentText === 'string') {
          // Convert to multilingual format
          result[field] = createMultilingualText(currentText, originalLanguage);
          result[field][targetLanguage] = translations[translationIndex];
        } else if (currentText && typeof currentText === 'object') {
          // Already multilingual
          result[field] = {
            ...currentText,
            [targetLanguage]: translations[translationIndex]
          };
        }
        
        translationIndex++;
      }
    });
    
    return result;
  };
  
  if (Array.isArray(originalObj)) {
    return originalObj.map(item => applyToObject(item, textFields));
  } else {
    return applyToObject(originalObj, textFields);
  }
};

/**
 * Get language display name
 */
export const getLanguageDisplayName = (language: SupportedLanguage): string => {
  const names: { [key in SupportedLanguage]: string } = {
    'th': 'ไทย',
    'en': 'English',
    'zh-CN': '中文'
  };
  return names[language] || language;
};

/**
 * Validate supported language
 */
export const isValidLanguage = (language: string): language is SupportedLanguage => {
  return ['th', 'en', 'zh-CN'].includes(language as SupportedLanguage);
};

/**
 * Get browser default language
 */
export const getBrowserLanguage = (): SupportedLanguage => {
  const browserLang = navigator.language.toLowerCase();
  
  if (browserLang.startsWith('th')) return 'th';
  if (browserLang.startsWith('zh')) return 'zh-CN';
  return 'en'; // Default fallback
};