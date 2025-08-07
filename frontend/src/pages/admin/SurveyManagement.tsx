import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FiPlus, FiEdit, FiTrash2, FiEye, FiBarChart, FiDownload, FiUsers, FiFileText, FiMail, FiGlobe, FiLock, FiGift } from 'react-icons/fi';
import { Survey } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import DashboardButton from '../../components/navigation/DashboardButton';
import SurveyCouponAssignments from '../../components/surveys/SurveyCouponAssignments';
import toast from 'react-hot-toast';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';

const SurveyManagement: React.FC = () => {
  const { t } = useTranslation();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedSurveyForCoupons, setSelectedSurveyForCoupons] = useState<Survey | null>(null);

  const loadSurveys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await surveyService.getSurveys(currentPage, 10, statusFilter);
      setSurveys(response.surveys);
      setTotalPages(response.pagination.totalPages);
    } catch (err: any) {
      console.error('Error loading surveys:', err);
      setError(err.response?.data?.message || 'Failed to load surveys');
      toast.error('Failed to load surveys');
    } finally {
      setLoading(false);
    }
  }, [currentPage, statusFilter]);

  useEffect(() => {
    loadSurveys();
  }, [currentPage, statusFilter, loadSurveys]);

  const handleDeleteSurvey = async (surveyId: string) => {
    if (!confirm('Are you sure you want to delete this survey? This action cannot be undone.')) {
      return;
    }

    try {
      await surveyService.deleteSurvey(surveyId);
      toast.success('Survey deleted successfully');
      loadSurveys();
    } catch (err: any) {
      console.error('Error deleting survey:', err);
      toast.error(err.response?.data?.message || 'Failed to delete survey');
    }
  };

  const handleExportResponses = async (surveyId: string, surveyTitle: string) => {
    try {
      const blob = await surveyService.exportSurveyResponses(surveyId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `survey-${surveyTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-responses.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Survey responses exported successfully');
    } catch (err: any) {
      console.error('Error exporting responses:', err);
      toast.error('Failed to export survey responses');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'paused': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-blue-100 text-blue-800';
      case 'archived': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAccessTypeColor = (accessType: string) => {
    switch (accessType) {
      case 'public': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'invite_only': return 'bg-purple-50 text-purple-700 border-purple-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getAccessTypeLabel = (accessType: string) => {
    switch (accessType) {
      case 'public': return (
        <>
          <FiGlobe className="mr-1 h-3 w-3" />
          Public
        </>
      );
      case 'invite_only': return (
        <>
          <FiLock className="mr-1 h-3 w-3" />
          Invite Only
        </>
      );
      default: return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
            <span className="ml-3 text-gray-600">Loading surveys...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold text-gray-900">Survey Management</h1>
            </div>
            <div className="flex items-center space-x-4">
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Actions Bar */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <Link
                to="/admin/surveys/create"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiPlus className="mr-2 h-4 w-4" />
                Create Survey
              </Link>
              
              <Link
                to="/admin/surveys/templates"
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiFileText className="mr-2 h-4 w-4" />
                Templates
              </Link>
              
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              >
                <option value="">All Status</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-4">
              <p>{error}</p>
            </div>
          )}

          {/* Survey List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Surveys ({surveys.length})
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                Manage and monitor your customer surveys
              </p>
            </div>

            {surveys.length > 0 ? (
              <div className="border-t border-gray-200">
                <ul className="divide-y divide-gray-200">
                  {surveys.map((survey) => (
                    <li key={survey.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center min-w-0 flex-1">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center">
                              <p className="text-lg font-semibold text-gray-900 truncate">
                                {survey.title}
                              </p>
                              <span className={`ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(survey.status)}`}>
                                {survey.status}
                              </span>
                              <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${getAccessTypeColor(survey.access_type)}`}>
                                {getAccessTypeLabel(survey.access_type)}
                              </span>
                            </div>
                            {survey.description && (
                              <p className="mt-1 text-sm text-gray-600 truncate">
                                {survey.description}
                              </p>
                            )}
                            <div className="mt-2 flex items-center text-xs text-gray-500 space-x-4">
                              <span className="flex items-center">
                                <FiUsers className="mr-1 h-3 w-3" />
                                {survey.questions.length} questions
                              </span>
                              <span>Created: {formatDateToDDMMYYYY(survey.created_at)}</span>
                              <span>Updated: {formatDateToDDMMYYYY(survey.updated_at)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Link
                            to={`/admin/surveys/${survey.id}/preview`}
                            className="p-2 text-gray-400 hover:text-gray-600"
                            title="Preview survey"
                          >
                            <FiEye className="h-4 w-4" />
                          </Link>
                          
                          <Link
                            to={`/admin/surveys/${survey.id}/analytics`}
                            className="p-2 text-gray-400 hover:text-blue-600"
                            title="View analytics"
                          >
                            <FiBarChart className="h-4 w-4" />
                          </Link>
                          
                          <Link
                            to={`/admin/surveys/${survey.id}/invitations`}
                            className="p-2 text-gray-400 hover:text-purple-600"
                            title="Manage invitations"
                          >
                            <FiMail className="h-4 w-4" />
                          </Link>
                          
                          <button
                            onClick={() => setSelectedSurveyForCoupons(survey)}
                            className="p-2 text-gray-400 hover:text-orange-600"
                            title="Manage survey rewards"
                          >
                            <FiGift className="h-4 w-4" />
                          </button>
                          
                          <button
                            onClick={() => handleExportResponses(survey.id, survey.title)}
                            className="p-2 text-gray-400 hover:text-green-600"
                            title="Export responses"
                          >
                            <FiDownload className="h-4 w-4" />
                          </button>
                          
                          <Link
                            to={`/admin/surveys/${survey.id}/edit`}
                            className="p-2 text-gray-400 hover:text-blue-600"
                            title="Edit survey"
                          >
                            <FiEdit className="h-4 w-4" />
                          </Link>
                          
                          <button
                            onClick={() => handleDeleteSurvey(survey.id)}
                            className="p-2 text-gray-400 hover:text-red-600"
                            title="Delete survey"
                          >
                            <FiTrash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="border-t border-gray-200 p-6 text-center">
                <div className="text-gray-500">
                  <FiBarChart className="mx-auto h-12 w-12 mb-4" />
                  <h3 className="text-lg font-medium mb-2">No surveys found</h3>
                  <p className="mb-4">Get started by creating your first customer survey.</p>
                  <Link
                    to="/admin/surveys/create"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    Create Survey
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6 mt-4 rounded-lg shadow">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Page <span className="font-medium">{currentPage}</span> of{' '}
                    <span className="font-medium">{totalPages}</span>
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          page === currentPage
                            ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Survey Coupon Assignment Modal */}
      {selectedSurveyForCoupons && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-6xl shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {t('surveys.admin.couponAssignment.title')} - {selectedSurveyForCoupons.title || t('surveys.untitled')}
              </h3>
              <button
                onClick={() => setSelectedSurveyForCoupons(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <SurveyCouponAssignments
              surveyId={selectedSurveyForCoupons.id}
              surveyTitle={selectedSurveyForCoupons.title}
              surveyStatus={selectedSurveyForCoupons.status}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default SurveyManagement;