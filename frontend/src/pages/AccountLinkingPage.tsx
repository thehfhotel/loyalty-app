import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  accountLinkingService, 
  AccountLinkRequest, 
  LinkedUserInfo,
  LinkRequestsResponse 
} from '../services/accountLinkingService';
import { useAuthStore } from '../store/authStore';
import { getUserDisplayName, getOAuthProviderName } from '../utils/userHelpers';
import toast from 'react-hot-toast';
import { 
  FiArrowLeft, 
  FiLink, 
  FiMinusCircle, 
  FiMail, 
  FiCheck, 
  FiX, 
  FiClock,
  FiUser
} from 'react-icons/fi';

const linkRequestSchema = z.object({
  targetEmail: z.string().email('Invalid email address'),
  message: z.string().optional()
});

type LinkRequestFormData = z.infer<typeof linkRequestSchema>;

export default function AccountLinkingPage() {
  const user = useAuthStore((state) => state.user);
  const [linkRequests, setLinkRequests] = useState<LinkRequestsResponse>({ sent: [], received: [] });
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedUserInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch
  } = useForm<LinkRequestFormData>({
    resolver: zodResolver(linkRequestSchema)
  });

  const targetEmail = watch('targetEmail');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [requests, accounts] = await Promise.all([
        accountLinkingService.getLinkRequests(),
        accountLinkingService.getLinkedAccounts()
      ]);
      setLinkRequests(requests);
      setLinkedAccounts(accounts);
    } catch (error: any) {
      console.error('Failed to load data:', error);
      toast.error(error.message || 'Failed to load account linking data');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitLinkRequest = async (data: LinkRequestFormData) => {
    try {
      setIsSending(true);
      
      // Check if email can be linked
      const status = await accountLinkingService.checkLinkStatus(data.targetEmail);
      if (!status.canLink) {
        toast.error(status.reason || 'Cannot link to this email');
        return;
      }

      await accountLinkingService.createLinkRequest(data.targetEmail, data.message);
      toast.success('Link request sent successfully');
      reset();
      loadData();
    } catch (error: any) {
      console.error('Failed to create link request:', error);
      toast.error(error.message || 'Failed to send link request');
    } finally {
      setIsSending(false);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    try {
      await accountLinkingService.approveLinkRequest(requestId);
      toast.success('Link request approved');
      loadData();
    } catch (error: any) {
      console.error('Failed to approve request:', error);
      toast.error(error.message || 'Failed to approve link request');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await accountLinkingService.rejectLinkRequest(requestId);
      toast.success('Link request rejected');
      loadData();
    } catch (error: any) {
      console.error('Failed to reject request:', error);
      toast.error(error.message || 'Failed to reject link request');
    }
  };

  const handleUnlinkAccount = async (linkedUserId: string, email: string) => {
    if (confirm(`Are you sure you want to unlink the account ${email}?`)) {
      try {
        await accountLinkingService.unlinkAccount(linkedUserId);
        toast.success('Account unlinked successfully');
        loadData();
      } catch (error: any) {
        console.error('Failed to unlink account:', error);
        toast.error(error.message || 'Failed to unlink account');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading account linking data...</p>
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
            <div className="flex items-center space-x-4">
              <Link
                to="/profile"
                className="inline-flex items-center text-gray-500 hover:text-gray-700"
              >
                <FiArrowLeft className="h-6 w-6" />
              </Link>
              <h1 className="text-3xl font-bold text-gray-900">Account Linking</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-8">
          
          {/* Create Link Request */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                Link Another Account
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Connect your {getUserDisplayName(user)} account with another email address or account.
              </p>
              
              <form onSubmit={handleSubmit(onSubmitLinkRequest)} className="space-y-4">
                <div>
                  <label htmlFor="targetEmail" className="block text-sm font-medium text-gray-700">
                    Email Address to Link
                  </label>
                  <div className="mt-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiMail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      {...register('targetEmail')}
                      type="email"
                      className="appearance-none block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      placeholder="Enter email address to link"
                    />
                  </div>
                  {errors.targetEmail && (
                    <p className="mt-1 text-sm text-red-600">{errors.targetEmail.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700">
                    Optional Message
                  </label>
                  <textarea
                    {...register('message')}
                    rows={3}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Add a message to explain why you want to link these accounts"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSending}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <FiLink className="mr-2 h-4 w-4" />
                  {isSending ? 'Sending...' : 'Send Link Request'}
                </button>
              </form>
            </div>
          </div>

          {/* Linked Accounts */}
          {linkedAccounts.length > 0 && (
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Linked Accounts
                </h3>
                <div className="space-y-4">
                  {linkedAccounts.map((account) => (
                    <div key={account.linkedUserId} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <FiUser className="h-5 w-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {account.firstName && account.lastName 
                              ? `${account.firstName} ${account.lastName}`
                              : account.email
                            }
                          </p>
                          <p className="text-sm text-gray-500">
                            {account.email}
                            {account.oauthProvider && (
                              <span className="ml-1 text-xs">
                                via {getOAuthProviderName({ oauthProvider: account.oauthProvider } as any)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnlinkAccount(account.linkedUserId, account.email)}
                        className="inline-flex items-center px-3 py-1 border border-red-300 text-sm font-medium rounded text-red-700 bg-red-50 hover:bg-red-100"
                      >
                        <FiMinusCircle className="mr-1 h-4 w-4" />
                        Unlink
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Received Link Requests */}
          {linkRequests.received.length > 0 && (
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Pending Link Requests
                </h3>
                <div className="space-y-4">
                  {linkRequests.received.map((request) => (
                    <div key={request.id} className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <FiClock className="h-4 w-4 text-yellow-600" />
                            <p className="text-sm font-medium text-gray-900">
                              Link request to {request.targetEmail}
                            </p>
                          </div>
                          {request.message && (
                            <p className="mt-1 text-sm text-gray-600">
                              "{request.message}"
                            </p>
                          )}
                          <p className="mt-1 text-xs text-gray-500">
                            Expires: {new Date(request.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleApproveRequest(request.id)}
                            className="inline-flex items-center px-3 py-1 border border-green-300 text-sm font-medium rounded text-green-700 bg-green-50 hover:bg-green-100"
                          >
                            <FiCheck className="mr-1 h-4 w-4" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleRejectRequest(request.id)}
                            className="inline-flex items-center px-3 py-1 border border-red-300 text-sm font-medium rounded text-red-700 bg-red-50 hover:bg-red-100"
                          >
                            <FiX className="mr-1 h-4 w-4" />
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Sent Link Requests */}
          {linkRequests.sent.length > 0 && (
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Sent Link Requests
                </h3>
                <div className="space-y-4">
                  {linkRequests.sent.map((request) => (
                    <div key={request.id} className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <FiClock className="h-4 w-4 text-blue-600" />
                        <p className="text-sm font-medium text-gray-900">
                          Waiting for {request.targetEmail} to accept
                        </p>
                      </div>
                      {request.message && (
                        <p className="mt-1 text-sm text-gray-600">
                          Message: "{request.message}"
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        Sent: {new Date(request.createdAt).toLocaleDateString()} | 
                        Expires: {new Date(request.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Empty States */}
            {linkRequests.sent.length === 0 && linkRequests.received.length === 0 && linkedAccounts.length === 0 && (
              <div className="bg-white shadow rounded-lg">
                <div className="px-4 py-5 sm:p-6 text-center">
                  <FiLink className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No linked accounts</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Start by sending a link request to another email address.
                  </p>
                </div>
              </div>
            )}
        </div>
      </main>
    </div>
  );
}