import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FiCalendar, FiUsers, FiStar, FiAlertCircle, FiPlus, FiChevronRight, FiX, FiUpload, FiCheckCircle, FiClock, FiDollarSign } from 'react-icons/fi';
import MainLayout from '../components/layout/MainLayout';
import { trpc } from '../hooks/useTRPC';
import toast from 'react-hot-toast';

type BookingStatus = 'confirmed' | 'cancelled' | 'completed';
type BookingTab = 'current' | 'history';
type PaymentType = 'deposit' | 'full' | null;
type SlipOkStatus = 'pending' | 'verified' | 'failed' | 'quota_exceeded' | null;
type AdminVerificationStatus = 'pending' | 'verified' | 'needs_action' | null;

interface Booking {
  id: string;
  roomTypeName: string;
  checkInDate: string | Date;
  checkOutDate: string | Date;
  numGuests: number;
  totalPrice: number | string;
  pointsEarned: number;
  status: string;
  notes?: string;
  cancellationReason?: string;
  cancelledByAdmin?: boolean;
  createdAt: string | Date;
  // Payment fields
  paymentType?: PaymentType;
  paymentAmount?: number;
  slipUrl?: string;
  slipUploadedAt?: string | Date;
  slipOkStatus?: SlipOkStatus;
  adminVerificationStatus?: AdminVerificationStatus;
  verifiedAt?: string | Date;
  verifiedBy?: string;
}

const statusColors: Record<BookingStatus | 'cancelledByAdmin', { bg: string; text: string }> = {
  confirmed: { bg: 'bg-green-100', text: 'text-green-800' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-800' },
  completed: { bg: 'bg-blue-100', text: 'text-blue-800' },
  cancelledByAdmin: { bg: 'bg-amber-100', text: 'text-amber-800' },
};

const paymentStatusColors: Record<string, { bg: string; text: string }> = {
  deposit: { bg: 'bg-orange-100', text: 'text-orange-800' },
  full: { bg: 'bg-green-100', text: 'text-green-800' },
};

const slipOkStatusColors: Record<string, { bg: string; text: string; icon: 'clock' | 'check' | 'alert' }> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: 'clock' },
  verified: { bg: 'bg-green-100', text: 'text-green-800', icon: 'check' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', icon: 'alert' },
  quota_exceeded: { bg: 'bg-orange-100', text: 'text-orange-800', icon: 'alert' },
};

const adminStatusColors: Record<string, { bg: string; text: string; icon: 'clock' | 'check' | 'alert' }> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: 'clock' },
  verified: { bg: 'bg-green-100', text: 'text-green-800', icon: 'check' },
  needs_action: { bg: 'bg-red-100', text: 'text-red-800', icon: 'alert' },
};

