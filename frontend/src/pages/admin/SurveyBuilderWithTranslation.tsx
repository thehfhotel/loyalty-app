import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FiPlus, FiSave, FiEye, FiGlobe } from 'react-icons/fi';
import { Survey, SurveyQuestion, CreateSurveyRequest, QuestionType, SurveyAccessType, SurveyStatus } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import { translationService } from '../../services/translationService';
import DashboardButton from '../../components/navigation/DashboardButton';
import QuestionEditor from '../../components/surveys/QuestionEditor';
import SurveyPreview from '../../components/surveys/SurveyPreview';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import LanguageTabs from '../../components/translation/LanguageTabs';
import toast from 'react-hot-toast';
import { MultilingualSurvey, SupportedLanguage, TranslationStatus } from '../../types/multilingual';

// Validation utility types and functions (keeping existing)
interface QuestionValidationError {
  id: string;
  text: string;
  error: string;
  questionNumber: number;
}

interface SurveyValidationResult {
  emptyQuestions: QuestionValidationError[];
  emptyOptions: QuestionValidationError[];
  isValid: boolean;
}

const validateSurveyQuestions = (questions: SurveyQuestion[], t: any): SurveyValidationResult => {
  const emptyQuestions: QuestionValidationError[] = [];
  const emptyOptions: QuestionValidationError[] = [];

  questions.forEach((question, index) => {
    const hasValidText = question.text && 
                        typeof question.text === 'string' && 
                        question.text.trim().length > 0;
    
    if (!hasValidText) {
      emptyQuestions.push({
        id: question.id,
        text: question.text ?? '',
        error: t('surveys.admin.validation.questionTextRequired'),
        questionNumber: index + 1
      });
    }

    if (['single_choice', 'multiple_choice'].includes(question.type) && question.options) {
      question.options.forEach((option, optIndex) => {
        const hasValidOptionText = option.text && 
                                  typeof option.text === 'string' && 
                                  option.text.trim().length > 0;
        
        if (!hasValidOptionText) {
          emptyOptions.push({
            id: `${question.id}_${option.id}`,
            text: option.text ?? '',
            error: `Option ${optIndex + 1} text is required`,
            questionNumber: index + 1
          });
        }
      });
    }
  });

  return {
    emptyQuestions,
    emptyOptions,
    isValid: emptyQuestions.length === 0 && emptyOptions.length === 0
  };
};

const handleQuestionValidationErrors = (validationResult: SurveyValidationResult): void => {
  const { emptyQuestions, emptyOptions } = validationResult;
  
  document.querySelectorAll('.validation-error-highlight').forEach(el => {
    el.classList.remove('validation-error-highlight');
  });
  document.querySelectorAll('.validation-field-error').forEach(el => {
    el.classList.remove('validation-field-error');
  });
  
  if (emptyQuestions.length > 0) {
    const questionNumbers = emptyQuestions.map(q => q.questionNumber).join(', ');
    const message = emptyQuestions.length === 1 
      ? `Question ${questionNumbers} needs your attention`
      : `Questions ${questionNumbers} need your attention`;
    
    toast.error(message, {
      duration: 6000,
      icon: '👆'
    });
    
    emptyQuestions.forEach((question, index) => {
      const questionContainer = document.querySelector(`[data-question-id="${question.id}"]`);
      const questionTextarea = document.querySelector(`[data-question-id="${question.id}"] textarea`);
      
      if (questionContainer) {
        questionContainer.classList.add('validation-error-highlight');
      }
      
      if (questionTextarea) {
        questionTextarea.classList.add('validation-field-error');
        
        if (index === 0) {
          questionTextarea.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center'
          });
          
          setTimeout(() => {
            (questionTextarea as HTMLElement).focus();
            questionTextarea.classList.add('animate-pulse');
            setTimeout(() => {
              questionTextarea.classList.remove('animate-pulse');
            }, 2000);
          }, 500);
        }
      }
    });
    
    setTimeout(() => {
      document.querySelectorAll('.validation-error-highlight').forEach(el => {
        el.classList.remove('validation-error-highlight');
      });
      document.querySelectorAll('.validation-field-error').forEach(el => {
        el.classList.remove('validation-field-error');
      });
    }, 8000);
  }
  
  if (emptyOptions.length > 0) {
    const message = emptyOptions.length === 1
      ? 'Please fill in all option text fields'
      : `Please fill in all option text fields (${emptyOptions.length} empty options found)`;
    
    toast.error(message, {
      duration: 5000,
      icon: '📋'
    });
    
    emptyOptions.forEach((option, index) => {
      const optionInput = document.querySelector(`input[value="${option.text}"]`);
      if (optionInput) {
        optionInput.classList.add('validation-field-error');
        
        if (emptyQuestions.length === 0 && index === 0) {
          optionInput.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center'
          });
          setTimeout(() => {
            (optionInput as HTMLElement).focus();
          }, 500);
        }
      }
    });
  }
};

