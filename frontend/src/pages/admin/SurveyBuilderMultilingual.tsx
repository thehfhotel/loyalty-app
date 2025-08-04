import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FiPlus, FiSave, FiEye } from 'react-icons/fi';
import { Survey, SurveyQuestion, CreateSurveyRequest, QuestionType, SurveyAccessType, SurveyStatus } from '../../types/survey';
import { SupportedLanguage, MultilingualSurvey } from '../../types/multilingual';
import { surveyService } from '../../services/surveyService';
import { translationService } from '../../services/translationService';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageTabs from '../../components/translation/LanguageTabs';
import TranslationButton from '../../components/translation/TranslationButton';
import QuestionEditor from '../../components/surveys/QuestionEditor';
import SurveyPreview from '../../components/surveys/SurveyPreview';
import { getTextInLanguage, createMultilingualText, updateMultilingualText } from '../../utils/translationHelpers';
import toast from 'react-hot-toast';

const SurveyBuilderMultilingual: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  
  // UI State
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  
  // Language and Translation State
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>('th');
  const [availableLanguages, setAvailableLanguages] = useState<SupportedLanguage[]>(['th']);
  const [translationStatus, setTranslationStatus] = useState<{ [key in SupportedLanguage]?: 'original' | 'translated' | 'pending' | 'error' }>({
    'th': 'original'
  });
  
  // Survey Data State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [accessType, setAccessType] = useState<SurveyAccessType>('public');
  const [status, setStatus] = useState<SurveyStatus>('draft');
  
  // Translation data storage (for different languages)
  const [multilingualData, setMultilingualData] = useState<{
    title: { [key in SupportedLanguage]?: string };
    description: { [key in SupportedLanguage]?: string };
    questions: { [key in SupportedLanguage]?: SurveyQuestion[] };
  }>({
    title: { th: '' },
    description: { th: '' },
    questions: { th: [] }
  });

  useEffect(() => {
    if (id) {
      loadSurvey();
    }
  }, [id]);

  useEffect(() => {
    // Update current displayed content when language changes
    setTitle(multilingualData.title[currentLanguage] || '');
    setDescription(multilingualData.description[currentLanguage] || '');
    setQuestions(multilingualData.questions[currentLanguage] || []);
  }, [currentLanguage, multilingualData]);

  const loadSurvey = async () => {
    if (!id) {return;}
    
    try {
      setLoading(true);
      const survey = await surveyService.getSurveyById(id);
      
      if (survey) {
        // Initialize with existing data
        const originalLang = survey.original_language || 'th';
        
        setMultilingualData({
          title: { [originalLang]: survey.title },
          description: { [originalLang]: survey.description || '' },
          questions: { [originalLang]: survey.questions }
        });
        
        setAvailableLanguages((survey.available_languages as SupportedLanguage[]) || [originalLang]);
        setCurrentLanguage(originalLang as SupportedLanguage);
        setAccessType(survey.access_type);
        setStatus(survey.status);
        
        // Load translations if available
        await loadTranslations(id, (survey.available_languages as SupportedLanguage[]) || [originalLang]);
      }
    } catch (error) {
      console.error('Failed to load survey:', error);
      toast.error(t('surveys.admin.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadTranslations = async (surveyId: string, languages: SupportedLanguage[]) => {
    try {
      const translations: { [key in SupportedLanguage]?: any } = {};
      
      for (const language of languages) {
        try {
          const translatedSurvey = await surveyService.getSurveyWithTranslations(surveyId, language);
          if (translatedSurvey) {
            translations[language] = translatedSurvey;
          }
        } catch (error) {
          console.warn(`Failed to load ${language} translation:`, error);
        }
      }
      
      // Update multilingual data with translations
      const newMultilingualData = { ...multilingualData };
      const newTranslationStatus = { ...translationStatus };
      
      Object.entries(translations).forEach(([lang, data]) => {
        const language = lang as SupportedLanguage;
        if (data) {
          newMultilingualData.title[language] = data.title;
          newMultilingualData.description[language] = data.description || '';
          newMultilingualData.questions[language] = data.questions;
          newTranslationStatus[language] = 'translated';
        }
      });
      
      setMultilingualData(newMultilingualData);
      setTranslationStatus(newTranslationStatus);
      
    } catch (error) {
      console.error('Failed to load translations:', error);
    }
  };

  const updateCurrentLanguageData = () => {
    // Save current editing data to the multilingual store
    setMultilingualData(prev => ({
      ...prev,
      title: { ...prev.title, [currentLanguage]: title },
      description: { ...prev.description, [currentLanguage]: description },
      questions: { ...prev.questions, [currentLanguage]: questions }
    }));
  };

  const handleLanguageChange = (language: SupportedLanguage) => {
    // Save current language data before switching
    updateCurrentLanguageData();
    setCurrentLanguage(language);
  };

  const handleTranslate = async (targetLanguages: SupportedLanguage[]) => {
    if (!id) {
      toast.error(t('translation.saveSurveyFirst'));
      return;
    }

    try {
      setTranslating(true);
      
      // Update translation status to pending for target languages
      const newStatus = { ...translationStatus };
      targetLanguages.forEach(lang => {
        newStatus[lang] = 'pending';
      });
      setTranslationStatus(newStatus);

      // Start translation job
      const translationJob = await translationService.translateSurvey(
        id,
        currentLanguage,
        targetLanguages
      );

      toast.success(t('translation.translationStarted'));

      // Poll for completion
      pollTranslationProgress(translationJob.id, targetLanguages);

    } catch (error) {
      console.error('Translation failed:', error);
      toast.error(t('translation.translationFailed'));
      
      // Reset status on error
      const newStatus = { ...translationStatus };
      targetLanguages.forEach(lang => {
        newStatus[lang] = 'error';
      });
      setTranslationStatus(newStatus);
    } finally {
      setTranslating(false);
    }
  };

  const pollTranslationProgress = async (jobId: string, targetLanguages: SupportedLanguage[]) => {
    const pollInterval = setInterval(async () => {
      try {
        const job = await translationService.getTranslationJobStatus(jobId);
        
        if (job.status === 'completed') {
          clearInterval(pollInterval);
          
          // Update status to completed
          const newStatus = { ...translationStatus };
          targetLanguages.forEach(lang => {
            newStatus[lang] = 'translated';
          });
          setTranslationStatus(newStatus);
          
          // Add new languages to available languages
          const newAvailableLanguages = [...new Set([...availableLanguages, ...targetLanguages])];
          setAvailableLanguages(newAvailableLanguages);
          
          // Reload translations
          if (id) {
            await loadTranslations(id, newAvailableLanguages);
          }
          
          toast.success(t('translation.translationCompleted'));
          
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          
          const newStatus = { ...translationStatus };
          targetLanguages.forEach(lang => {
            newStatus[lang] = 'error';
          });
          setTranslationStatus(newStatus);
          
          toast.error(t('translation.translationFailed'));
        }
        
      } catch (error) {
        console.error('Failed to check translation status:', error);
        clearInterval(pollInterval);
      }
    }, 2000);

    // Clear interval after 5 minutes to prevent infinite polling
    setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
  };

  const addQuestion = () => {
    const newQuestion: SurveyQuestion = {
      id: `q_${Date.now()}`,
      type: 'text',
      text: '',
      required: false,
      order: questions.length
    };
    
    const newQuestions = [...questions, newQuestion];
    setQuestions(newQuestions);
    
    // Update multilingual data
    setMultilingualData(prev => ({
      ...prev,
      questions: { ...prev.questions, [currentLanguage]: newQuestions }
    }));
  };

  const updateQuestion = (questionId: string, updates: Partial<SurveyQuestion>) => {
    const newQuestions = questions.map(q => 
      q.id === questionId ? { ...q, ...updates } : q
    );
    setQuestions(newQuestions);
    
    // Update multilingual data
    setMultilingualData(prev => ({
      ...prev,
      questions: { ...prev.questions, [currentLanguage]: newQuestions }
    }));
  };

  const deleteQuestion = (questionId: string) => {
    const newQuestions = questions.filter(q => q.id !== questionId);
    setQuestions(newQuestions);
    
    // Update multilingual data
    setMultilingualData(prev => ({
      ...prev,
      questions: { ...prev.questions, [currentLanguage]: newQuestions }
    }));
  };

  const handleSave = async () => {
    // Update current language data before saving
    updateCurrentLanguageData();
    
    if (!title.trim()) {
      toast.error(t('surveys.admin.validation.titleRequired'));
      return;
    }

    if (questions.length === 0) {
      toast.error(t('surveys.admin.validation.questionsRequired'));
      return;
    }

    try {
      setSaving(true);

      const surveyData: CreateSurveyRequest = {
        title,
        description: description || undefined,
        questions,
        access_type: accessType,
        status,
        original_language: currentLanguage,
        // Note: autoTranslate handled separately if needed
      };

      let savedSurvey: Survey;
      
      if (id) {
        savedSurvey = await surveyService.updateSurvey(id, surveyData);
      } else {
        savedSurvey = await surveyService.createSurvey(surveyData);
      }

      toast.success(t('surveys.admin.saveSuccess'));

      if (!id) {
        // Navigate to edit mode for new surveys
        navigate(`/admin/surveys/builder/${savedSurvey.id}`);
      }

    } catch (error) {
      console.error('Save failed:', error);
      toast.error(t('surveys.admin.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    updateCurrentLanguageData();
    
    try {
      setSaving(true);
      
      if (id) {
        await surveyService.updateSurvey(id, { status: 'active' });
        setStatus('active');
        toast.success(t('surveys.admin.publishSuccess'));
      } else {
        // Save first, then publish
        await handleSave();
        // The save will redirect to edit mode where user can publish
      }
    } catch (error) {
      console.error('Publish failed:', error);
      toast.error(t('surveys.admin.errors.publishFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {id ? t('surveys.admin.editSurvey') : t('surveys.admin.createSurvey')}
            </h1>
            <p className="mt-2 text-gray-600">
              {t('surveys.admin.builderDescription')}
            </p>
          </div>
          <DashboardButton />
        </div>

        {/* Language Tabs */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-gray-900">
              {t('translation.languages')}
            </h2>
            {id && (
              <TranslationButton
                onTranslate={handleTranslate}
                isTranslating={translating}
                availableLanguages={availableLanguages}
                originalLanguage={availableLanguages[0] || 'th'}
              />
            )}
          </div>
          
          <LanguageTabs
            languages={availableLanguages}
            currentLanguage={currentLanguage}
            onLanguageChange={handleLanguageChange}
            translationStatus={translationStatus}
          />
        </div>

        {/* Survey Form */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          {/* Basic Information */}
          <div className="mb-8">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              {t('surveys.admin.basicInformation')}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('surveys.admin.surveyTitle')} *
                </label>
                <input
                  type="text"
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder={t('surveys.admin.surveyTitlePlaceholder')}
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('surveys.admin.surveyDescription')}
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder={t('surveys.admin.surveyDescriptionPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="accessType" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('surveys.admin.accessType')}
                  </label>
                  <select
                    id="accessType"
                    value={accessType}
                    onChange={(e) => setAccessType(e.target.value as SurveyAccessType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="public">{t('surveys.admin.accessTypes.public')}</option>
                    <option value="invite_only">{t('surveys.admin.accessTypes.inviteOnly')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('surveys.admin.status')}
                  </label>
                  <select
                    id="status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SurveyStatus)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="draft">{t('surveys.admin.statuses.draft')}</option>
                    <option value="active">{t('surveys.admin.statuses.active')}</option>
                    <option value="paused">{t('surveys.admin.statuses.paused')}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Questions Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900">
                {t('surveys.admin.questions')}
              </h2>
              <button
                onClick={addQuestion}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <FiPlus className="w-4 h-4 mr-2" />
                {t('surveys.admin.addQuestion')}
              </button>
            </div>

            <div className="space-y-4">
              {questions.map((question, index) => (
                <QuestionEditor
                  key={question.id}
                  question={question}
                  index={index}
                  questionNumber={index + 1}
                  onUpdate={(updates) => updateQuestion(question.id, updates)}
                  onRemove={() => deleteQuestion(question.id)}
                  onReorder={(fromIndex, toIndex) => {}} 
                  canMove={false}
                />
              ))}
              
              {questions.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>{t('surveys.admin.noQuestions')}</p>
                  <button
                    onClick={addQuestion}
                    className="mt-2 text-primary-600 hover:text-primary-700 font-medium"
                  >
                    {t('surveys.admin.addFirstQuestion')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-200">
            <button
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <FiEye className="w-4 h-4 mr-2" />
              {t('surveys.admin.preview')}
            </button>

            <div className="flex space-x-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiSave className="w-4 h-4 mr-2" />
                {saving ? t('common.saving') : t('common.save')}
              </button>

              {status !== 'active' && (
                <button
                  onClick={handlePublish}
                  disabled={saving}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t('common.saving') : t('surveys.admin.publish')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Preview Modal */}
        {showPreview && (
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  {t('surveys.admin.preview')}
                </h3>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="p-6">
                <SurveyPreview
                  survey={{
                    id: id || 'preview',
                    title,
                    description,
                    questions,
                    target_segment: {},
                    status,
                    access_type: accessType,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }}
                  onClose={() => setShowPreview(false)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SurveyBuilderMultilingual;