import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { FiToggleLeft, FiToggleRight, FiClock, FiUser, FiInfo, FiRefreshCw, FiAlertCircle } from 'react-icons/fi';
import { featureToggleService, FeatureToggle, FeatureToggleAudit } from '../../services/featureToggleService';
import { useAuthStore } from '../../store/authStore';
import { clearFeatureCache } from '../../hooks/useFeatureToggle';
import DashboardButton from '../../components/navigation/DashboardButton';

export default function FeatureTogglePage() {
  const [features, setFeatures] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [auditHistory, setAuditHistory] = useState<FeatureToggleAudit[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [toggleReason, setToggleReason] = useState('');
  const user = useAuthStore((state) => state.user);

  // Check if user is super admin
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    if (!isSuperAdmin) {
      toast.error('Access denied. Super admin privileges required.');
      return;
    }
    loadFeatures();
  }, [isSuperAdmin]);

  const loadFeatures = async () => {
    try {
      setLoading(true);
      const data = await featureToggleService.getAllFeatureToggles();
      setFeatures(data);
    } catch (error: any) {
      console.error('Failed to load features:', error);
      toast.error(error.message || 'Failed to load feature toggles');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFeature = async (featureKey: string, currentStatus: boolean) => {
    if (!toggleReason.trim()) {
      toast.error('Please provide a reason for this change');
      return;
    }

    try {
      await featureToggleService.toggleFeature(featureKey, !currentStatus, toggleReason);
      toast.success(`Feature ${!currentStatus ? 'enabled' : 'disabled'} successfully`);
      setToggleReason('');
      
      // Clear the feature cache so the app picks up the new state
      clearFeatureCache();
      
      await loadFeatures();
      
      // Refresh audit history if it's currently shown
      if (selectedFeature === featureKey) {
        await loadAuditHistory(featureKey);
      }
    } catch (error: any) {
      console.error('Failed to toggle feature:', error);
      toast.error(error.message || 'Failed to toggle feature');
    }
  };

  const loadAuditHistory = async (featureKey: string) => {
    try {
      setLoadingAudit(true);
      setSelectedFeature(featureKey);
      const audit = await featureToggleService.getFeatureToggleAudit(featureKey);
      setAuditHistory(audit);
    } catch (error: any) {
      console.error('Failed to load audit history:', error);
      toast.error(error.message || 'Failed to load audit history');
    } finally {
      setLoadingAudit(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <FiAlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">
            You need super admin privileges to access this page.
          </p>
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
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Feature Toggles</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage feature flags and system configurations
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={loadFeatures}
                disabled={loading}
                className="inline-flex items-center font-medium border border-gray-300 bg-white text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiRefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Feature Toggles List */}
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Feature Toggles
                </h3>
                
                {/* Shared reason input */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <label htmlFor="toggle-reason" className="block text-sm font-medium text-gray-700 mb-2">
                    Reason for changes:
                  </label>
                  <input
                    type="text"
                    id="toggle-reason"
                    value={toggleReason}
                    onChange={(e) => setToggleReason(e.target.value)}
                    placeholder="Enter reason for toggle changes..."
                    className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This reason will be recorded for any feature toggle changes you make.
                  </p>
                </div>
                
                {loading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-500">Loading features...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {features.map((feature) => (
                      <div
                        key={feature.id}
                        className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center">
                              <h4 className="text-lg font-medium text-gray-900">
                                {feature.featureName}
                              </h4>
                              <span className="ml-2 text-sm text-gray-500">
                                ({feature.featureKey})
                              </span>
                            </div>
                            {feature.description && (
                              <p className="mt-1 text-sm text-gray-600">
                                {feature.description}
                              </p>
                            )}
                            <div className="mt-2 flex items-center text-xs text-gray-500">
                              <FiClock className="mr-1 h-3 w-3" />
                              Updated: {formatDateTime(feature.updatedAt)}
                            </div>
                          </div>
                          
                          <div className="ml-4 flex items-center space-x-2">
                            <button
                              onClick={() => {
                                if (feature.isEnabled) {
                                  handleToggleFeature(feature.featureKey, feature.isEnabled);
                                } else {
                                  handleToggleFeature(feature.featureKey, feature.isEnabled);
                                }
                              }}
                              className={`p-2 rounded-md ${
                                feature.isEnabled
                                  ? 'text-green-600 hover:bg-green-50'
                                  : 'text-gray-400 hover:bg-gray-50'
                              }`}
                              title={feature.isEnabled ? 'Feature is enabled' : 'Feature is disabled'}
                            >
                              {feature.isEnabled ? (
                                <FiToggleRight className="h-6 w-6" />
                              ) : (
                                <FiToggleLeft className="h-6 w-6" />
                              )}
                            </button>
                            
                            <button
                              onClick={() => loadAuditHistory(feature.featureKey)}
                              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-md"
                              title="View audit history"
                            >
                              <FiInfo className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Audit History */}
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Audit History
                  {selectedFeature && (
                    <span className="ml-2 text-sm text-gray-500">
                      for {selectedFeature}
                    </span>
                  )}
                </h3>
                
                {!selectedFeature ? (
                  <div className="text-center py-8 text-gray-500">
                    <FiInfo className="mx-auto h-8 w-8 text-gray-400" />
                    <p className="mt-2 text-sm">
                      Select a feature to view its audit history
                    </p>
                  </div>
                ) : loadingAudit ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-500">Loading audit history...</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {auditHistory.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No audit history found
                      </p>
                    ) : (
                      auditHistory.map((audit) => (
                        <div
                          key={audit.id}
                          className="border border-gray-200 rounded-lg p-3"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                {audit.newState ? (
                                  <FiToggleRight className="h-4 w-4 text-green-600" />
                                ) : (
                                  <FiToggleLeft className="h-4 w-4 text-gray-400" />
                                )}
                                <span className="text-sm font-medium">
                                  {audit.previousState !== null 
                                    ? `${audit.previousState ? 'Enabled' : 'Disabled'} → ${audit.newState ? 'Enabled' : 'Disabled'}`
                                    : `Set to ${audit.newState ? 'Enabled' : 'Disabled'}`
                                  }
                                </span>
                              </div>
                              
                              {audit.reason && (
                                <p className="mt-1 text-xs text-gray-600">
                                  Reason: {audit.reason}
                                </p>
                              )}
                              
                              <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                                <div className="flex items-center">
                                  <FiUser className="mr-1 h-3 w-3" />
                                  {audit.changedBy}
                                </div>
                                <div className="flex items-center">
                                  <FiClock className="mr-1 h-3 w-3" />
                                  {formatDateTime(audit.changedAt)}
                                </div>
                              </div>
                              
                              {audit.ipAddress && (
                                <div className="mt-1 text-xs text-gray-400">
                                  IP: {audit.ipAddress}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}