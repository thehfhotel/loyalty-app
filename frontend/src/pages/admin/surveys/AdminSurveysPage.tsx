import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Download,
  BarChart3,
  Settings,
  Users,
  TrendingUp,
  ClipboardList
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { CreateSurveyModal } from '../../../components/admin/surveys/CreateSurveyModal';
import { AdminSurveyCard } from '../../../components/admin/surveys/AdminSurveyCard';
import { SurveyAnalyticsModal } from '../../../components/admin/surveys/SurveyAnalyticsModal';
import { adminSurveyService, type AdminSurvey } from '../../../services/adminSurveyService';
import toast from 'react-hot-toast';

type TabType = 'all' | 'active' | 'expired' | 'draft';

const AdminSurveysPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [surveys, setSurveys] = useState<AdminSurvey[]>([]);
  
  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedSurveyForAnalytics, setSelectedSurveyForAnalytics] = useState<AdminSurvey | null>(null);

  useEffect(() => {
    loadSurveys();
  }, []);

  const loadSurveys = async () => {
    setIsLoading(true);
    try {
      const surveysData = await adminSurveyService.getAllSurveys();
      setSurveys(surveysData);
    } catch (error) {
      toast.error('Failed to load surveys');
      console.error('Error loading surveys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSurvey = async (surveyData: any) => {
    try {
      await adminSurveyService.createSurvey(surveyData);
      toast.success('Survey created successfully');
      setIsCreateModalOpen(false);
      await loadSurveys();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create survey');
    }
  };

  const handleViewAnalytics = (survey: AdminSurvey) => {
    setSelectedSurveyForAnalytics(survey);
  };

  const handleToggleStatus = async (surveyId: string, isActive: boolean) => {
    try {
      await adminSurveyService.updateSurveyStatus(surveyId, isActive);
      toast.success(`Survey ${isActive ? 'activated' : 'deactivated'} successfully`);
      await loadSurveys();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update survey status');
    }
  };

  const getFilteredSurveys = () => {
    let filtered = surveys;

    // Filter by tab
    const now = new Date();
    switch (activeTab) {
      case 'active':
        filtered = surveys.filter(survey => 
          survey.isActive && new Date(survey.endDate) > now
        );
        break;
      case 'expired':
        filtered = surveys.filter(survey => new Date(survey.endDate) <= now);
        break;
      case 'draft':
        filtered = surveys.filter(survey => !survey.isActive);
        break;
      default:
        // 'all' - no additional filtering
        break;
    }

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(survey =>
        survey.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        survey.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        survey.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  };

  const getStats = () => {
    const now = new Date();
    const active = surveys.filter(s => s.isActive && new Date(s.endDate) > now).length;
    const expired = surveys.filter(s => new Date(s.endDate) <= now).length;
    const draft = surveys.filter(s => !s.isActive).length;
    const totalResponses = surveys.reduce((sum, s) => sum + s.responseCount, 0);

    return { active, expired, draft, totalResponses };
  };

  const handleExportData = () => {
    // Export functionality would be implemented here
    toast.info('Export functionality coming soon!');
  };

  const stats = getStats();
  const filteredSurveys = getFilteredSurveys();

  const tabs = [
    { id: 'active' as TabType, label: 'Active', count: stats.active },
    { id: 'draft' as TabType, label: 'Draft', count: stats.draft },
    { id: 'expired' as TabType, label: 'Expired', count: stats.expired },
    { id: 'all' as TabType, label: 'All', count: surveys.length }
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Survey Management</h1>
          <p className="text-gray-600 mt-1">Create, manage, and analyze your surveys</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            leftIcon={<Download className="w-4 h-4" />}
            onClick={handleExportData}
          >
            Export
          </Button>
          <Button
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCreateModalOpen(true)}
          >
            Create Survey
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Surveys</p>
                <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              </div>
              <div className="bg-green-100 p-2 rounded-lg">
                <ClipboardList className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Draft Surveys</p>
                <p className="text-2xl font-bold text-orange-600">{stats.draft}</p>
              </div>
              <div className="bg-orange-100 p-2 rounded-lg">
                <Filter className="w-5 h-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Responses</p>
                <p className="text-2xl font-bold text-blue-600">{stats.totalResponses}</p>
              </div>
              <div className="bg-blue-100 p-2 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Expired</p>
                <p className="text-2xl font-bold text-red-600">{stats.expired}</p>
              </div>
              <div className="bg-red-100 p-2 rounded-lg">
                <BarChart3 className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
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
              No surveys found
            </h3>
            <p className="text-gray-600 mb-4">
              {searchQuery 
                ? 'Try adjusting your search query.'
                : 'Get started by creating your first survey.'}
            </p>
            {!searchQuery && (
              <Button
                variant="primary"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={() => setIsCreateModalOpen(true)}
              >
                Create First Survey
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSurveys.map((survey) => (
            <AdminSurveyCard
              key={survey.id}
              survey={survey}
              onViewAnalytics={handleViewAnalytics}
              onToggleStatus={handleToggleStatus}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <CreateSurveyModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateSurvey={handleCreateSurvey}
      />

      {selectedSurveyForAnalytics && (
        <SurveyAnalyticsModal
          isOpen={!!selectedSurveyForAnalytics}
          onClose={() => setSelectedSurveyForAnalytics(null)}
          survey={selectedSurveyForAnalytics}
        />
      )}
    </div>
  );
};

export default AdminSurveysPage;