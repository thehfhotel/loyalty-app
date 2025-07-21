import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface LanguageProviderProps {
  children: React.ReactNode;
}

export default function LanguageProvider({ children }: LanguageProviderProps) {
  const { i18n } = useTranslation();

  useEffect(() => {
    // Update HTML lang attribute when language changes
    document.documentElement.lang = i18n.language;
    
    // Update document title based on language
    const titleMap: Record<string, string> = {
      en: 'Hotel Loyalty App',
      th: 'แอปสะสมคะแนนโรงแรม'
    };
    
    document.title = titleMap[i18n.language] || titleMap.en;
    
    // Add class to body for language-specific styling
    document.body.className = document.body.className.replace(/lang-\w+/g, '');
    document.body.classList.add(`lang-${i18n.language}`);
  }, [i18n.language]);

  return <>{children}</>;
}