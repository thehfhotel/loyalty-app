import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiPlus, FiEdit, FiTrash2, FiGift, FiUsers, FiCalendar } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { 
  SurveyCouponDetails, 
  AssignCouponToSurveyRequest, 
  UpdateSurveyCouponAssignmentRequest
} from '../../types/survey';
import { Coupon } from '../../types/coupon';
import { surveyService } from '../../services/surveyService';
import { couponService } from '../../services/couponService';

interface SurveyCouponAssignmentsProps {
  surveyId: string;
  surveyTitle: string;
  surveyStatus: string;
}

interface AssignCouponModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssign: (data: AssignCouponToSurveyRequest) => void;
  surveyId: string;
  coupons: Coupon[];
  existingAssignments: SurveyCouponDetails[];
}

interface EditAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (data: UpdateSurveyCouponAssignmentRequest) => void;
  assignment: SurveyCouponDetails | null;
}

const AssignCouponModal: React.FC<AssignCouponModalProps> = ({
  isOpen,
  onClose,
  onAssign,
  surveyId,
  coupons,
  existingAssignments
}) => {
  const { t } = useTranslation();
  const [selectedCouponId, setSelectedCouponId] = useState('');
  // Note: Coupons are always awarded on survey completion
  const [maxAwards, setMaxAwards] = useState<number | undefined>();
  const [customExpiryDays, setCustomExpiryDays] = useState<number | undefined>();
  const [assignedReason, setAssignedReason] = useState('Survey completion reward');

  const assignedCouponIds = new Set(existingAssignments.map(a => a.coupon_id));
  const availableCoupons = coupons.filter(c => 
    c.status === 'active' && !assignedCouponIds.has(c.id)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCouponId) {
      toast.error(t('surveys.admin.couponAssignment.selectCoupon'));
      return;
    }

    onAssign({
      survey_id: surveyId,
      coupon_id: selectedCouponId,
      max_awards: maxAwards,
      custom_expiry_days: customExpiryDays,
      assigned_reason: assignedReason
    });

    // Reset form
    setSelectedCouponId('');
    setMaxAwards(undefined);
    setCustomExpiryDays(undefined);
    setAssignedReason('Survey completion reward');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {t('surveys.admin.couponAssignment.assignCoupon')}
          </h3>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {/* Coupon Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('coupons.coupon')} *
                </label>
                <select
                  value={selectedCouponId}
                  onChange={(e) => setSelectedCouponId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">{t('surveys.admin.couponAssignment.selectCoupon')}</option>
                  {availableCoupons.map(coupon => (
                    <option key={coupon.id} value={coupon.id}>
                      {coupon.code} - {coupon.name}
                      {coupon.type === 'percentage' && ` (${coupon.value}% off)`}
                      {coupon.type === 'fixed_amount' && ` (${coupon.currency} ${coupon.value} off)`}
                    </option>
                  ))}
                </select>
                {availableCoupons.length === 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    {t('surveys.admin.couponAssignment.noAvailableCoupons')}
                  </p>
                )}
              </div>

              {/* Award Condition - Always completion */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2 flex items-center">
                  <FiGift className="mr-2" />
                  {t('surveys.admin.couponAssignment.rewardCondition')}
                </h4>
                <p className="text-sm text-blue-700">
                  {t('surveys.admin.couponAssignment.alwaysOnCompletion')}
                </p>
              </div>

              {/* Max Awards */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('surveys.admin.couponAssignment.maxAwards')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={maxAwards || ''}
                  onChange={(e) => setMaxAwards(e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('surveys.admin.couponAssignment.unlimited')}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('surveys.admin.couponAssignment.maxAwardsHelp')}
                </p>
              </div>

              {/* Custom Expiry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('surveys.admin.couponAssignment.customExpiry')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={customExpiryDays || ''}
                  onChange={(e) => setCustomExpiryDays(e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('surveys.admin.couponAssignment.useCouponExpiry')}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('surveys.admin.couponAssignment.customExpiryHelp')}
                </p>
              </div>

              {/* Assigned Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('surveys.admin.couponAssignment.reason')}
                </label>
                <textarea
                  value={assignedReason}
                  onChange={(e) => setAssignedReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder={t('surveys.admin.couponAssignment.reasonPlaceholder')}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!selectedCouponId}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('surveys.admin.couponAssignment.assign')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const EditAssignmentModal: React.FC<EditAssignmentModalProps> = ({
  isOpen,
  onClose,
  onUpdate,
  assignment
}) => {
  const { t } = useTranslation();
  // Note: Coupons are always awarded on survey completion
  const [maxAwards, setMaxAwards] = useState<number | undefined>();
  const [customExpiryDays, setCustomExpiryDays] = useState<number | undefined>();
  const [assignedReason, setAssignedReason] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (assignment) {
      setMaxAwards(assignment.max_awards);
      setCustomExpiryDays(assignment.custom_expiry_days);
      setAssignedReason(assignment.assigned_reason);
      setIsActive(assignment.is_active);
    }
  }, [assignment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      max_awards: maxAwards,
      custom_expiry_days: customExpiryDays,
      assigned_reason: assignedReason,
      is_active: isActive
    });
  };

  if (!isOpen || !assignment) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {t('surveys.couponAssignment.editAssignment')}
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            {t('coupons.coupon')}: <strong>{assignment.coupon_code} - {assignment.coupon_name}</strong>
          </p>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {/* Active Status */}
              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    {t('common.active')}
                  </span>
                </label>
              </div>

              {/* Award Condition - Always completion */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2 flex items-center">
                  <FiGift className="mr-2" />
                  {t('surveys.admin.couponAssignment.rewardCondition')}
                </h4>
                <p className="text-sm text-blue-700">
                  {t('surveys.admin.couponAssignment.alwaysOnCompletion')}
                </p>
              </div>

              {/* Max Awards */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('surveys.admin.couponAssignment.maxAwards')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={maxAwards || ''}
                  onChange={(e) => setMaxAwards(e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('surveys.admin.couponAssignment.unlimited')}
                />
              </div>

              {/* Custom Expiry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('surveys.admin.couponAssignment.customExpiry')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={customExpiryDays || ''}
                  onChange={(e) => setCustomExpiryDays(e.target.value ? parseInt(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('surveys.admin.couponAssignment.useCouponExpiry')}
                />
              </div>

              {/* Assigned Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('surveys.admin.couponAssignment.reason')}
                </label>
                <textarea
                  value={assignedReason}
                  onChange={(e) => setAssignedReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {t('common.save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const SurveyCouponAssignments: React.FC<SurveyCouponAssignmentsProps> = ({
  surveyId,
  surveyTitle,
  surveyStatus
}) => {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<SurveyCouponDetails[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<SurveyCouponDetails | null>(null);

  useEffect(() => {
    loadData();
  }, [surveyId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [assignmentsResponse, couponsResponse] = await Promise.all([
        surveyService.getSurveyCouponAssignments(surveyId),
        couponService.listCoupons(1, 100, { status: 'active' })
      ]);
      
      setAssignments(assignmentsResponse.assignments);
      setCoupons(couponsResponse.coupons);
    } catch (error: any) {
      console.error('Error loading survey coupon assignments:', error);
      toast.error(t('surveys.admin.couponAssignment.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleAssignCoupon = async (data: AssignCouponToSurveyRequest) => {
    try {
      await surveyService.assignCouponToSurvey(data);
      toast.success(t('surveys.admin.couponAssignment.assignSuccess'));
      setShowAssignModal(false);
      loadData();
    } catch (error: any) {
      console.error('Error assigning coupon:', error);
      toast.error(error.response?.data?.message || t('surveys.admin.couponAssignment.assignError'));
    }
  };

  const handleUpdateAssignment = async (data: UpdateSurveyCouponAssignmentRequest) => {
    if (!editingAssignment) return;

    try {
      await surveyService.updateSurveyCouponAssignment(
        editingAssignment.survey_id,
        editingAssignment.coupon_id,
        data
      );
      toast.success(t('surveys.admin.couponAssignment.updateSuccess'));
      setShowEditModal(false);
      setEditingAssignment(null);
      loadData();
    } catch (error: any) {
      console.error('Error updating assignment:', error);
      toast.error(error.response?.data?.message || t('surveys.admin.couponAssignment.updateError'));
    }
  };

  const handleRemoveAssignment = async (assignment: SurveyCouponDetails) => {
    if (!confirm(t('surveys.admin.couponAssignment.confirmRemove'))) return;

    try {
      await surveyService.removeCouponFromSurvey(assignment.survey_id, assignment.coupon_id);
      toast.success(t('surveys.admin.couponAssignment.removeSuccess'));
      loadData();
    } catch (error: any) {
      console.error('Error removing assignment:', error);
      toast.error(error.response?.data?.message || t('surveys.admin.couponAssignment.removeError'));
    }
  };

  const openEditModal = (assignment: SurveyCouponDetails) => {
    setEditingAssignment(assignment);
    setShowEditModal(true);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            <div className="h-4 bg-gray-200 rounded w-4/6"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {t('surveys.admin.couponAssignment.title')}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {t('surveys.admin.couponAssignment.description')}
            </p>
          </div>
          <button
            onClick={() => setShowAssignModal(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            disabled={surveyStatus !== 'active'}
          >
            <FiPlus className="mr-2" />
            {t('surveys.admin.couponAssignment.assignCoupon')}
          </button>
        </div>
      </div>

      <div className="p-6">
        {assignments.length === 0 ? (
          <div className="text-center py-8">
            <FiGift className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">{t('surveys.admin.couponAssignment.noAssignments')}</p>
            <p className="text-sm text-gray-400 mt-2">
              {t('surveys.admin.couponAssignment.noAssignmentsHelp')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {assignments.map((assignment) => (
              <div
                key={assignment.assignment_id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h4 className="font-medium text-gray-900">
                        {assignment.coupon_code} - {assignment.coupon_name}
                      </h4>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        assignment.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {assignment.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                      <div className="flex items-center">
                        <FiGift className="mr-2 text-blue-500" />
                        <span>
                          {assignment.coupon_type === 'percentage' && `${assignment.coupon_value}% off`}
                          {assignment.coupon_type === 'fixed_amount' && `${assignment.coupon_currency} ${assignment.coupon_value} off`}
                          {assignment.coupon_type === 'free_upgrade' && t('coupons.freeUpgrade')}
                          {assignment.coupon_type === 'free_service' && t('coupons.freeService')}
                        </span>
                      </div>

                      <div className="flex items-center">
                        <FiUsers className="mr-2 text-green-500" />
                        <span>
                          {t('surveys.admin.couponAssignment.awarded')}: {assignment.awarded_count}
                          {assignment.max_awards && ` / ${assignment.max_awards}`}
                        </span>
                      </div>

                      <div className="flex items-center">
                        <FiGift className="mr-2 text-orange-500" />
                        <span>
                          {t('surveys.admin.couponAssignment.awardedOnCompletion')}
                        </span>
                      </div>
                    </div>

                    {assignment.assigned_reason && (
                      <p className="text-sm text-gray-500 mt-2">
                        {t('surveys.admin.couponAssignment.reason')}: {assignment.assigned_reason}
                      </p>
                    )}
                  </div>

                  <div className="flex space-x-2 ml-4">
                    <button
                      onClick={() => openEditModal(assignment)}
                      className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                      title={t('common.edit')}
                    >
                      <FiEdit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleRemoveAssignment(assignment)}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                      title={t('common.remove')}
                    >
                      <FiTrash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AssignCouponModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        onAssign={handleAssignCoupon}
        surveyId={surveyId}
        coupons={coupons}
        existingAssignments={assignments}
      />

      <EditAssignmentModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingAssignment(null);
        }}
        onUpdate={handleUpdateAssignment}
        assignment={editingAssignment}
      />
    </div>
  );
};

export default SurveyCouponAssignments;