const SurveyBuilderWithTranslation: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  const [survey, setSurvey] = useState<Partial<Survey>>({
    title: '',
    description: '',
    questions: [],
    target_segment: {},
    status: 'draft',
    access_type: 'public'
  });

  const [multilingualSurvey, setMultilingualSurvey] = useState<MultilingualSurvey | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('th');
  const [translationStatus, setTranslationStatus] = useState<Record<SupportedLanguage, TranslationStatus>>({
    th: 'original',
    en: 'pending',
    'zh-CN': 'pending'
  });
  const [isTranslating, setIsTranslating] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [validationState, setValidationState] = useState<SurveyValidationResult>({
    emptyQuestions: [],
    emptyOptions: [],
    isValid: true
  });

  useEffect(() => {
    if (isEditing) {
      loadSurvey();
      // Check for any ongoing translation jobs when page loads/refreshes
      checkOngoingTranslations();
    } else if (location.state?.template) {
      const template = location.state.template;
      setSurvey({
        title: template.title,
        description: template.description,
        questions: template.questions,
        target_segment: {},
        status: 'draft',
        access_type: 'public'
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEditing, location.state]);

  useEffect(() => {
    if (survey.questions && survey.questions.length > 0) {
      const validation = validateSurveyQuestions(survey.questions, t);
      setValidationState(validation);
    } else {
      setValidationState({ emptyQuestions: [], emptyOptions: [], isValid: true });
    }
  }, [survey.questions, t]);

  // Inject validation error highlighting CSS
  useEffect(() => {
    const styleId = 'validation-highlighting-styles';
    
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .validation-error-highlight {
        border: 3px solid #ef4444 !important;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2) !important;
        transition: all 0.3s ease-in-out !important;
        animation: validation-pulse 0.5s ease-in-out !important;
      }
      
      @keyframes validation-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.02); }
        100% { transform: scale(1); }
      }
      
      .validation-error-highlight textarea {
        border-color: #ef4444 !important;
        background-color: #fef2f2 !important;
      }
      
      .validation-field-error {
        border: 2px solid #ef4444 !important;
        background-color: #fef2f2 !important;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1) !important;
        animation: field-error-pulse 0.6s ease-in-out !important;
      }
      
      @keyframes field-error-pulse {
        0% { 
          transform: scale(1);
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
        }
        50% { 
          transform: scale(1.01);
          box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.2);
        }
        100% { 
          transform: scale(1);
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
        }
      }
      
      .validation-field-error:focus {
        border-color: #dc2626 !important;
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.3) !important;
        background-color: #ffffff !important;
      }
      
      .validation-error-highlight:hover {
        border-color: #dc2626 !important;
      }
    `;

    document.head.appendChild(style);

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, []);

  const loadSurvey = async () => {
    if (!id) {return;}
    
    try {
      setLoading(true);
      const surveyData = await surveyService.getSurveyById(id);
      setSurvey(surveyData);
      
      // Load translations if available
      const translationsData = await translationService.getSurveyTranslations(id);
      if (translationsData) {
        // Create a MultilingualSurvey-compatible object from backend response
        const multilingualData: MultilingualSurvey = {
          ...translationsData,
          originalLanguage: translationsData.original_language ?? 'th',
          availableLanguages: translationsData.available_languages ?? ['th'],
          translationStatus: 'none',
          translations: translationsData.translations ?? {}
        };
        
        setMultilingualSurvey(multilingualData);
        
        // Update translation status
        const newStatus: Record<SupportedLanguage, TranslationStatus> = {
          th: 'original',
          en: 'pending',
          'zh-CN': 'pending'
        };
        
        // Check if translations exist in the response
        if (translationsData.translations && typeof translationsData.translations === 'object') {
          Object.keys(translationsData.translations).forEach((lang) => {
            if (lang !== translationsData.original_language) {
              newStatus[lang as SupportedLanguage] = 'translated';
            }
          });
        }
        
        setTranslationStatus(newStatus);
        setSelectedLanguage(translationsData.original_language ?? 'th');
      }
    } catch (err: any) {
      console.error('Error loading survey:', err);
      toast.error(t('surveys.admin.messages.loadError'));
      navigate('/admin/surveys');
    } finally {
      setLoading(false);
    }
  };

  const checkOngoingTranslations = async () => {
    if (!id) {return;}
    
    try {
      // Get recent translation jobs for this survey
      const jobs = await translationService.getTranslationJobs();
      const surveyJobs = jobs.filter((job: any) => 
        job.entityId === id && 
        job.entityType === 'survey' &&
        (job.status === 'pending' || job.status === 'processing')
      );
      
      if (surveyJobs.length > 0) {
        // Show notification that translations are in progress
        toast('Translation in progress... The page will auto-refresh when complete.', {
          duration: 5000,
          icon: '🔄'
        });
        
        // Update status to pending for languages being translated
        const newStatus = { ...translationStatus };
        surveyJobs.forEach((job: any) => {
          job.target_languages?.forEach((lang: string) => {
            newStatus[lang as SupportedLanguage] = 'pending';
          });
        });
        setTranslationStatus(newStatus);
        setIsTranslating(true);
        
        // Poll for completion of any ongoing jobs
        const pollInterval = setInterval(async () => {
          try {
            let allCompleted = true;
            
            for (const job of surveyJobs) {
              const jobStatus = await translationService.getTranslationJob(job.id);
              
              if (jobStatus.status === 'completed') {
                // Don't break yet, check all jobs
                continue;
              } else if (jobStatus.status === 'failed') {
                allCompleted = false;
                // Update specific job languages to error
                const errorStatus = { ...translationStatus };
                job.targetLanguages?.forEach((lang: string) => {
                  errorStatus[lang as SupportedLanguage] = 'error';
                });
                setTranslationStatus(errorStatus);
                
                toast.error(`Translation failed for some languages: ${jobStatus.error ?? 'Unknown error'}`, {
                  duration: 7000,
                  icon: '❌'
                });
              } else {
                allCompleted = false;
              }
            }
            
            if (allCompleted) {
              clearInterval(pollInterval);
              setIsTranslating(false);
              
              // Show refreshing indicator
              toast.loading('Refreshing survey with new translations...', {
                duration: 2000,
                icon: '🔄'
              });
              
              // Reload survey with translations
              await loadSurvey();
              
              // Show refresh indicator
              setJustRefreshed(true);
              setTimeout(() => setJustRefreshed(false), 5000);
              
              // Success notification
              toast.success('Translation completed! The page has been automatically refreshed.', {
                duration: 7000,
                icon: '✅'
              });
              
              // Smooth scroll to top to show refreshed content
              setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }, 1000);
            }
          } catch (error) {
            console.error('Error polling ongoing translation jobs:', error);
          }
        }, 3000);
        
        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setIsTranslating(false);
        }, 300000);
      }
    } catch (error) {
      console.error('Error checking ongoing translations:', error);
    }
  };

  const handleSurveyChange = (field: string, value: any) => {
    setSurvey(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleTranslate = async (targetLanguages: SupportedLanguage[]) => {
    if (!id) {
      toast.error('Please save the survey before translating');
      return;
    }

    try {
      setIsTranslating(true);
      
      // Update status to pending for target languages
      const newStatus = { ...translationStatus };
      targetLanguages.forEach(lang => {
        newStatus[lang] = 'pending';
      });
      setTranslationStatus(newStatus);

      const result = await translationService.translateSurvey(id, selectedLanguage, targetLanguages);
      
      toast.success(`Translation started! Job ID: ${result.id}`, {
        duration: 5000,
        icon: '🌐'
      });

      // Poll for translation completion
      const pollInterval = setInterval(async () => {
        try {
          const jobStatus = await translationService.getTranslationJob(result.id);
          
          if (jobStatus.status === 'completed') {
            clearInterval(pollInterval);
            
            // Show refreshing indicator
            toast.loading('Refreshing survey with new translations...', {
              duration: 2000,
              icon: '🔄'
            });
            
            // Reload survey with translations
            await loadSurvey();
            
            // Show refresh indicator
            setJustRefreshed(true);
            setTimeout(() => setJustRefreshed(false), 5000);
            
            // Success notification with auto-refresh info
            toast.success('Translation completed! The page has been automatically refreshed with the translated content.', {
              duration: 7000,
              icon: '✅'
            });
            
            // Force a brief UI update to highlight the change
            setTimeout(() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 1000);
          } else if (jobStatus.status === 'failed') {
            clearInterval(pollInterval);
            
            // Update status to error
            const errorStatus = { ...translationStatus };
            targetLanguages.forEach(lang => {
              errorStatus[lang] = 'error';
            });
            setTranslationStatus(errorStatus);
            
            toast.error(`Translation failed: ${jobStatus.error ?? 'Unknown error'}`, {
              duration: 7000,
              icon: '❌'
            });
          }
        } catch (error) {
          console.error('Error polling translation job:', error);
        }
      }, 3000); // Poll every 3 seconds

      // Stop polling after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 120000);

    } catch (err: any) {
      console.error('Translation error:', err);
      toast.error('Failed to start translation');
      
      // Reset status on error
      const errorStatus = { ...translationStatus };
      targetLanguages.forEach(lang => {
        errorStatus[lang] = 'error';
      });
      setTranslationStatus(errorStatus);
    } finally {
      setIsTranslating(false);
    }
  };

  const addQuestion = (type: QuestionType) => {
    const newQuestion: SurveyQuestion = {
      id: surveyService.generateQuestionId(),
      type,
      text: '',
      required: true,
      order: (survey.questions?.length ?? 0) + 1,
      ...(type === 'multiple_choice' || type === 'single_choice' ? {
        options: [
          { id: surveyService.generateOptionId(), text: t('surveys.admin.questions.defaultOptions.option1'), value: '1' },
          { id: surveyService.generateOptionId(), text: t('surveys.admin.questions.defaultOptions.option2'), value: '2' }
        ]
      } : {}),
      ...(type === 'rating_5' ? { min_rating: 1, max_rating: 5 } : {}),
      ...(type === 'rating_10' ? { min_rating: 1, max_rating: 10 } : {})
    };

    setSurvey(prev => ({
      ...prev,
      questions: [...(prev.questions ?? []), newQuestion]
    }));
  };

  const updateQuestion = (questionId: string, updates: Partial<SurveyQuestion>) => {
    setSurvey(prev => ({
      ...prev,
      questions: prev.questions?.map(q => 
        q.id === questionId ? { ...q, ...updates } : q
      ) ?? []
    }));
  };

  const removeQuestion = (questionId: string) => {
    setSurvey(prev => ({
      ...prev,
      questions: prev.questions?.filter(q => q.id !== questionId) ?? []
    }));
  };

  const reorderQuestions = (fromIndex: number, toIndex: number) => {
    const questions = [...(survey.questions ?? [])];
    const [removed] = questions.splice(fromIndex, 1);
    questions.splice(toIndex, 0, removed);
    
    const reorderedQuestions = questions.map((q, index) => ({
      ...q,
      order: index + 1
    }));

    setSurvey(prev => ({
      ...prev,
      questions: reorderedQuestions
    }));
  };

  const saveSurvey = async (status?: string) => {
    if (!survey.title || !survey.questions?.length) {
      toast.error(t('surveys.admin.validation.titleAndQuestionRequired'));
      return;
    }

    if (!validationState.isValid) {
      handleQuestionValidationErrors(validationState);
      return;
    }

    try {
      setSaving(true);
      
      const surveyData: CreateSurveyRequest = {
        title: survey.title,
        description: survey.description,
        questions: survey.questions,
        target_segment: survey.target_segment,
        access_type: survey.access_type ?? 'public' as SurveyAccessType,
        status: (status ?? survey.status) as SurveyStatus,
        original_language: selectedLanguage,
        available_languages: [selectedLanguage]
      };

      let surveyId = id;
      
      if (isEditing && id) {
        await surveyService.updateSurvey(id, { ...surveyData, status: (status ?? survey.status) as SurveyStatus });
        toast.success(t('surveys.admin.messages.updateSuccess'));
      } else {
        const newSurvey = await surveyService.createSurvey(surveyData);
        surveyId = newSurvey.id;
        toast.success(t('surveys.admin.messages.createSuccess'));
        navigate(`/admin/surveys/${newSurvey.id}/edit`);
      }

      // Auto-translate when publishing (status = 'active')
      if ((status ?? survey.status) === 'active' && surveyId) {
        try {
          setIsTranslating(true);
          const targetLanguages: SupportedLanguage[] = (['en', 'zh-CN'] as SupportedLanguage[]).filter(lang => lang !== selectedLanguage);
          
          if (targetLanguages.length > 0) {
            toast('Starting automatic translation to all languages...', {
              duration: 3000,
              icon: '🌐'
            });
            
            const translationJob = await translationService.translateSurvey(surveyId, selectedLanguage, targetLanguages);
            
            toast.success(`Auto-translation started! Job ID: ${translationJob.id}`, {
              duration: 5000,
              icon: '🔄'
            });
          }
        } catch (translationError) {
          console.error('Auto-translation failed:', translationError);
          toast.error('Survey published successfully, but auto-translation failed. You can translate manually later.', {
            duration: 7000,
            icon: '⚠️'
          });
        } finally {
          setIsTranslating(false);
        }
      }
    } catch (err: any) {
      const isValidationError = err.response?.status === 400;
      const errorMessage = err.response?.data?.message ?? err.message ?? 'Failed to save survey';
      
      if (isValidationError) {
        const backendErrors = err.response?.data?.validationErrors ?? [];
        if (backendErrors.length > 0) {
          const fieldErrors = backendErrors.map((error: any) => error.message ?? error.field).join(', ');
          toast.error(t('surveys.admin.messages.validationFailed', { errors: fieldErrors }), {
            duration: 6000,
            icon: '⚠️'
          });
        } else {
          toast.error(errorMessage, { duration: 5000, icon: '⚠️' });
        }
      } else {
        toast.error(t('surveys.admin.messages.networkError', { message: errorMessage }), {
          duration: 7000,
          icon: '🔌'
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // Get display content based on selected language
  const getDisplayContent = () => {
    if (!multilingualSurvey || selectedLanguage === multilingualSurvey.originalLanguage) {
      return survey;
    }

    // Check if translations exist (backend may not return translations structure)
    if (!multilingualSurvey.translations || typeof multilingualSurvey.translations !== 'object') {
      return survey;
    }

    const translation = multilingualSurvey.translations[selectedLanguage];
    if (!translation) {
      return survey;
    }

    return {
      ...survey,
      title: (translation as any)?.title ?? survey.title,
      description: (translation as any)?.description ?? survey.description,
      questions: (translation as any)?.questions ?? survey.questions
    };
  };

  const displayContent = getDisplayContent();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
            <span className="ml-3 text-gray-600">{t('surveys.admin.surveyBuilder.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                {isEditing ? t('surveys.admin.surveyBuilder.pageTitle.edit') : t('surveys.admin.surveyBuilder.pageTitle.create')}
              </h1>
              {isTranslating && (
                <div className="ml-4 flex items-center text-sm text-blue-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2" />
                  <span>Translation in progress...</span>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiEye className="mr-2 h-4 w-4" />
                {showPreview ? t('surveys.admin.surveyBuilder.hidePreview') : t('surveys.admin.surveyBuilder.preview')}
              </button>
              <LanguageSwitcher />
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4">
        {showPreview ? (
          <SurveyPreview survey={displayContent as Survey} onClose={() => setShowPreview(false)} />
        ) : (
          <div className="space-y-6">
            {/* Language Tabs */}
            {isEditing && (
              <LanguageTabs
                languages={['th', 'en', 'zh-CN']}
                currentLanguage={selectedLanguage}
                onLanguageChange={setSelectedLanguage}
                translationStatus={translationStatus}
              />
            )}

            {/* Auto-refresh Notice */}
            {justRefreshed && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <div className="h-5 w-5 text-green-400">✅</div>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-green-700 font-medium">
                      Content updated! The page has been automatically refreshed with the latest translations.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Translation Notice */}
            {selectedLanguage !== 'th' && translationStatus[selectedLanguage] === 'translated' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex">
                  <FiGlobe className="h-5 w-5 text-blue-400 mt-0.5" />
                  <div className="ml-3">
                    <p className="text-sm text-blue-700">
                      You are viewing the {selectedLanguage === 'en' ? 'English' : 'Chinese'} translation.
                      To edit the original content, switch to Thai language.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Basic Information */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">{t('surveys.admin.basicInfo.title')}</h2>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                    {t('surveys.admin.basicInfo.surveyTitle')}
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={displayContent.title ?? ''}
                    onChange={(e) => handleSurveyChange('title', e.target.value)}
                    disabled={isEditing && selectedLanguage !== multilingualSurvey?.originalLanguage}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
                    placeholder={t('surveys.admin.basicInfo.surveyTitlePlaceholder')}
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                    {t('surveys.admin.basicInfo.description')}
                  </label>
                  <textarea
                    id="description"
                    rows={3}
                    value={displayContent.description ?? ''}
                    onChange={(e) => handleSurveyChange('description', e.target.value)}
                    disabled={isEditing && selectedLanguage !== multilingualSurvey?.originalLanguage}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100"
                    placeholder={t('surveys.admin.basicInfo.descriptionPlaceholder')}
                  />
                </div>

                <div>
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                    {t('surveys.admin.basicInfo.status')}
                  </label>
                  <select
                    id="status"
                    value={survey.status ?? 'draft'}
                    onChange={(e) => handleSurveyChange('status', e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="draft">{t('surveys.admin.basicInfo.statusOptions.draft')}</option>
                    <option value="active">{t('surveys.admin.basicInfo.statusOptions.active')}</option>
                    <option value="paused">{t('surveys.admin.basicInfo.statusOptions.paused')}</option>
                    <option value="completed">{t('surveys.admin.basicInfo.statusOptions.completed')}</option>
                    <option value="archived">{t('surveys.admin.basicInfo.statusOptions.archived')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="access_type" className="block text-sm font-medium text-gray-700">
                    {t('surveys.admin.basicInfo.accessType')}
                  </label>
                  <select
                    id="access_type"
                    value={survey.access_type ?? 'public'}
                    onChange={(e) => handleSurveyChange('access_type', e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="public">{t('surveys.admin.basicInfo.accessTypeOptions.public')}</option>
                    <option value="invite_only">{t('surveys.admin.basicInfo.accessTypeOptions.inviteOnly')}</option>
                  </select>
                  <p className="mt-2 text-sm text-gray-500">
                    {survey.access_type === 'public' 
                      ? t('surveys.admin.basicInfo.accessTypeDescriptions.public')
                      : t('surveys.admin.basicInfo.accessTypeDescriptions.inviteOnly')
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Questions */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium text-gray-900">{t('surveys.admin.questions.title')}</h2>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">
                    {t('surveys.admin.questions.count', { count: displayContent.questions?.length ?? 0 })}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {displayContent.questions?.map((question: any, index: number) => (
                  <QuestionEditor
                    key={question.id}
                    question={question}
                    index={index}
                    questionNumber={index + 1}
                    onUpdate={(updates) => updateQuestion(question.id, updates)}
                    onRemove={() => removeQuestion(question.id)}
                    onReorder={reorderQuestions}
                    canMove={(displayContent.questions?.length || 0) > 1}
                    disabled={isEditing && selectedLanguage !== multilingualSurvey?.originalLanguage}
                  />
                ))}

                {displayContent.questions?.length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                    <p className="text-gray-500 mb-4">{t('surveys.admin.questions.noQuestions')}</p>
                  </div>
                )}
              </div>

              {/* Add Question Buttons - only show in original language */}
              {(!isEditing || selectedLanguage === multilingualSurvey?.originalLanguage) && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">{t('surveys.admin.questions.addQuestion')}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <button
                      onClick={() => addQuestion('single_choice')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.singleChoice')}
                    </button>
                    <button
                      onClick={() => addQuestion('multiple_choice')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.multipleChoice')}
                    </button>
                    <button
                      onClick={() => addQuestion('text')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.text')}
                    </button>
                    <button
                      onClick={() => addQuestion('textarea')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.textarea')}
                    </button>
                    <button
                      onClick={() => addQuestion('rating_5')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.rating5')}
                    </button>
                    <button
                      onClick={() => addQuestion('rating_10')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.rating10')}
                    </button>
                    <button
                      onClick={() => addQuestion('yes_no')}
                      className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <FiPlus className="mr-2 h-4 w-4" />
                      {t('surveys.admin.questions.questionTypes.yesNo')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Save Actions */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex justify-between items-center">
                <button
                  onClick={() => navigate('/admin/surveys')}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  {t('surveys.admin.surveyBuilder.cancel')}
                </button>
                
                <div className="flex items-center space-x-3">
                  {/* Validation Status Indicator */}
                  {survey.questions && survey.questions.length > 0 && (
                    <div className="flex items-center text-sm">
                      {validationState.isValid ? (
                        <span className="flex items-center text-green-600">
                          <span className="w-2 h-2 bg-green-500 rounded-full mr-2" />
                          {t('surveys.admin.validation.readyToSave')}
                        </span>
                      ) : (
                        <span className="flex items-center text-amber-600">
                          <span className="w-2 h-2 bg-amber-500 rounded-full mr-2" />
                          {validationState.emptyQuestions.length === 1 
                            ? t('surveys.admin.validation.needsAttention', { count: validationState.emptyQuestions.length })
                            : t('surveys.admin.validation.needsAttentionPlural', { count: validationState.emptyQuestions.length })
                          }
                        </span>
                      )}
                    </div>
                  )}
                  
                  <button
                    onClick={() => saveSurvey('draft')}
                    disabled={saving || (isEditing && selectedLanguage !== multilingualSurvey?.originalLanguage)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    <FiSave className="mr-2 h-4 w-4" />
                    {t('surveys.admin.saveDraft')}
                  </button>
                  
                  <button
                    onClick={() => saveSurvey('active')}
                    disabled={saving || (isEditing && selectedLanguage !== multilingualSurvey?.originalLanguage)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
                    {isEditing ? t('surveys.admin.updateAndPublish') : t('surveys.admin.createAndPublish')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SurveyBuilderWithTranslation;