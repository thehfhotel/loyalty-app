import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiGlobe, FiRefreshCw } from 'react-icons/fi';
import { SupportedLanguage } from '../../types/multilingual';

interface TranslationButtonProps {
  onTranslate: (targetLanguages: SupportedLanguage[]) => void;
  isTranslating: boolean;
  disabled?: boolean;
  availableLanguages?: SupportedLanguage[];
  originalLanguage: SupportedLanguage;
}

const TranslationButton: React.FC<TranslationButtonProps> = ({
  onTranslate,
  isTranslating,
  disabled = false,
  availableLanguages = ['th'],
  originalLanguage
}) => {
  const { t } = useTranslation();
  const [showLanguageSelection, setShowLanguageSelection] = useState(false);
  const [selectedLanguages, setSelectedLanguages] = useState<SupportedLanguage[]>([]);

  const allLanguages: SupportedLanguage[] = ['th', 'en', 'zh-CN'];
  const targetLanguages = allLanguages.filter(lang => lang !== originalLanguage);

  const getLanguageDisplayName = (language: SupportedLanguage): string => {
    const names: { [key in SupportedLanguage]: string } = {
      'th': 'ไทย',
      'en': 'English',
      'zh-CN': '中文'
    };
    return names[language] ?? language;
  };

  const handleStartTranslation = () => {
    setShowLanguageSelection(true);
    // Pre-select untranslated languages
    const untranslatedLanguages = targetLanguages.filter(lang => !availableLanguages.includes(lang));
    setSelectedLanguages(untranslatedLanguages);
  };

  const handleLanguageToggle = (language: SupportedLanguage) => {
    setSelectedLanguages(prev => 
      prev.includes(language)
        ? prev.filter(l => l !== language)
        : [...prev, language]
    );
  };

  const handleConfirmTranslation = () => {
    if (selectedLanguages.length > 0) {
      onTranslate(selectedLanguages);
      setShowLanguageSelection(false);
      setSelectedLanguages([]);
    }
  };

  const handleCancel = () => {
    setShowLanguageSelection(false);
    setSelectedLanguages([]);
  };

  const isFirstTranslation = availableLanguages.length === 1;

  if (showLanguageSelection) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <h3 className="text-sm font-medium text-gray-900 mb-3">
          {isFirstTranslation ? 'Select languages to translate to:' : 'Select languages to update:'}
        </h3>
        
        <div className="space-y-2 mb-4">
          {targetLanguages.map((language) => {
            const isTranslated = availableLanguages.includes(language);
            return (
              <label key={language} className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedLanguages.includes(language)}
                  onChange={() => handleLanguageToggle(language)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">
                  {getLanguageDisplayName(language)}
                  {isTranslated && (
                    <span className="ml-1 text-xs text-green-600">(translated)</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex justify-end space-x-2">
          <button
            onClick={handleCancel}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmTranslation}
            disabled={selectedLanguages.length === 0}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFirstTranslation ? 'Translate' : 'Update Translations'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleStartTranslation}
      disabled={disabled || isTranslating}
      className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isTranslating ? (
        <>
          <FiRefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Translating...
        </>
      ) : (
        <>
          <FiGlobe className="mr-2 h-4 w-4" />
          {isFirstTranslation ? 'Translate' : 'Update Translations'}
        </>
      )}
    </button>
  );
};

export default TranslationButton;