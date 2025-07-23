import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Survey, SurveyResponse } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import QuestionRenderer from '../../components/surveys/QuestionRenderer';
import SurveyProgress from '../../components/surveys/SurveyProgress';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageSwitcher from '../../components/LanguageSwitcher';

const TakeSurvey: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [existingResponse, setExistingResponse] = useState<SurveyResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    if (id) {
      loadSurvey(id);
    }
  }, [id]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (survey && Object.keys(answers).length > 0) {
      const interval = setInterval(() => {
        saveProgress();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [survey, answers]);

  const loadSurvey = async (surveyId: string) => {
    try {
      setLoading(true);
      setError(null);

      const [surveyData, responseData] = await Promise.all([
        surveyService.getSurveyById(surveyId),
        surveyService.getUserResponse(surveyId)
      ]);

      setSurvey(surveyData);
      setExistingResponse(responseData);

      if (responseData) {
        // Allow retaking surveys - always start fresh for multiple submissions
        setAnswers({});
        setIsCompleted(false);
        setCurrentQuestion(0);
      }
    } catch (err: any) {
      console.error('Error loading survey:', err);
      setError(err.response?.data?.message || t('surveys.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const saveProgress = async (isCompletingNow = false) => {
    if (!survey || !id) return;

    try {
      setSaving(true);
      
      const isComplete = isCompletingNow || surveyService.isResponseComplete(survey, answers);
      
      await surveyService.submitResponse({
        survey_id: id,
        answers,
        is_completed: isComplete
      });

      if (isComplete && isCompletingNow) {
        setIsCompleted(true);
        setCurrentQuestion(survey.questions.length);
      }
    } catch (err: any) {
      console.error('Error saving progress:', err);
      setError(err.response?.data?.message || t('surveys.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAnswerChange = (questionId: string, answer: any) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));

    // Clear error for this question
    if (errors[questionId]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[questionId];
        return newErrors;
      });
    }
  };

  const validateCurrentQuestion = (): boolean => {
    if (!survey || currentQuestion >= survey.questions.length) return true;

    const question = survey.questions[currentQuestion];
    const answer = answers[question.id];
    
    if (!surveyService.validateAnswer(question, answer)) {
      setErrors({
        [question.id]: question.required 
          ? t('surveys.errors.required')
          : t('surveys.errors.invalid')
      });
      return false;
    }

    return true;
  };

  const goToNext = () => {
    if (!validateCurrentQuestion()) return;

    if (survey && currentQuestion < survey.questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
      saveProgress();
    } else {
      // Last question, complete survey
      saveProgress(true);
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

  const exitSurvey = () => {
    if (Object.keys(answers).length > 0) {
      saveProgress();
    }
    navigate('/surveys');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">{t('surveys.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            <p>{error}</p>
          </div>
          <div className="mt-4">
            <button
              onClick={() => navigate('/surveys')}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-md transition-colors"
            >
              {t('surveys.backToList')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-4">
          <div className="text-center py-12">
            <p className="text-gray-500">{t('surveys.notFound')}</p>
          </div>
        </div>
      </div>
    );
  }

  const progress = surveyService.calculateProgress(answers, survey.questions.length);
  const isLastQuestion = currentQuestion >= survey.questions.length - 1;
  const isCompletionPage = currentQuestion >= survey.questions.length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">{survey.title}</h1>
            </div>
            <div className="flex items-center space-x-4">
              <LanguageSwitcher />
              <DashboardButton variant="outline" size="md" />
              <button
                onClick={exitSurvey}
                className="text-gray-600 hover:text-gray-900 font-medium text-sm"
              >
                {t('surveys.exit')}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto p-4">
        {!isCompletionPage ? (
          <>
            <SurveyProgress
              current={currentQuestion + 1}
              total={survey.questions.length}
              progress={progress}
            />

            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <QuestionRenderer
                question={survey.questions[currentQuestion]}
                answer={answers[survey.questions[currentQuestion].id]}
                onAnswerChange={handleAnswerChange}
                error={errors[survey.questions[currentQuestion].id]}
              />
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <button
                onClick={goToPrevious}
                disabled={currentQuestion === 0}
                className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 font-medium py-2 px-4 rounded-md transition-colors"
              >
                {t('surveys.previous')}
              </button>

              <div className="flex items-center space-x-2">
                {saving && (
                  <span className="text-sm text-gray-500">
                    {t('surveys.saving')}
                  </span>
                )}
                
                <button
                  onClick={goToNext}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-md transition-colors"
                >
                  {isLastQuestion 
                    ? t('surveys.complete')
                    : t('surveys.next')
                  }
                </button>
              </div>
            </div>

            {/* Question navigation dots */}
            <div className="flex justify-center mt-6 space-x-2">
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
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {t('surveys.completed.title')}
            </h2>
            <p className="text-gray-600 mb-6">
              {t('surveys.completed.message')}
            </p>
            
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <p className="text-green-800 text-sm">
                ✓ {t('surveys.completed.saved')}
              </p>
            </div>

            <div className="flex justify-center space-x-4">
              <button
                onClick={() => navigate('/surveys')}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
              >
                {t('surveys.backToList')}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default TakeSurvey;