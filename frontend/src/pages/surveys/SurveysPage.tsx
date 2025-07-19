import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Search, QrCode, Award, Calendar, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { SurveyCard } from '../../components/surveys/SurveyCard';
import { 
  surveyService, 
  Survey, 
  SurveyWithProgress 
} from '../../services/surveyService';
import toast from 'react-hot-toast';

type TabType = 'available' | 'completed';

const SurveysPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('available');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyWithProgress[]>([]);

  useEffect(() => {
    loadSurveys();
  }, []);

  const loadSurveys = async () => {
    setIsLoading(true);
    try {
      const surveyData = await surveyService.getActiveSurveys();
      setSurveys(surveyData);
    } catch (error) {
      toast.error('Failed to load surveys');
      console.error('Error loading surveys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartSurvey = async (survey: Survey) => {
    try {
      const response = await surveyService.startSurveyResponse(survey.id);
      
      // Navigate to survey taking page with response ID
      navigate(`/surveys/take/${response.id}`, {
        state: { survey }
      });
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to start survey');
    }
  };

  const handleContinueSurvey = (survey: Survey) => {
    // For started surveys, we'd navigate to the survey taking page
    // with the existing response ID
    toast.info('Continue survey functionality will be implemented');
  };

  const getFilteredSurveys = () => {
    let filteredSurveys = surveys;

    // Filter by tab
    if (activeTab === 'available') {
      filteredSurveys = surveys.filter(survey => 
        !survey.isCompleted && surveyService.isSurveyAvailable(survey)
      );
    } else if (activeTab === 'completed') {
      filteredSurveys = surveys.filter(survey => survey.isCompleted);
    }

    // Apply search filter
    if (searchQuery) {
      filteredSurveys = filteredSurveys.filter(survey =>
        survey.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        survey.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        survey.code.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filteredSurveys;
  };

  const getStats = () => {
    const available = surveys.filter(s => !s.isCompleted && surveyService.isSurveyAvailable(s)).length;
    const completed = surveys.filter(s => s.isCompleted).length;
    const inProgress = surveys.filter(s => s.isStarted && !s.isCompleted).length;
    const totalPoints = surveys
      .filter(s => s.isCompleted)
      .reduce((sum, s) => sum + s.pointsReward, 0);

    return { available, completed, inProgress, totalPoints };
  };

  const stats = getStats();
  const filteredSurveys = getFilteredSurveys();

  const tabs = [
    { id: 'available' as TabType, label: 'Available', icon: ClipboardList, count: stats.available },
    { id: 'completed' as TabType, label: 'Completed', icon: Calendar, count: stats.completed }
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Surveys</h1>
          <p className="text-gray-600 mt-1">Share your feedback and earn points</p>
        </div>
        <Button
          variant="secondary"
          leftIcon={<QrCode className="w-4 h-4" />}
          onClick={() => {
            // QR scanner functionality would go here
            toast.info('QR scanner coming soon!');
          }}
        >
          Scan QR
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Available</p>
                <p className="text-2xl font-bold text-gray-900">{stats.available}</p>
              </div>
              <div className="bg-blue-100 p-2 rounded-lg">
                <ClipboardList className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">In Progress</p>
                <p className="text-2xl font-bold text-gray-900">{stats.inProgress}</p>
              </div>
              <div className="bg-orange-100 p-2 rounded-lg">
                <TrendingUp className="w-5 h-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
              </div>
              <div className="bg-green-100 p-2 rounded-lg">
                <Calendar className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Points Earned</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalPoints}</p>
              </div>
              <div className="bg-primary-100 p-2 rounded-lg">
                <Award className="w-5 h-5 text-primary-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <Badge variant="secondary" size="sm">
                  {tab.count}
                </Badge>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="Search surveys..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" text="Loading surveys..." />
        </div>
      ) : filteredSurveys.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <ClipboardList className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {activeTab === 'available' ? 'No available surveys' : 'No completed surveys'}
            </h3>
            <p className="text-gray-600">
              {activeTab === 'available' 
                ? 'Check back later for new surveys to participate in.'
                : 'Complete surveys to see them here and earn points.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSurveys.map((survey) => (
            <SurveyCard
              key={survey.id}
              survey={survey}
              variant={
                survey.isCompleted ? 'completed' :
                survey.isStarted ? 'started' : 'available'
              }
              onStart={handleStartSurvey}
              onContinue={handleContinueSurvey}
            />
          ))}
        </div>
      )}

      {/* Help Section */}
      {activeTab === 'available' && !isLoading && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-primary-600" />
              How Survey Points Work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">📝 Complete Surveys</h4>
                <p className="text-gray-600">
                  Answer all required questions honestly and thoroughly to earn points.
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-2">⏰ Limited Time</h4>
                <p className="text-gray-600">
                  Most surveys have expiration dates, so complete them soon after starting.
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-2">🎁 Earn Rewards</h4>
                <p className="text-gray-600">
                  Points are automatically added to your account upon survey completion.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SurveysPage;