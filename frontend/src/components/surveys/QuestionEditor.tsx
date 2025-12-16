import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiMove, FiPlus, FiX } from 'react-icons/fi';
import { SurveyQuestion, QuestionOption } from '../../types/survey';
import { surveyService } from '../../services/surveyService';

interface QuestionEditorProps {
  question: SurveyQuestion;
  index: number;
  questionNumber: number;
  onUpdate: (updates: Partial<SurveyQuestion>) => void;
  onRemove: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  canMove: boolean;
  disabled?: boolean;
}

const QuestionEditor: React.FC<QuestionEditorProps> = ({
  question,
  index,
  questionNumber: _questionNumber,
  onUpdate,
  onRemove,
  onReorder,
  canMove,
  disabled = false
}) => {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const ratingDefaults = question.type === 'rating_10'
    ? { min: 1, max: 10 }
    : { min: 1, max: 5 };

  const [questionText, setQuestionText] = useState(question.text ?? '');
  const [description, setDescription] = useState(question.description ?? '');
  const [options, setOptions] = useState<QuestionOption[]>(question.options ?? []);
  const [minRating, setMinRating] = useState<string>((question.min_rating ?? ratingDefaults.min).toString());
  const [maxRating, setMaxRating] = useState<string>((question.max_rating ?? ratingDefaults.max).toString());
  const [isRequired, setIsRequired] = useState<boolean>(question.required ?? false);

  useEffect(() => {
    const defaults = question.type === 'rating_10'
      ? { min: 1, max: 10 }
      : { min: 1, max: 5 };

    setQuestionText(question.text ?? '');
    setDescription(question.description ?? '');
    setOptions(question.options ?? []);
    setMinRating((question.min_rating ?? defaults.min).toString());
    setMaxRating((question.max_rating ?? defaults.max).toString());
    setIsRequired(question.required ?? false);
  }, [question]);

  const handleQuestionTextChange = (text: string) => {
    setQuestionText(text);
    onUpdate({ text });
  };

  const handleDescriptionChange = (newDescription: string) => {
    setDescription(newDescription);
    onUpdate({ description: newDescription });
  };

  const addOption = () => {
    setOptions(prevOptions => {
      const safeOptions = prevOptions ?? [];
      const newOption: QuestionOption = {
        id: surveyService.generateOptionId(),
        text: t('surveys.admin.questionEditor.newOptionText', { number: safeOptions.length + 1 }),
        value: (safeOptions.length + 1).toString() // Auto-generate sequential numeric value
      };

      const updatedOptions = [...safeOptions, newOption];
      onUpdate({ options: updatedOptions });
      return updatedOptions;
    });
  };

  const updateOption = (optionId: string, field: 'text' | 'value', value: string) => {
    if (field === 'value') {return;}

    setOptions(prevOptions => {
      const updatedOptions = (prevOptions ?? []).map((option, index) =>
        option.id === optionId
          ? { ...option, text: value, value: (index + 1).toString() } // Keep value as sequential number
          : option
      );

      onUpdate({ options: updatedOptions });
      return updatedOptions;
    });
  };

  const removeOption = (optionId: string) => {
    setOptions(prevOptions => {
      if (!prevOptions || prevOptions.length <= 2) {return prevOptions;}

      // Re-index values when removing an option
      const filteredOptions = prevOptions
        .filter(option => option.id !== optionId)
        .map((option, index) => ({
          ...option,
          value: (index + 1).toString() // Re-index values sequentially
        }));

      onUpdate({ options: filteredOptions });
      return filteredOptions;
    });
  };

  const handleRequiredToggle = (checked: boolean) => {
    setIsRequired(checked);
    onUpdate({ required: checked });
  };

  const handleMinRatingChange = (value: string) => {
    setMinRating(value);
    const parsed = Number.parseInt(value, 10);

    if (!Number.isNaN(parsed)) {
      onUpdate({ min_rating: parsed });
    }
  };

  const handleMaxRatingChange = (value: string) => {
    setMaxRating(value);
    const parsed = Number.parseInt(value, 10);

    if (!Number.isNaN(parsed)) {
      onUpdate({ max_rating: parsed });
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', index.toString());
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
    if (fromIndex !== index) {
      onReorder(fromIndex, index);
    }
  };

  const getQuestionTypeLabel = (type: string) => {
    switch (type) {
      case 'single_choice': return t('surveys.admin.questionEditor.questionTypes.singleChoice');
      case 'multiple_choice': return t('surveys.admin.questionEditor.questionTypes.multipleChoice');
      case 'text': return t('surveys.admin.questionEditor.questionTypes.text');
      case 'textarea': return t('surveys.admin.questionEditor.questionTypes.textarea');
      case 'rating_5': return t('surveys.admin.questionEditor.questionTypes.rating5');
      case 'rating_10': return t('surveys.admin.questionEditor.questionTypes.rating10');
      case 'yes_no': return t('surveys.admin.questionEditor.questionTypes.yesNo');
      default: return type;
    }
  };

  const parsedMaxRating = Number.parseInt(maxRating, 10);
  const displayMaxRating = Number.isNaN(parsedMaxRating) ? ratingDefaults.max : parsedMaxRating;

  return (
    <div
      className={`border rounded-lg p-4 bg-white ${isDragging ? 'opacity-50' : ''}`}
      draggable={canMove}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-question-id={question.id}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-2">
          {canMove && (
            <button
              role="presentation"
              className="p-1 text-gray-400 hover:text-gray-600 cursor-move"
            >
              <FiMove className="h-4 w-4" />
            </button>
          )}
          <span className="text-sm font-medium text-gray-900">
            {t('surveys.admin.questionEditor.questionNumber', { number: question.order })}
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {getQuestionTypeLabel(question.type)}
          </span>
        </div>
        
        <button
          onClick={onRemove}
          disabled={disabled}
          aria-label="trash"
          className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-sm font-medium">Trash</span>
        </button>
      </div>

      <div className="space-y-4">
        {/* Question Text */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('surveys.admin.questionEditor.questionText')}
          </label>
          <textarea
            value={questionText}
            onChange={(e) => handleQuestionTextChange(e.target.value)}
            disabled={disabled}
            rows={2}
            className={`block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              !questionText || questionText.trim() === '' 
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                : 'border-gray-300'
            } ${disabled ? 'bg-gray-100' : ''}`}
            placeholder={t('surveys.admin.questionEditor.questionTextPlaceholder')}
          />
          {(!questionText || questionText.trim() === '') && (
            <p className="mt-1 text-sm text-red-600">{t('surveys.admin.questionEditor.fieldRequired')}</p>
          )}
        </div>

        {/* Question Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('surveys.admin.questionEditor.description')}
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            disabled={disabled}
            className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${disabled ? 'bg-gray-100' : ''}`}
            placeholder={t('surveys.admin.questionEditor.descriptionPlaceholder')}
          />
        </div>

        {/* Options for choice questions */}
        {(question.type === 'single_choice' || question.type === 'multiple_choice') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('surveys.admin.questionEditor.answerOptions')}
            </label>
            <div className="space-y-2">
              {options?.map((option, index) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-500 w-6">{index + 1}.</span>
                  <input
                    type="text"
                    value={option.text}
                    onChange={(e) => updateOption(option.id, 'text', e.target.value)}
                    disabled={disabled}
                    className={`flex-1 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${disabled ? 'bg-gray-100' : ''}`}
                    placeholder={t('surveys.admin.questionEditor.optionTextPlaceholder')}
                  />
                  {options && options.length > 2 && (
                    <button
                      onClick={() => removeOption(option.id)}
                      disabled={disabled}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span aria-hidden="true">×</span>
                      <FiX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addOption}
                disabled={disabled}
                className="flex items-center text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiPlus className="mr-1 h-4 w-4" />
                {t('surveys.admin.questionEditor.addOption')}
              </button>
            </div>
          </div>
        )}

        {/* Rating range for rating questions */}
        {(question.type === 'rating_5' || question.type === 'rating_10') && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('surveys.admin.questionEditor.minRating')}
              </label>
              <input
                type="number"
                value={minRating}
                onChange={(e) => handleMinRatingChange(e.target.value)}
                disabled={disabled}
                min="1"
                max={question.type === 'rating_5' ? 5 : 10}
                className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${disabled ? 'bg-gray-100' : ''}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('surveys.admin.questionEditor.maxRating')}
              </label>
              <input
                type="number"
                value={maxRating}
                onChange={(e) => handleMaxRatingChange(e.target.value)}
                disabled={disabled}
                min="1"
                max={question.type === 'rating_5' ? 5 : 10}
                className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${disabled ? 'bg-gray-100' : ''}`}
              />
            </div>
          </div>
        )}

        {/* Required toggle */}
        <div className="flex items-center">
          <input
            id={`required-${question.id}`}
            type="checkbox"
            checked={isRequired}
            onChange={(e) => handleRequiredToggle(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
          />
          <label htmlFor={`required-${question.id}`} className="ml-2 block text-sm text-gray-700">
            {t('surveys.admin.questionEditor.requiredQuestion')}
          </label>
        </div>

        {/* Preview */}
        <div className="mt-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-500 mb-2 font-medium">{t('surveys.admin.questionEditor.preview')}</p>
          <div className="text-sm">
            <p className="font-medium text-gray-900 mb-1">
              {questionText || t('surveys.admin.questionEditor.previewPlaceholder')}
              {isRequired && <span className="text-red-500 ml-1">*</span>}
            </p>
            {description && (
              <p className="text-xs text-gray-600 mb-2">{description}</p>
            )}
            
            {question.type === 'single_choice' && (
              <div className="space-y-1">
                {options?.map((option) => (
                  <label key={option.id} className="flex items-center">
                    <input type="radio" name={`preview-${question.id}`} className="mr-2" />
                    <span className="text-sm">{option.text}</span>
                  </label>
                ))}
              </div>
            )}
            
            {question.type === 'multiple_choice' && (
              <div className="space-y-1">
                {options?.map((option) => (
                  <label key={option.id} className="flex items-center">
                    <input type="checkbox" className="mr-2" />
                    <span className="text-sm">{option.text}</span>
                  </label>
                ))}
              </div>
            )}
            
            {question.type === 'text' && (
              <input
                type="text"
                disabled
                className="w-full border-gray-300 rounded text-sm"
                placeholder={t('surveys.admin.questionEditor.textInputPlaceholder')}
              />
            )}
            
            {question.type === 'textarea' && (
              <textarea
                disabled
                rows={3}
                className="w-full border-gray-300 rounded text-sm"
                placeholder={t('surveys.admin.questionEditor.longTextInputPlaceholder')}
              />
            )}
            
            {(question.type === 'rating_5' || question.type === 'rating_10') && (
              <div className="flex items-center space-x-1">
                {Array.from({ length: displayMaxRating }, (_, i) => (
                  <span key={i} className="text-gray-300 text-lg">★</span>
                ))}
              </div>
            )}
            
            {question.type === 'yes_no' && (
              <div className="space-y-1">
                <label className="flex items-center">
                  <input type="radio" name={`preview-${question.id}`} className="mr-2" />
                  <span className="text-sm">{t('common.yes')}</span>
                </label>
                <label className="flex items-center">
                  <input type="radio" name={`preview-${question.id}`} className="mr-2" />
                  <span className="text-sm">{t('common.no')}</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuestionEditor;
