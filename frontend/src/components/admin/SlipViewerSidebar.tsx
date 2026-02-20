import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiCheck,
  FiAlertTriangle,
  FiRefreshCw,
  FiEdit,
  FiClock,
  FiImage,
  FiUpload,
  FiX,
  FiMaximize2,
  FiList,
  FiChevronLeft,
  FiChevronRight
} from 'react-icons/fi';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

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

// Multi-slip support - individual slip from booking_slips table
interface BookingSlip {
  id: string;
  slipUrl: string;
  uploadedAt: string;
  uploadedBy?: string;
  slipokStatus: 'pending' | 'verified' | 'failed' | 'quota_exceeded';
  slipokVerifiedAt: string | null;
  adminStatus: 'pending' | 'verified' | 'needs_action';
  adminVerifiedAt: string | null;
  adminVerifiedBy: string | null;
  adminNotes?: string | null;
  isPrimary?: boolean;
}

// Legacy single slip interface (for backward compatibility)
interface LegacySlip {
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
  paymentAmount: number | null;
  discountAmount: number | null;
  discountReason: string | null;
  status: 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  adminNotes: string | null;
  // Multi-slip support
  slips?: BookingSlip[];
  // Legacy single slip (deprecated)
  slip: LegacySlip | null;
  auditHistory: BookingAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

interface SlipViewerSidebarProps {
  booking: Booking | null;
  onVerify: (bookingId: string) => Promise<void>;
  onNeedsAction: (bookingId: string, notes: string) => Promise<void>;
  onEdit: (booking: Booking) => void;
  onRefresh: () => void;
}

const SlipViewerSidebar: React.FC<SlipViewerSidebarProps> = ({
  booking,
  onVerify,
  onNeedsAction,
  onEdit,
  onRefresh
}) => {
  const { t } = useTranslation();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSlipUrl, setFullscreenSlipUrl] = useState<string | null>(null);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesInput, setNotesInput] = useState('');
  const [activeSlipId, setActiveSlipId] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [currentSlipIndex, setCurrentSlipIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // TODO: Replace with REST service when Rust admin booking endpoints are implemented
  // Multi-slip verification mutations
  const verifySlipByIdMutation = useMutation({
    mutationFn: async (_data: { slipId: string }) => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      throw new Error('Admin booking management is being migrated');
    },
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.slipVerified'));
      onRefresh();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.verifyFailed'));
    }
  });

  const markSlipNeedsActionMutation = useMutation({
    mutationFn: async (_data: { slipId: string; notes: string }) => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      throw new Error('Admin booking management is being migrated');
    },
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.needsActionMarked'));
      onRefresh();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.needsActionFailed'));
    }
  });

  // Get slips array - prefer multi-slip, fallback to legacy single slip
  const getSlips = (): BookingSlip[] => {
    if (!booking) return [];

    // Check for multi-slip array first
    if (booking.slips && booking.slips.length > 0) {
      return booking.slips;
    }

    // Fallback to legacy single slip
    if (booking.slip) {
      return [{
        id: booking.slip.id,
        slipUrl: booking.slip.imageUrl,
        uploadedAt: booking.slip.uploadedAt,
        slipokStatus: booking.slip.slipokStatus,
        slipokVerifiedAt: booking.slip.slipokVerifiedAt,
        adminStatus: booking.slip.adminStatus,
        adminVerifiedAt: booking.slip.adminVerifiedAt,
        adminVerifiedBy: booking.slip.adminVerifiedBy,
        isPrimary: true
      }];
    }

    return [];
  };

  const slips = getSlips();
  const hasMultipleSlips = slips.length > 1;
  const currentSlip = slips[currentSlipIndex];

  // Legacy verify handler (for backward compatibility)
  const handleLegacyVerifyClick = async () => {
    if (!booking) return;
    await onVerify(booking.id);
  };

  // Multi-slip verify handler
  const handleVerifySlip = async (slipId: string) => {
    await verifySlipByIdMutation.mutateAsync({ slipId });
  };

  const handleNeedsActionClick = (slipId?: string) => {
    setActiveSlipId(slipId ?? null);
    setShowNotesModal(true);
  };

  const handleNotesSubmit = async () => {
    if (!booking || !notesInput.trim()) return;

    if (activeSlipId) {
      // Multi-slip: mark specific slip
      await markSlipNeedsActionMutation.mutateAsync({
        slipId: activeSlipId,
        notes: notesInput.trim()
      });
    } else {
      // Legacy: mark booking
      await onNeedsAction(booking.id, notesInput.trim());
    }

    setShowNotesModal(false);
    setNotesInput('');
    setActiveSlipId(null);
  };

  const handleReplaceSlip = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!booking || !event.target.files || event.target.files.length === 0) return;

    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error(t('admin.booking.bookingManagement.errors.invalidFileType'));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('admin.booking.bookingManagement.errors.fileTooLarge'));
      return;
    }

    setIsUploading(true);
    try {
      toast.error('File upload integration requires additional backend setup');
      setIsUploading(false);
    } catch {
      setIsUploading(false);
    }
  };

  const openFullscreen = (slipUrl: string) => {
    setFullscreenSlipUrl(slipUrl);
    setIsFullscreen(true);
  };

  const SlipStatusBadge: React.FC<{ status: string; verifiedAt: string | null }> = ({
    status,
    verifiedAt
  }) => {
    const badges: Record<string, { className: string; text: string }> = {
      verified: { className: 'bg-green-100 text-green-800', text: t('admin.booking.bookingManagement.slipStatus.verified') },
      failed: { className: 'bg-red-100 text-red-800', text: t('admin.booking.bookingManagement.slipStatus.failed') },
      pending: { className: 'bg-yellow-100 text-yellow-800', text: t('admin.booking.bookingManagement.slipStatus.pending') },
      quota_exceeded: { className: 'bg-orange-100 text-orange-800', text: t('admin.booking.bookingManagement.slipStatus.quotaExceeded') }
    };

    const badge = badges[status] ?? badges.pending;

    return (
      <div className="flex flex-col">
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${badge?.className ?? ''}`}>
          {badge?.text ?? ''}
        </span>
        {verifiedAt && (
          <span className="text-xs text-gray-500 mt-1">
            {formatDateTimeToEuropean(verifiedAt)}
          </span>
        )}
      </div>
    );
  };

  const AdminStatusBadge: React.FC<{
    status: string;
    verifiedAt: string | null;
    verifiedByName?: string | null;
  }> = ({ status, verifiedAt, verifiedByName }) => {
    const badges: Record<string, { className: string; text: string }> = {
      verified: { className: 'bg-green-100 text-green-800', text: t('admin.booking.bookingManagement.adminStatus.verified') },
      needs_action: { className: 'bg-orange-100 text-orange-800', text: t('admin.booking.bookingManagement.adminStatus.needsAction') },
      pending: { className: 'bg-yellow-100 text-yellow-800', text: t('admin.booking.bookingManagement.adminStatus.pending') }
    };

    const badge = badges[status] ?? badges.pending;

    return (
      <div className="flex flex-col">
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${badge?.className ?? ''}`}>
          {badge?.text ?? ''}
        </span>
        {verifiedAt && (
          <span className="text-xs text-gray-500 mt-1">
            {formatDateTimeToEuropean(verifiedAt)}
          </span>
        )}
        {verifiedByName && (
          <span className="text-xs text-gray-500">
            {t('admin.booking.bookingManagement.by')}: {verifiedByName}
          </span>
        )}
      </div>
    );
  };

  const formatAuditAction = (action: string): string => {
    const actionMap: Record<string, string> = {
      admin_verified: t('admin.booking.bookingManagement.auditActions.adminVerified'),
      needs_action_marked: t('admin.booking.bookingManagement.auditActions.needsActionMarked'),
      slip_replaced: t('admin.booking.bookingManagement.auditActions.slipReplaced'),
      slip_verified: t('admin.booking.bookingManagement.auditActions.slipVerified'),
      slip_needs_action: t('admin.booking.bookingManagement.auditActions.slipNeedsAction'),
      booking_created: t('admin.booking.bookingManagement.auditActions.bookingCreated'),
      booking_updated: t('admin.booking.bookingManagement.auditActions.bookingUpdated'),
      discount_applied: t('admin.booking.bookingManagement.auditActions.discountApplied'),
      payment_updated: t('admin.booking.bookingManagement.auditActions.paymentUpdated')
    };
    return actionMap[action] ?? action;
  };

  // No booking selected state
  if (!booking) {
    return (
      <div className="bg-white rounded-lg shadow h-full">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {t('admin.booking.bookingManagement.slipViewer.title')}
          </h3>
        </div>
        <div className="p-6 flex flex-col items-center justify-center text-gray-500 h-64">
          <FiImage className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-center">{t('admin.booking.bookingManagement.slipViewer.selectBooking')}</p>
        </div>
      </div>
    );
  }

  const recentAudit = booking.auditHistory?.slice(0, 3) ?? [];

  return (
    <div className="bg-white rounded-lg shadow h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('admin.booking.bookingManagement.slipViewer.title')}
        </h3>
        {slips.length > 0 && slips[0] && (
          <p className="text-sm text-gray-500 mt-1">
            {slips.length > 1
              ? t('admin.booking.bookingManagement.slipViewer.slipCount', { count: slips.length })
              : t('admin.booking.bookingManagement.slipViewer.uploaded') + ': ' + formatDateTimeToEuropean(slips[0].uploadedAt)
            }
          </p>
        )}
      </div>

      {/* Status Section - Show current slip status */}
      {currentSlip && (
        <div className="p-4 border-b border-gray-200 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">
              {t('admin.booking.bookingManagement.slipViewer.slipokStatus')}
            </p>
            <SlipStatusBadge status={currentSlip.slipokStatus} verifiedAt={currentSlip.slipokVerifiedAt} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">
              {t('admin.booking.bookingManagement.slipViewer.adminStatus')}
            </p>
            <AdminStatusBadge
              status={currentSlip.adminStatus}
              verifiedAt={currentSlip.adminVerifiedAt}
              verifiedByName={null}
            />
          </div>
        </div>
      )}

      {/* Image Section - Gallery View for Multiple Slips */}
      <div className="p-4 border-b border-gray-200 flex-1 flex flex-col min-h-0">
        {slips.length > 0 ? (
          <>
          <div className="relative flex-1 min-h-[300px]">
            {/* Main Image */}
            <img
              src={currentSlip?.slipUrl}
              alt={t('admin.booking.bookingManagement.slipViewer.slipImage')}
              className="w-full h-full object-contain rounded-lg cursor-pointer"
              onClick={() => currentSlip && openFullscreen(currentSlip.slipUrl)}
            />

            {/* Fullscreen Button */}
            <button
              onClick={() => currentSlip && openFullscreen(currentSlip.slipUrl)}
              className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70"
              title={t('admin.booking.bookingManagement.slipViewer.fullscreen')}
            >
              <FiMaximize2 className="w-4 h-4" />
            </button>

            {/* Multi-slip Navigation */}
            {hasMultipleSlips && (
              <>
                {/* Slip Counter */}
                <div className="absolute top-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
                  {currentSlipIndex + 1} / {slips.length}
                </div>

                {/* Previous/Next Buttons */}
                <button
                  onClick={() => setCurrentSlipIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentSlipIndex === 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <FiChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setCurrentSlipIndex(prev => Math.min(slips.length - 1, prev + 1))}
                  disabled={currentSlipIndex === slips.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <FiChevronRight className="w-5 h-5" />
                </button>

                {/* Thumbnail Strip */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 bg-black/30 p-1 rounded">
                  {slips.map((slip, index) => (
                    <button
                      key={slip.id}
                      onClick={() => setCurrentSlipIndex(index)}
                      className={`w-12 h-12 rounded overflow-hidden border-2 transition-all ${
                        index === currentSlipIndex ? 'border-white' : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={slip.slipUrl}
                        alt={`Slip ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Pagination Dots - Always visible below image */}
          {hasMultipleSlips && (
            <div className="flex justify-center items-center gap-2 mt-3">
              <button
                onClick={() => setCurrentSlipIndex(prev => Math.max(0, prev - 1))}
                disabled={currentSlipIndex === 0}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <FiChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-1.5">
                {slips.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlipIndex(index)}
                    className={`transition-all duration-200 rounded-full ${
                      currentSlipIndex === index
                        ? 'w-6 h-2 bg-primary-600'
                        : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
                    }`}
                    aria-label={`Go to slip ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setCurrentSlipIndex(prev => Math.min(slips.length - 1, prev + 1))}
                disabled={currentSlipIndex === slips.length - 1}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <FiChevronRight className="w-5 h-5" />
              </button>

              <span className="text-sm text-gray-500 ml-2">
                {currentSlipIndex + 1} / {slips.length}
              </span>
            </div>
          )}
          </>
        ) : (
          <div className="h-48 bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-400">
            <FiImage className="w-12 h-12 mb-2" />
            <p className="text-sm">{t('admin.booking.bookingManagement.slipViewer.noSlip')}</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-b border-gray-200 space-y-2">
        {currentSlip ? (
          <>
            {/* Multi-slip actions - operate on current slip */}
            <button
              onClick={() => handleVerifySlip(currentSlip.id)}
              disabled={verifySlipByIdMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifySlipByIdMutation.isPending ? (
                <FiRefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <FiCheck className="w-4 h-4" />
              )}
              {hasMultipleSlips
                ? t('admin.booking.bookingManagement.actions.verifySlip', { number: currentSlipIndex + 1 })
                : t('admin.booking.bookingManagement.actions.verify')
              }
            </button>
            <button
              onClick={() => handleNeedsActionClick(currentSlip.id)}
              disabled={markSlipNeedsActionMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiAlertTriangle className="w-4 h-4" />
              {t('admin.booking.bookingManagement.actions.needsAction')}
            </button>
          </>
        ) : (
          <>
            {/* Legacy single slip actions */}
            <button
              onClick={handleLegacyVerifyClick}
              disabled={true}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiCheck className="w-4 h-4" />
              {t('admin.booking.bookingManagement.actions.verify')}
            </button>
            <button
              onClick={() => handleNeedsActionClick()}
              disabled={true}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiAlertTriangle className="w-4 h-4" />
              {t('admin.booking.bookingManagement.actions.needsAction')}
            </button>
          </>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <FiRefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <FiUpload className="w-4 h-4" />
          )}
          {t('admin.booking.bookingManagement.actions.replaceSlip')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleReplaceSlip}
          className="hidden"
        />
        <button
          onClick={() => onEdit(booking)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200"
        >
          <FiEdit className="w-4 h-4" />
          {t('admin.booking.bookingManagement.actions.edit')}
        </button>
      </div>

      {/* Audit Summary */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-900">
            {t('admin.booking.bookingManagement.slipViewer.auditSummary')}
          </h4>
          {booking.auditHistory && booking.auditHistory.length > 0 && (
            <button
              onClick={() => setShowAuditModal(true)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {t('admin.booking.bookingManagement.slipViewer.viewFullHistory')}
            </button>
          )}
        </div>
        {recentAudit.length > 0 ? (
          <div className="space-y-2">
            {recentAudit.map((entry) => (
              <div key={entry.id} className="text-xs border-l-2 border-gray-200 pl-2">
                <p className="font-medium text-gray-900">{formatAuditAction(entry.action)}</p>
                <p className="text-gray-500">
                  {entry.adminName} - {formatDateTimeToEuropean(entry.createdAt)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            {t('admin.booking.bookingManagement.slipViewer.noAuditHistory')}
          </p>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && fullscreenSlipUrl && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={() => {
            setIsFullscreen(false);
            setFullscreenSlipUrl(null);
          }}
        >
          <button
            onClick={() => {
              setIsFullscreen(false);
              setFullscreenSlipUrl(null);
            }}
            className="absolute top-4 right-4 p-2 bg-white/20 rounded-full text-white hover:bg-white/30"
          >
            <FiX className="w-6 h-6" />
          </button>
          <img
            src={fullscreenSlipUrl}
            alt={t('admin.booking.bookingManagement.slipViewer.slipImage')}
            className="max-w-full max-h-full object-contain p-4"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('admin.booking.bookingManagement.modals.needsAction.title')}
            </h3>
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder={t('admin.booking.bookingManagement.modals.needsAction.placeholder')}
              className="w-full border border-gray-300 rounded-md p-3 h-32 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  setShowNotesModal(false);
                  setNotesInput('');
                  setActiveSlipId(null);
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleNotesSubmit}
                disabled={!notesInput.trim() || markSlipNeedsActionMutation.isPending}
                className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50"
              >
                {markSlipNeedsActionMutation.isPending ? (
                  <FiRefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  t('admin.booking.bookingManagement.modals.needsAction.submit')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FiList className="w-5 h-5" />
                {t('admin.booking.bookingManagement.modals.auditHistory.title')}
              </h3>
              <button
                onClick={() => setShowAuditModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {booking.auditHistory && booking.auditHistory.length > 0 ? (
                <div className="space-y-4">
                  {booking.auditHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="border-l-4 border-blue-500 pl-4 py-2"
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
                        <div className="mt-2 text-sm">
                          {entry.oldValue && (
                            <p className="text-red-600">
                              <span className="font-medium">
                                {t('admin.booking.bookingManagement.modals.auditHistory.oldValue')}:
                              </span>{' '}
                              {entry.oldValue}
                            </p>
                          )}
                          {entry.newValue && (
                            <p className="text-green-600">
                              <span className="font-medium">
                                {t('admin.booking.bookingManagement.modals.auditHistory.newValue')}:
                              </span>{' '}
                              {entry.newValue}
                            </p>
                          )}
                        </div>
                      )}
                      {entry.notes && (
                        <p className="mt-1 text-sm text-gray-500 italic">
                          "{entry.notes}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  {t('admin.booking.bookingManagement.slipViewer.noAuditHistory')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SlipViewerSidebar;
