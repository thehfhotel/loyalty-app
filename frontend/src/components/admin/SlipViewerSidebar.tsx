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
  FiList
} from 'react-icons/fi';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
// import { trpc } from '../../hooks/useTRPC';  // TODO: Enable when file upload is ready
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
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesInput, setNotesInput] = useState('');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Note: replaceSlip mutation is commented out until file upload infrastructure is ready
  // When file upload is implemented:
  // 1. Uncomment the trpc import above
  // 2. Uncomment this mutation and use onRefresh in onSuccess
  // const replaceSlipMutation = trpc.booking.admin.replaceSlip.useMutation({
  //   onSuccess: () => {
  //     toast.success(t('admin.booking.bookingManagement.messages.slipReplaced'));
  //     onRefresh();
  //   },
  //   onError: () => {
  //     toast.error(t('admin.booking.bookingManagement.errors.replaceFailed'));
  //   }
  // });
  void onRefresh; // Mark as used - will be needed for file upload feature

  const handleVerifyClick = async () => {
    if (!booking) return;
    await onVerify(booking.id);
  };

  const handleNeedsActionClick = () => {
    setShowNotesModal(true);
  };

  const handleNotesSubmit = async () => {
    if (!booking || !notesInput.trim()) return;
    await onNeedsAction(booking.id, notesInput.trim());
    setShowNotesModal(false);
    setNotesInput('');
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
      // For now, we'll use a placeholder URL - in production this would upload to a file storage service
      // and return the URL. The replaceSlip mutation expects a URL, not base64.
      // This is a simplified implementation - you would typically upload the file first,
      // then call replaceSlip with the resulting URL.
      const formData = new FormData();
      formData.append('file', file);

      // Since the API expects a URL, we'll show a message that this feature requires
      // additional backend implementation for file upload
      toast.error('File upload integration requires additional backend setup');
      setIsUploading(false);

      // When file upload is implemented, it would look like:
      // const uploadResponse = await uploadFile(formData);
      // await replaceSlipMutation.mutateAsync({
      //   bookingId: booking.id,
      //   newSlipUrl: uploadResponse.url
      // });
    } catch {
      setIsUploading(false);
    }
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
    verifiedByName: string | null;
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

  const slip = booking.slip;
  const recentAudit = booking.auditHistory?.slice(0, 3) ?? [];

  return (
    <div className="bg-white rounded-lg shadow h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('admin.booking.bookingManagement.slipViewer.title')}
        </h3>
        {slip && (
          <p className="text-sm text-gray-500 mt-1">
            {t('admin.booking.bookingManagement.slipViewer.uploaded')}: {formatDateTimeToEuropean(slip.uploadedAt)}
          </p>
        )}
      </div>

      {/* Status Section */}
      {slip && (
        <div className="p-4 border-b border-gray-200 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">
              {t('admin.booking.bookingManagement.slipViewer.slipokStatus')}
            </p>
            <SlipStatusBadge status={slip.slipokStatus} verifiedAt={slip.slipokVerifiedAt} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">
              {t('admin.booking.bookingManagement.slipViewer.adminStatus')}
            </p>
            <AdminStatusBadge
              status={slip.adminStatus}
              verifiedAt={slip.adminVerifiedAt}
              verifiedByName={slip.adminVerifiedByName}
            />
          </div>
        </div>
      )}

      {/* Image Section */}
      <div className="p-4 border-b border-gray-200 flex-1 overflow-hidden">
        {slip ? (
          <div className="relative h-full">
            <img
              src={slip.imageUrl}
              alt={t('admin.booking.bookingManagement.slipViewer.slipImage')}
              className="w-full h-full object-contain rounded-lg cursor-pointer"
              onClick={() => setIsFullscreen(true)}
            />
            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70"
              title={t('admin.booking.bookingManagement.slipViewer.fullscreen')}
            >
              <FiMaximize2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="h-48 bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-400">
            <FiImage className="w-12 h-12 mb-2" />
            <p className="text-sm">{t('admin.booking.bookingManagement.slipViewer.noSlip')}</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-b border-gray-200 space-y-2">
        <button
          onClick={handleVerifyClick}
          disabled={!slip}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiCheck className="w-4 h-4" />
          {t('admin.booking.bookingManagement.actions.verify')}
        </button>
        <button
          onClick={handleNeedsActionClick}
          disabled={!slip}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiAlertTriangle className="w-4 h-4" />
          {t('admin.booking.bookingManagement.actions.needsAction')}
        </button>
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
      {isFullscreen && slip && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={() => setIsFullscreen(false)}
        >
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 p-2 bg-white/20 rounded-full text-white hover:bg-white/30"
          >
            <FiX className="w-6 h-6" />
          </button>
          <img
            src={slip.imageUrl}
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
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleNotesSubmit}
                disabled={!notesInput.trim()}
                className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50"
              >
                {t('admin.booking.bookingManagement.modals.needsAction.submit')}
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
