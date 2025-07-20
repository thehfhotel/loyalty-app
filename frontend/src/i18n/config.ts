import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations directly
import enTranslations from './locales/en/translation.json';
import thTranslations from './locales/th/translation.json';

export const defaultNS = 'translation';
export const resources = {
  en: {
    translation: enTranslations,
  },
  th: {
    translation: thTranslations,
  },
} as const;

i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Initialize i18next
  .init({
    debug: false, // Disable debug mode for cleaner console output
    fallbackLng: 'en',
    lng: 'th', // Default to Thai
    defaultNS,
    ns: [defaultNS],
    
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    
    // Use bundled translations instead of loading from backend
    resources,
    
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;