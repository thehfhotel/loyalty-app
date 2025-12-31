import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FiUsers, FiEye, FiCalendar, FiRefreshCw } from 'react-icons/fi';
import { Survey } from '../../types/survey';
import { useAuthRedirect } from '../../hooks/useAuthRedirect';
import DashboardButton from '../../components/navigation/DashboardButton';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { trpc } from '../../hooks/useTRPC';
import { getTRPCErrorMessage } from '../../hooks/useTRPC';

const SurveyList: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthRedirect(); // Additional auth check
  const [activeTab, setActiveTab] = useState<'public' | 'invited'>('public');

  // Fetch public surveys using tRPC
  const {
    data: publicSurveys = [],
    isLoading: loadingPublic,
    error: publicError,
    refetch: refetchPublic
  } = trpc.survey.getPublicSurveys.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Fetch invited surveys using tRPC
  const {
    data: invitedSurveys = [],
    isLoading: loadingInvited,
    error: invitedError,
    refetch: refetchInvited
  } = trpc.survey.getInvitedSurveys.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const loading = loadingPublic || loadingInvited;
  const error = publicError ?? invitedError;
  const errorMessage = error ? getTRPCErrorMessage(error) : null;

  const loadSurveys = async () => {
    await Promise.all([refetchPublic(), refetchInvited()]);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const renderSurveyCard = (survey: Survey) => (
    <div
      key={survey.id}
      className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col h-full"
    >
      <div className="p-6 flex flex-col h-full">
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <h3 className="text-xl font-semibold text-gray-900">
                  {survey.title}
                </h3>
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  survey.access_type === 'public' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-blue-100 text-blue-800'
                }`}
                >
                  {survey.access_type === 'public' ? (
                    <>
                      <FiUsers className="mr-1 h-3 w-3" />
                      Public
                    </>
                  ) : (
                    <>
                      <FiEye className="mr-1 h-3 w-3" />
                      Invited
                    </>
                  )}
                </span>
              </div>
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
            <span className="flex items-center">
              <FiCalendar className="mr-1 h-3 w-3" />
              {formatDate(survey.created_at)}
            </span>
          </div>
        </div>

        <div className="flex space-x-3 mt-auto">
          <Link
            to={`/surveys/${survey.id}/take`}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center"
          >
            {t('surveys.takeSurvey', 'Take Survey')}
          </Link>
          <Link
            to={`/surveys/${survey.id}/details`}
            className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors flex items-center justify-center"
          >
            {t('surveys.viewDetails', 'View Details')}
          </Link>
        </div>
      </div>
    </div>
  );

  const currentSurveys = activeTab === 'public' ? publicSurveys : invitedSurveys;

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
              <button
                onClick={loadSurveys}
                disabled={loading}
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <FiRefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <LanguageSwitcher />
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4">
        {loading && (
          <div className="mb-6">
            <div className="flex justify-center items-center h-24 bg-white rounded-md border border-gray-200">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              <span className="ml-3 text-gray-600">{t('surveys.loading')}</span>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Survey Type Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('public')}
                className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'public'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center">
                  <FiUsers className="mr-2 h-4 w-4" />
                  {t('surveys.tabs.public')} {t('surveys.title')} ({publicSurveys.length})
                </div>
              </button>
              <button
                onClick={() => setActiveTab('invited')}
                className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'invited'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center">
                  <FiEye className="mr-2 h-4 w-4" />
                  {t('surveys.tabs.invited')} {t('surveys.title')} ({invitedSurveys.length})
                </div>
              </button>
            </nav>
          </div>
        </div>

        {/* Survey Description */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start">
            {activeTab === 'public' ? (
              <FiUsers className="flex-shrink-0 h-5 w-5 text-blue-600 mt-0.5 mr-3" />
            ) : (
              <FiEye className="flex-shrink-0 h-5 w-5 text-blue-600 mt-0.5 mr-3" />
            )}
            <div>
              <h3 className="text-sm font-medium text-blue-900 mb-1">
                {activeTab === 'public' ? 'Public Surveys' : 'Invited Surveys'}
              </h3>
              <p className="text-sm text-blue-800">
                {activeTab === 'public' 
                  ? 'These surveys are available to all users in the app. Complete them anytime to share your feedback.'
                  : 'These surveys are specifically for you. You were personally invited to participate in these surveys.'
                }
              </p>
            </div>
          </div>
        </div>

        {currentSurveys.length === 0 && !loading && !errorMessage ? (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg mb-4">
              {activeTab === 'public' ? '📋' : '✉️'} {t('surveys.noSurveys', 'No surveys available')}
            </div>
            <p className="text-gray-400">
              {activeTab === 'public' 
                ? t('surveys.noPublicSurveys', 'No public surveys are currently available. Check back later!')
                : t('surveys.noInvitedSurveys', 'You haven\'t been invited to any surveys yet.')
              }
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {currentSurveys.map((survey) => renderSurveyCard(survey))}
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
