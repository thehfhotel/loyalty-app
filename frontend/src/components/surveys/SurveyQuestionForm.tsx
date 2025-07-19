import React, { useState, useEffect } from 'react';
import { AlertCircle, Star } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card, CardContent } from '../ui/Card';
import { SurveyQuestion, surveyService } from '../../services/surveyService';

interface SurveyQuestionFormProps {
  question: SurveyQuestion;
  initialAnswer?: any;
  onAnswerChange: (answer: any) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  showNavigation?: boolean;
}

export const SurveyQuestionForm: React.FC<SurveyQuestionFormProps> = ({
  question,
  initialAnswer,
  onAnswerChange,
  onNext,
  onPrevious,
  isFirst = false,
  isLast = false,
  showNavigation = true
}) => {
  const [answer, setAnswer] = useState<any>(initialAnswer);
  const [error, setError] = useState<string>('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setAnswer(initialAnswer);
  }, [initialAnswer]);

  const handleAnswerChange = (newAnswer: any) => {
    setAnswer(newAnswer);
    setTouched(true);
    setError('');
    onAnswerChange(newAnswer);
  };

  const validateAndNext = () => {
    setTouched(true);
    const validation = surveyService.validateAnswer(question, answer);
    
    if (!validation.isValid) {
      setError(validation.error || 'Invalid answer');
      return;
    }
    
    setError('');
    if (onNext) {
      onNext();
    }
  };

  const renderQuestionInput = () => {
    switch (question.type) {
      case 'text':
        return (
          <textarea
            value={answer || ''}
            onChange={(e) => handleAnswerChange(e.target.value)}
            placeholder="Enter your answer..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            rows={4}
            maxLength={1000}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={answer || ''}
            onChange={(e) => handleAnswerChange(parseFloat(e.target.value) || null)}
            placeholder="Enter a number..."
            error={touched && error ? error : undefined}
          />
        );

      case 'boolean':
        return (
          <div className="space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name={`question-${question.id}`}
                checked={answer === true}
                onChange={() => handleAnswerChange(true)}
                className="w-4 h-4 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-gray-900">Yes</span>
            </label>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name={`question-${question.id}`}
                checked={answer === false}
                onChange={() => handleAnswerChange(false)}
                className="w-4 h-4 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-gray-900">No</span>
            </label>
          </div>
        );

      case 'single_choice':
        return (
          <div className="space-y-3">
            {question.options?.map((option, index) => (
              <label key={index} className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  checked={answer === option}
                  onChange={() => handleAnswerChange(option)}
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-gray-900">{option}</span>
              </label>
            ))}
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="space-y-3">
            {question.options?.map((option, index) => (
              <label key={index} className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Array.isArray(answer) && answer.includes(option)}
                  onChange={(e) => {
                    const currentAnswers = Array.isArray(answer) ? [...answer] : [];
                    if (e.target.checked) {
                      handleAnswerChange([...currentAnswers, option]);
                    } else {
                      handleAnswerChange(currentAnswers.filter(a => a !== option));
                    }
                  }}
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 rounded"
                />
                <span className="text-gray-900">{option}</span>
              </label>
            ))}
          </div>
        );

      case 'rating':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => handleAnswerChange(rating)}
                  className={`p-2 rounded-lg transition-colors ${
                    answer >= rating
                      ? 'text-yellow-500 bg-yellow-50'
                      : 'text-gray-300 hover:text-yellow-400 hover:bg-gray-50'
                  }`}
                >
                  <Star className={`w-8 h-8 ${answer >= rating ? 'fill-current' : ''}`} />
                </button>
              ))}
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Very Poor</span>
              <span>Excellent</span>
            </div>
            {answer && (
              <div className="text-sm text-primary-600 font-medium">
                Rating: {answer} out of 5
              </div>
            )}
          </div>
        );

      default:
        return (
          <div className="text-red-600">
            Unsupported question type: {question.type}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="space-y-6">
            {/* Question Header */}
            <div>
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-900 leading-tight">
                  {question.title}
                  {question.isRequired && (
                    <span className="text-red-500 ml-1">*</span>
                  )}
                </h3>
                <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  {surveyService.getQuestionTypeDisplayName(question.type)}
                </span>
              </div>
              
              {question.description && (
                <p className="text-gray-600 text-sm leading-relaxed">
                  {question.description}
                </p>
              )}
            </div>

            {/* Question Input */}
            <div className="space-y-2">
              {renderQuestionInput()}
              
              {/* Character count for text fields */}
              {question.type === 'text' && answer && (
                <div className="text-xs text-gray-500 text-right">
                  {answer.length} / 1000 characters
                </div>
              )}
            </div>

            {/* Error Message */}
            {touched && error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <span className="text-sm text-red-800">{error}</span>
              </div>
            )}

            {/* Required Field Notice */}
            {question.isRequired && !touched && (
              <div className="text-sm text-gray-600">
                <span className="text-red-500">*</span> This question is required
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      {showNavigation && (
        <div className="flex justify-between">
          <Button
            variant="secondary"
            onClick={onPrevious}
            disabled={isFirst}
          >
            Previous
          </Button>
          
          <Button
            variant="primary"
            onClick={isLast ? validateAndNext : validateAndNext}
          >
            {isLast ? 'Complete Survey' : 'Next'}
          </Button>
        </div>
      )}
    </div>
  );
};