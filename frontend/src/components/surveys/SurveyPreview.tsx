import React, { useState } from 'react';
import { FiX, FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import { Survey } from '../../types/survey';
import QuestionRenderer from './QuestionRenderer';
import SurveyProgress from './SurveyProgress';

// Survey answer can be string, number, boolean, array of strings, or null
type SurveyAnswer = string | number | boolean | string[] | null;

interface SurveyPreviewProps {
  survey: Survey;
  onClose: () => void;
}

const SurveyPreview: React.FC<SurveyPreviewProps> = ({ survey, onClose }) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswer>>({});

  const handleAnswerChange = (questionId: string, answer: SurveyAnswer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const goToNext = () => {
    if (currentQuestion < survey.questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    }
  };

  const goToPrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(prev => prev - 1);
    }
  };

  const goToQuestion = (index: number) => {
    setCurrentQuestion(index);
  };

  const calculateProgress = () => {
    const answeredQuestions = Object.keys(answers).length;
    return Math.round((answeredQuestions / survey.questions.length) * 100);
  };

  const isLastQuestion = currentQuestion >= survey.questions.length - 1;
  const isCompletionPage = currentQuestion >= survey.questions.length;

  return (
    <div className="bg-white shadow rounded-lg">
      {/* Preview Header */}
      <div className="bg-blue-50 px-6 py-4 border-b rounded-t-lg">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Survey Preview</h2>
            <p className="text-sm text-gray-600">This is how your survey will appear to customers</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <FiX className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Survey Preview Content */}
      <div className="p-6">
        {!isCompletionPage ? (
          <>
            {/* Survey Header */}
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{survey.title}</h1>
              {survey.description && (
                <p className="text-gray-600">{survey.description}</p>
              )}
            </div>

            {/* Progress */}
            <SurveyProgress
              current={currentQuestion + 1}
              total={survey.questions.length}
              progress={calculateProgress()}
            />

            {/* Current Question */}
            <div className="bg-gray-50 rounded-lg p-6 mb-6 min-h-[300px]">
              {survey.questions[currentQuestion] && (
                <QuestionRenderer
                  question={survey.questions[currentQuestion]}
                  answer={answers[survey.questions[currentQuestion].id]}
                  onAnswerChange={handleAnswerChange}
                  error=""
                />
              )}
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center mb-4">
              <button
                onClick={goToPrevious}
                disabled={currentQuestion === 0}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiArrowLeft className="mr-2 h-4 w-4" />
                Previous
              </button>

              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500">
                  Question {currentQuestion + 1} of {survey.questions.length}
                </span>
              </div>

              <button
                onClick={goToNext}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                {isLastQuestion ? 'Complete Survey' : 'Next'}
                <FiArrowRight className="ml-2 h-4 w-4" />
              </button>
            </div>

            {/* Question Navigation Dots */}
            <div className="flex justify-center space-x-2">
              {survey.questions.map((_, index) => (
                <button
                  key={index}
                  onClick={() => goToQuestion(index)}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    index === currentQuestion
                      ? 'bg-blue-600'
                      : answers[survey.questions[index].id]
                      ? 'bg-green-400'
                      : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
          </>
        ) : (
          /* Completion Page */
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Survey Completed!
            </h2>
            <p className="text-gray-600 mb-6">
              Thank you for taking the time to complete this survey. Your feedback is valuable to us.
            </p>
            
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <p className="text-green-800 text-sm">
                ✓ Your responses have been saved successfully
              </p>
            </div>

            <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md">
              Back to Surveys
            </button>
          </div>
        )}
      </div>

      {/* Preview Footer */}
      <div className="bg-gray-50 px-6 py-3 border-t rounded-b-lg">
        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>Preview Mode - No responses will be saved</span>
          <button
            onClick={onClose}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};

export default SurveyPreview;