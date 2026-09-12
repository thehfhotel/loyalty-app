import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { FiUser, FiUsers, FiUserCheck, FiUserX, FiSearch, FiTrash2, FiEye } from 'react-icons/fi';
import { userManagementService, User, UserStats } from '../../services/userManagementService';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';
import AppShell from '../../components/layout/AppShell';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { Card, Table, type TableColumn, Input, Select, Badge, Button, Modal, Skeleton } from '../../components/ui';

type RoleBadgeTone = 'error' | 'info' | 'brand';

const ROLE_BADGE_TONE: Record<string, RoleBadgeTone> = {
  super_admin: 'error',
  admin: 'info',
};

function getRoleBadgeTone(role: string): RoleBadgeTone {
  return ROLE_BADGE_TONE[role] ?? 'brand';
}

function getUserDisplayName(user: Pick<User, 'firstName' | 'lastName'>, fallback: string): string {
  return user.firstName ?? user.lastName ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : fallback;
}

function StatCard({ icon: Icon, iconClassName, label, value }: { icon: React.ComponentType<{ className?: string }>; iconClassName: string; label: string; value: number }) {
  return (
    <Card>
      <div className="flex items-center">
        <Icon className={`h-8 w-8 mr-3 ${iconClassName}`} aria-hidden="true" />
        <div>
          <p className="text-caption text-ink-muted">{label}</p>
          <p className="text-title text-ink">{value}</p>
        </div>
      </div>
    </Card>
  );
}

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

  // The auto-search effect below re-runs the instant `initialLoading` flips
  // to false (it's in that effect's dependency array), which would otherwise
  // re-fetch page 1 with an empty term a second time right after the initial
  // load already fetched exactly that. Skip that one transition so mount
  // performs exactly one fetch; any later change to the page or search term
  // fires normally.
  const skipNextAutoSearchRef = useRef(true);

  // Auto-search on debounced term change or page change
  useEffect(() => {
    // Skip if still in initial loading
    if (initialLoading) {return;}

    if (skipNextAutoSearchRef.current) {
      skipNextAutoSearchRef.current = false;
      return;
    }

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

  const roleLabel = (role: string) =>
    role === 'super_admin' ? t('userManagement.superAdmin') : role === 'admin' ? t('userManagement.admin') : t('userManagement.customer');

  const columns: TableColumn<User>[] = [
    {
      key: 'user',
      header: t('userManagement.user'),
      cell: (user) => (
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10">
            {user.avatarUrl ? (
              <img className="h-10 w-10 rounded-full" src={user.avatarUrl} alt="" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-surface-sunken flex items-center justify-center">
                <FiUser className="h-6 w-6 text-ink-muted" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="ml-4 text-body font-semibold text-ink">
            {getUserDisplayName(user, t('userManagement.noNameProvided'))}
          </div>
        </div>
      ),
    },
    {
      key: 'membershipId',
      header: t('profile.membershipId'),
      cell: (user) => <span className="font-mono">{user.membershipId ?? '-'}</span>,
    },
    { key: 'email', header: t('userManagement.email'), cell: (user) => user.email },
    { key: 'phone', header: t('userManagement.phone'), cell: (user) => user.phone ?? '-' },
    {
      key: 'role',
      header: t('userManagement.role'),
      cell: (user) => (
        <Select
          value={user.role}
          onChange={(e) => handleRoleChange(user, e.target.value)}
          className="h-9 w-auto"
          aria-label={t('userManagement.role')}
        >
          <option value="customer">{t('userManagement.customer')}</option>
          <option value="admin">{t('userManagement.admin')}</option>
          <option value="super_admin">{t('userManagement.superAdmin')}</option>
        </Select>
      ),
    },
    {
      key: 'status',
      header: t('userManagement.status'),
      cell: (user) => (
        <Badge tone={user.isActive ? 'success' : 'neutral'}>
          {user.isActive ? t('userManagement.active') : t('userManagement.inactive')}
        </Badge>
      ),
    },
    { key: 'joined', header: t('userManagement.joined'), cell: (user) => formatDateToDDMMYYYY(user.createdAt) },
    {
      key: 'actions',
      header: t('userManagement.actions'),
      align: 'right',
      cell: (user) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => viewUserDetails(user)} aria-label={t('userManagement.viewDetails')}>
            <FiEye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleStatusToggle(user)}
            aria-label={user.isActive ? t('userManagement.deactivate') : t('userManagement.activate')}
            className={user.isActive ? 'text-error-600 hover:text-error-700' : 'text-success-600 hover:text-success-700'}
          >
            {user.isActive ? <FiUserX className="h-4 w-4" aria-hidden="true" /> : <FiUserCheck className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => confirmDelete(user)}
            aria-label={t('userManagement.deleteUser')}
            className="text-error-600 hover:text-error-700"
          >
            <FiTrash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  if (initialLoading) {
    return (
      <AppShell variant="admin" title={t('userManagement.title')}>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-12" />
              </Card>
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell variant="admin" title={t('userManagement.title')}>
      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard icon={FiUsers} iconClassName="text-brand-600" label={t('userManagement.totalUsers')} value={stats.total} />
          <StatCard icon={FiUserCheck} iconClassName="text-success-700" label={t('userManagement.activeUsers')} value={stats.active} />
          <StatCard icon={FiUser} iconClassName="text-info-700" label={t('userManagement.administrators')} value={stats.admins} />
          <StatCard icon={FiUserCheck} iconClassName="text-warning-700" label={t('userManagement.recentJoins')} value={stats.recentlyJoined} />
        </div>
      )}

      {/* Search Bar */}
      <Card className="mb-8">
        <Input
          type="text"
          placeholder={t('userManagement.searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          leadingIcon={<FiSearch aria-hidden="true" />}
          trailingSlot={isSearching ? <div className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : undefined}
          aria-label={t('userManagement.searchPlaceholder')}
        />
        <p className="text-fine text-ink-muted mt-2">{t('userManagement.searchHint', 'Search by name, email, phone, or membership ID')}</p>
      </Card>

      {/* Users Table */}
      <Table
        columns={columns}
        rows={users}
        rowKey={(user) => user.userId}
        loading={isSearching}
        aria-label={t('userManagement.title')}
        mobileCard={(user) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-body font-semibold text-ink">{getUserDisplayName(user, t('userManagement.noNameProvided'))}</p>
              <Badge tone={user.isActive ? 'success' : 'neutral'} size="sm">
                {user.isActive ? t('userManagement.active') : t('userManagement.inactive')}
              </Badge>
            </div>
            <div className="text-caption text-ink-muted">{user.email}</div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-fine text-ink-muted">{t('profile.membershipId')}</span>
              <span className="text-caption text-ink text-right font-mono">{user.membershipId ?? '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-fine text-ink-muted">{t('userManagement.joined')}</span>
              <span className="text-caption text-ink text-right">{formatDateToDDMMYYYY(user.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Badge tone={getRoleBadgeTone(user.role)} size="sm">{roleLabel(user.role)}</Badge>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => viewUserDetails(user)} aria-label={t('userManagement.viewDetails')}>
                  <FiEye className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleStatusToggle(user)}
                  aria-label={user.isActive ? t('userManagement.deactivate') : t('userManagement.activate')}
                  className={user.isActive ? 'text-error-600 hover:text-error-700' : 'text-success-600 hover:text-success-700'}
                >
                  {user.isActive ? <FiUserX className="h-4 w-4" aria-hidden="true" /> : <FiUserCheck className="h-4 w-4" aria-hidden="true" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => confirmDelete(user)}
                  aria-label={t('userManagement.deleteUser')}
                  className="text-error-600 hover:text-error-700"
                >
                  <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        )}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-6">
          <div className="text-caption text-ink-muted">
            {t('userManagement.pagination', { current: currentPage, total: totalPages })}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>
              {t('userManagement.previous')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages}>
              {t('userManagement.next')}
            </Button>
          </div>
        </div>
      )}

      {/* User Details Modal */}
      <Modal open={showUserModal && Boolean(selectedUser)} onClose={() => setShowUserModal(false)} title={t('userManagement.userDetails')} size="sm">
        {selectedUser && (
          <div className="space-y-3">
            <div>
              <span className="font-semibold text-ink">{t('userManagement.name')}: </span>
              <span className="text-ink">{getUserDisplayName(selectedUser, t('userManagement.notProvided'))}</span>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('profile.membershipId')}: </span>
              <span className="font-mono text-caption text-ink">{selectedUser.membershipId ?? t('admin.coupons.notAssigned')}</span>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('userManagement.email')}: </span>
              <span className="text-ink">{selectedUser.email}</span>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('userManagement.phone')}: </span>
              <span className="text-ink">{selectedUser.phone ?? t('userManagement.notProvided')}</span>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('userManagement.role')}: </span>
              <Badge tone={getRoleBadgeTone(selectedUser.role)}>{roleLabel(selectedUser.role)}</Badge>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('userManagement.status')}: </span>
              <Badge tone={selectedUser.isActive ? 'success' : 'neutral'}>
                {selectedUser.isActive ? t('userManagement.active') : t('userManagement.inactive')}
              </Badge>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('userManagement.emailVerified')}: </span>
              <span className="text-ink">{selectedUser.emailVerified ? t('userManagement.yes') : t('userManagement.no')}</span>
            </div>
            <div>
              <span className="font-semibold text-ink">{t('userManagement.joined')}: </span>
              <span className="text-ink">{formatDateToDDMMYYYY(selectedUser.createdAt)}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={showDeleteConfirm && Boolean(userToDelete)}
        title={t('userManagement.deleteUser')}
        message={userToDelete ? t('userManagement.confirmDelete', {
          name: getUserDisplayName(userToDelete, userToDelete.email),
        }) : ''}
        confirmText={t('userManagement.delete')}
        cancelText={t('userManagement.cancel')}
        onConfirm={handleDeleteUser}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setUserToDelete(null);
        }}
        variant="danger"
      />
    </AppShell>
  );
};

export default React.memo(UserManagement);
