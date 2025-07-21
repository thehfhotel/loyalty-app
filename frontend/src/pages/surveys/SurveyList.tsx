import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Survey } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import { useAuthStore } from '../../store/authStore';
import DashboardButton from '../../components/navigation/DashboardButton';

const SurveyList: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSurveys();
  }, []);

  const loadSurveys = async () => {
    try {
      setLoading(true);
      setError(null);
      const availableSurveys = await surveyService.getAvailableSurveys();
      setSurveys(availableSurveys);
    } catch (err: any) {
      console.error('Error loading surveys:', err);
      setError(err.response?.data?.message || t('surveys.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold text-gray-900">
                {t('surveys.title', 'Surveys')}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {surveys.length === 0 && !loading && !error ? (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg mb-4">
              📋 {t('surveys.noSurveys', 'No surveys available')}
            </div>
            <p className="text-gray-400">
              {t('surveys.noSurveysDesc', 'Check back later for new surveys to complete.')}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {surveys.map((survey) => (
              <div
                key={survey.id}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">
                        {survey.title}
                      </h3>
                      {survey.description && (
                        <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                          {survey.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                    <span>
                      {survey.questions.length} {t('surveys.questions', 'questions')}
                    </span>
                    <span>
                      {t('surveys.created')}: {formatDate(survey.created_at)}
                    </span>
                  </div>

                  <div className="flex space-x-3">
                    <Link
                      to={`/surveys/${survey.id}`}
                      className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors text-center"
                    >
                      {t('surveys.takeSurvey', 'Take Survey')}
                    </Link>
                    <Link
                      to={`/surveys/${survey.id}/details`}
                      className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors text-center"
                    >
                      {t('surveys.viewDetails', 'View Details')}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Refresh button */}
        <div className="mt-8 text-center">
          <button
            onClick={loadSurveys}
            disabled={loading}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? t('common.loading', 'Loading...') : t('common.refresh', 'Refresh')}
          </button>
        </div>
      </main>
    </div>
  );
};

export default SurveyList;