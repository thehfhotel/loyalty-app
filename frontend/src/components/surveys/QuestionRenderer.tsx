import React from 'react';
import { SurveyQuestion } from '../../types/survey';
import { useTranslation } from 'react-i18next';

interface QuestionRendererProps {
  question: SurveyQuestion;
  answer: any;
  onAnswerChange: (questionId: string, answer: any) => void;
  error?: string;
}

const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  answer,
  onAnswerChange,
  error
}) => {
  const { t } = useTranslation();

  const handleAnswerChange = (value: any) => {
    onAnswerChange(question.id, value);
  };

  const renderQuestion = () => {
    switch (question.type) {
      case 'single_choice':
        return (
          <div className="space-y-3">
            {question.options?.map((option) => {
              // Convert both to strings for comparison to handle type mismatches
              const isChecked = String(answer) === String(option.value);
              return (
                <label key={option.id} className="flex items-center cursor-pointer hover:bg-gray-50 p-2 rounded-md transition-colors">
                  <input
                    type="radio"
                    name={`question_${question.id}`}
                    value={option.value}
                    checked={isChecked}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                    className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 focus:ring-2 border-gray-300"
                  />
                  <span className={`text-gray-700 select-none ${isChecked ? 'font-medium text-blue-700' : ''}`}>{option.text}</span>
                </label>
              );
            })}
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="space-y-3">
            {question.options?.map((option) => (
              <label key={option.id} className="flex items-center cursor-pointer hover:bg-gray-50 p-2 rounded-md transition-colors">
                <input
                  type="checkbox"
                  checked={Array.isArray(answer) && answer.includes(option.value)}
                  onChange={(e) => {
                    const currentAnswers = Array.isArray(answer) ? answer : [];
                    if (e.target.checked) {
                      handleAnswerChange([...currentAnswers, option.value]);
                    } else {
                      handleAnswerChange(currentAnswers.filter(a => a !== option.value));
                    }
                  }}
                  className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 focus:ring-2 border-gray-300 rounded"
                />
                <span className={`text-gray-700 select-none ${Array.isArray(answer) && answer.includes(option.value) ? 'font-medium text-blue-700' : ''}`}>{option.text}</span>
              </label>
            ))}
          </div>
        );

      case 'text':
        return (
          <input
            type="text"
            value={answer || ''}
            onChange={(e) => handleAnswerChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={t('surveys.enterAnswer', 'Enter your answer...')}
          />
        );

      case 'textarea':
        return (
          <textarea
            value={answer || ''}
            onChange={(e) => handleAnswerChange(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={t('surveys.enterAnswer', 'Enter your answer...')}
          />
        );

      case 'rating_5':
        return (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-500">1</span>
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => handleAnswerChange(rating)}
                className={`w-10 h-10 rounded-full border-2 font-medium transition-colors ${
                  Number(answer) === rating
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                }`}
              >
                {rating}
              </button>
            ))}
            <span className="text-sm text-gray-500">5</span>
          </div>
        );

      case 'rating_10':
        return (
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => handleAnswerChange(rating)}
                className={`w-12 h-10 rounded border-2 font-medium transition-colors ${
                  Number(answer) === rating
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                }`}
              >
                {rating}
              </button>
            ))}
          </div>
        );

      case 'yes_no':
        return (
          <div className="flex space-x-4">
            <label className="flex items-center cursor-pointer hover:bg-gray-50 p-2 rounded-md transition-colors">
              <input
                type="radio"
                name={`question_${question.id}`}
                value="yes"
                checked={String(answer) === 'yes'}
                onChange={(e) => handleAnswerChange(e.target.value)}
                className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 focus:ring-2 border-gray-300"
              />
              <span className={`text-gray-700 select-none ${String(answer) === 'yes' ? 'font-medium text-blue-700' : ''}`}>{t('common.yes', 'Yes')}</span>
            </label>
            <label className="flex items-center cursor-pointer hover:bg-gray-50 p-2 rounded-md transition-colors">
              <input
                type="radio"
                name={`question_${question.id}`}
                value="no"
                checked={String(answer) === 'no'}
                onChange={(e) => handleAnswerChange(e.target.value)}
                className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 focus:ring-2 border-gray-300"
              />
              <span className={`text-gray-700 select-none ${String(answer) === 'no' ? 'font-medium text-blue-700' : ''}`}>{t('common.no', 'No')}</span>
            </label>
          </div>
        );

      default:
        return (
          <div className="text-red-500">
            {t('surveys.unknownQuestionType', 'Unknown question type')}: {question.type}
          </div>
        );
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-4">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {question.text}
          {question.required && <span className="text-red-500 ml-1">*</span>}
        </h3>
        {question.description && (
          <p className="text-sm text-gray-600 mb-3">{question.description}</p>
        )}
      </div>

      {renderQuestion()}

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};

export default QuestionRenderer;