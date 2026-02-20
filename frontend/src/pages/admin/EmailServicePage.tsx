import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import DashboardButton from '../../components/navigation/DashboardButton';
import { FiMail, FiCheck, FiX, FiRefreshCw } from 'react-icons/fi';

export default function EmailServicePage() {
  const { t } = useTranslation();

  // TODO: Replace with REST service when Rust admin email endpoints are implemented
  interface EmailStatus {
    configured: boolean;
    smtpConnected: boolean;
    imapConnected: boolean;
    lastTestResult?: {
      success: boolean;
      timestamp: string;
      deliveryTimeMs?: number;
      error?: string;
    };
  }

  interface TestResult {
    success: boolean;
    testId?: string;
    smtpSent?: boolean;
    imapReceived?: boolean;
    deliveryTimeMs?: number;
    error?: string;
  }

  // Fetch email service status
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<EmailStatus | null>({
    queryKey: ['admin', 'email', 'status'],
    queryFn: async () => {
      // TODO: Replace with REST service when Rust admin email endpoints are implemented
      return null;
    },
  });

  // Email test mutation
  const testMutation = useMutation<TestResult, Error, void>({
    mutationFn: async () => {
      // TODO: Replace with REST service when Rust admin email endpoints are implemented
      throw new Error('Admin email service management is being migrated');
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t('emailService.test.success'));
      } else {
        toast.error(t('emailService.test.failed'));
      }
      refetchStatus();
    },
    onError: () => {
      toast.error(t('emailService.test.failed'));
    }
  });

  const handleRunTest = () => {
    testMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <FiMail className="w-8 h-8 mr-3 text-blue-600" />
                {t('emailService.title')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('emailService.description')}
              </p>
            </div>

            <div className="mt-4 sm:mt-0">
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('emailService.status.title')}
          </h2>

          {statusLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
              <p className="mt-4 text-gray-600">{t('common.loading')}</p>
            </div>
          ) : status ? (
            <div className="space-y-4">
              {/* Configuration Status */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium text-gray-900">
                    Email Configuration
                  </div>
                  <div className="text-sm text-gray-500">
                    {status.configured
                      ? t('emailService.status.configured')
                      : t('emailService.status.notConfigured')
                    }
                  </div>
                </div>
                {status.configured ? (
                  <FiCheck className="w-6 h-6 text-green-600" />
                ) : (
                  <FiX className="w-6 h-6 text-red-600" />
                )}
              </div>

              {/* SMTP Status */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium text-gray-900">
                    SMTP Connection
                  </div>
                  <div className="text-sm text-gray-500">
                    {status.smtpConnected
                      ? t('emailService.status.smtpConnected')
                      : t('emailService.status.smtpDisconnected')
                    }
                  </div>
                </div>
                {status.smtpConnected ? (
                  <FiCheck className="w-6 h-6 text-green-600" />
                ) : (
                  <FiX className="w-6 h-6 text-red-600" />
                )}
              </div>

              {/* IMAP Status */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium text-gray-900">
                    IMAP Connection
                  </div>
                  <div className="text-sm text-gray-500">
                    {status.imapConnected
                      ? t('emailService.status.imapConnected')
                      : t('emailService.status.imapDisconnected')
                    }
                  </div>
                </div>
                {status.imapConnected ? (
                  <FiCheck className="w-6 h-6 text-green-600" />
                ) : (
                  <FiX className="w-6 h-6 text-red-600" />
                )}
              </div>

              {/* Last Test Result */}
              {status.lastTestResult && (
                <div
                  className={`p-4 rounded-lg border ${
                    status.lastTestResult.success
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="font-medium text-gray-900 mb-2">
                    {t('emailService.lastTest')}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Status:</span>
                      <span className={`ml-2 font-medium ${status.lastTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                        {status.lastTestResult.success ? 'Passed' : 'Failed'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Time:</span>
                      <span className="ml-2 text-gray-900">
                        {new Date(status.lastTestResult.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {status.lastTestResult.deliveryTimeMs && (
                      <div>
                        <span className="text-gray-500">Delivery:</span>
                        <span className="ml-2 text-gray-900">{status.lastTestResult.deliveryTimeMs}ms</span>
                      </div>
                    )}
                    {status.lastTestResult.error && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Error:</span>
                        <span className="ml-2 text-red-600">{status.lastTestResult.error}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              {t('common.error')}
            </div>
          )}
        </div>

        {/* Test Controls */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Email Test
          </h2>

          <p className="text-gray-600 mb-4">
            Run a complete end-to-end test that sends an email via SMTP and verifies receipt via IMAP.
          </p>

          <button
            onClick={handleRunTest}
            disabled={testMutation.isPending}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testMutation.isPending ? (
              <>
                <FiRefreshCw className="w-4 h-4 mr-2 animate-spin" />
                {t('emailService.test.running')}
              </>
            ) : (
              <>
                <FiMail className="w-4 h-4 mr-2" />
                {t('emailService.test.button')}
              </>
            )}
          </button>

          {/* Test Results */}
          {testMutation.data && (
            <div
              className={`mt-4 p-4 rounded-lg ${
                testMutation.data.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
              }`}
            >
              <h3 className="font-medium mb-2 text-gray-900">
                {t('emailService.results.title')}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('emailService.results.testId')}:</span>
                  <span className="font-mono text-gray-900">{testMutation.data.testId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('emailService.results.smtpSent')}:</span>
                  <span className={testMutation.data.smtpSent ? 'text-green-600' : 'text-red-600'}>
                    {testMutation.data.smtpSent ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('emailService.results.imapReceived')}:</span>
                  <span className={testMutation.data.imapReceived ? 'text-green-600' : 'text-red-600'}>
                    {testMutation.data.imapReceived ? 'Yes' : 'No'}
                  </span>
                </div>
                {testMutation.data.deliveryTimeMs && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">{t('emailService.results.deliveryTime')}:</span>
                    <span className="text-gray-900">{testMutation.data.deliveryTimeMs}ms</span>
                  </div>
                )}
                {testMutation.data.error && (
                  <div className="mt-2 pt-2 border-t border-red-300">
                    <span className="text-gray-600">{t('emailService.results.error')}:</span>
                    <p className="text-red-600 mt-1">{testMutation.data.error}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
