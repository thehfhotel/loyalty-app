import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  FiUsers, 
  FiAward, 
  FiPlus, 
  FiMinus, 
  FiRefreshCw,
  FiSearch,
  FiDollarSign,
  FiUser
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { 
  loyaltyService, 
  AdminUserLoyalty, 
  PointsTransaction 
} from '../../services/loyaltyService';
import DashboardButton from '../../components/navigation/DashboardButton';

interface PointsAdjustmentModal {
  isOpen: boolean;
  user: AdminUserLoyalty | null;
  type: 'award' | 'deduct';
}

interface SpendingConsoleModal {
  isOpen: boolean;
}

export default function LoyaltyAdminPage() {
  const { t } = useTranslation();
  
  const [users, setUsers] = useState<AdminUserLoyalty[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize] = useState(20);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAction, setIsLoadingAction] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserLoyalty | null>(null);
  const [userTransactions, setUserTransactions] = useState<PointsTransaction[]>([]);
  const [pointsModal, setPointsModal] = useState<PointsAdjustmentModal>({
    isOpen: false,
    user: null,
    type: 'award'
  });
  const [pointsForm, setPointsForm] = useState({
    points: '',
    description: '',
    referenceId: ''
  });
  const [spendingModal, setSpendingModal] = useState<SpendingConsoleModal>({
    isOpen: false
  });
  const [spendingForm, setSpendingForm] = useState({
    userId: '',
    spendingAmount: '',
    nightsStayed: '',
    checkinId: '',
    userSearchTerm: '',
    selectedUser: null as AdminUserLoyalty | null
  });
  const [userSearchResults, setUserSearchResults] = useState<AdminUserLoyalty[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  useEffect(() => {
    loadUsers();
  }, [currentPage, searchTerm]);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const result = await loyaltyService.getAllUsersLoyaltyStatus(
        pageSize,
        currentPage * pageSize,
        searchTerm || undefined
      );
      setUsers(result.users);
      setTotalUsers(result.total);
    } catch (error) {
      toast.error(t('admin.loyalty.errors.loadFailed'));
      console.error('Failed to load users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserTransactions = async (userId: string) => {
    try {
      const result = await loyaltyService.getUserPointsHistoryAdmin(userId, 50, 0);
      setUserTransactions(result.transactions);
    } catch (error) {
      toast.error(t('admin.loyalty.errors.transactionsFailed'));
      console.error('Failed to load user transactions:', error);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(0);
    loadUsers();
  };

  const openPointsModal = (user: AdminUserLoyalty, type: 'award' | 'deduct') => {
    setPointsModal({ isOpen: true, user, type });
    setPointsForm({ points: '', description: '', referenceId: '' });
  };

  const closePointsModal = () => {
    setPointsModal({ isOpen: false, user: null, type: 'award' });
    setPointsForm({ points: '', description: '', referenceId: '' });
  };

  const handlePointsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pointsModal.user || !pointsForm.points) {return;}

    try {
      setIsLoadingAction(true);
      const points = parseInt(pointsForm.points);
      
      if (pointsModal.type === 'award') {
        await loyaltyService.awardPoints(
          pointsModal.user.user_id,
          points,
          pointsForm.description || undefined,
          pointsForm.referenceId || undefined
        );
        toast.success(t('admin.loyalty.success.pointsAwarded', { points }));
      } else {
        await loyaltyService.deductPoints(
          pointsModal.user.user_id,
          points,
          pointsForm.description || `Points deducted by admin`
        );
        toast.success(t('admin.loyalty.success.pointsDeducted', { points }));
      }

      closePointsModal();
      loadUsers();
      if (selectedUser?.user_id === pointsModal.user.user_id) {
        loadUserTransactions(pointsModal.user.user_id);
      }
    } catch (error) {
      toast.error(t('admin.loyalty.errors.pointsOperationFailed'));
      console.error('Points operation failed:', error);
    } finally {
      setIsLoadingAction(false);
    }
  };

  const openSpendingConsole = () => {
    setSpendingModal({ isOpen: true });
    setSpendingForm({
      userId: '',
      spendingAmount: '',
      nightsStayed: '',
      checkinId: '',
      userSearchTerm: '',
      selectedUser: null
    });
    setUserSearchResults([]);
  };

  const closeSpendingConsole = () => {
    setSpendingModal({ isOpen: false });
    setSpendingForm({
      userId: '',
      spendingAmount: '',
      nightsStayed: '',
      checkinId: '',
      userSearchTerm: '',
      selectedUser: null
    });
    setUserSearchResults([]);
  };

  const searchUsersForSpending = async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setUserSearchResults([]);
      return;
    }

    try {
      setIsSearchingUsers(true);
      const result = await loyaltyService.getAllUsersLoyaltyStatus(10, 0, searchTerm);
      setUserSearchResults(result.users);
    } catch (error) {
      console.error('Failed to search users:', error);
      toast.error('Failed to search users');
    } finally {
      setIsSearchingUsers(false);
    }
  };

  const handleUserSearchChange = (value: string) => {
    setSpendingForm({ ...spendingForm, userSearchTerm: value, selectedUser: null });
    searchUsersForSpending(value);
  };

  const selectUserForSpending = (user: AdminUserLoyalty) => {
    setSpendingForm({
      ...spendingForm,
      userId: user.user_id,
      selectedUser: user,
      userSearchTerm: user.first_name && user.last_name 
        ? `${user.first_name} ${user.last_name}` 
        : user.oauth_provider === 'line' && user.first_name
        ? user.first_name
        : user.email
    });
    setUserSearchResults([]);
  };

  const calculatePoints = (spending: number): number => {
    return Math.floor(spending * 10); // 1 THB = 10 points
  };

  const handleSpendingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spendingForm.selectedUser || !spendingForm.spendingAmount || !spendingForm.checkinId) {return;}

    try {
      setIsLoadingAction(true);
      const spendingAmount = parseFloat(spendingForm.spendingAmount);
      const nightsStayed = parseInt(spendingForm.nightsStayed) || 0;
      const pointsToAward = calculatePoints(spendingAmount);
      
      let description = `Spending points: ${spendingAmount} THB`;
      if (nightsStayed > 0) {
        description += `, ${nightsStayed} ${nightsStayed === 1 ? 'night' : 'nights'}`;
      }
      description += ` (Check-in: ${spendingForm.checkinId})`;
      
      // If nights are provided, use the new method that handles both nights and points
      if (nightsStayed > 0) {
        // We'll need to add a new service method for this
        await loyaltyService.awardSpendingWithNights(
          spendingForm.selectedUser.user_id,
          spendingAmount,
          nightsStayed,
          spendingForm.checkinId,
          description
        );
      } else {
        // Regular points-only award
        await loyaltyService.awardPoints(
          spendingForm.selectedUser.user_id,
          pointsToAward,
          description,
          spendingForm.checkinId
        );
      }
      
      let successMessage = `Awarded ${pointsToAward} points for ${spendingAmount} THB spending`;
      if (nightsStayed > 0) {
        successMessage += ` and ${nightsStayed} ${nightsStayed === 1 ? 'night' : 'nights'}`;
      }
      toast.success(successMessage);
      
      closeSpendingConsole();
      loadUsers();
      if (selectedUser?.user_id === spendingForm.selectedUser.user_id) {
        loadUserTransactions(spendingForm.selectedUser.user_id);
      }
    } catch (error) {
      toast.error('Failed to award spending points');
      console.error('Spending points operation failed:', error);
    } finally {
      setIsLoadingAction(false);
    }
  };


  const selectUser = (user: AdminUserLoyalty) => {
    setSelectedUser(user);
    loadUserTransactions(user.user_id);
  };

  const totalPages = Math.ceil(totalUsers / pageSize);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <FiAward className="w-8 h-8 mr-3 text-blue-600" />
                {t('admin.loyalty.title')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('admin.loyalty.subtitle')}
              </p>
            </div>
            
            <div className="mt-4 sm:mt-0 flex space-x-3">
              <button
                onClick={openSpendingConsole}
                className="inline-flex items-center font-medium border border-blue-300 bg-blue-50 text-blue-700 px-4 py-2 text-sm rounded-md hover:bg-blue-100 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiDollarSign className="w-4 h-4 mr-2" />
                Award Spending Points
              </button>
              
              <button
                onClick={loadUsers}
                disabled={isLoading}
                className="inline-flex items-center font-medium border border-gray-300 bg-white text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiRefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                {t('admin.loyalty.refresh')}
              </button>
              
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Users List */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md">
              <div className="p-6 border-b border-gray-200">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <FiUsers className="w-5 h-5 mr-2" />
                    {t('admin.loyalty.usersList')} ({totalUsers})
                  </h2>
                  
                  <form onSubmit={handleSearch} className="mt-4 sm:mt-0">
                    <div className="flex">
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('admin.loyalty.searchPlaceholder')}
                        className="block w-full px-3 py-2 border border-gray-300 rounded-l-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center px-3 py-2 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-500 hover:bg-gray-100"
                      >
                        <FiSearch className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.loyalty.table.user')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.loyalty.table.tier')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('profile.membershipId')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.loyalty.table.points')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.loyalty.table.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {isLoading ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                          {t('common.loading')}
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                          {t('admin.loyalty.noUsers')}
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => (
                        <tr 
                          key={user.user_id}
                          className={`hover:bg-gray-50 cursor-pointer ${
                            selectedUser?.user_id === user.user_id ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => selectUser(user)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {user.first_name && user.last_name 
                                  ? `${user.first_name} ${user.last_name}`
                                  : user.oauth_provider === 'line' && user.first_name
                                  ? user.first_name
                                  : user.email
                                }
                              </div>
                              <div className="text-sm text-gray-500">
                                {user.oauth_provider === 'line' && user.first_name ? 'LINE User' : user.email}
                              </div>
                              {user.oauth_provider && (
                                <div className="text-xs mt-1">
                                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                                    user.oauth_provider === 'line' ? 'bg-green-100 text-green-800' :
                                    user.oauth_provider === 'google' ? 'bg-red-100 text-red-800' :
                                    user.oauth_provider === 'facebook' ? 'bg-blue-100 text-blue-800' :
                                    'bg-gray-100 text-gray-800'
                                  }`}
                                  >
                                    via {user.oauth_provider.toUpperCase()}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span 
                              className="inline-flex px-2 py-1 text-xs font-semibold rounded-full"
                              style={{ 
                                backgroundColor: `${user.tier_color}20`,
                                color: user.tier_color
                              }}
                            >
                              {user.tier_name}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900 font-mono">
                              {user.membership_id || '-'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {user.current_points.toLocaleString()}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openPointsModal(user, 'award');
                              }}
                              className="text-green-600 hover:text-green-900"
                            >
                              <FiPlus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openPointsModal(user, 'deduct');
                              }}
                              className="text-red-600 hover:text-red-900"
                            >
                              <FiMinus className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <div className="text-sm text-gray-700">
                    {t('admin.loyalty.pagination.showing', {
                      start: currentPage * pageSize + 1,
                      end: Math.min((currentPage + 1) * pageSize, totalUsers),
                      total: totalUsers
                    })}
                  </div>
                  <div className="flex space-x-1">
                    <button
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 0}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                      {t('common.previous')}
                    </button>
                    <button
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage >= totalPages - 1}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-50"
                    >
                      {t('common.next')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* User Details */}
          <div>
            {selectedUser ? (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {t('admin.loyalty.userDetails')}
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {selectedUser.first_name && selectedUser.last_name 
                        ? `${selectedUser.first_name} ${selectedUser.last_name}`
                        : selectedUser.oauth_provider === 'line' && selectedUser.first_name
                        ? selectedUser.first_name
                        : selectedUser.email
                      }
                    </div>
                    <div className="text-sm text-gray-500">
                      {selectedUser.oauth_provider === 'line' && selectedUser.first_name ? 'LINE User' : selectedUser.email}
                    </div>
                    {selectedUser.oauth_provider && (
                      <div className="text-xs mt-1">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          selectedUser.oauth_provider === 'line' ? 'bg-green-100 text-green-800' :
                          selectedUser.oauth_provider === 'google' ? 'bg-red-100 text-red-800' :
                          selectedUser.oauth_provider === 'facebook' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}
                        >
                          via {selectedUser.oauth_provider.toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-500">{t('profile.membershipId')}</div>
                    <div className="text-sm font-mono text-gray-900">{selectedUser.membership_id || t('admin.coupons.notAssigned')}</div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-500">{t('admin.loyalty.currentPoints')}</div>
                    <div className="text-lg font-semibold">{selectedUser.current_points.toLocaleString()}</div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-500">{t('admin.loyalty.currentTier')}</div>
                    <div 
                      className="inline-flex px-2 py-1 text-sm font-semibold rounded-full"
                      style={{ 
                        backgroundColor: `${selectedUser.tier_color}20`,
                        color: selectedUser.tier_color
                      }}
                    >
                      {selectedUser.tier_name}
                    </div>
                  </div>
                </div>

                {/* Recent Transactions */}
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">
                    {t('admin.loyalty.recentTransactions')}
                  </h4>
                  <div className="max-h-64 overflow-y-auto space-y-3">
                    {userTransactions.length === 0 ? (
                      <div className="text-sm text-gray-500">
                        {t('admin.loyalty.noTransactions')}
                      </div>
                    ) : (
                      userTransactions.slice(0, 10).map((transaction) => (
                        <div key={transaction.id} className="flex justify-between items-start text-sm border-b border-gray-100 pb-2 last:border-b-0">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <div className={transaction.points > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {transaction.points > 0 ? '+' : ''}{transaction.points.toLocaleString()} pts
                              </div>
                              <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                {transaction.type}
                              </div>
                            </div>
                            <div className="mt-1 space-y-1">
                              <div className="text-xs text-gray-600">
                                {formatDateTimeToEuropean(transaction.created_at)}
                              </div>
                              {transaction.admin_email && (
                                <div className="flex items-center space-x-1 text-xs text-blue-600">
                                  <FiUser className="w-3 h-3" />
                                  <span title={`Adjusted by ${transaction.admin_email}`}>
                                    Admin: {transaction.admin_email}
                                  </span>
                                </div>
                              )}
                              {transaction.admin_reason && (
                                <div className="text-xs text-gray-500 italic">
                                  "{transaction.admin_reason}"
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-md p-6 text-center text-gray-500">
                {t('admin.loyalty.selectUser')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Points Adjustment Modal */}
      {pointsModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {pointsModal.type === 'award' 
                ? t('admin.loyalty.awardPoints')
                : t('admin.loyalty.deductPoints')
              }
            </h3>
            
            <form onSubmit={handlePointsSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.loyalty.pointsAmount')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={pointsForm.points}
                  onChange={(e) => setPointsForm({ ...pointsForm, points: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.loyalty.description')}
                </label>
                <textarea
                  value={pointsForm.description}
                  onChange={(e) => setPointsForm({ ...pointsForm, description: e.target.value })}
                  rows={3}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.loyalty.referenceId')} ({t('common.optional')})
                </label>
                <input
                  type="text"
                  value={pointsForm.referenceId}
                  onChange={(e) => setPointsForm({ ...pointsForm, referenceId: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={closePointsModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isLoadingAction}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                    pointsModal.type === 'award'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  } disabled:opacity-50`}
                >
                  {isLoadingAction ? t('common.processing') : (
                    pointsModal.type === 'award' 
                      ? t('admin.loyalty.awardPoints')
                      : t('admin.loyalty.deductPoints')
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Spending Console Modal */}
      {spendingModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              <FiDollarSign className="w-5 h-5 inline mr-2" />
              Award Spending Points
            </h3>
            
            <form onSubmit={handleSpendingSubmit} className="space-y-4">
              {/* User Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Customer
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={spendingForm.userSearchTerm}
                    onChange={(e) => handleUserSearchChange(e.target.value)}
                    placeholder="Search by name or email..."
                    className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                  {isSearchingUsers && (
                    <div className="absolute right-3 top-2.5">
                      <FiRefreshCw className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  )}
                </div>
                
                {/* User Search Results */}
                {userSearchResults.length > 0 && !spendingForm.selectedUser && (
                  <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-md bg-white shadow-sm">
                    {userSearchResults.map((user) => (
                      <button
                        key={user.user_id}
                        type="button"
                        onClick={() => selectUserForSpending(user)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 focus:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium text-sm">
                          {user.first_name && user.last_name 
                            ? `${user.first_name} ${user.last_name}`
                            : user.oauth_provider === 'line' && user.first_name
                            ? user.first_name
                            : user.email
                          }
                        </div>
                        <div className="text-xs text-gray-500">
                          {user.oauth_provider === 'line' && user.first_name ? 'LINE User' : user.email}
                        </div>
                        <div className="text-xs text-gray-400">
                          {user.tier_name} • {user.current_points} points • {t('profile.membershipId')}: {user.membership_id || 'N/A'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Selected User Display */}
                {spendingForm.selectedUser && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium text-sm text-blue-900">
                          {spendingForm.selectedUser.first_name && spendingForm.selectedUser.last_name 
                            ? `${spendingForm.selectedUser.first_name} ${spendingForm.selectedUser.last_name}`
                            : spendingForm.selectedUser.oauth_provider === 'line' && spendingForm.selectedUser.first_name
                            ? spendingForm.selectedUser.first_name
                            : spendingForm.selectedUser.email
                          }
                        </div>
                        <div className="text-xs text-blue-700">
                          {spendingForm.selectedUser.oauth_provider === 'line' && spendingForm.selectedUser.first_name ? 'LINE User' : spendingForm.selectedUser.email}
                        </div>
                        <div className="text-xs text-blue-600">
                          {spendingForm.selectedUser.tier_name} • {spendingForm.selectedUser.current_points} points
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSpendingForm({ ...spendingForm, selectedUser: null, userSearchTerm: '' })}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Spending Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Spending Amount (THB)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={spendingForm.spendingAmount}
                  onChange={(e) => setSpendingForm({ ...spendingForm, spendingAmount: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0.00"
                  required
                />
                {spendingForm.spendingAmount && (
                  <div className="mt-1 text-sm text-green-600">
                    Points to award: {calculatePoints(parseFloat(spendingForm.spendingAmount) || 0)}
                  </div>
                )}
              </div>

              {/* Nights Stayed */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Nights Stayed (Optional)
                </label>
                <input
                  type="number"
                  min="0"
                  value={spendingForm.nightsStayed}
                  onChange={(e) => setSpendingForm({ ...spendingForm, nightsStayed: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0"
                />
                {spendingForm.nightsStayed && parseInt(spendingForm.nightsStayed) > 0 && (
                  <div className="mt-1 text-sm text-blue-600">
                    Will add {spendingForm.nightsStayed} {parseInt(spendingForm.nightsStayed) === 1 ? 'night' : 'nights'} to user's total
                  </div>
                )}
              </div>

              {/* Check-in ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Check-in ID (Reference)
                </label>
                <input
                  type="text"
                  value={spendingForm.checkinId}
                  onChange={(e) => setSpendingForm({ ...spendingForm, checkinId: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., CHK-2024-001"
                  required
                />
              </div>
              
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={closeSpendingConsole}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoadingAction || !spendingForm.selectedUser || !spendingForm.spendingAmount || !spendingForm.checkinId}
                  className="px-4 py-2 text-sm font-medium text-white rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoadingAction ? 'Processing...' : 'Award Points'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}