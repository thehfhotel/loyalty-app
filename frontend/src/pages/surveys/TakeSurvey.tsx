import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Survey } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import { translationService } from '../../services/translationService';
import QuestionRenderer from '../../components/surveys/QuestionRenderer';
import SurveyProgress from '../../components/surveys/SurveyProgress';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import LanguageTabs from '../../components/translation/LanguageTabs';
import { MultilingualSurvey, SupportedLanguage } from '../../types/multilingual';

const TakeSurvey: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [multilingualSurvey, setMultilingualSurvey] = useState<MultilingualSurvey | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('th');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Get display content based on selected language
  const getDisplayContent = useCallback(() => {
    if (!multilingualSurvey || selectedLanguage === multilingualSurvey.originalLanguage) {
      return survey;
    }

    // Check if translations exist
    if (!multilingualSurvey.translations || typeof multilingualSurvey.translations !== 'object') {
      return survey;
    }

    const translation = multilingualSurvey.translations[selectedLanguage];
    if (!translation) {
      return survey;
    }

    return {
      ...survey,
      title: (translation as any)?.title ?? survey?.title,
      description: (translation as any)?.description ?? survey?.description,
      questions: (translation as any)?.questions ?? survey?.questions
    };
  }, [multilingualSurvey, selectedLanguage, survey]);

  const loadSurvey = useCallback(async (surveyId: string) => {
    try {
      setLoading(true);
      setError(null);

      const [surveyData, responseData, translationsData] = await Promise.all([
        surveyService.getSurveyById(surveyId),
        surveyService.getUserResponse(surveyId),
        translationService.getSurveyTranslations(surveyId)
      ]);

      setSurvey(surveyData);

      // Load translations if available
      if (translationsData) {
        const multilingualData: MultilingualSurvey = {
          ...translationsData,
          originalLanguage: translationsData.original_language ?? 'th',
          availableLanguages: translationsData.available_languages ?? ['th'],
          translationStatus: 'none',
          translations: translationsData.translations ?? {}
        };
        
        setMultilingualSurvey(multilingualData);
        setSelectedLanguage(translationsData.original_language ?? 'th');
      }

      if (responseData) {
        // Allow retaking surveys - always start fresh for multiple submissions
        setAnswers({});
        setCurrentQuestion(0);
      }
    } catch (err) {
      console.error('Error loading survey:', err);
      const errorMessage = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(errorMessage ?? t('surveys.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const saveProgress = useCallback(async (isCompletingNow = false) => {
    if (!survey || !id) {return;}

    try {
      setSaving(true);
      
      const isComplete = isCompletingNow || surveyService.isResponseComplete(survey, answers);
      
      await surveyService.submitResponse({
        survey_id: id,
        answers,
        is_completed: isComplete
      });

      if (isComplete && isCompletingNow) {
        const displayContent = getDisplayContent();
        setCurrentQuestion(displayContent?.questions?.length ?? 0);
      }
    } catch (err) {
      console.error('Error saving progress:', err);
      const errorMessage = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(errorMessage ?? t('surveys.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [survey, id, answers, getDisplayContent, t]);

  useEffect(() => {
    if (id) {
      loadSurvey(id);
    }
  }, [id, loadSurvey]);

  // Track language changes
  useEffect(() => {
    // Language change effect - can add analytics tracking here if needed
  }, [selectedLanguage, multilingualSurvey]);

  // Get display content based on selected language (moved here to fix hooks order)
  const displayContent = useMemo(() => getDisplayContent(), [getDisplayContent]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (survey && Object.keys(answers).length > 0) {
      const interval = setInterval(() => {
        saveProgress();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [survey, answers, saveProgress]);

  const handleAnswerChange = (questionId: string, answer: unknown) => {
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
    const displayContent = getDisplayContent();
    if (!displayContent || currentQuestion >= (displayContent.questions?.length ?? 0)) {return true;}

    const question = displayContent.questions?.[currentQuestion];
    if (!question) {return true;}
    
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
    if (!validateCurrentQuestion()) {return;}

    const displayContent = getDisplayContent();
    if (displayContent && currentQuestion < (displayContent.questions?.length ?? 0) - 1) {
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
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

  const progress = surveyService.calculateProgress(answers, displayContent?.questions?.length ?? 0);
  const isLastQuestion = currentQuestion >= (displayContent?.questions?.length ?? 0) - 1;
  const isCompletionPage = currentQuestion >= (displayContent?.questions?.length ?? 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">{displayContent?.title}</h1>
              <span className="ml-4 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                {selectedLanguage.toUpperCase()}
              </span>
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
          
          {/* Language Tabs - show if we have multilingual survey data */}
          {multilingualSurvey && (
            <div className="border-t border-gray-200">
              <div className="px-4 sm:px-6 lg:px-8">
                <LanguageTabs
                  languages={['th', 'en', 'zh-CN']}
                  currentLanguage={selectedLanguage}
                  onLanguageChange={setSelectedLanguage}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto p-4">
        {!isCompletionPage ? (
          <>
            <SurveyProgress
              current={currentQuestion + 1}
              total={displayContent?.questions?.length ?? 0}
              progress={progress}
            />

            {displayContent?.questions?.[currentQuestion] && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <QuestionRenderer
                  question={displayContent.questions[currentQuestion]}
                  answer={answers[displayContent.questions[currentQuestion].id]}
                  onAnswerChange={handleAnswerChange}
                  error={errors[displayContent.questions[currentQuestion].id]}
                />
              </div>
            )}

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
              {displayContent?.questions?.map((question, index: number) => (
                <button
                  key={index}
                  onClick={() => goToQuestion(index)}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    index === currentQuestion
                      ? 'bg-blue-600'
                      : answers[question.id]
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