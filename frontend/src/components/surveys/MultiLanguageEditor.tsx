import React, { useEffect, useState } from 'react';
import { FiGlobe, FiPlus, FiTrash2, FiCheck } from 'react-icons/fi';

interface Language {
  code: string;
  name: string;
  flag: string;
}

interface MultiLanguageEditorProps {
  value: Record<string, string>;
  onChange: (translations: Record<string, string>) => void;
  label: string;
  placeholder?: string;
  type?: 'text' | 'textarea';
  required?: boolean;
}

const supportedLanguages: Language[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'th', name: 'ไทย (Thai)', flag: '🇹🇭' },
  { code: 'zh', name: '中文 (Chinese)', flag: '🇨🇳' },
  { code: 'ja', name: '日本語 (Japanese)', flag: '🇯🇵' },
  { code: 'ko', name: '한국어 (Korean)', flag: '🇰🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
];

const MultiLanguageEditor: React.FC<MultiLanguageEditorProps> = ({
  value = {},
  onChange,
  label,
  placeholder,
  type = 'text',
  required = false
}) => {
  const initializeTranslations = (initialValue: Record<string, string>) => ({
    en: initialValue?.en ?? '',
    ...initialValue
  });

  const [translations, setTranslations] = useState<Record<string, string>>(initializeTranslations(value));
  const [activeTab, setActiveTab] = useState<string>('en');
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  useEffect(() => {
    setTranslations(initializeTranslations(value));
  }, [value]);

  useEffect(() => {
    if (activeTab !== 'en' && translations[activeTab] === undefined) {
      setActiveTab('en');
    }
  }, [activeTab, translations]);
  
  // Get currently enabled languages
  const enabledLanguages = supportedLanguages.filter(lang => 
    translations[lang.code] !== undefined || lang.code === 'en'
  );
  
  // Get available languages to add
  const availableToAdd = supportedLanguages.filter(lang => 
    !enabledLanguages.some(enabled => enabled.code === lang.code)
  );

  const handleTextChange = (langCode: string, text: string) => {
    setTranslations(prev => {
      const newTranslations = {
        ...prev,
        [langCode]: text
      };
      onChange(newTranslations);
      return newTranslations;
    });
  };

  const addLanguage = (langCode: string) => {
    setTranslations(prev => {
      const newTranslations = {
        ...prev,
        [langCode]: prev['en'] ?? '' // Default to English text
      };
      onChange(newTranslations);
      return newTranslations;
    });

    setActiveTab(langCode);
    setShowLanguageSelector(false);
  };

  const removeLanguage = (langCode: string) => {
    if (langCode === 'en') {return;} // Don't allow removing English
    
    setTranslations(prev => {
      const newTranslations = { ...prev };
      delete newTranslations[langCode];
      onChange(newTranslations);
      return newTranslations;
    });
    
    if (activeTab === langCode) {
      setActiveTab('en');
    }
  };

  // Provide a safe fallback - supportedLanguages always has 'en' as first element
  const currentLang = supportedLanguages.find(lang => lang.code === activeTab) ?? supportedLanguages[0] ?? { code: 'en', name: 'English', flag: '🇺🇸' };
  const currentText = translations[activeTab] ?? '';

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {/* Language Tabs */}
      <div className="flex items-center space-x-2 border-b border-gray-200">
        <div className="flex space-x-1">
          {enabledLanguages.map(lang => {
            const isActive = activeTab === lang.code;
            return (
              <div key={lang.code} className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setActiveTab(lang.code)}
                  className={`px-3 py-2 text-sm font-medium rounded-t-md flex items-center space-x-2 ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-500'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <span>{lang.flag}</span>
                    <span>{lang.name}</span>
                    {translations[lang.code] && (
                      <FiCheck className="h-3 w-3 text-green-500" />
                    )}
                  </span>
                  {lang.code !== 'en' && (
                    <button
                      type="button"
                      aria-label={`Remove ${lang.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeLanguage(lang.code);
                      }}
                      className="p-1 text-red-500 hover:text-red-700"
                    >
                      <FiTrash2 className="h-3 w-3" />
                    </button>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Add Language Button */}
        {availableToAdd.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowLanguageSelector(!showLanguageSelector)}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
            >
              <FiPlus className="h-4 w-4" />
              <FiGlobe className="h-4 w-4" />
            </button>

            {showLanguageSelector && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-20">
                <div className="p-2">
                  <p className="text-xs text-gray-500 mb-2">Add Language:</p>
                  {availableToAdd.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => addLanguage(lang.code)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 rounded flex items-center space-x-2"
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Text Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Editing: {currentLang.flag} {currentLang.name}
          </span>
          {activeTab !== 'en' && translations['en'] && (
            <button
              type="button"
              onClick={() => handleTextChange(activeTab, translations['en'] ?? '')}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Copy from English
            </button>
          )}
        </div>

        {type === 'textarea' ? (
          <textarea
            value={currentText}
            onChange={(e) => handleTextChange(activeTab, e.target.value)}
            placeholder={placeholder ? `${placeholder} (${currentLang.name})` : `Enter text in ${currentLang.name}...`}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        ) : (
          <input
            type="text"
            value={currentText}
            onChange={(e) => handleTextChange(activeTab, e.target.value)}
            placeholder={placeholder ? `${placeholder} (${currentLang.name})` : `Enter text in ${currentLang.name}...`}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}
      </div>
      
      {/* Translation Status */}
      <div className="text-xs text-gray-500">
        <div className="flex items-center space-x-4">
          <span>
            Translations: {Object.keys(translations).filter(key => translations[key]?.trim()).length} / {enabledLanguages.length}
          </span>
          <div className="flex space-x-1">
            {enabledLanguages.map(lang => (
              <span
                key={lang.code}
                className={`inline-block w-2 h-2 rounded-full ${
                  translations[lang.code]?.trim() ? 'bg-green-400' : 'bg-gray-300'
                }`}
                title={`${lang.name}: ${translations[lang.code]?.trim() ? 'Translated' : 'Missing'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiLanguageEditor;
