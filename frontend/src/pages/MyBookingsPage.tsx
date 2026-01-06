import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FiCalendar, FiUsers, FiStar, FiAlertCircle, FiPlus, FiChevronRight, FiX } from 'react-icons/fi';
import MainLayout from '../components/layout/MainLayout';
import { trpc } from '../hooks/useTRPC';
import toast from 'react-hot-toast';

type BookingStatus = 'confirmed' | 'cancelled' | 'completed';
type BookingTab = 'current' | 'history';

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
  createdAt: string | Date;
}

const statusColors: Record<BookingStatus, { bg: string; text: string }> = {
  confirmed: { bg: 'bg-green-100', text: 'text-green-800' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-800' },
  completed: { bg: 'bg-blue-100', text: 'text-blue-800' },
};

export default function MyBookingsPage() {
  const { t } = useTranslation();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [activeTab, setActiveTab] = useState<BookingTab>('current');

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
    onError: (error) => {
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
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold">{booking.roomTypeName}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[booking.status as BookingStatus]?.bg} ${statusColors[booking.status as BookingStatus]?.text}`}>
                        {t(`booking.status.${booking.status}`)}
                      </span>
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

                  {/* Price and Chevron */}
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary-600">
                        ฿{Number(booking.totalPrice).toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        {calculateNights(booking.checkInDate, booking.checkOutDate)} {t('booking.nights')}
                      </div>
                    </div>
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
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[selectedBooking.status as BookingStatus]?.bg} ${statusColors[selectedBooking.status as BookingStatus]?.text}`}>
                  {t(`booking.status.${selectedBooking.status}`)}
                </span>
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
                    <div className="font-semibold text-yellow-600">
                      {selectedBooking.pointsEarned.toLocaleString()} {t('loyalty.points')}
                      {selectedBooking.status === 'cancelled' && (
                        <span className="text-red-500 text-xs ml-1">({t('booking.pointsDeducted')})</span>
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

              {/* Notes */}
              {selectedBooking.notes && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm font-medium text-gray-700 mb-1">{t('booking.notes')}</div>
                  <div className="text-gray-600">{selectedBooking.notes}</div>
                </div>
              )}

              {/* Cancellation Info */}
              {selectedBooking.cancellationReason && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start">
                    <FiAlertCircle className="text-red-500 mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-red-800">{t('booking.cancellationReason')}</div>
                      <div className="text-red-600">{selectedBooking.cancellationReason}</div>
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
    </MainLayout>
  );
}
