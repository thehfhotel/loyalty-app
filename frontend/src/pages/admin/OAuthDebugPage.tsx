import React, { useState, useEffect } from 'react';
import { authService } from '../../services/authService';

interface OAuthLog {
  timestamp: string;
  step: string;
  provider: string;
  success: boolean;
  data?: any;
  error?: any;
  request?: {
    url: string;
    method: string;
    headers: Record<string, any>;
    query: Record<string, any>;
    ip: string;
    userAgent: string;
  };
  environment?: {
    nodeEnv: string;
    isProduction: boolean;
    isSecure: boolean;
    domain: string;
  };
}

interface ProviderStats {
  total: number;
  successful: number;
  failed: number;
  successRate: string;
  lastAttempt?: string;
  lastSuccess?: string;
  lastError?: string;
  commonErrors: Array<{ error: string; count: number }>;
}

interface OAuthDebugData {
  timestamp: string;
  stats: Record<string, ProviderStats>;
  recentLogs: OAuthLog[];
  recentErrors: OAuthLog[];
  configuration: Record<string, any>;
  debugMode: boolean;
}

const OAuthDebugPage: React.FC = () => {
  const [debugData, setDebugData] = useState<OAuthDebugData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  const fetchDebugData = async () => {
    try {
      // Try to fetch without authentication for debug purposes
      const response = await fetch('/api/oauth-debug/dashboard');
      if (!response.ok) {
        // If auth required, try with token if available
        if (response.status === 401) {
          try {
            const authResponse = await authService.apiCall('/oauth-debug/dashboard', 'GET');
            setDebugData(authResponse);
          } catch (authErr) {
            // If still failing, show a simplified debug interface
            setError('Authentication required for full debug access. Showing basic OAuth flow testing.');
            setDebugData(null);
          }
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else {
        const data = await response.json();
        setDebugData(data);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch debug data');
      console.error('OAuth debug fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const testProvider = async (provider: string) => {
    try {
      setLoading(true);
      const response = await authService.apiCall(`/oauth-debug/test/${provider}`, 'POST');
      console.log(`OAuth test result for ${provider}:`, response);
      // Refresh data after test
      await fetchDebugData();
    } catch (err) {
      setError(`Failed to test ${provider}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const simulateOAuth = async (provider: string) => {
    try {
      setLoading(true);
      const response = await authService.apiCall(`/oauth-debug/simulate/${provider}`, 'POST');
      console.log(`OAuth simulation result for ${provider}:`, response);
      // Refresh data after simulation
      setTimeout(fetchDebugData, 500);
    } catch (err) {
      setError(`Failed to simulate ${provider}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const clearLogs = async () => {
    try {
      await authService.apiCall('/oauth-debug/logs', 'DELETE');
      await fetchDebugData();
    } catch (err) {
      setError(`Failed to clear logs: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const toggleDebugMode = async () => {
    try {
      const response = await authService.apiCall('/oauth-debug/debug-mode', 'POST', {
        enabled: !debugData?.debugMode
      });
      console.log('Debug mode toggle result:', response);
      await fetchDebugData();
    } catch (err) {
      setError(`Failed to toggle debug mode: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const exportErrors = async () => {
    try {
      const response = await fetch('/api/oauth-debug/export/errors', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        }
      });
      
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oauth-errors-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Failed to export errors: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    fetchDebugData();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchDebugData, 5000);
      setRefreshInterval(interval);
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        setRefreshInterval(null);
      }
    }

    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [autoRefresh]);

  // Show a basic OAuth flow tester even without authentication
  const renderBasicDebugger = () => (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">OAuth Flow Debugger</h1>
        <p className="text-gray-600 mt-2">Test OAuth providers and monitor authentication flows</p>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
        <div className="flex">
          <div className="text-yellow-400">⚠️</div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800">Limited Access</h3>
            <p className="text-sm text-yellow-700 mt-1">
              {error || 'Authentication required for full debug dashboard. You can still test OAuth flows below.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {['google', 'facebook', 'line'].map(provider => (
          <div key={provider} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 capitalize mb-4">{provider} OAuth</h3>
            <div className="space-y-4">
              <a
                href={`/api/oauth/${provider}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-4 py-2 bg-blue-600 text-white text-center rounded-md hover:bg-blue-700"
              >
                Test {provider} Login
              </a>
              <p className="text-xs text-gray-500">
                Opens {provider} OAuth flow in new tab. Check browser console for debug info.
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">OAuth Flow Testing</h2>
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            <p><strong>1. Test OAuth Flow:</strong> Click any provider button above</p>
            <p><strong>2. Monitor Logs:</strong> Check browser console (F12 → Console) for debug information</p>
            <p><strong>3. Check Network:</strong> Use browser dev tools (F12 → Network) to see API calls</p>
            <p><strong>4. Backend Logs:</strong> Server-side logs are being captured for analysis</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded">
            <h3 className="font-medium text-gray-900 mb-2">Expected OAuth Flow:</h3>
            <ol className="text-sm text-gray-600 space-y-1">
              <li>1. Click provider button → Redirect to provider (Google/Facebook/LINE)</li>
              <li>2. User authenticates with provider</li>
              <li>3. Provider redirects to callback URL with auth code</li>
              <li>4. Backend exchanges code for tokens</li>
              <li>5. User data retrieved and JWT tokens generated</li>
              <li>6. Redirect to frontend with tokens</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading && !debugData) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-600 mt-4">Loading OAuth debug data...</p>
      </div>
    </div>;
  }

  // If no debug data available, show basic debugger
  if (!debugData) {
    return <div className="min-h-screen bg-gray-50">{renderBasicDebugger()}</div>;
  }

  const getStatusColor = (success: boolean) => success ? 'text-green-600' : 'text-red-600';
  const getStatusBg = (success: boolean) => success ? 'bg-green-50' : 'bg-red-50';

  const filteredLogs = debugData?.recentLogs.filter(log => 
    selectedProvider === 'all' || log.provider === selectedProvider
  ) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">OAuth Debug Dashboard</h1>
          <p className="text-gray-600 mt-2">Monitor and troubleshoot OAuth authentication flows</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="text-red-400">⚠️</div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="mb-6 flex flex-wrap gap-4 items-center">
          <button
            onClick={fetchDebugData}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          
          <button
            onClick={toggleDebugMode}
            className={`px-4 py-2 rounded-md ${
              debugData?.debugMode 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            Debug Mode: {debugData?.debugMode ? 'ON' : 'OFF'}
          </button>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-2"
            />
            Auto-refresh (5s)
          </label>

          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="all">All Providers</option>
            <option value="google">Google</option>
            <option value="facebook">Facebook</option>
            <option value="line">LINE</option>
          </select>

          <button
            onClick={clearLogs}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Clear Logs
          </button>

          <button
            onClick={exportErrors}
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            Export Errors
          </button>
        </div>

        {debugData && (
          <>
            {/* Provider Statistics */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Provider Statistics</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {Object.entries(debugData.stats).map(([provider, stats]) => (
                  <div key={provider} className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-lg font-medium text-gray-900 capitalize mb-4">{provider}</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Attempts:</span>
                        <span className="font-medium">{stats.total}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Success Rate:</span>
                        <span className={`font-medium ${
                          parseFloat(stats.successRate) > 90 ? 'text-green-600' : 
                          parseFloat(stats.successRate) > 70 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {stats.successRate}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Successful:</span>
                        <span className="text-green-600 font-medium">{stats.successful}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Failed:</span>
                        <span className="text-red-600 font-medium">{stats.failed}</span>
                      </div>
                      {stats.lastAttempt && (
                        <div className="text-xs text-gray-500 mt-2">
                          Last: {new Date(stats.lastAttempt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex space-x-2">
                      <button
                        onClick={() => testProvider(provider)}
                        className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        Test Config
                      </button>
                      <button
                        onClick={() => simulateOAuth(provider)}
                        className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                      >
                        Simulate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Configuration Status */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Configuration Status</h2>
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.entries(debugData.configuration).map(([category, config]: [string, any]) => (
                      <div key={category}>
                        <h3 className="font-medium text-gray-900 capitalize mb-2">{category}</h3>
                        <div className="space-y-1">
                          {config.issues && config.issues.length > 0 ? (
                            config.issues.map((issue: string, index: number) => (
                              <div key={index} className="text-sm text-red-600">❌ {issue}</div>
                            ))
                          ) : (
                            <div className="text-sm text-green-600">✅ Configuration OK</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Logs */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Recent OAuth Logs ({filteredLogs.length})
              </h2>
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  {filteredLogs.length === 0 ? (
                    <div className="px-6 py-8 text-center text-gray-500">
                      No logs found for the selected provider.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {filteredLogs.map((log, index) => (
                        <div key={index} className={`px-6 py-4 ${getStatusBg(log.success)}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <span className={`font-medium ${getStatusColor(log.success)}`}>
                                {log.success ? '✅' : '❌'}
                              </span>
                              <span className="font-medium text-gray-900 capitalize">
                                {log.provider}
                              </span>
                              <span className="text-sm text-gray-600">{log.step}</span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          {log.error && (
                            <div className="mt-2 text-sm text-red-600">
                              Error: {log.error.message || JSON.stringify(log.error)}
                            </div>
                          )}
                          {log.data && (
                            <details className="mt-2">
                              <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
                                View Details
                              </summary>
                              <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                {JSON.stringify(log.data, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Errors */}
            {debugData.recentErrors.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  Recent Errors ({debugData.recentErrors.length})
                </h2>
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <div className="divide-y divide-gray-200">
                      {debugData.recentErrors.map((log, index) => (
                        <div key={index} className="px-6 py-4 bg-red-50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <span className="text-red-600">❌</span>
                              <span className="font-medium text-gray-900 capitalize">
                                {log.provider}
                              </span>
                              <span className="text-sm text-gray-600">{log.step}</span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-2 text-sm text-red-600">
                            {log.error?.message || 'Unknown error'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OAuthDebugPage;