import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  FiArrowLeft, 
  FiDownload, 
  FiUsers, 
  FiCheckCircle, 
  FiClock,
  FiBarChart,
  FiPieChart,
  FiTrendingUp
} from 'react-icons/fi';
import { Survey, SurveyResponse } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import DashboardButton from '../../components/navigation/DashboardButton';
import toast from 'react-hot-toast';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ChartData,
  ChartOptions
} from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

interface AnalyticsData {
  survey: Survey;
  responses: SurveyResponse[];
  totalResponses: number;
  completionRate: number;
  averageCompletionTime: number;
  responsesByDate: { date: string; count: number }[];
  questionAnalytics: {
    questionId: string;
    question: string;
    type: string;
    responses: Record<string, number>;
    averageRating?: number;
  }[];
}

const SurveyAnalytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadAnalytics();
    }
  }, [id]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const analyticsData = await surveyService.getSurveyAnalytics(id!);
      setAnalytics(analyticsData);
    } catch (err: any) {
      console.error('Error loading analytics:', err);
      setError(err.response?.data?.message || 'Failed to load analytics');
      toast.error('Failed to load survey analytics');
    } finally {
      setLoading(false);
    }
  };

  const handleExportAnalytics = async () => {
    try {
      const blob = await surveyService.exportSurveyResponses(id!);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `survey-${analytics?.survey.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-analytics.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Analytics exported successfully');
    } catch (err: any) {
      console.error('Error exporting analytics:', err);
      toast.error('Failed to export analytics');
    }
  };

  const getChartOptions = (title: string): ChartOptions<any> => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: title,
        font: {
          size: 16
        }
      },
    },
  });

  const getResponseTrendData = (): ChartData<'line'> => {
    if (!analytics) return { labels: [], datasets: [] };

    return {
      labels: analytics.responsesByDate.map(d => d.date),
      datasets: [
        {
          label: 'Daily Responses',
          data: analytics.responsesByDate.map(d => d.count),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4
        }
      ]
    };
  };

  const getQuestionChartData = (question: any): ChartData<'bar' | 'pie'> => {
    const labels = Object.keys(question.responses);
    const data = Object.values(question.responses) as number[];
    
    const backgroundColors = [
      'rgba(255, 99, 132, 0.6)',
      'rgba(54, 162, 235, 0.6)',
      'rgba(255, 206, 86, 0.6)',
      'rgba(75, 192, 192, 0.6)',
      'rgba(153, 102, 255, 0.6)',
      'rgba(255, 159, 64, 0.6)',
    ];

    return {
      labels,
      datasets: [{
        label: 'Responses',
        data,
        backgroundColor: backgroundColors.slice(0, labels.length),
        borderColor: backgroundColors.slice(0, labels.length).map(c => c.replace('0.6', '1')),
        borderWidth: 1
      }]
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Loading analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            <p>{error || 'Survey not found'}</p>
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
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Survey Analytics</h1>
                <p className="text-sm text-gray-600 mt-1">{analytics.survey.title}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleExportAnalytics}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <FiDownload className="mr-2 h-4 w-4" />
                Export CSV
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiUsers className="h-8 w-8 text-blue-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Total Responses</p>
                  <p className="text-2xl font-semibold text-gray-900">{analytics.totalResponses}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiCheckCircle className="h-8 w-8 text-green-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Completion Rate</p>
                  <p className="text-2xl font-semibold text-gray-900">{analytics.completionRate.toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiClock className="h-8 w-8 text-yellow-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Avg. Completion Time</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {Math.floor(analytics.averageCompletionTime / 60)}m {analytics.averageCompletionTime % 60}s
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiBarChart className="h-8 w-8 text-purple-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Questions</p>
                  <p className="text-2xl font-semibold text-gray-900">{analytics.survey.questions.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Response Trend */}
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <FiTrendingUp className="mr-2 h-5 w-5" />
              Response Trend
            </h2>
            <div className="h-64">
              <Line 
                data={getResponseTrendData()} 
                options={getChartOptions('Daily Response Count')}
              />
            </div>
          </div>

          {/* Question Analytics */}
          <div className="space-y-8">
            <h2 className="text-lg font-semibold text-gray-900">Question Breakdown</h2>
            
            {analytics.questionAnalytics.map((question, index) => (
              <div key={question.questionId} className="bg-white rounded-lg shadow p-6">
                <h3 className="text-md font-semibold text-gray-900 mb-4">
                  Q{index + 1}: {question.question}
                </h3>
                
                {/* Chart based on question type */}
                {(question.type === 'multiple_choice' || question.type === 'single_choice') && (
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="h-64">
                      <Bar 
                        data={getQuestionChartData(question)} 
                        options={getChartOptions('Response Distribution')}
                      />
                    </div>
                    <div className="h-64">
                      <Pie 
                        data={getQuestionChartData(question)} 
                        options={getChartOptions('Response Percentage')}
                      />
                    </div>
                  </div>
                )}
                
                {(question.type === 'rating_5' || question.type === 'rating_10') && (
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="h-64">
                      <Bar 
                        data={getQuestionChartData(question)} 
                        options={getChartOptions('Rating Distribution')}
                      />
                    </div>
                    <div className="flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-gray-500 text-sm">Average Rating</p>
                        <p className="text-5xl font-bold text-blue-600">
                          {question.averageRating?.toFixed(1) || '0'}
                        </p>
                        <p className="text-gray-500 text-sm">
                          out of {question.type === 'rating_5' ? '5' : '10'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                {question.type === 'yes_no' && (
                  <div className="h-64 max-w-md mx-auto">
                    <Pie 
                      data={getQuestionChartData(question)} 
                      options={getChartOptions('Yes/No Distribution')}
                    />
                  </div>
                )}
                
                {(question.type === 'text' || question.type === 'textarea') && (
                  <div className="bg-gray-50 rounded p-4">
                    <p className="text-gray-600">
                      {Object.keys(question.responses).length} text responses collected
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      Text responses are included in the CSV export
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default SurveyAnalytics;