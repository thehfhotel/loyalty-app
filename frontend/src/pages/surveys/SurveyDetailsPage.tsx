import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FiArrowLeft, FiCalendar, FiUsers, FiEye } from 'react-icons/fi';
import { Survey } from '../../types/survey';
import SurveyPreview from '../../components/surveys/SurveyPreview';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import toast from 'react-hot-toast';
import { trpc } from '../../hooks/useTRPC';
import { getTRPCErrorMessage } from '../../hooks/useTRPC';

const SurveyDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  // Fetch survey using tRPC
  const {
    data: survey,
    isLoading: loading,
    error: surveyError
  } = trpc.survey.getSurveyById.useQuery(
    { surveyId: id ?? '' },
    {
      enabled: !!id
    }
  );

  // Show error toast when error occurs
  React.useEffect(() => {
    if (surveyError) {
      toast.error(t('surveys.errors.loadFailed'));
    }
  }, [surveyError, t]);

  const error = surveyError ? getTRPCErrorMessage(surveyError) : null;

  // Memoize date formatting for performance
  const formatDate = useMemo(() => (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  }, []);

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
                  <h1 className="text-2xl font-bold text-gray-900">{survey.title}</h1>
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
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {survey.description && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('surveys.description')}</h2>
            <p className="text-gray-600">{survey.description}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('surveys.preview', { count: survey.questions?.length ?? 0 })}
          </h2>
          <SurveyPreview
            survey={survey as Survey}
            onClose={() => window.history.back()}
          />
        </div>
      </main>
    </div>
  );
};

export default SurveyDetailsPage;
