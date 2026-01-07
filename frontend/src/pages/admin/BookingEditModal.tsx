import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  FiX,
  FiCalendar,
  FiDollarSign,
  FiClock,
  FiUser,
  FiPercent
} from 'react-icons/fi';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { trpc } from '../../hooks/useTRPC';

// Types matching BookingManagement
interface BookingUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  membershipId: string | null;
  phone: string | null;
}

interface RoomType {
  id: string;
  name: string;
}

interface BookingSlip {
  id: string;
  imageUrl: string;
  uploadedAt: string;
  slipokStatus: 'pending' | 'verified' | 'failed' | 'quota_exceeded';
  slipokVerifiedAt: string | null;
  adminStatus: 'pending' | 'verified' | 'needs_action';
  adminVerifiedAt: string | null;
  adminVerifiedBy: string | null;
  adminVerifiedByName: string | null;
}

interface BookingAuditEntry {
  id: string;
  action: string;
  adminId: string;
  adminName: string;
  oldValue: string | null;
  newValue: string | null;
  notes: string | null;
  createdAt: string;
}

interface Booking {
  id: string;
  userId: string;
  user: BookingUser;
  roomTypeId: string;
  roomType: RoomType;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  totalPrice: number;
  paymentType: 'full' | 'deposit';
  paymentAmount: number;
  discountAmount: number | null;
  discountReason: string | null;
  status: 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  adminNotes: string | null;
  slip: BookingSlip | null;
  auditHistory: BookingAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

interface BookingEditModalProps {
  booking: Booking;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type TabType = 'details' | 'payment' | 'audit';

const BookingEditModal: React.FC<BookingEditModalProps> = ({
  booking,
  isOpen,
  onClose,
  onSave
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [isSaving, setIsSaving] = useState(false);

  // Form state - Details tab
  const [checkInDate, setCheckInDate] = useState(booking.checkInDate.split('T')[0]);
  const [checkOutDate, setCheckOutDate] = useState(booking.checkOutDate.split('T')[0]);
  const [numberOfGuests, setNumberOfGuests] = useState(booking.numberOfGuests);
  const [roomTypeId, setRoomTypeId] = useState(booking.roomTypeId);
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? '');

  // Form state - Payment tab
  const [totalPrice, setTotalPrice] = useState(booking.totalPrice);
  const [discountAmount, setDiscountAmount] = useState(booking.discountAmount ?? 0);
  const [discountReason, setDiscountReason] = useState(booking.discountReason ?? '');
  const [showDiscountForm, setShowDiscountForm] = useState(false);

  // Fetch room types for dropdown
  const roomTypesQuery = trpc.booking.getRoomTypes.useQuery();
  const roomTypes = roomTypesQuery.data ?? [];

  // Update booking mutation
  const updateBookingMutation = trpc.booking.admin.updateBooking.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.bookingUpdated'));
      onSave();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.updateFailed'));
      setIsSaving(false);
    }
  });

  // Apply discount mutation
  const applyDiscountMutation = trpc.booking.admin.applyDiscount.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.discountApplied'));
      setShowDiscountForm(false);
      onSave();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.discountFailed'));
    }
  });

  useEffect(() => {
    if (isOpen) {
      // Reset form state when modal opens
      setCheckInDate(booking.checkInDate.split('T')[0]);
      setCheckOutDate(booking.checkOutDate.split('T')[0]);
      setNumberOfGuests(booking.numberOfGuests);
      setRoomTypeId(booking.roomTypeId);
      setAdminNotes(booking.adminNotes ?? '');
      setTotalPrice(booking.totalPrice);
      setDiscountAmount(booking.discountAmount ?? 0);
      setDiscountReason(booking.discountReason ?? '');
      setActiveTab('details');
    }
  }, [isOpen, booking]);

  const handleSave = async () => {
    setIsSaving(true);
    // Create Date objects for the API (which expects Date type via z.coerce.date())
    const checkIn = new Date(checkInDate + 'T00:00:00');
    const checkOut = new Date(checkOutDate + 'T00:00:00');

    await updateBookingMutation.mutateAsync({
      bookingId: booking.id,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      numGuests: numberOfGuests,
      roomTypeId,
      notes: adminNotes || undefined,
      totalPrice
    });
  };

  const handleApplyDiscount = async () => {
    if (!discountReason.trim()) {
      toast.error(t('admin.booking.bookingManagement.errors.discountReasonRequired'));
      return;
    }
    await applyDiscountMutation.mutateAsync({
      bookingId: booking.id,
      discountAmount,
      reason: discountReason.trim()
    });
  };

  // Calculate payment amount based on payment type
  const calculatePaymentAmount = (price: number): number => {
    if (booking.paymentType === 'full') {
      return price - discountAmount;
    }
    return Math.ceil((price - discountAmount) * 0.5); // 50% deposit
  };

  const formatAuditAction = (action: string): string => {
    const actionMap: Record<string, string> = {
      admin_verified: t('admin.booking.bookingManagement.auditActions.adminVerified'),
      needs_action_marked: t('admin.booking.bookingManagement.auditActions.needsActionMarked'),
      slip_replaced: t('admin.booking.bookingManagement.auditActions.slipReplaced'),
      booking_created: t('admin.booking.bookingManagement.auditActions.bookingCreated'),
      booking_updated: t('admin.booking.bookingManagement.auditActions.bookingUpdated'),
      discount_applied: t('admin.booking.bookingManagement.auditActions.discountApplied'),
      payment_updated: t('admin.booking.bookingManagement.auditActions.paymentUpdated')
    };
    return actionMap[action] ?? action;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {t('admin.booking.bookingManagement.editModal.title')}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {t('admin.booking.bookingManagement.editModal.bookingId')}: {booking.id.substring(0, 8)}...
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <FiX className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-6 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'details'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <FiCalendar className="w-4 h-4 inline-block mr-2" />
              {t('admin.booking.bookingManagement.editModal.tabs.details')}
            </button>
            <button
              onClick={() => setActiveTab('payment')}
              className={`px-6 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'payment'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <FiDollarSign className="w-4 h-4 inline-block mr-2" />
              {t('admin.booking.bookingManagement.editModal.tabs.payment')}
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-6 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'audit'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <FiClock className="w-4 h-4 inline-block mr-2" />
              {t('admin.booking.bookingManagement.editModal.tabs.audit')}
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Details Tab */}
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* User Info (Read-only) */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <FiUser className="w-4 h-4" />
                  {t('admin.booking.bookingManagement.editModal.userInfo')}
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">{t('admin.booking.bookingManagement.editModal.name')}:</span>
                    <span className="ml-2 text-gray-900">
                      {booking.user.firstName && booking.user.lastName
                        ? `${booking.user.firstName} ${booking.user.lastName}`
                        : booking.user.email}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('admin.booking.bookingManagement.editModal.email')}:</span>
                    <span className="ml-2 text-gray-900">{booking.user.email}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('admin.booking.bookingManagement.editModal.membershipId')}:</span>
                    <span className="ml-2 text-gray-900 font-mono">
                      {booking.user.membershipId ?? '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('admin.booking.bookingManagement.editModal.phone')}:</span>
                    <span className="ml-2 text-gray-900">{booking.user.phone ?? '-'}</span>
                  </div>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.bookingManagement.editModal.checkInDate')}
                  </label>
                  <input
                    type="date"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.bookingManagement.editModal.checkOutDate')}
                  </label>
                  <input
                    type="date"
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    min={checkInDate}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.bookingManagement.editModal.numberOfGuests')}
                  </label>
                  <input
                    type="number"
                    value={numberOfGuests}
                    onChange={(e) => setNumberOfGuests(parseInt(e.target.value) || 1)}
                    min={1}
                    max={10}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.bookingManagement.editModal.roomType')}
                  </label>
                  <select
                    value={roomTypeId}
                    onChange={(e) => setRoomTypeId(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {roomTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Original Booking Notes (Read-only) */}
              {booking.notes && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.bookingManagement.editModal.originalNotes')}
                  </label>
                  <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-600">
                    {booking.notes}
                  </div>
                </div>
              )}

              {/* Admin Notes (Editable) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('admin.booking.bookingManagement.editModal.adminNotes')}
                </label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder={t('admin.booking.bookingManagement.editModal.adminNotesPlaceholder')}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* Payment Tab */}
          {activeTab === 'payment' && (
            <div className="space-y-6">
              {/* Current Payment Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  {t('admin.booking.bookingManagement.editModal.currentPayment')}
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">
                      {t('admin.booking.bookingManagement.editModal.paymentType')}:
                    </span>
                    <span className="ml-2 text-gray-900 font-medium">
                      {booking.paymentType === 'full'
                        ? t('admin.booking.bookingManagement.paymentType.full')
                        : t('admin.booking.bookingManagement.paymentType.deposit')}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">
                      {t('admin.booking.bookingManagement.editModal.paymentAmount')}:
                    </span>
                    <span className="ml-2 text-gray-900 font-medium">
                      {booking.paymentAmount.toLocaleString()} THB
                    </span>
                  </div>
                </div>
              </div>

              {/* Total Price (Editable) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('admin.booking.bookingManagement.editModal.totalPrice')}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={totalPrice}
                    onChange={(e) => setTotalPrice(parseFloat(e.target.value) || 0)}
                    min={0}
                    step={0.01}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 pr-12 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                    THB
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {t('admin.booking.bookingManagement.editModal.calculatedPayment')}:{' '}
                  {calculatePaymentAmount(totalPrice).toLocaleString()} THB
                </p>
              </div>

              {/* Current Discount */}
              {booking.discountAmount && booking.discountAmount > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-green-800 mb-2 flex items-center gap-2">
                    <FiPercent className="w-4 h-4" />
                    {t('admin.booking.bookingManagement.editModal.currentDiscount')}
                  </h4>
                  <p className="text-lg font-semibold text-green-700">
                    -{booking.discountAmount.toLocaleString()} THB
                  </p>
                  {booking.discountReason && (
                    <p className="text-sm text-green-600 mt-1">
                      {t('admin.booking.bookingManagement.editModal.reason')}: {booking.discountReason}
                    </p>
                  )}
                </div>
              )}

              {/* Apply Discount Section */}
              {!showDiscountForm ? (
                <button
                  onClick={() => setShowDiscountForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-md text-gray-600 hover:border-blue-500 hover:text-blue-600"
                >
                  <FiPercent className="w-4 h-4" />
                  {t('admin.booking.bookingManagement.editModal.applyDiscount')}
                </button>
              ) : (
                <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                  <h4 className="text-sm font-medium text-gray-700">
                    {t('admin.booking.bookingManagement.editModal.applyDiscount')}
                  </h4>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      {t('admin.booking.bookingManagement.editModal.discountAmount')}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                        min={0}
                        max={totalPrice}
                        step={0.01}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 pr-12 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                        THB
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      {t('admin.booking.bookingManagement.editModal.discountReason')} *
                    </label>
                    <input
                      type="text"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      placeholder={t('admin.booking.bookingManagement.editModal.discountReasonPlaceholder')}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowDiscountForm(false);
                        setDiscountAmount(booking.discountAmount ?? 0);
                        setDiscountReason(booking.discountReason ?? '');
                      }}
                      className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleApplyDiscount}
                      disabled={applyDiscountMutation.isPending || !discountReason.trim()}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                    >
                      {applyDiscountMutation.isPending
                        ? t('common.processing')
                        : t('admin.booking.bookingManagement.editModal.applyDiscountBtn')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Audit History Tab */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              {booking.auditHistory && booking.auditHistory.length > 0 ? (
                <div className="space-y-4">
                  {booking.auditHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="border-l-4 border-blue-500 pl-4 py-3 bg-gray-50 rounded-r-lg"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            {formatAuditAction(entry.action)}
                          </p>
                          <p className="text-sm text-gray-600">
                            {entry.adminName}
                          </p>
                        </div>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <FiClock className="w-3 h-3" />
                          {formatDateTimeToEuropean(entry.createdAt)}
                        </span>
                      </div>
                      {(entry.oldValue ?? entry.newValue) && (
                        <div className="mt-2 text-sm space-y-1">
                          {entry.oldValue && (
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                                {t('admin.booking.bookingManagement.editModal.auditOld')}
                              </span>
                              <span className="text-gray-600">{entry.oldValue}</span>
                            </div>
                          )}
                          {entry.newValue && (
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                {t('admin.booking.bookingManagement.editModal.auditNew')}
                              </span>
                              <span className="text-gray-600">{entry.newValue}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {entry.notes && (
                        <p className="mt-2 text-sm text-gray-500 italic border-l-2 border-gray-300 pl-2">
                          "{entry.notes}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FiClock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{t('admin.booking.bookingManagement.editModal.noAuditHistory')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            {t('common.cancel')}
          </button>
          {activeTab !== 'audit' && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? t('common.saving') : t('common.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingEditModal;
