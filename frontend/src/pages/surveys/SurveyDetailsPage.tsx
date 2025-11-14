import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FiArrowLeft, FiCalendar, FiUsers, FiEye } from 'react-icons/fi';
import { Survey } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import { translationService } from '../../services/translationService';
import SurveyPreview from '../../components/surveys/SurveyPreview';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import LanguageTabs from '../../components/translation/LanguageTabs';
import { MultilingualSurvey, SupportedLanguage } from '../../types/multilingual';
import toast from 'react-hot-toast';

const SurveyDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [multilingualSurvey, setMultilingualSurvey] = useState<MultilingualSurvey | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('th');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);

  useEffect(() => {
    if (id) {
      loadSurvey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadSurvey = async () => {
    if (!id) {
      setError('Survey ID is required');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const [surveyData, translationsData] = await Promise.all([
        surveyService.getSurveyById(id),
        translationService.getSurveyTranslations(id)
      ]);
      
      setSurvey(surveyData);
      
      // Load translations if available
      if (translationsData) {
        const multilingualData: MultilingualSurvey = {
          ...translationsData,
          originalLanguage: translationsData.original_language || 'th',
          availableLanguages: translationsData.available_languages || ['th'],
          translationStatus: 'none',
          translations: translationsData.translations || {}
        };
        
        setMultilingualSurvey(multilingualData);
        
        setSelectedLanguage(translationsData.original_language || 'th');
      }
    } catch (err) {
      console.error('Error loading survey:', err);
      const errorMessage = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(errorMessage || t('surveys.errors.loadFailed'));
      toast.error(t('surveys.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Memoize display content calculation for performance
  const getDisplayContent = useCallback(() => {
    if (!survey) {return null;}
    
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

    type Translation = { title?: string; description?: string; questions?: unknown[] };
    return {
      ...survey,
      title: (translation as Translation)?.title || survey.title,
      description: (translation as Translation)?.description || survey.description,
      questions: (translation as Translation)?.questions || survey.questions
    };
  }, [survey, multilingualSurvey, selectedLanguage]);

  // Memoize date formatting for performance
  const formatDate = useMemo(() => (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  }, []);

  // Optimized language change handler with loading state
  const handleLanguageChange = useCallback(async (language: SupportedLanguage) => {
    if (language === selectedLanguage || translationLoading) {return;}
    
    setTranslationLoading(true);
    try {
      // Add a small delay to show loading state for better UX
      await new Promise(resolve => setTimeout(resolve, 150));
      setSelectedLanguage(language);
    } finally {
      setTranslationLoading(false);
    }
  }, [selectedLanguage, translationLoading]);

  // Get display content based on selected language (moved here to fix hooks order)
  const displayContent = useMemo(() => getDisplayContent(), [getDisplayContent]);

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

   
  if (error || !survey) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-4">
          <div className="text-center py-12">
            <div className="text-red-500 text-xl mb-4">
              {error ?? t('surveys.notFound')}
            </div>
            <Link
              to="/surveys"
              className="inline-flex items-center text-blue-600 hover:text-blue-800"
            >
              <FiArrowLeft className="mr-2 h-4 w-4" />
              {t('surveys.backToSurveys')}
            </Link>
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
              <Link
                to="/surveys"
                className="mr-4 text-gray-400 hover:text-gray-600"
              >
                <FiArrowLeft className="h-6 w-6" />
              </Link>
              <div className="flex items-center">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{displayContent?.title}</h1>
                  <div className="flex items-center space-x-4 text-sm text-gray-500 mt-1">
                    <span className="flex items-center">
                      <FiCalendar className="mr-1 h-3 w-3" />
                      {t('surveys.created')} {formatDate(survey.created_at)}
                    </span>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      survey.access_type === 'public' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-blue-100 text-blue-800'
                    }`}
                    >
                      {survey.access_type === 'public' ? (
                        <>
                          <FiUsers className="mr-1 h-3 w-3" />
                          {t('surveys.accessType.public')}
                        </>
                      ) : (
                        <>
                          <FiEye className="mr-1 h-3 w-3" />
                          {t('surveys.accessType.invited')}
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <span className="ml-4 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                  {selectedLanguage.toUpperCase()}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to={`/surveys/${survey.id}/take`}
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                {t('surveys.takeSurvey')}
              </Link>
              <LanguageSwitcher />
              <DashboardButton variant="outline" size="sm" />
            </div>
          </div>
          
          {/* Language Tabs - show if we have multilingual survey data */}
          {multilingualSurvey && (
            <div className="border-t border-gray-200">
              <div className="px-4 sm:px-6 lg:px-8">
                <LanguageTabs
                  languages={['th', 'en', 'zh-CN']}
                  currentLanguage={selectedLanguage}
                  onLanguageChange={handleLanguageChange}
                  isLoading={translationLoading}
                  aria-label={t('translation.languages')}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {displayContent?.description && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('surveys.description')}</h2>
            <p className="text-gray-600">{displayContent.description}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('surveys.preview', { count: displayContent?.questions?.length || 0 })}
          </h2>
          <SurveyPreview 
            survey={displayContent ?? survey} 
            onClose={() => window.history.back()} 
          />
        </div>
      </main>
    </div>
  );
};

export default SurveyDetailsPage;