export default function MyBookingsPage() {
  const { t } = useTranslation();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [activeTab, setActiveTab] = useState<BookingTab>('current');

  // Slip upload modal state
  const [showSlipUploadModal, setShowSlipUploadModal] = useState(false);
  const [slipUploadBookingId, setSlipUploadBookingId] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // QR code URL - use env variable or fallback to static image
  const promptPayQRUrl = import.meta.env.VITE_PROMPTPAY_QR_IMAGE_URL ?? '/images/company-promptpay-qr.png';

  // Queries
  const { data: bookings, isLoading, refetch } = trpc.booking.getMyBookings.useQuery();

  // Mutations
  const cancelBookingMutation = trpc.booking.cancelBooking.useMutation({
    onSuccess: () => {
      toast.success(t('booking.cancelSuccess'));
      setShowCancelModal(false);
      setSelectedBookingId(null);
      setCancelReason('');
      refetch();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message || t('booking.cancelError'));
    },
  });

  const handleCancelClick = (bookingId: string) => {
    setSelectedBookingId(bookingId);
    setSelectedBooking(null); // Close details modal
    setShowCancelModal(true);
  };

  const handleCardClick = (booking: Booking) => {
    setSelectedBooking(booking);
  };

  const calculateNights = (checkIn: string | Date, checkOut: string | Date) => {
    return Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)
    );
  };

  const handleConfirmCancel = () => {
    if (!selectedBookingId) {
      return;
    }
    cancelBookingMutation.mutate({
      id: selectedBookingId,
      reason: cancelReason || undefined,
    });
  };

  const canCancel = (booking: { status: string; checkInDate: string | Date }) => {
    return booking.status === 'confirmed' && new Date(booking.checkInDate) > new Date();
  };

  // Slip upload handlers
  const handleUploadSlipClick = useCallback((bookingId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSlipUploadBookingId(bookingId);
    setSlipFile(null);
    setSlipPreview(null);
    setShowSlipUploadModal(true);
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.match(/^image\/(jpeg|jpg|png)$/)) {
      toast.error(t('payment.invalidFileType'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      toast.error(t('payment.fileTooLarge'));
      return;
    }
    setSlipFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setSlipPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, [t]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const removeSlip = useCallback(() => {
    setSlipFile(null);
    setSlipPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleSlipUpload = useCallback(async () => {
    if (!slipFile || !slipUploadBookingId) return;

    setIsUploading(true);
    try {
      // TODO: Implement actual upload when backend endpoint is ready
      // For now, simulate upload success
      await new Promise(resolve => setTimeout(resolve, 1500));
      toast.success(t('payment.slipUploaded'));
      setShowSlipUploadModal(false);
      setSlipUploadBookingId(null);
      setSlipFile(null);
      setSlipPreview(null);
      refetch();
    } catch (_error) {
      toast.error(t('payment.uploadError'));
    } finally {
      setIsUploading(false);
    }
  }, [slipFile, slipUploadBookingId, t, refetch]);

  const closeSlipUploadModal = useCallback(() => {
    setShowSlipUploadModal(false);
    setSlipUploadBookingId(null);
    setSlipFile(null);
    setSlipPreview(null);
  }, []);

  // Helper to check if slip can be uploaded
  const canUploadSlip = (booking: Booking) => {
    return booking.status === 'confirmed' && !booking.slipUrl;
  };

  // Helper to get display status (distinguishes admin-cancelled from user-cancelled)
  const getDisplayStatus = (booking: Booking): { key: BookingStatus | 'cancelledByAdmin'; translationKey: string } => {
    if (booking.status === 'cancelled' && booking.cancelledByAdmin) {
      return { key: 'cancelledByAdmin', translationKey: 'booking.status.cancelledByAdmin' };
    }
    return { key: booking.status as BookingStatus, translationKey: `booking.status.${booking.status}` };
  };

  // Get the booking for slip upload modal
  const slipUploadBooking = slipUploadBookingId
    ? (bookings?.find((b) => b.id === slipUploadBookingId) as Booking | undefined)
    : null;

  // Filter functions for tabs
  const isCurrentBooking = (booking: Booking) =>
    booking.status === 'confirmed' && new Date(booking.checkInDate) > new Date();

  const isHistoryBooking = (booking: Booking) =>
    booking.status === 'completed' ||
    booking.status === 'cancelled' ||
    (booking.status === 'confirmed' && new Date(booking.checkInDate) <= new Date());

  // Filtered bookings
  const currentBookings = bookings?.filter((b) => isCurrentBooking(b as Booking)) ?? [];
  const historyBookings = bookings?.filter((b) => isHistoryBooking(b as Booking)) ?? [];
  const displayedBookings = activeTab === 'current' ? currentBookings : historyBookings;

  if (isLoading) {
    return (
      <MainLayout title={t('booking.myBookings')}>
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title={t('booking.myBookings')}>
      {/* Header with Book Button */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">{t('booking.myBookings')}</h2>
        <Link
          to="/booking"
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          data-testid="new-booking-button"
        >
          <FiPlus className="mr-2" />
          {t('booking.bookRoom')}
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('current')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'current'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            data-testid="tab-current"
          >
            {t('booking.currentBookings')} ({currentBookings.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'history'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            data-testid="tab-history"
          >
            {t('booking.bookingHistory')} ({historyBookings.length})
          </button>
        </nav>
      </div>

      {/* Empty State */}
      {displayedBookings.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <FiCalendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {activeTab === 'current' ? t('booking.noCurrentBookings') : t('booking.noBookingHistory')}
          </h3>
          <p className="text-gray-500 mb-6">
            {activeTab === 'current'
              ? t('booking.noCurrentBookingsDescription')
              : t('booking.noBookingHistoryDescription')}
          </p>
          {activeTab === 'current' && (
            <Link
              to="/booking"
              className="inline-flex items-center px-6 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              <FiPlus className="mr-2" />
              {t('booking.bookYourFirstRoom')}
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {displayedBookings.map((booking) => (
            <div
              key={booking.id}
              className="bg-white rounded-lg shadow overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
              data-testid={`booking-card-${booking.id}`}
              onClick={() => handleCardClick(booking as Booking)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleCardClick(booking as Booking);
                }
              }}
            >
              <div className="p-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  {/* Booking Details */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      <h3 className="text-lg font-semibold">{booking.roomTypeName}</h3>
                      {(() => {
                        const displayStatus = getDisplayStatus(booking as Booking);
                        return (
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[displayStatus.key]?.bg} ${statusColors[displayStatus.key]?.text}`}>
                            {t(displayStatus.translationKey)}
                          </span>
                        );
                      })()}
                      {/* Payment Type Badge */}
                      {(booking as Booking).paymentType && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${paymentStatusColors[(booking as Booking).paymentType as string]?.bg} ${paymentStatusColors[(booking as Booking).paymentType as string]?.text}`}>
                          <FiDollarSign className="inline w-3 h-3 mr-1" />
                          {(booking as Booking).paymentType === 'deposit' ? t('payment.deposit') : t('payment.payInFull')}
                        </span>
                      )}
                      {/* SlipOK Status Badge */}
                      {(booking as Booking).slipOkStatus && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${slipOkStatusColors[(booking as Booking).slipOkStatus as string]?.bg} ${slipOkStatusColors[(booking as Booking).slipOkStatus as string]?.text}`}>
                          {slipOkStatusColors[(booking as Booking).slipOkStatus as string]?.icon === 'check' && <FiCheckCircle className="inline w-3 h-3 mr-1" />}
                          {slipOkStatusColors[(booking as Booking).slipOkStatus as string]?.icon === 'clock' && <FiClock className="inline w-3 h-3 mr-1" />}
                          {slipOkStatusColors[(booking as Booking).slipOkStatus as string]?.icon === 'alert' && <FiAlertCircle className="inline w-3 h-3 mr-1" />}
                          {t(`payment.slipok.${(booking as Booking).slipOkStatus}`)}
                        </span>
                      )}
                      {/* Admin Status Badge */}
                      {(booking as Booking).adminVerificationStatus && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${adminStatusColors[(booking as Booking).adminVerificationStatus as string]?.bg} ${adminStatusColors[(booking as Booking).adminVerificationStatus as string]?.text}`}>
                          {adminStatusColors[(booking as Booking).adminVerificationStatus as string]?.icon === 'check' && <FiCheckCircle className="inline w-3 h-3 mr-1" />}
                          {adminStatusColors[(booking as Booking).adminVerificationStatus as string]?.icon === 'clock' && <FiClock className="inline w-3 h-3 mr-1" />}
                          {adminStatusColors[(booking as Booking).adminVerificationStatus as string]?.icon === 'alert' && <FiAlertCircle className="inline w-3 h-3 mr-1" />}
                          {t(`payment.admin.${(booking as Booking).adminVerificationStatus}`)}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                      <div className="flex items-center">
                        <FiCalendar className="mr-2 text-gray-400" />
                        <div>
                          <span className="font-medium">{t('booking.checkIn')}:</span>{' '}
                          {new Date(booking.checkInDate).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="flex items-center">
                        <FiCalendar className="mr-2 text-gray-400" />
                        <div>
                          <span className="font-medium">{t('booking.checkOut')}:</span>{' '}
                          {new Date(booking.checkOutDate).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Price, Upload Button and Chevron */}
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary-600">
                        ฿{Number(booking.totalPrice).toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        {calculateNights(booking.checkInDate, booking.checkOutDate)} {t('booking.nights')}
                      </div>
                      {/* Payment amount if exists */}
                      {(booking as Booking).paymentAmount && (
                        <div className="text-sm text-green-600 font-medium">
                          {t('payment.paid')}: ฿{((booking as Booking).paymentAmount ?? 0).toLocaleString('th-TH')}
                        </div>
                      )}
                    </div>
                    {/* Upload Slip Button */}
                    {canUploadSlip(booking as Booking) && (
                      <button
                        onClick={(e) => handleUploadSlipClick(booking.id, e)}
                        className="text-sm text-gray-500 hover:text-primary-600 flex items-center"
                        data-testid={`upload-slip-${booking.id}`}
                      >
                        <FiUpload className="mr-1 w-4 h-4" />
                        {t('payment.uploadSlip')}
                      </button>
                    )}
                    <FiChevronRight className="text-gray-400 text-xl" />
                  </div>
                </div>
              </div>

              {/* Booking Footer */}
              <div className="bg-gray-50 px-6 py-3 text-sm text-gray-500 flex items-center justify-between">
                <span>{t('booking.bookedOn')}: {new Date(booking.createdAt).toLocaleDateString()}</span>
                <span className="text-primary-600">{t('booking.clickForDetails')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Booking Details Modal */}
      {selectedBooking && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedBooking(null)}
          data-testid="booking-details-modal-backdrop"
        >
          <div
            className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="booking-details-modal"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-semibold">{selectedBooking.roomTypeName}</h3>
                {(() => {
                  const displayStatus = getDisplayStatus(selectedBooking);
                  return (
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[displayStatus.key]?.bg} ${statusColors[displayStatus.key]?.text}`}>
                      {t(displayStatus.translationKey)}
                    </span>
                  );
                })()}
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                className="text-gray-400 hover:text-gray-600"
                data-testid="booking-details-close"
              >
                <FiX className="text-2xl" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Dates Section */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500 mb-1">{t('booking.checkIn')}</div>
                  <div className="font-semibold flex items-center">
                    <FiCalendar className="mr-2 text-primary-600" />
                    {new Date(selectedBooking.checkInDate).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">{t('booking.checkOut')}</div>
                  <div className="font-semibold flex items-center">
                    <FiCalendar className="mr-2 text-primary-600" />
                    {new Date(selectedBooking.checkOutDate).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Nights Count */}
              <div className="text-center py-3 bg-gray-50 rounded-lg" data-testid="booking-nights-count">
                <span className="text-lg font-semibold text-primary-600">
                  {calculateNights(selectedBooking.checkInDate, selectedBooking.checkOutDate)}
                </span>{' '}
                <span className="text-gray-600">
                  {calculateNights(selectedBooking.checkInDate, selectedBooking.checkOutDate) === 1
                    ? t('booking.night')
                    : t('booking.nights')}
                </span>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center">
                  <FiUsers className="mr-2 text-gray-400" />
                  <div>
                    <div className="text-sm text-gray-500">{t('booking.guests')}</div>
                    <div className="font-semibold">
                      {selectedBooking.numGuests} {selectedBooking.numGuests === 1 ? t('booking.guest') : t('booking.guests')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  <FiStar className="mr-2 text-yellow-500" />
                  <div>
                    <div className="text-sm text-gray-500">{t('booking.pointsEarned')}</div>
                    <div className={`font-semibold ${selectedBooking.status === 'cancelled' ? 'text-gray-400' : 'text-yellow-600'}`}>
                      {selectedBooking.status === 'cancelled' ? (
                        '-'
                      ) : (
                        <>{selectedBooking.pointsEarned.toLocaleString()} {t('loyalty.points')}</>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Total Price */}
              <div className="text-center py-4 bg-primary-50 rounded-lg">
                <div className="text-sm text-gray-500 mb-1">{t('booking.totalPrice')}</div>
                <div className="text-3xl font-bold text-primary-600">
                  ฿{Number(selectedBooking.totalPrice).toLocaleString()}
                </div>
              </div>

              {/* Payment Section */}
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- logical OR for truthy check */}
              {Boolean(selectedBooking.paymentType || selectedBooking.slipUrl || selectedBooking.slipOkStatus || selectedBooking.adminVerificationStatus) && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                  <div className="flex items-center text-blue-800 font-medium">
                    <FiDollarSign className="mr-2" />
                    {t('payment.title')}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {/* Payment Type */}
                    {selectedBooking.paymentType && (
                      <div>
                        <div className="text-gray-500">{t('payment.paymentType')}</div>
                        <div className="font-medium">
                          {selectedBooking.paymentType === 'deposit' ? t('payment.deposit') : t('payment.payInFull')}
                        </div>
                      </div>
                    )}

                    {/* Payment Amount */}
                    {selectedBooking.paymentAmount && (
                      <div>
                        <div className="text-gray-500">{t('payment.amountPaid')}</div>
                        <div className="font-medium text-green-600">
                          ฿{selectedBooking.paymentAmount.toLocaleString('th-TH')}
                        </div>
                      </div>
                    )}

                    {/* SlipOK Status */}
                    {selectedBooking.slipOkStatus && (
                      <div>
                        <div className="text-gray-500">{t('payment.slipokStatus')}</div>
                        <div className={`font-medium ${slipOkStatusColors[selectedBooking.slipOkStatus]?.text}`}>
                          {slipOkStatusColors[selectedBooking.slipOkStatus]?.icon === 'check' && <FiCheckCircle className="inline w-4 h-4 mr-1" />}
                          {slipOkStatusColors[selectedBooking.slipOkStatus]?.icon === 'clock' && <FiClock className="inline w-4 h-4 mr-1" />}
                          {slipOkStatusColors[selectedBooking.slipOkStatus]?.icon === 'alert' && <FiAlertCircle className="inline w-4 h-4 mr-1" />}
                          {t(`payment.slipok.${selectedBooking.slipOkStatus}`)}
                        </div>
                      </div>
                    )}

                    {/* Admin Verification Status */}
                    {selectedBooking.adminVerificationStatus && (
                      <div>
                        <div className="text-gray-500">{t('payment.adminStatus')}</div>
                        <div className={`font-medium ${adminStatusColors[selectedBooking.adminVerificationStatus]?.text}`}>
                          {adminStatusColors[selectedBooking.adminVerificationStatus]?.icon === 'check' && <FiCheckCircle className="inline w-4 h-4 mr-1" />}
                          {adminStatusColors[selectedBooking.adminVerificationStatus]?.icon === 'clock' && <FiClock className="inline w-4 h-4 mr-1" />}
                          {adminStatusColors[selectedBooking.adminVerificationStatus]?.icon === 'alert' && <FiAlertCircle className="inline w-4 h-4 mr-1" />}
                          {t(`payment.admin.${selectedBooking.adminVerificationStatus}`)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Slip Preview */}
                  {selectedBooking.slipUrl && (
                    <div className="mt-3">
                      <div className="text-gray-500 text-sm mb-2">{t('payment.slipPreview')}</div>
                      <div className="relative border rounded-lg overflow-hidden max-h-48">
                        <img
                          src={selectedBooking.slipUrl}
                          alt="Transfer slip"
                          className="w-full h-full object-contain bg-gray-100"
                        />
                      </div>
                      {selectedBooking.slipUploadedAt && (
                        <div className="text-xs text-gray-500 mt-1">
                          {t('payment.uploadedAt')}: {new Date(selectedBooking.slipUploadedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Verification Info */}
                  {selectedBooking.verifiedAt && (
                    <div className="text-xs text-gray-500 border-t pt-2 mt-2">
                      <div>{t('payment.verifiedAt')}: {new Date(selectedBooking.verifiedAt).toLocaleString()}</div>
                      {selectedBooking.verifiedBy && (
                        <div>{t('payment.verifiedBy')}: {selectedBooking.verifiedBy}</div>
                      )}
                    </div>
                  )}

                  {/* Upload Slip Button (if not uploaded yet) */}
                  {canUploadSlip(selectedBooking) && (
                    <button
                      onClick={() => {
                        setSelectedBooking(null);
                        handleUploadSlipClick(selectedBooking.id);
                      }}
                      className="w-full py-2 px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 flex items-center justify-center mt-2"
                    >
                      <FiUpload className="mr-2" />
                      {t('payment.uploadSlip')}
                    </button>
                  )}
                </div>
              )}

              {/* Notes */}
              {selectedBooking.notes && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm font-medium text-gray-700 mb-1">{t('booking.notes')}</div>
                  <div className="text-gray-600">{selectedBooking.notes}</div>
                </div>
              )}

              {/* Cancellation Info */}
              {selectedBooking.status === 'cancelled' && (
                <div className={`p-4 border rounded-lg ${selectedBooking.cancelledByAdmin ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-start">
                    <FiAlertCircle className={`mr-2 mt-0.5 flex-shrink-0 ${selectedBooking.cancelledByAdmin ? 'text-amber-500' : 'text-red-500'}`} />
                    <div>
                      {selectedBooking.cancelledByAdmin && (
                        <div className="text-sm font-medium text-amber-800 mb-2">
                          {t('booking.cancelledByAdmin')}
                        </div>
                      )}
                      {selectedBooking.cancellationReason && (
                        <>
                          <div className={`text-sm font-medium ${selectedBooking.cancelledByAdmin ? 'text-amber-800' : 'text-red-800'}`}>
                            {t('booking.cancellationReason')}
                          </div>
                          <div className={selectedBooking.cancelledByAdmin ? 'text-amber-600' : 'text-red-600'}>
                            {selectedBooking.cancellationReason}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Booked On */}
              <div className="text-center text-sm text-gray-500">
                {t('booking.bookedOn')}: {new Date(selectedBooking.createdAt).toLocaleDateString()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-3 p-6 border-t bg-gray-50">
              <button
                onClick={() => setSelectedBooking(null)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-100"
              >
                {t('common.close')}
              </button>
              {canCancel(selectedBooking) && (
                <button
                  onClick={() => handleCancelClick(selectedBooking.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                  data-testid="booking-details-cancel"
                >
                  {t('booking.cancelBooking')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6" data-testid="cancel-modal">
            <h3 className="text-lg font-semibold mb-4">{t('booking.cancelBookingTitle')}</h3>
            <p className="text-gray-600 mb-4">{t('booking.cancelBookingConfirm')}</p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('booking.cancelReason')} ({t('common.optional')})
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder={t('booking.cancelReasonPlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                data-testid="cancel-reason-input"
              />
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-800">
                <FiAlertCircle className="inline mr-1" />
                {t('booking.cancelWarning')}
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setSelectedBookingId(null);
                  setCancelReason('');
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                data-testid="cancel-modal-close"
              >
                {t('common.close')}
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelBookingMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-300"
                data-testid="confirm-cancel-button"
              >
                {cancelBookingMutation.isPending ? (
                  <span className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    {t('common.processing')}
                  </span>
                ) : (
                  t('booking.confirmCancel')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slip Upload Modal */}
      {showSlipUploadModal && slipUploadBooking && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={closeSlipUploadModal}
          data-testid="slip-upload-modal-backdrop"
        >
          <div
            className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="slip-upload-modal"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-xl font-semibold">{t('payment.uploadSlip')}</h3>
              <button
                onClick={closeSlipUploadModal}
                className="text-gray-400 hover:text-gray-600"
                data-testid="slip-upload-modal-close"
              >
                <FiX className="text-2xl" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Booking Summary */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">{slipUploadBooking.roomTypeName}</h4>
                <div className="text-sm text-gray-600 grid grid-cols-2 gap-2">
                  <div>{t('booking.checkIn')}: {new Date(slipUploadBooking.checkInDate).toLocaleDateString()}</div>
                  <div>{t('booking.checkOut')}: {new Date(slipUploadBooking.checkOutDate).toLocaleDateString()}</div>
                </div>
                <div className="mt-2 text-lg font-bold text-primary-600">
                  ฿{Number(slipUploadBooking.totalPrice).toLocaleString('th-TH')}
                </div>
              </div>

              {/* QR Code Display */}
              <div className="text-center">
                <h4 className="font-medium mb-3">{t('payment.scanQRCode')}</h4>
                <div className="inline-block p-4 bg-white border-2 border-gray-200 rounded-lg shadow-sm">
                  <img
                    src={promptPayQRUrl}
                    alt="PromptPay QR Code"
                    className="w-40 h-40 object-contain mx-auto"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"%3E%3Crect fill="%23f3f4f6" width="160" height="160"/%3E%3Ctext x="80" y="80" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12"%3EQR Code%3C/text%3E%3C/svg%3E';
                    }}
                  />
                </div>
                <p className="text-sm text-gray-600 mt-3">
                  {t('payment.scanInstructions')}
                </p>
              </div>

              {/* Slip Upload Section */}
              <div>
                <h4 className="font-medium mb-3">{t('payment.uploadSlipDescription')}</h4>

                {!slipPreview ? (
                  <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                      isDragging ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-primary-400'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="slip-upload-dropzone"
                  >
                    <FiUpload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 mb-2">{t('payment.dragDropSlip')}</p>
                    <p className="text-xs text-gray-400">JPG, PNG (max 10MB)</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png"
                      onChange={handleFileInputChange}
                      className="hidden"
                      data-testid="slip-upload-input"
                    />
                  </div>
                ) : (
                  <div className="relative border rounded-lg overflow-hidden">
                    <img
                      src={slipPreview}
                      alt="Transfer slip preview"
                      className="w-full max-h-48 object-contain bg-gray-100"
                    />
                    <button
                      onClick={removeSlip}
                      className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full hover:bg-red-600"
                      data-testid="slip-upload-remove"
                    >
                      <FiX className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-3 p-6 border-t bg-gray-50">
              <button
                onClick={closeSlipUploadModal}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-100"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSlipUpload}
                disabled={!slipFile || isUploading}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center"
                data-testid="slip-upload-submit"
              >
                {isUploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    {t('common.processing')}
                  </>
                ) : (
                  <>
                    <FiUpload className="mr-2" />
                    {t('payment.submitSlip')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
