import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FiCalendar, FiUsers, FiStar, FiAlertCircle, FiPlus } from 'react-icons/fi';
import MainLayout from '../components/layout/MainLayout';
import { trpc } from '../hooks/useTRPC';
import toast from 'react-hot-toast';

type BookingStatus = 'confirmed' | 'cancelled' | 'completed';

interface Booking {
  id: string;
  roomTypeName?: string;
  status: string;
  checkInDate: string | Date;
  checkOutDate: string | Date;
  numGuests: number;
  pointsEarned: number;
  notes?: string | null;
  cancellationReason?: string | null;
  totalPrice: number | string;
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
    setShowCancelModal(true);
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

      {/* Empty State */}
      {!bookings || bookings.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <FiCalendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {t('booking.noBookings')}
          </h3>
          <p className="text-gray-500 mb-6">
            {t('booking.noBookingsDescription')}
          </p>
          <Link
            to="/booking"
            className="inline-flex items-center px-6 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            <FiPlus className="mr-2" />
            {t('booking.bookYourFirstRoom')}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking: Booking) => (
            <div
              key={booking.id}
              className="bg-white rounded-lg shadow overflow-hidden"
              data-testid={`booking-${booking.id}`}
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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                      <div className="flex items-center">
                        <FiCalendar className="mr-2 text-gray-400" />
                        <div>
                          <div className="font-medium">{t('booking.checkIn')}</div>
                          <div>{new Date(booking.checkInDate).toLocaleDateString()}</div>
                        </div>
                      </div>

                      <div className="flex items-center">
                        <FiCalendar className="mr-2 text-gray-400" />
                        <div>
                          <div className="font-medium">{t('booking.checkOut')}</div>
                          <div>{new Date(booking.checkOutDate).toLocaleDateString()}</div>
                        </div>
                      </div>

                    </div>

                    <div className="flex items-center gap-6 mt-4 text-sm">
                      <div className="flex items-center text-gray-600">
                        <FiUsers className="mr-1" />
                        {booking.numGuests} {booking.numGuests === 1 ? t('booking.guest') : t('booking.guests')}
                      </div>
                      <div className={`flex items-center ${booking.status === 'cancelled' ? 'text-gray-400' : 'text-yellow-600'}`}>
                        <FiStar className="mr-1" />
                        {booking.status === 'cancelled' ? (
                          '-'
                        ) : (
                          <>{booking.pointsEarned.toLocaleString()} {t('loyalty.points')}</>
                        )}
                      </div>
                    </div>

                    {booking.notes && (
                      <div className="mt-3 text-sm text-gray-500">
                        <span className="font-medium">{t('booking.notes')}:</span> {booking.notes}
                      </div>
                    )}

                    {booking.cancellationReason && (
                      <div className="mt-3 text-sm text-red-600 flex items-start">
                        <FiAlertCircle className="mr-1 mt-0.5 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{t('booking.cancellationReason')}:</span>{' '}
                          {booking.cancellationReason}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Price and Actions */}
                  <div className="flex flex-col items-end gap-3">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary-600">
                        ฿{Number(booking.totalPrice).toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-500">
                        {Math.ceil((new Date(booking.checkOutDate).getTime() - new Date(booking.checkInDate).getTime()) / (1000 * 60 * 60 * 24))}{' '}
                        {t('booking.nights')}
                      </div>
                    </div>

                    {canCancel(booking) && (
                      <button
                        onClick={() => handleCancelClick(booking.id)}
                        className="px-4 py-2 text-red-600 border border-red-600 rounded-md hover:bg-red-50 text-sm"
                        data-testid={`cancel-booking-${booking.id}`}
                      >
                        {t('booking.cancelBooking')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Booking Footer */}
              <div className="bg-gray-50 px-6 py-3 text-sm text-gray-500">
                {t('booking.bookedOn')}: {new Date(booking.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
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
