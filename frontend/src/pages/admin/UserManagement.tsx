import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { FiUser, FiUsers, FiUserCheck, FiUserX, FiSearch, FiTrash2, FiEye } from 'react-icons/fi';
import { userManagementService, User, UserStats } from '../../services/userManagementService';
import DashboardButton from '../../components/navigation/DashboardButton';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';

const UserManagement: React.FC = () => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const pageSize = 10;

  const fetchUsers = useCallback(async (page = 1, search = '') => {
    try {
      const response = await userManagementService.getUsers(page, pageSize, search);
      setUsers(response.data);
      setTotalPages(response.pagination.pages);
    } catch (_error) {
      toast.error(t('userManagement.messages.fetchUsersFailed'));
    }
  }, [t]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await userManagementService.getUserStats();
      setStats(response.data);
    } catch (_error) {
      toast.error(t('userManagement.messages.fetchStatsFailed'));
    }
  }, [t]);

  // Debounce search term - wait 300ms after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Initial load - fetch stats and users
  useEffect(() => {
    const loadInitialData = async () => {
      setInitialLoading(true);
      await Promise.all([fetchUsers(1, ''), fetchStats()]);
      setInitialLoading(false);
    };
    loadInitialData();
  }, [fetchUsers, fetchStats]);

  // Auto-search on debounced term change or page change
  useEffect(() => {
    // Skip if still in initial loading
    if (initialLoading) return;

    const searchUsers = async () => {
      setIsSearching(true);
      await fetchUsers(currentPage, debouncedSearchTerm);
      setIsSearching(false);
    };
    searchUsers();
  }, [currentPage, debouncedSearchTerm, fetchUsers, initialLoading]);

  // Reset to page 1 when search term changes
  useEffect(() => {
    if (!initialLoading && debouncedSearchTerm !== '') {
      setCurrentPage(1);
    }
  }, [debouncedSearchTerm, initialLoading]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    // Search is now automatic via debounce, but keep form submit for accessibility
  }, []);

  const handleStatusToggle = useCallback(async (user: User) => {
    try {
      await userManagementService.updateUserStatus(user.userId, !user.isActive);
      toast.success(user.isActive
        ? t('userManagement.messages.userDeactivated')
        : t('userManagement.messages.userActivated')
      );
      fetchUsers(currentPage, debouncedSearchTerm);
    } catch (_error) {
      toast.error(t('userManagement.messages.updateStatusFailed'));
    }
  }, [currentPage, debouncedSearchTerm, fetchUsers, t]);

  const handleRoleChange = async (user: User, newRole: string) => {
    try {
      await userManagementService.updateUserRole(user.userId, newRole);
      toast.success(t('userManagement.messages.roleUpdated'));
      fetchUsers(currentPage, debouncedSearchTerm);
    } catch (_error) {
      toast.error(t('userManagement.messages.updateRoleFailed'));
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) {return;}

    try {
      await userManagementService.deleteUser(userToDelete.userId);
      toast.success(t('userManagement.messages.userDeleted'));
      setShowDeleteConfirm(false);
      setUserToDelete(null);
      fetchUsers(currentPage, debouncedSearchTerm);
      fetchStats();
    } catch (_error) {
      toast.error(t('userManagement.messages.deleteFailed'));
    }
  };

  const confirmDelete = (user: User) => {
    setUserToDelete(user);
    setShowDeleteConfirm(true);
  };

  const viewUserDetails = async (user: User) => {
    try {
      const response = await userManagementService.getUserById(user.userId);
      setSelectedUser(response.data);
      setShowUserModal(true);
    } catch (_error) {
      toast.error(t('userManagement.messages.fetchDetailsFailed'));
    }
  };

  const formatDate = (dateString: string) => {
    return formatDateToDDMMYYYY(dateString);
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'bg-red-100 text-red-800';
      case 'admin':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  const getStatusBadgeColor = (isActive: boolean) => {
    return isActive 
      ? 'bg-green-100 text-green-800' 
      : 'bg-gray-100 text-gray-800';
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded w-64 mb-6" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white p-6 rounded-lg shadow">
                  <div className="h-4 bg-gray-300 rounded w-20 mb-2" />
                  <div className="h-8 bg-gray-300 rounded w-12" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <FiUsers className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-3xl font-bold text-gray-900">{t('userManagement.title')}</h1>
            </div>
            <div className="flex items-center space-x-4">
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-4">

        {/* Statistics Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center">
                <FiUsers className="h-8 w-8 text-blue-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">{t('userManagement.totalUsers')}</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center">
                <FiUserCheck className="h-8 w-8 text-green-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">{t('userManagement.activeUsers')}</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center">
                <FiUser className="h-8 w-8 text-purple-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">{t('userManagement.administrators')}</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.admins}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center">
                <FiUserCheck className="h-8 w-8 text-orange-600 mr-3" />
                <div>
                  <p className="text-sm text-gray-600">{t('userManagement.recentJoins')}</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.recentlyJoined}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="flex-1 relative">
              <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={t('userManagement.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              )}
            </div>
          </form>
          <p className="text-xs text-gray-500 mt-2">{t('userManagement.searchHint', 'Search by name, email, phone, or membership ID')}</p>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden relative">
          {isSearching && (
            <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
              <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('userManagement.user')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('profile.membershipId')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('userManagement.email')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('userManagement.role')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('userManagement.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('userManagement.joined')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('userManagement.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.userId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          {user.avatarUrl ? (
                            <img
                              className="h-10 w-10 rounded-full"
                              src={user.avatarUrl}
                              alt=""
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                              <FiUser className="h-6 w-6 text-gray-600" />
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {user.firstName ?? user.lastName 
                              ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
                              : t('userManagement.noNameProvided')
                            }
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                      {user.membershipId ?? '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${getRoleBadgeColor(user.role)}`}
                      >
                        <option value="customer">{t('userManagement.customer')}</option>
                        <option value="admin">{t('userManagement.admin')}</option>
                        <option value="super_admin">{t('userManagement.superAdmin')}</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeColor(user.isActive)}`}>
                        {user.isActive ? t('userManagement.active') : t('userManagement.inactive')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => viewUserDetails(user)}
                          className="text-blue-600 hover:text-blue-900 p-1"
                          title={t('userManagement.viewDetails')}
                        >
                          <FiEye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleStatusToggle(user)}
                          className={`p-1 ${user.isActive 
                            ? 'text-red-600 hover:text-red-900' 
                            : 'text-green-600 hover:text-green-900'
                          }`}
                          title={user.isActive ? t('userManagement.deactivate') : t('userManagement.activate')}
                        >
                          {user.isActive ? <FiUserX className="h-4 w-4" /> : <FiUserCheck className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => confirmDelete(user)}
                          className="text-red-600 hover:text-red-900 p-1"
                          title={t('userManagement.deleteUser')}
                        >
                          <FiTrash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-6">
            <div className="text-sm text-gray-700">
              {t('userManagement.pagination', { current: currentPage, total: totalPages })}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('userManagement.previous')}
              </button>
              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('userManagement.next')}
              </button>
            </div>
          </div>
        )}

        {/* User Details Modal */}
        {showUserModal && selectedUser && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{t('userManagement.userDetails')}</h3>
                <div className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.name')}: </span>
                    <span className="text-gray-900">
                      {selectedUser.firstName ?? selectedUser.lastName 
                        ? `${selectedUser.firstName ?? ''} ${selectedUser.lastName ?? ''}`.trim()
                        : t('userManagement.notProvided')
                      }
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('profile.membershipId')}: </span>
                    <span className="text-gray-900 font-mono text-sm">{selectedUser.membershipId ?? t('admin.coupons.notAssigned')}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.email')}: </span>
                    <span className="text-gray-900">{selectedUser.email}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.phone')}: </span>
                    <span className="text-gray-900">{selectedUser.phone ?? t('userManagement.notProvided')}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.role')}: </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getRoleBadgeColor(selectedUser.role)}`}>
                      {selectedUser.role === 'super_admin' ? t('userManagement.superAdmin') : 
                       selectedUser.role === 'admin' ? t('userManagement.admin') : t('userManagement.customer')}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.status')}: </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeColor(selectedUser.isActive)}`}>
                      {selectedUser.isActive ? t('userManagement.active') : t('userManagement.inactive')}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.emailVerified')}: </span>
                    <span className="text-gray-900">{selectedUser.emailVerified ? t('userManagement.yes') : t('userManagement.no')}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">{t('userManagement.joined')}: </span>
                    <span className="text-gray-900">{formatDate(selectedUser.createdAt)}</span>
                  </div>
                </div>
                <div className="mt-6">
                  <button
                    onClick={() => setShowUserModal(false)}
                    className="w-full px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                  >
                    {t('userManagement.close')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && userToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3 text-center">
                <FiTrash2 className="mx-auto h-16 w-16 text-red-600" />
                <h3 className="text-lg font-medium text-gray-900 mt-4">{t('userManagement.deleteUser')}</h3>
                <p className="text-sm text-gray-500 mt-2">
                  {t('userManagement.confirmDelete', {
                    name: userToDelete.firstName ?? userToDelete.lastName 
                      ? `${userToDelete.firstName ?? ''} ${userToDelete.lastName ?? ''}`.trim()
                      : userToDelete.email
                  })}
                </p>
                <div className="mt-6 flex justify-center space-x-4">
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setUserToDelete(null);
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                  >
                    {t('userManagement.cancel')}
                  </button>
                  <button
                    onClick={handleDeleteUser}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                  >
                    {t('userManagement.delete')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(UserManagement);