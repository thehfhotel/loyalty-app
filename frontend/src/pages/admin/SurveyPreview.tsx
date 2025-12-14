import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { Survey } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import SurveyPreview from '../../components/surveys/SurveyPreview';
import DashboardButton from '../../components/navigation/DashboardButton';
import toast from 'react-hot-toast';
import { logger } from '../../utils/logger';

const SurveyPreviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      
      const surveyData = await surveyService.getSurveyById(id);
      setSurvey(surveyData);
    } catch (err) {
      logger.error('Error loading survey:', err);
      const errorMessage = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(errorMessage ?? 'Failed to load survey');
      toast.error('Failed to load survey');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
            <span className="ml-3 text-gray-600">Loading survey...</span>
          </div>
        </div>
      </div>
    );
  }

   
  if (error || !survey) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            <p>{error ?? 'Survey not found'}</p>
            <Link to="/admin/surveys" className="text-red-800 underline mt-2 inline-block">
              Back to Surveys
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link
                to="/admin/surveys"
                className="mr-4 text-gray-400 hover:text-gray-600"
              >
                <FiArrowLeft className="h-6 w-6" />
              </Link>
              <h1 className="text-3xl font-bold text-gray-900">Survey Preview</h1>
            </div>
            <div className="flex items-center space-x-4">
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <SurveyPreview 
            survey={survey} 
            onClose={() => window.history.back()} 
          />
        </div>
      </main>
    </div>
  );
};

export default SurveyPreviewPage;