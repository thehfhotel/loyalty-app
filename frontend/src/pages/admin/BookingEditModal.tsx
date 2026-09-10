import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  FiCalendar,
  FiDollarSign,
  FiClock,
  FiUser,
  FiPercent,
  FiAlertTriangle
} from 'react-icons/fi';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Card, FormField, Input, Modal, Select, Textarea, TabNav } from '../../components/ui';
import type { TabItem } from '../../components/ui';
import { adminBookingService } from '../../services/adminBookingService';
import type { AdminBooking as Booking } from '../../services/adminBookingService';

// Booking shapes come from the admin booking service, which mirrors the
// serde DTOs in `backend-rust/src/routes/admin_bookings.rs`.

interface BookingEditModalProps {
  booking: Booking;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type TabType = 'details' | 'payment' | 'audit' | 'cancel';

/** `<input type="date">` wants `YYYY-MM-DD`. The admin routes serialise a
 *  `NaiveDate` already, but a legacy row may arrive as a full timestamp. */
const toDateInputValue = (value: string): string => value.split('T')[0] ?? value;

const BookingEditModal: React.FC<BookingEditModalProps> = ({
  booking,
  isOpen,
  onClose,
  onSave
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [isSaving, setIsSaving] = useState(false);
  const headingRef = useRef<HTMLParagraphElement>(null);

  // Form state - Details tab
  const [checkInDate, setCheckInDate] = useState(toDateInputValue(booking.checkInDate));
  const [checkOutDate, setCheckOutDate] = useState(toDateInputValue(booking.checkOutDate));
  const [numberOfGuests, setNumberOfGuests] = useState(booking.numberOfGuests);
  const [roomTypeId, setRoomTypeId] = useState(booking.roomTypeId);
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? '');

  // Form state - Payment tab
  const [totalPrice, setTotalPrice] = useState(booking.totalPrice);
  const [discountAmount, setDiscountAmount] = useState(booking.discountAmount ?? 0);
  const [discountReason, setDiscountReason] = useState(booking.discountReason ?? '');
  const [showDiscountForm, setShowDiscountForm] = useState(false);

  // Form state - Cancel tab
  const [cancelReason, setCancelReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // `GET /api/admin/bookings/room-types` — active types only, so the modal
  // cannot move a booking onto a hidden one.
  const roomTypesQuery = useQuery({
    queryKey: ['admin', 'bookings', 'roomTypes'],
    queryFn: () => adminBookingService.listRoomTypes(),
  });
  const roomTypes = roomTypesQuery.data ?? [];

  // `PUT /api/admin/bookings/:id` — the handler writes only the fields it
  // is sent, and ignores anything outside its allow-list.
  const updateBookingMutation = useMutation({
    mutationFn: (data: {
      bookingId: string;
      checkInDate: string;
      checkOutDate: string;
      numberOfGuests: number;
      roomTypeId: string;
      adminNotes?: string;
      totalPrice: number;
    }) => {
      const { bookingId, ...body } = data;
      return adminBookingService.updateBooking(bookingId, body);
    },
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
  const applyDiscountMutation = useMutation({
    mutationFn: (data: { bookingId: string; discountAmount: number; reason: string }) =>
      adminBookingService.applyDiscount(data.bookingId, {
        discountAmount: data.discountAmount,
        reason: data.reason,
      }),
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.discountApplied'));
      setShowDiscountForm(false);
      onSave();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.discountFailed'));
    }
  });

  // Cancel booking mutation
  const cancelBookingMutation = useMutation({
    mutationFn: (data: { bookingId: string; reason: string }) =>
      adminBookingService.cancelBooking(data.bookingId, { reason: data.reason }),
    onSuccess: () => {
      toast.success(t('admin.booking.cancel.success'));
      setIsCancelling(false);
      onSave();
      onClose();
    },
    onError: () => {
      toast.error(t('admin.booking.cancel.error'));
      setIsCancelling(false);
    }
  });

  useEffect(() => {
    if (isOpen) {
      // Reset form state when modal opens
      setCheckInDate(toDateInputValue(booking.checkInDate));
      setCheckOutDate(toDateInputValue(booking.checkOutDate));
      setNumberOfGuests(booking.numberOfGuests);
      setRoomTypeId(booking.roomTypeId);
      setAdminNotes(booking.adminNotes ?? '');
      setTotalPrice(booking.totalPrice);
      setDiscountAmount(booking.discountAmount ?? 0);
      setDiscountReason(booking.discountReason ?? '');
      setActiveTab('details');
      // Reset cancel form state
      setCancelReason('');
      setConfirmCancel(false);
      setIsCancelling(false);
    }
    // Keyed on the booking's *id*, not the object: the page re-renders this
    // modal with a fresher object when the detail read lands, and resetting
    // on identity would wipe whatever the admin had already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, booking.id]);

  const handleSave = async () => {
    setIsSaving(true);
    // The handler parses `NaiveDate`, so send the plain `YYYY-MM-DD` the
    // date inputs already hold — serialising a `Date` would send an instant
    // and shift the stay by a day either side of UTC.
    await updateBookingMutation.mutateAsync({
      bookingId: booking.id,
      checkInDate,
      checkOutDate,
      numberOfGuests,
      roomTypeId,
      // `notes` is the guest's own note and stays read-only in this modal;
      // what the admin types here is `adminNotes`.
      adminNotes: adminNotes || undefined,
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

  const handleCancelBooking = async () => {
    if (!cancelReason.trim() || !confirmCancel) {
      return;
    }
    setIsCancelling(true);
    await cancelBookingMutation.mutateAsync({
      bookingId: booking.id,
      reason: cancelReason.trim()
    });
  };

  // Check if booking is already cancelled
  const isBookingCancelled = booking.status === 'cancelled';

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
      payment_updated: t('admin.booking.bookingManagement.auditActions.paymentUpdated'),
      booking_cancelled: t('admin.booking.bookingManagement.auditActions.bookingCancelled')
    };
    return actionMap[action] ?? action;
  };

  // Table's onRowClick primitive gives us a single activation per tab strip;
  // the Cancel tab stays unreachable once a booking is already cancelled,
  // matching the old disabled <button> — TabNav has no per-item disabled
  // state, so the guard lives in the change handler instead.
  const handleTabChange = (value: string) => {
    if (value === 'cancel' && isBookingCancelled) {
      return;
    }
    setActiveTab(value as TabType);
  };

  const tabItems: TabItem[] = [
    {
      value: 'details',
      label: (
        <span className="flex items-center gap-2">
          <FiCalendar className="h-4 w-4" aria-hidden="true" />
          {t('admin.booking.bookingManagement.editModal.tabs.details')}
        </span>
      ),
    },
    {
      value: 'payment',
      label: (
        <span className="flex items-center gap-2">
          <FiDollarSign className="h-4 w-4" aria-hidden="true" />
          {t('admin.booking.bookingManagement.editModal.tabs.payment')}
        </span>
      ),
    },
    {
      value: 'audit',
      label: (
        <span className="flex items-center gap-2">
          <FiClock className="h-4 w-4" aria-hidden="true" />
          {t('admin.booking.bookingManagement.editModal.tabs.audit')}
        </span>
      ),
    },
    {
      value: 'cancel',
      label: (
        <span className={`flex items-center gap-2 ${isBookingCancelled ? 'opacity-40' : ''}`}>
          <FiAlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t('admin.booking.bookingManagement.editModal.tabs.cancel')}
        </span>
      ),
    },
  ];

  if (!isOpen) {return null;}

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={t('admin.booking.bookingManagement.editModal.title')}
      size="lg"
      initialFocusRef={headingRef}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {activeTab !== 'audit' && activeTab !== 'cancel' && (
            <Button type="button" onClick={handleSave} loading={isSaving}>
              {isSaving ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </div>
      }
    >
      <p ref={headingRef} tabIndex={-1} className="mb-4 text-caption text-ink-muted outline-none">
        {t('admin.booking.bookingManagement.editModal.bookingId')}: {booking.id.substring(0, 8)}...
      </p>

      <TabNav
        aria-label={t('admin.booking.bookingManagement.editModal.title')}
        items={tabItems}
        value={activeTab}
        onChange={handleTabChange}
        className="mb-6"
      />

      {/* Details Tab */}
      {activeTab === 'details' && (
        <div className="space-y-6">
          {/* User Info (Read-only) */}
          <Card surface="sunken">
            <h3 className="mb-3 flex items-center gap-2 text-caption font-semibold text-ink">
              <FiUser className="h-4 w-4" aria-hidden="true" />
              {t('admin.booking.bookingManagement.editModal.userInfo')}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-caption">
              <div>
                <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.name')}:</span>
                <span className="ml-2 text-ink">
                  {booking.user.firstName && booking.user.lastName
                    ? `${booking.user.firstName} ${booking.user.lastName}`
                    : booking.user.email}
                </span>
              </div>
              <div>
                <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.email')}:</span>
                <span className="ml-2 text-ink">{booking.user.email}</span>
              </div>
              <div>
                <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.membershipId')}:</span>
                <span className="ml-2 font-mono text-ink">
                  {booking.user.membershipId ?? '-'}
                </span>
              </div>
              <div>
                <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.phone')}:</span>
                <span className="ml-2 text-ink">{booking.user.phone ?? '-'}</span>
              </div>
            </div>
          </Card>

          {/* Editable Fields */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label={t('admin.booking.bookingManagement.editModal.checkInDate')} htmlFor="edit-check-in">
              <Input
                id="edit-check-in"
                type="date"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
              />
            </FormField>
            <FormField label={t('admin.booking.bookingManagement.editModal.checkOutDate')} htmlFor="edit-check-out">
              <Input
                id="edit-check-out"
                type="date"
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                min={checkInDate}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label={t('admin.booking.bookingManagement.editModal.numberOfGuests')} htmlFor="edit-guests">
              <Input
                id="edit-guests"
                type="number"
                value={numberOfGuests}
                onChange={(e) => setNumberOfGuests(parseInt(e.target.value) || 1)}
                min={1}
                max={10}
              />
            </FormField>
            <FormField label={t('admin.booking.bookingManagement.editModal.roomType')} htmlFor="edit-room-type">
              <Select
                id="edit-room-type"
                value={roomTypeId}
                onChange={(e) => setRoomTypeId(e.target.value)}
              >
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {/* Original Booking Notes (Read-only) */}
          {booking.notes && (
            <div className="space-y-1.5">
              <p className="text-caption font-semibold text-ink">
                {t('admin.booking.bookingManagement.editModal.originalNotes')}
              </p>
              <div className="rounded-lg bg-surface-sunken p-3 text-caption text-ink-muted">
                {booking.notes}
              </div>
            </div>
          )}

          {/* Admin Notes (Editable) */}
          <FormField label={t('admin.booking.bookingManagement.editModal.adminNotes')} htmlFor="edit-admin-notes">
            <Textarea
              id="edit-admin-notes"
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder={t('admin.booking.bookingManagement.editModal.adminNotesPlaceholder')}
              rows={3}
            />
          </FormField>
        </div>
      )}

      {/* Payment Tab */}
      {activeTab === 'payment' && (
        <div className="space-y-6">
          {/* Current Payment Info */}
          <Card surface="sunken">
            <h3 className="mb-3 text-caption font-semibold text-ink">
              {t('admin.booking.bookingManagement.editModal.currentPayment')}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-caption">
              <div>
                <span className="text-ink-muted">
                  {t('admin.booking.bookingManagement.editModal.paymentType')}:
                </span>
                <span className="ml-2 font-semibold text-ink">
                  {booking.paymentType === 'full'
                    ? t('admin.booking.bookingManagement.paymentType.full')
                    : t('admin.booking.bookingManagement.paymentType.deposit')}
                </span>
              </div>
              <div>
                <span className="text-ink-muted">
                  {t('admin.booking.bookingManagement.editModal.paymentAmount')}:
                </span>
                <span className="ml-2 font-semibold text-ink">
                  {booking.paymentAmount !== null
                    ? `${booking.paymentAmount.toLocaleString()} THB`
                    : '-'}
                </span>
              </div>
            </div>
          </Card>

          {/* Total Price (Editable) */}
          <div>
            <FormField label={t('admin.booking.bookingManagement.editModal.totalPrice')} htmlFor="edit-total-price">
              <Input
                id="edit-total-price"
                type="number"
                value={totalPrice}
                onChange={(e) => setTotalPrice(parseFloat(e.target.value) || 0)}
                min={0}
                step={0.01}
                trailingSlot={<span className="pr-3 text-caption text-ink-muted">THB</span>}
              />
            </FormField>
            <p className="mt-1 text-fine text-ink-muted">
              {t('admin.booking.bookingManagement.editModal.calculatedPayment')}:{' '}
              {calculatePaymentAmount(totalPrice).toLocaleString()} THB
            </p>
          </div>

          {/* Current Discount */}
          {booking.discountAmount && booking.discountAmount > 0 && (
            <Card className="border-success-200 bg-success-50">
              <h4 className="mb-2 flex items-center gap-2 text-caption font-semibold text-success-700">
                <FiPercent className="h-4 w-4" aria-hidden="true" />
                {t('admin.booking.bookingManagement.editModal.currentDiscount')}
              </h4>
              <p className="text-title text-success-700">
                -{booking.discountAmount.toLocaleString()} THB
              </p>
              {booking.discountReason && (
                <p className="mt-1 text-caption text-success-600">
                  {t('admin.booking.bookingManagement.editModal.reason')}: {booking.discountReason}
                </p>
              )}
            </Card>
          )}

          {/* Apply Discount Section */}
          {!showDiscountForm ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full border-dashed"
              onClick={() => setShowDiscountForm(true)}
            >
              <FiPercent className="h-4 w-4" aria-hidden="true" />
              {t('admin.booking.bookingManagement.editModal.applyDiscount')}
            </Button>
          ) : (
            <Card className="space-y-4">
              <h4 className="text-caption font-semibold text-ink">
                {t('admin.booking.bookingManagement.editModal.applyDiscount')}
              </h4>
              <FormField label={t('admin.booking.bookingManagement.editModal.discountAmount')} htmlFor="edit-discount-amount">
                <Input
                  id="edit-discount-amount"
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                  min={0}
                  max={totalPrice}
                  step={0.01}
                  trailingSlot={<span className="pr-3 text-caption text-ink-muted">THB</span>}
                />
              </FormField>
              <FormField
                label={t('admin.booking.bookingManagement.editModal.discountReason')}
                htmlFor="edit-discount-reason"
                required
              >
                <Input
                  id="edit-discount-reason"
                  type="text"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder={t('admin.booking.bookingManagement.editModal.discountReasonPlaceholder')}
                />
              </FormField>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowDiscountForm(false);
                    setDiscountAmount(booking.discountAmount ?? 0);
                    setDiscountReason(booking.discountReason ?? '');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-success-600 hover:bg-success-700"
                  onClick={handleApplyDiscount}
                  disabled={!discountReason.trim()}
                  loading={applyDiscountMutation.isPending}
                >
                  {t('admin.booking.bookingManagement.editModal.applyDiscountBtn')}
                </Button>
              </div>
            </Card>
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
                  className="rounded-r-lg border-l-4 border-brand-500 bg-surface-sunken py-3 pl-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-ink">
                        {formatAuditAction(entry.action)}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {entry.adminName}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-fine text-ink-muted">
                      <FiClock className="h-3 w-3" aria-hidden="true" />
                      {formatDateTimeToEuropean(entry.createdAt)}
                    </span>
                  </div>
                  {(entry.oldValue ?? entry.newValue) && (
                    <div className="mt-2 space-y-1 text-caption">
                      {entry.oldValue && (
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-error-50 px-2 py-0.5 text-fine text-error-700">
                            {t('admin.booking.bookingManagement.editModal.auditOld')}
                          </span>
                          <span className="text-ink-muted">{entry.oldValue}</span>
                        </div>
                      )}
                      {entry.newValue && (
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-success-50 px-2 py-0.5 text-fine text-success-700">
                            {t('admin.booking.bookingManagement.editModal.auditNew')}
                          </span>
                          <span className="text-ink-muted">{entry.newValue}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {entry.notes && (
                    <p className="mt-2 border-l-2 border-hairline-strong pl-2 text-caption italic text-ink-muted">
                      &quot;{entry.notes}&quot;
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-ink-muted">
              <FiClock className="mx-auto mb-4 h-12 w-12 opacity-50" aria-hidden="true" />
              <p>{t('admin.booking.bookingManagement.editModal.noAuditHistory')}</p>
            </div>
          )}
        </div>
      )}

      {/* Cancel Tab */}
      {activeTab === 'cancel' && (
        <div className="space-y-6">
          {isBookingCancelled ? (
            /* Already Cancelled State */
            <Card surface="sunken" className="p-6 text-center">
              <FiAlertTriangle className="mx-auto mb-4 h-12 w-12 text-ink-faint" aria-hidden="true" />
              <p className="text-caption text-ink-muted">{t('admin.booking.cancel.alreadyCancelled')}</p>
            </Card>
          ) : (
            <>
              {/* Warning Alert */}
              <Card className="border-error-200 bg-error-50">
                <div className="flex items-start gap-3">
                  <FiAlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error-600" aria-hidden="true" />
                  <div>
                    <h4 className="text-caption font-semibold text-error-700">
                      {t('admin.booking.cancel.title')}
                    </h4>
                    <p className="mt-1 text-caption text-error-600">
                      {t('admin.booking.cancel.warning')}
                    </p>
                  </div>
                </div>
              </Card>

              {/* Booking Summary */}
              <Card surface="sunken">
                <h3 className="mb-3 flex items-center gap-2 text-caption font-semibold text-ink">
                  <FiUser className="h-4 w-4" aria-hidden="true" />
                  {t('admin.booking.bookingManagement.editModal.userInfo')}
                </h3>
                <div className="grid grid-cols-2 gap-4 text-caption">
                  <div>
                    <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.name')}:</span>
                    <span className="ml-2 text-ink">
                      {booking.user.firstName && booking.user.lastName
                        ? `${booking.user.firstName} ${booking.user.lastName}`
                        : booking.user.email}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.checkInDate')}:</span>
                    <span className="ml-2 text-ink">
                      {new Date(booking.checkInDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.checkOutDate')}:</span>
                    <span className="ml-2 text-ink">
                      {new Date(booking.checkOutDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('admin.booking.bookingManagement.editModal.totalPrice')}:</span>
                    <span className="ml-2 font-semibold text-ink">
                      {booking.totalPrice.toLocaleString()} THB
                    </span>
                  </div>
                </div>
              </Card>

              {/* Cancellation Reason */}
              <FormField label={t('admin.booking.cancel.reasonLabel')} htmlFor="cancel-reason">
                <Textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={t('admin.booking.cancel.reasonPlaceholder')}
                  rows={3}
                  className="focus:border-error-600 focus:ring-error-600"
                />
              </FormField>

              {/* Confirmation Checkbox */}
              <label htmlFor="confirmCancel" className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="confirmCancel"
                  checked={confirmCancel}
                  onChange={(e) => setConfirmCancel(e.target.checked)}
                  className="h-4 w-4 rounded border-hairline-strong text-error-600 focus:ring-error-600"
                />
                <span className="text-caption text-ink">
                  {t('admin.booking.cancel.confirmCheckbox')}
                </span>
              </label>

              {/* Cancel Button */}
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                onClick={handleCancelBooking}
                disabled={!cancelReason.trim() || !confirmCancel}
                loading={isCancelling}
              >
                {isCancelling
                  ? t('admin.booking.cancel.cancelling')
                  : t('admin.booking.cancel.button')}
              </Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default BookingEditModal;
