import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { couponService } from '../../services/couponService';
import { Coupon } from '../../types/coupon';

interface CouponAssignment {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  assignedCount: number;
  usedCount: number;
  availableCount: number;
  latestAssignment: Date;
}

interface CouponAssignmentSummary {
  totalUsers: number;
  totalAssigned: number;
  totalUsed: number;
  totalAvailable: number;
}

interface CouponAssignmentsModalProps {
  coupon: Coupon;
  isOpen: boolean;
  onClose: () => void;
}

const CouponAssignmentsModal: React.FC<CouponAssignmentsModalProps> = ({
  coupon,
  isOpen,
  onClose
}) => {
  const { } = useTranslation();
  const [assignments, setAssignments] = useState<CouponAssignment[]>([]);
  const [summary, setSummary] = useState<CouponAssignmentSummary>({
    totalUsers: 0,
    totalAssigned: 0,
    totalUsed: 0,
    totalAvailable: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [userToRemove, setUserToRemove] = useState<CouponAssignment | null>(null);
  const limit = 10;

  const loadAssignments = async (pageNum: number = 1) => {
    try {
      setLoading(true);
      setError(null);
      const result = await couponService.getCouponAssignments(coupon.id, pageNum, limit);
      
      setAssignments(result.assignments);
      setSummary(result.summary);
      setPage(result.page);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (err: any) {
      console.error('Error loading coupon assignments:', err);
      setError(err.response?.data?.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssignments(1);
  }, [coupon.id]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (assignment: CouponAssignment) => {
    const { usedCount, availableCount } = assignment;
    if (availableCount > 0 && usedCount > 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          Partially Used
        </span>
      );
    } else if (usedCount > 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          All Used
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Available
        </span>
      );
    }
  };

  const handleRemoveClick = (assignment: CouponAssignment) => {
    setUserToRemove(assignment);
    setShowConfirmation(true);
  };

  const handleConfirmRemove = async () => {
    if (!userToRemove) return;

    try {
      setRemovingUserId(userToRemove.userId);
      setShowConfirmation(false);
      
      await couponService.revokeUserCouponsForCoupon(
        coupon.id, 
        userToRemove.userId,
        'Removed by admin from assignment management'
      );
      
      // Reload assignments to reflect changes
      await loadAssignments(page);
      
      setUserToRemove(null);
    } catch (err: any) {
      console.error('Error removing user coupons:', err);
      setError(err.response?.data?.message || 'Failed to remove user coupons');
    } finally {
      setRemovingUserId(null);
    }
  };

  const handleCancelRemove = () => {
    setShowConfirmation(false);
    setUserToRemove(null);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Coupon Assignments
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {coupon.name} ({coupon.code})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-gray-600">Loading assignments...</span>
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <div className="text-red-600 mb-2">⚠️</div>
              <p className="text-gray-600">{error}</p>
              <button
                onClick={() => loadAssignments(page)}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Try Again
              </button>
            </div>
          ) : assignments.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-gray-400 mb-2">📋</div>
              <p className="text-gray-600">No users have been assigned this coupon yet.</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{summary.totalUsers}</div>
                    <div className="text-sm text-gray-600">Total Users</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {summary.totalAssigned}
                    </div>
                    <div className="text-sm text-gray-600">Total Assigned</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-600">
                      {summary.totalUsed}
                    </div>
                    <div className="text-sm text-gray-600">Used</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-600">
                      {summary.totalAvailable}
                    </div>
                    <div className="text-sm text-gray-600">Available</div>
                  </div>
                </div>
              </div>

              {/* Assignments Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        User
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Assigned
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Used
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Available
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Latest Assignment
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {assignments.map((assignment) => (
                      <tr key={assignment.userId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {assignment.firstName} {assignment.lastName}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {assignment.email}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-blue-600">
                            {assignment.assignedCount}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-600">
                            {assignment.usedCount}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-orange-600">
                            {assignment.availableCount}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(assignment)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(assignment.latestAssignment)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {assignment.availableCount > 0 ? (
                            <button
                              onClick={() => handleRemoveClick(assignment)}
                              disabled={removingUserId === assignment.userId}
                              className="text-red-600 hover:text-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {removingUserId === assignment.userId ? 'Removing...' : 'Remove'}
                            </button>
                          ) : (
                            <span className="text-gray-400">No coupons</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer with Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Page {page} of {totalPages} ({total} users)
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => loadAssignments(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm bg-white border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => loadAssignments(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm bg-white border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && userToRemove && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Confirm Coupon Removal
            </h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to remove all available coupons from {userToRemove.firstName} {userToRemove.lastName}? 
              This action will revoke {userToRemove.availableCount} coupon{userToRemove.availableCount > 1 ? 's' : ''} and cannot be undone.
            </p>
            <div className="flex space-x-3 justify-end">
              <button
                onClick={handleCancelRemove}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemove}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Remove Coupons
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CouponAssignmentsModal;