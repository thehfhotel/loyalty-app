import React, { useState } from 'react';
import { FiMove, FiTrash2, FiPlus, FiX } from 'react-icons/fi';
import { SurveyQuestion, QuestionOption } from '../../types/survey';
import { surveyService } from '../../services/surveyService';

interface QuestionEditorProps {
  question: SurveyQuestion;
  index: number;
  onUpdate: (updates: Partial<SurveyQuestion>) => void;
  onRemove: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  canMove: boolean;
}

const QuestionEditor: React.FC<QuestionEditorProps> = ({
  question,
  index,
  onUpdate,
  onRemove,
  onReorder,
  canMove
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const addOption = () => {
    if (!question.options) return;
    
    const newOption: QuestionOption = {
      id: surveyService.generateOptionId(),
      text: `Option ${question.options.length + 1}`,
      value: `option${question.options.length + 1}`
    };
    
    onUpdate({
      options: [...question.options, newOption]
    });
  };

  const updateOption = (optionId: string, field: 'text' | 'value', value: string) => {
    if (!question.options) return;
    
    const updatedOptions = question.options.map(option =>
      option.id === optionId ? { ...option, [field]: value } : option
    );
    
    onUpdate({ options: updatedOptions });
  };

  const removeOption = (optionId: string) => {
    if (!question.options || question.options.length <= 2) return;
    
    const filteredOptions = question.options.filter(option => option.id !== optionId);
    onUpdate({ options: filteredOptions });
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
      case 'single_choice': return 'Single Choice';
      case 'multiple_choice': return 'Multiple Choice';
      case 'text': return 'Text Input';
      case 'textarea': return 'Long Text';
      case 'rating_5': return '5-Star Rating';
      case 'rating_10': return '10-Point Scale';
      case 'yes_no': return 'Yes/No';
      default: return type;
    }
  };

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
            <button className="p-1 text-gray-400 hover:text-gray-600 cursor-move">
              <FiMove className="h-4 w-4" />
            </button>
          )}
          <span className="text-sm font-medium text-gray-900">
            Question {question.order}
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {getQuestionTypeLabel(question.type)}
          </span>
        </div>
        
        <button
          onClick={onRemove}
          className="p-1 text-gray-400 hover:text-red-600"
        >
          <FiTrash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        {/* Question Text */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Question Text *
          </label>
          <textarea
            value={question.text}
            onChange={(e) => onUpdate({ text: e.target.value })}
            rows={2}
            className={`block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              !question.text || question.text.trim() === '' 
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                : 'border-gray-300'
            }`}
            placeholder="Enter your question..."
          />
          {(!question.text || question.text.trim() === '') && (
            <p className="mt-1 text-sm text-red-600">This field is required</p>
          )}
        </div>

        {/* Question Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description (Optional)
          </label>
          <input
            type="text"
            value={question.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Additional context or instructions..."
          />
        </div>

        {/* Options for choice questions */}
        {(question.type === 'single_choice' || question.type === 'multiple_choice') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Answer Options
            </label>
            <div className="space-y-2">
              {question.options?.map((option) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={option.text}
                    onChange={(e) => updateOption(option.id, 'text', e.target.value)}
                    className="flex-1 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Option text..."
                  />
                  <input
                    type="text"
                    value={option.value.toString()}
                    onChange={(e) => updateOption(option.id, 'value', e.target.value)}
                    className="w-24 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="value"
                  />
                  {question.options && question.options.length > 2 && (
                    <button
                      onClick={() => removeOption(option.id)}
                      className="p-1 text-gray-400 hover:text-red-600"
                    >
                      <FiX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addOption}
                className="flex items-center text-sm text-blue-600 hover:text-blue-800"
              >
                <FiPlus className="mr-1 h-4 w-4" />
                Add Option
              </button>
            </div>
          </div>
        )}

        {/* Rating range for rating questions */}
        {(question.type === 'rating_5' || question.type === 'rating_10') && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Rating
              </label>
              <input
                type="number"
                value={question.min_rating || 1}
                onChange={(e) => onUpdate({ min_rating: parseInt(e.target.value) })}
                min="1"
                max={question.type === 'rating_5' ? 5 : 10}
                className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Rating
              </label>
              <input
                type="number"
                value={question.max_rating || (question.type === 'rating_5' ? 5 : 10)}
                onChange={(e) => onUpdate({ max_rating: parseInt(e.target.value) })}
                min="1"
                max={question.type === 'rating_5' ? 5 : 10}
                className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          </div>
        )}

        {/* Required toggle */}
        <div className="flex items-center">
          <input
            id={`required-${question.id}`}
            type="checkbox"
            checked={question.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor={`required-${question.id}`} className="ml-2 block text-sm text-gray-700">
            Required question
          </label>
        </div>

        {/* Preview */}
        <div className="mt-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-500 mb-2 font-medium">Preview:</p>
          <div className="text-sm">
            <p className="font-medium text-gray-900 mb-1">
              {question.text || 'Question text will appear here...'}
              {question.required && <span className="text-red-500 ml-1">*</span>}
            </p>
            {question.description && (
              <p className="text-xs text-gray-600 mb-2">{question.description}</p>
            )}
            
            {question.type === 'single_choice' && (
              <div className="space-y-1">
                {question.options?.map((option) => (
                  <label key={option.id} className="flex items-center">
                    <input type="radio" name={`preview-${question.id}`} className="mr-2" />
                    <span className="text-sm">{option.text}</span>
                  </label>
                ))}
              </div>
            )}
            
            {question.type === 'multiple_choice' && (
              <div className="space-y-1">
                {question.options?.map((option) => (
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
                placeholder="Text input"
              />
            )}
            
            {question.type === 'textarea' && (
              <textarea
                disabled
                rows={3}
                className="w-full border-gray-300 rounded text-sm"
                placeholder="Long text input"
              />
            )}
            
            {(question.type === 'rating_5' || question.type === 'rating_10') && (
              <div className="flex items-center space-x-1">
                {Array.from({ length: question.max_rating || (question.type === 'rating_5' ? 5 : 10) }, (_, i) => (
                  <span key={i} className="text-gray-300 text-lg">★</span>
                ))}
              </div>
            )}
            
            {question.type === 'yes_no' && (
              <div className="space-y-1">
                <label className="flex items-center">
                  <input type="radio" name={`preview-${question.id}`} className="mr-2" />
                  <span className="text-sm">Yes</span>
                </label>
                <label className="flex items-center">
                  <input type="radio" name={`preview-${question.id}`} className="mr-2" />
                  <span className="text-sm">No</span>
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