import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Coupon, CreateCouponRequest, CouponType, CouponStatus } from '../../types/coupon';
import { couponService } from '../../services/couponService';
import DashboardButton from '../../components/navigation/DashboardButton';
import CouponAssignmentsModal from '../../components/admin/CouponAssignmentsModal';
import toast from 'react-hot-toast';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

const CouponManagement: React.FC = () => {
  const { t } = useTranslation();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAssignmentsModal, setShowAssignmentsModal] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [createModalError, setCreateModalError] = useState<string | null>(null);

  // Create coupon form state
  const [newCoupon, setNewCoupon] = useState<CreateCouponRequest>({
    code: '',
    name: '',
    description: '',
    type: 'percentage',
    value: 0,
    minimumSpend: 0,
    maximumDiscount: 0,
    usageLimit: 100,
    usageLimitPerUser: 1,
    validFrom: new Date().toISOString().split('T')[0],
    validUntil: '',
    termsAndConditions: ''
  });

  const loadCoupons = async (pageNum: number = 1) => {
    try {
      setLoading(true);
      setError(null);
      
      // Get all non-expired coupons - let backend handle the filtering
      // We need to make multiple calls to get different statuses since API doesn't support "NOT expired"
      const [activeResponse, pausedResponse, draftResponse] = await Promise.all([
        couponService.getAdminCoupons(1, 1000, { status: 'active' }),
        couponService.getAdminCoupons(1, 1000, { status: 'paused' }),
        couponService.getAdminCoupons(1, 1000, { status: 'draft' })
      ]);
      
      // Combine all non-expired coupons
      const allCoupons = [
        ...activeResponse.coupons,
        ...pausedResponse.coupons, 
        ...draftResponse.coupons
      ];
      
      // Implement client-side pagination for the filtered results
      const itemsPerPage = 10;
      const startIndex = (pageNum - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const paginatedCoupons = allCoupons.slice(startIndex, endIndex);
      const calculatedTotalPages = Math.ceil(allCoupons.length / itemsPerPage);
      
      setCoupons(paginatedCoupons);
      setTotalPages(calculatedTotalPages);
      setPage(pageNum);
    } catch (err: any) {
      console.error('Error loading coupons:', err);
      setError(err.response?.data?.message || 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const authStorage = localStorage.getItem('auth-storage');
      let token = '';
      
      if (authStorage) {
        try {
          const parsedAuth = JSON.parse(authStorage);
          token = parsedAuth.state?.accessToken || '';
        } catch (error) {
          console.error('Error parsing auth storage:', error);
        }
      }
      
      const response = await fetch('http://localhost:4000/api/loyalty/admin/users?limit=100', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const usersData = data.data?.users || [];
        // Transform the loyalty service response to our User interface
        const transformedUsers = usersData.map((user: any) => ({
          id: user.user_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name
        }));
        setUsers(transformedUsers);
      } else {
        console.error('Failed to load users:', response.status, response.statusText);
      }
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  useEffect(() => {
    loadCoupons();
    loadUsers();
  }, []);

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setCreateModalError(null); // Clear any previous errors
      
      // Convert date strings to datetime format for backend validation
      const couponData = {
        ...newCoupon,
        validFrom: newCoupon.validFrom ? new Date(newCoupon.validFrom + 'T00:00:00.000Z').toISOString() : undefined,
        validUntil: newCoupon.validUntil ? new Date(newCoupon.validUntil + 'T23:59:59.999Z').toISOString() : undefined
      };
      
      await couponService.createCoupon(couponData);
      setShowCreateModal(false);
      setCreateModalError(null); // Clear error on success
      setNewCoupon({
        code: '',
        name: '',
        description: '',
        type: 'percentage',
        value: 0,
        minimumSpend: 0,
        maximumDiscount: 0,
        usageLimit: 100,
        usageLimitPerUser: 1,
        validFrom: new Date().toISOString().split('T')[0],
        validUntil: '',
        termsAndConditions: ''
      });
      await loadCoupons();
    } catch (err: any) {
      // Show error in modal instead of main page
      setCreateModalError(err.response?.data?.message || 'Failed to create coupon');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignCoupons = async () => {
    if (!selectedCoupon || selectedUsers.length === 0) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await couponService.assignCouponToUsers({
        couponId: selectedCoupon.id,
        userIds: selectedUsers,
        assignedReason: 'Admin assignment'
      });
      
      // Show success message
      const assignedCount = response?.length || selectedUsers.length;
      toast.success(`Successfully assigned coupon "${selectedCoupon.name}" to ${assignedCount} user(s)`);
      
      setShowAssignModal(false);
      setSelectedUsers([]);
      setSelectedCoupon(null);
      
      // Refresh the coupons list to update counts
      await loadCoupons();
    } catch (err: any) {
      console.error('Assignment error:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to assign coupons';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCouponStatus = async (coupon: Coupon) => {
    try {
      const newStatus = coupon.status === 'active' ? 'paused' : 'active';
      await couponService.updateCouponStatus(coupon.id, newStatus as CouponStatus);
      await loadCoupons();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update coupon status');
    }
  };

  const handleDeleteCoupon = (coupon: Coupon) => {
    setSelectedCoupon(coupon);
    setDeleteConfirmText('');
    setShowDeleteModal(true);
  };

  const confirmDeleteCoupon = async () => {
    const deleteKeyword = t('admin.coupons.deleteKeyword');
    if (!selectedCoupon || deleteConfirmText !== deleteKeyword) {
      return;
    }

    try {
      setLoading(true);
      await couponService.deleteCoupon(selectedCoupon.id);
      
      // Close modal and reset state
      setShowDeleteModal(false);
      setSelectedCoupon(null);
      setDeleteConfirmText('');
      
      // Reload coupons and clear any existing errors
      await loadCoupons();
      setError(null);
      
    } catch (err: any) {
      console.error('Error deleting coupon:', err);
      
      // Handle authentication errors specifically
      if (err.response?.status === 401) {
        setError('Your session has expired. Please refresh the page and log in again.');
      } else if (err.response?.status === 403) {
        setError('You do not have permission to delete coupons. Admin access required.');
      } else if (err.response?.status === 404) {
        // Handle case where coupon was already deleted
        setError(`Coupon "${selectedCoupon.name}" has already been deleted. Refreshing the list...`);
        // Auto-refresh the list to remove stale entries
        setTimeout(() => {
          loadCoupons();
          setError(null);
        }, 2000);
      } else {
        setError(err.response?.data?.message || `Failed to delete coupon "${selectedCoupon.name}"`);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB'
    }).format(amount);
  };

  if (loading && coupons.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/4"></div>
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 bg-gray-200 rounded"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {t('admin.coupons.title')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('admin.coupons.subtitle')}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(true);
                  setCreateModalError(null); // Clear any previous errors
                }}
                className="inline-flex items-center font-medium bg-blue-600 text-white px-4 py-2 text-sm rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {t('admin.coupons.createCoupon')}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="text-red-400 mr-3">⚠️</div>
              <div>
                <h3 className="text-red-800 font-medium">Error</h3>
                <p className="text-red-700 mt-1">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="text-red-600 underline hover:text-red-800 mt-2"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Coupons Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.coupons.title_field')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.coupons.couponTypeAndValue')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.coupons.usage')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.coupons.validity')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.coupons.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.coupons.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {coupons.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="text-gray-500">
                        <p className="text-lg font-medium">{t('admin.coupons.noCoupons')}</p>
                        <p className="text-sm mt-1">{t('admin.coupons.noCouponsDescription')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  coupons.map((coupon) => (
                    <tr key={coupon.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {coupon.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {coupon.code} - {coupon.description}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {coupon.type === 'percentage' 
                          ? `${coupon.value}% off`
                          : coupon.type === 'fixed_amount'
                          ? formatCurrency(coupon.value || 0)
                          : t(`coupons.types.${coupon.type}`)
                        }
                      </div>
                      {(coupon.minimumSpend || 0) > 0 && (
                        <div className="text-sm text-gray-500">
                          {t('admin.coupons.min')}: {formatCurrency(coupon.minimumSpend || 0)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {coupon.usedCount || 0} / {coupon.usageLimit}
                      </div>
                      <div className="text-sm text-gray-500">
                        {t('admin.coupons.maxPerUser', { count: coupon.usageLimitPerUser })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {new Date(coupon.validFrom).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        {t('admin.coupons.to')} {coupon.validUntil ? new Date(coupon.validUntil).toLocaleDateString() : t('common.noEndDate')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        coupon.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : coupon.status === 'paused'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {coupon.status === 'active' ? t('admin.coupons.active') : 
                         coupon.status === 'paused' ? t('admin.coupons.paused') : 
                         t(`admin.coupons.${coupon.status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-1 sm:space-y-0">
                        <button
                          onClick={() => {
                            setSelectedCoupon(coupon);
                            setShowAssignModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-900 text-left"
                        >
                          {t('admin.coupons.assign')}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedCoupon(coupon);
                            setShowAssignmentsModal(true);
                          }}
                          className="text-purple-600 hover:text-purple-900 text-left"
                        >
                          {t('admin.coupons.viewAssignments')}
                        </button>
                        <button
                          onClick={() => handleToggleCouponStatus(coupon)}
                          className={`text-left ${
                            coupon.status === 'active'
                              ? 'text-orange-600 hover:text-orange-900'
                              : 'text-green-600 hover:text-green-900'
                          }`}
                        >
                          {coupon.status === 'active' ? t('admin.coupons.pause') : t('admin.coupons.activate')}
                        </button>
                        <button
                          onClick={() => handleDeleteCoupon(coupon)}
                          className="text-red-600 hover:text-red-900 text-left"
                          title={t('admin.coupons.deleteTooltip')}
                        >
                          {t('admin.coupons.remove')}
                        </button>
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {t('admin.pagination.page')} {page} {t('admin.pagination.of')} {totalPages}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => loadCoupons(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded disabled:opacity-50"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => loadCoupons(page + 1)}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded disabled:opacity-50"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Coupon Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-full overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.coupons.createNewCoupon')}</h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateModalError(null); // Clear error when closing
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              {/* Modal-specific error display */}
              {createModalError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <div className="flex">
                    <div className="text-red-400 mr-3">⚠️</div>
                    <div className="flex-1">
                      <h3 className="text-red-800 font-medium text-sm">{t('admin.coupons.errorCreating')}</h3>
                      <p className="text-red-700 text-sm mt-1">{createModalError}</p>
                      <button
                        onClick={() => setCreateModalError(null)}
                        className="text-red-600 underline hover:text-red-800 text-xs mt-2"
                      >
                        {t('common.dismiss')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleCreateCoupon} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.code')}
                    </label>
                    <input
                      type="text"
                      required
                      value={newCoupon.code}
                      onChange={(e) => setNewCoupon({...newCoupon, code: e.target.value.toUpperCase()})}
                      placeholder={t('admin.coupons.codePlaceholder')}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.name')}
                    </label>
                    <input
                      type="text"
                      required
                      value={newCoupon.name}
                      onChange={(e) => setNewCoupon({...newCoupon, name: e.target.value})}
                      placeholder={t('admin.coupons.namePlaceholder')}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.type_field')}
                    </label>
                    <select
                      value={newCoupon.type}
                      onChange={(e) => setNewCoupon({...newCoupon, type: e.target.value as CouponType})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="percentage">{t('coupons.types.percentage')}</option>
                      <option value="fixed_amount">{t('coupons.types.fixed_amount')}</option>
                      <option value="bogo">{t('coupons.types.bogo')}</option>
                      <option value="free_upgrade">{t('coupons.types.free_upgrade')}</option>
                      <option value="free_service">{t('coupons.types.free_service')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.coupons.description_field')}
                  </label>
                  <textarea
                    value={newCoupon.description}
                    onChange={(e) => setNewCoupon({...newCoupon, description: e.target.value})}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {newCoupon.type === 'percentage' ? t('admin.coupons.percentage') : t('admin.coupons.amount')}
                    </label>
                    <input
                      type="number"
                      step={newCoupon.type === 'percentage' ? '1' : '0.01'}
                      min="0"
                      required
                      value={newCoupon.value}
                      onChange={(e) => setNewCoupon({...newCoupon, value: parseFloat(e.target.value) || 0})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.minimumSpend')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newCoupon.minimumSpend}
                      onChange={(e) => setNewCoupon({...newCoupon, minimumSpend: parseFloat(e.target.value) || 0})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.maximumDiscount')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newCoupon.maximumDiscount}
                      onChange={(e) => setNewCoupon({...newCoupon, maximumDiscount: parseFloat(e.target.value) || 0})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.maxTotalUses')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={newCoupon.usageLimit}
                      onChange={(e) => setNewCoupon({...newCoupon, usageLimit: parseInt(e.target.value) || 1})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.maxUsesPerUser')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={newCoupon.usageLimitPerUser}
                      onChange={(e) => setNewCoupon({...newCoupon, usageLimitPerUser: parseInt(e.target.value) || 1})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.validFrom')}
                    </label>
                    <input
                      type="date"
                      required
                      value={newCoupon.validFrom}
                      onChange={(e) => setNewCoupon({...newCoupon, validFrom: e.target.value})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.coupons.validUntil')}
                    </label>
                    <input
                      type="date"
                      required
                      value={newCoupon.validUntil}
                      onChange={(e) => setNewCoupon({...newCoupon, validUntil: e.target.value})}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.coupons.termsAndConditions')}
                  </label>
                  <textarea
                    value={newCoupon.termsAndConditions}
                    onChange={(e) => setNewCoupon({...newCoupon, termsAndConditions: e.target.value})}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="text-sm text-gray-600">
                  <p>{t('admin.coupons.activeImmediately')}</p>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateModalError(null); // Clear error when canceling
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading ? t('admin.coupons.creating') : t('admin.coupons.createCoupon')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Assign Coupon Modal */}
      {showAssignModal && selectedCoupon && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full max-h-full overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.coupons.assignCoupon')}</h2>
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 p-3 bg-gray-50 rounded-md">
                <div className="font-medium">{selectedCoupon.name}</div>
                <div className="text-sm text-gray-600">{selectedCoupon.code} - {selectedCoupon.description}</div>
              </div>

              <div className="space-y-3 max-h-60 overflow-y-auto">
                {users.map((user) => (
                  <label key={user.id || user.email} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUsers([...selectedUsers, user.id]);
                        } else {
                          setSelectedUsers(selectedUsers.filter(id => id !== user.id));
                        }
                      }}
                      className="mr-3"
                    />
                    <div>
                      <div className="font-medium">{user.firstName} {user.lastName}</div>
                      <div className="text-sm text-gray-600">{user.email}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleAssignCoupons}
                  disabled={loading || selectedUsers.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? t('admin.coupons.assigning') : t('admin.coupons.assignToUsers', { count: selectedUsers.length })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedCoupon && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-red-600">{t('admin.coupons.deleteCoupon')}</h2>
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedCoupon(null);
                    setDeleteConfirmText('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <div className="flex items-center mb-2">
                  <span className="text-red-500 mr-2">⚠️</span>
                  <span className="font-medium text-red-800">{t('admin.coupons.deleteWarning')}</span>
                </div>
                <div className="text-sm text-red-700">
                  <p className="mb-2">{t('admin.coupons.deleteConfirmText')}:</p>
                  <p className="font-medium">"{selectedCoupon.name}" ({selectedCoupon.code})</p>
                </div>
              </div>

              <div className="mb-4 p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-700 mb-2">{t('admin.coupons.deleteAffects')}:</p>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• {t('admin.coupons.existingRedemptions', { count: selectedCoupon.usedCount || 0 })}</li>
                  <li>• {t('admin.coupons.assignedUsers')}</li>
                  <li>• {t('admin.coupons.analyticsHistory')}</li>
                </ul>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.coupons.typeToConfirm')} <span className="font-bold text-red-600">{t('admin.coupons.deleteKeyword')}</span> {t('admin.coupons.toConfirm')}:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={t('admin.coupons.deletePlaceholder')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedCoupon(null);
                    setDeleteConfirmText('');
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={confirmDeleteCoupon}
                  disabled={loading || deleteConfirmText !== t('admin.coupons.deleteKeyword')}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t('admin.coupons.deleting') : t('admin.coupons.deleteCoupon')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Coupon Assignments Modal */}
      {showAssignmentsModal && selectedCoupon && (
        <CouponAssignmentsModal
          coupon={selectedCoupon}
          onClose={() => {
            setShowAssignmentsModal(false);
            setSelectedCoupon(null);
          }}
        />
      )}
    </div>
  );
};

export default CouponManagement;