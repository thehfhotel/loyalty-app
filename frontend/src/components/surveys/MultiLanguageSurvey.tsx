import React, { useState } from 'react';
import { FiGlobe } from 'react-icons/fi';
import { SurveyQuestion } from '../../types/survey';

interface MultiLanguageQuestion extends Omit<SurveyQuestion, 'text' | 'description' | 'options'> {
  text: Record<string, string>;
  description?: Record<string, string>;
  options?: Array<{
    id: string;
    text: Record<string, string>;
    value: string | number;
  }>;
}

interface MultiLanguageSurveyProps {
  questions: MultiLanguageQuestion[];
  onLanguageChange: (language: string) => void;
  currentLanguage: string;
  availableLanguages: { code: string; name: string; flag: string }[];
}

const MultiLanguageSurvey: React.FC<MultiLanguageSurveyProps> = ({
  questions,
  onLanguageChange,
  currentLanguage,
  availableLanguages
}) => {
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  // Provide a safe fallback in case availableLanguages is empty
  const fallbackLang = { code: 'en', name: 'English', flag: '🇺🇸' };
  const currentLang = availableLanguages.find(lang => lang.code === currentLanguage) ?? availableLanguages[0] ?? fallbackLang;

  const getTranslatedText = (textObj: Record<string, string> | string, fallback = '') => {
    if (typeof textObj === 'string') {return textObj;}
    return textObj[currentLanguage] || textObj['en'] || fallback;
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Language Selector */}
      <div className="mb-6">
        <div className="relative">
          <button
            onClick={() => setShowLanguageSelector(!showLanguageSelector)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FiGlobe className="mr-2 h-4 w-4" />
            <span className="mr-2">{currentLang.flag}</span>
            {currentLang.name}
            <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showLanguageSelector && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
              {availableLanguages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => {
                    onLanguageChange(lang.code);
                    setShowLanguageSelector(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center ${
                    lang.code === currentLanguage ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  <span className="mr-3">{lang.flag}</span>
                  {lang.name}
                  {lang.code === currentLanguage && (
                    <svg className="ml-auto h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-6">
        {questions.map((question, index) => (
          <div key={question.id} className="bg-white rounded-lg shadow p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {index + 1}. {getTranslatedText(question.text)}
                {question.required && <span className="text-red-500 ml-1">*</span>}
              </h3>
              {question.description && (
                <p className="mt-1 text-sm text-gray-600">
                  {getTranslatedText(question.description)}
                </p>
              )}
            </div>

            {/* Question Type Display */}
            <div className="text-xs text-gray-500 mb-2">
              Question Type: {question.type.replace('_', ' ').toUpperCase()}
            </div>

            {/* Options for choice questions */}
            {(question.type === 'single_choice' || question.type === 'multiple_choice') && question.options && (
              <div className="space-y-2">
                {question.options.map(option => (
                  <div key={option.id} className="flex items-center">
                    <input
                      type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                      id={`${question.id}_${option.id}`}
                      name={question.id}
                      value={option.value}
                      className="mr-3"
                      disabled
                    />
                    <label htmlFor={`${question.id}_${option.id}`} className="text-sm text-gray-700">
                      {getTranslatedText(option.text)}
                    </label>
                  </div>
                ))}
              </div>
            )}

            {/* Text inputs */}
            {question.type === 'text' && (
              <input
                type="text"
                placeholder={`Your answer in ${currentLang.name}...`}
                className="w-full p-2 border border-gray-300 rounded-md"
                disabled
              />
            )}

            {question.type === 'textarea' && (
              <textarea
                placeholder={`Your answer in ${currentLang.name}...`}
                rows={4}
                className="w-full p-2 border border-gray-300 rounded-md"
                disabled
              />
            )}

            {/* Rating scales */}
            {(question.type === 'rating_5' || question.type === 'rating_10') && (
              <div className="flex space-x-2">
                {Array.from({ length: question.type === 'rating_5' ? 5 : 10 }, (_, i) => (
                  <button
                    key={i}
                    className="w-10 h-10 border border-gray-300 rounded-md text-sm text-gray-500 hover:bg-gray-100"
                    disabled
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Yes/No */}
            {question.type === 'yes_no' && (
              <div className="space-x-4">
                <label className="inline-flex items-center">
                  <input type="radio" name={question.id} value="yes" className="mr-2" disabled />
                  Yes
                </label>
                <label className="inline-flex items-center">
                  <input type="radio" name={question.id} value="no" className="mr-2" disabled />
                  No
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Language Status */}
      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <div className="flex items-center">
          <FiGlobe className="h-5 w-5 text-blue-600 mr-2" />
          <div>
            <p className="text-sm font-medium text-blue-900">
              Multi-Language Survey Preview
            </p>
            <p className="text-xs text-blue-700 mt-1">
              Currently showing: {currentLang.name}.
              Survey supports {availableLanguages.length} languages.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiLanguageSurvey;