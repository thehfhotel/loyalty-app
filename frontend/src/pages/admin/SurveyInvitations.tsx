import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  FiArrowLeft, 
  FiSend, 
  FiUsers, 
  FiMail,
  FiClock,
  FiCheckCircle,
  FiAlertCircle,
  FiFilter
} from 'react-icons/fi';
import { Survey, SurveyInvitation } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import DashboardButton from '../../components/navigation/DashboardButton';
import toast from 'react-hot-toast';

interface InvitationStats {
  total: number;
  sent: number;
  viewed: number;
  started: number;
  completed: number;
}

const SurveyInvitations: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [invitations, setInvitations] = useState<SurveyInvitation[]>([]);
  const [stats, setStats] = useState<InvitationStats>({
    total: 0,
    sent: 0,
    viewed: 0,
    started: 0,
    completed: 0
  });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load survey details
      const surveyData = await surveyService.getSurveyById(id!);
      setSurvey(surveyData);
      
      // Load invitations
      const invitationsData = await surveyService.getSurveyInvitations(id!);
      setInvitations(invitationsData);
      
      // Calculate stats
      const newStats: InvitationStats = {
        total: invitationsData.length,
        sent: invitationsData.filter(i => i.status !== 'pending').length,
        viewed: invitationsData.filter(i => ['viewed', 'started', 'completed'].includes(i.status)).length,
        started: invitationsData.filter(i => ['started', 'completed'].includes(i.status)).length,
        completed: invitationsData.filter(i => i.status === 'completed').length
      };
      setStats(newStats);
      
    } catch (err: any) {
      console.error('Error loading data:', err);
      toast.error('Failed to load survey invitations');
    } finally {
      setLoading(false);
    }
  };

  const handleSendInvitations = async () => {
    if (!confirm('Are you sure you want to send invitations to all eligible users?')) {
      return;
    }

    try {
      setSending(true);
      const result = await surveyService.sendSurveyInvitations(id!);
      toast.success(`Successfully sent ${result.sent} invitations`);
      loadData();
    } catch (err: any) {
      console.error('Error sending invitations:', err);
      toast.error(err.response?.data?.message || 'Failed to send invitations');
    } finally {
      setSending(false);
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    try {
      await surveyService.resendInvitation(invitationId);
      toast.success('Invitation resent successfully');
      loadData();
    } catch (err: any) {
      console.error('Error resending invitation:', err);
      toast.error('Failed to resend invitation');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <FiClock className="mr-1 h-3 w-3" /> Pending
        </span>;
      case 'sent':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <FiMail className="mr-1 h-3 w-3" /> Sent
        </span>;
      case 'viewed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <FiAlertCircle className="mr-1 h-3 w-3" /> Viewed
        </span>;
      case 'started':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          <FiClock className="mr-1 h-3 w-3" /> In Progress
        </span>;
      case 'completed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <FiCheckCircle className="mr-1 h-3 w-3" /> Completed
        </span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Loading invitations...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            <p>Survey not found</p>
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
                <h1 className="text-3xl font-bold text-gray-900">Survey Invitations</h1>
                <p className="text-sm text-gray-600 mt-1">{survey.title}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleSendInvitations}
                disabled={sending || survey.status !== 'active'}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiSend className="mr-2 h-4 w-4" />
                {sending ? 'Sending...' : 'Send Invitations'}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiUsers className="h-8 w-8 text-gray-400" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Total Invitations</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.total}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiMail className="h-8 w-8 text-blue-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Sent</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.sent}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiAlertCircle className="h-8 w-8 text-yellow-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Viewed</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.viewed}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiClock className="h-8 w-8 text-purple-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Started</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.started}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FiCheckCircle className="h-8 w-8 text-green-500" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Completed</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.completed}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex items-center space-x-4">
              <FiFilter className="h-5 w-5 text-gray-400" />
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="viewed">Viewed</option>
                <option value="started">Started</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          {/* Invitations List */}
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Invitation Recipients
              </h3>
            </div>
            {invitations.length > 0 ? (
              <div className="border-t border-gray-200">
                <ul className="divide-y divide-gray-200">
                  {invitations
                    .filter(inv => selectedStatus === 'all' || inv.status === selectedStatus)
                    .map((invitation) => (
                    <li key={invitation.id} className="px-4 py-4 sm:px-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center min-w-0">
                          <div className="flex-shrink-0">
                            <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                              <FiUsers className="h-5 w-5 text-gray-600" />
                            </div>
                          </div>
                          <div className="ml-4 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              User ID: {invitation.user_id}
                            </p>
                            <p className="text-sm text-gray-500">
                              Invited: {new Date(invitation.created_at).toLocaleDateString()}
                              {invitation.sent_at && ` • Sent: ${new Date(invitation.sent_at).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          {getStatusBadge(invitation.status)}
                          {invitation.status === 'pending' && (
                            <button
                              onClick={() => handleResendInvitation(invitation.id)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              Send Now
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="border-t border-gray-200 p-6 text-center">
                <FiUsers className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">No invitations sent yet</p>
                {survey.status === 'active' && (
                  <button
                    onClick={handleSendInvitations}
                    className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                  >
                    <FiSend className="mr-2 h-4 w-4" />
                    Send First Invitations
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default SurveyInvitations;