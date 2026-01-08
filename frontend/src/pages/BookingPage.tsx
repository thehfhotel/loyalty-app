import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FiCalendar, FiUsers, FiCheck, FiStar, FiWifi, FiTv, FiCoffee } from 'react-icons/fi';
import MainLayout from '../components/layout/MainLayout';
import { trpc } from '../hooks/useTRPC';
import toast from 'react-hot-toast';

// Amenity icons mapping
const amenityIcons: Record<string, React.ReactNode> = {
  wifi: <FiWifi className="w-4 h-4" />,
  tv: <FiTv className="w-4 h-4" />,
  minibar: <FiCoffee className="w-4 h-4" />,
};

interface BookingStep {
  number: number;
  title: string;
  completed: boolean;
}

interface RoomTypeWithAvailability {
  id: string;
  name: string;
  description: string | null;
  pricePerNight: number;
  maxGuests: number;
  availableRooms: number;
  images: string[];
  amenities: string[];
  bedType: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  totalRooms: number;
}

export default function BookingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // Form state
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string | null>(null);
  const [numGuests, setNumGuests] = useState(1);
  const [notes, setNotes] = useState('');
  const [currentStep, setCurrentStep] = useState(1);

  // Date validation
  const today = new Date().toISOString().split('T')[0];
  const minCheckOut = checkIn ? new Date(new Date(checkIn).getTime() + 86400000).toISOString().split('T')[0] : today;

  // Calculate nights
  const nights = checkIn && checkOut
    ? Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Queries
  const { data: roomTypesWithAvailability, isLoading: isLoadingRoomTypes } = trpc.booking.checkAvailability.useQuery(
    { checkIn: new Date(checkIn), checkOut: new Date(checkOut) },
    { enabled: !!checkIn && !!checkOut && nights > 0 }
  );

  const selectedRoomType = roomTypesWithAvailability?.find((rt: RoomTypeWithAvailability) => rt.id === selectedRoomTypeId);
  const totalPrice = selectedRoomType ? selectedRoomType.pricePerNight * nights : 0;
  const pointsEarned = Math.floor(totalPrice * 10);

  // Mutations
  const createBookingMutation = trpc.booking.createBooking.useMutation({
    onSuccess: async () => {
      // Invalidate cache so MyBookingsPage shows fresh data
      await utils.booking.getMyBookings.invalidate();
      toast.success(t('booking.bookingSuccess'));
      navigate('/my-bookings');
    },
    onError: (error: { message: string }) => {
      toast.error(error.message || t('booking.bookingError'));
    },
  });

  const handleDateSubmit = () => {
    if (checkIn && checkOut && nights > 0) {
      setCurrentStep(2);
    }
  };

  const handleRoomTypeSelect = (roomTypeId: string) => {
    const roomType = roomTypesWithAvailability?.find((rt: RoomTypeWithAvailability) => rt.id === roomTypeId);
    if (roomType && roomType.availableRooms > 0) {
      setSelectedRoomTypeId(roomTypeId);
      setNumGuests(Math.min(numGuests, roomType.maxGuests));
      setCurrentStep(3);
    }
  };

  const handleBookingSubmit = () => {
    if (!selectedRoomTypeId || !checkIn || !checkOut) {
      return;
    }

    createBookingMutation.mutate({
      roomTypeId: selectedRoomTypeId,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      numGuests,
      notes: notes || undefined,
    });
  };

  const steps: BookingStep[] = [
    { number: 1, title: t('booking.selectDates'), completed: currentStep > 1 },
    { number: 2, title: t('booking.selectRoom'), completed: currentStep > 2 },
    { number: 3, title: t('booking.confirm'), completed: false },
  ];

  return (
    <MainLayout title={t('booking.title')}>
      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-center">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
                currentStep === step.number
                  ? 'bg-primary-600 text-white'
                  : step.completed
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
              }`}>
                {step.completed ? <FiCheck className="w-5 h-5" /> : step.number}
              </div>
              <span className={`ml-2 ${currentStep === step.number ? 'font-semibold' : 'text-gray-500'}`}>
                {step.title}
              </span>
              {index < steps.length - 1 && (
                <div className={`w-16 h-1 mx-4 ${step.completed ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Select Dates */}
      {currentStep === 1 && (
        <div className="bg-white rounded-lg shadow p-6 max-w-md mx-auto">
          <h2 className="text-xl font-semibold mb-6 flex items-center">
            <FiCalendar className="mr-2" />
            {t('booking.selectDates')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('booking.checkIn')}
              </label>
              <input
                type="date"
                value={checkIn}
                min={today}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  if (checkOut && e.target.value >= checkOut) {
                    setCheckOut('');
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                data-testid="check-in-date"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('booking.checkOut')}
              </label>
              <input
                type="date"
                value={checkOut}
                min={minCheckOut}
                onChange={(e) => setCheckOut(e.target.value)}
                disabled={!checkIn}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100"
                data-testid="check-out-date"
              />
            </div>

            {nights > 0 && (
              <p className="text-sm text-gray-600">
                {t('booking.nightsSelected', { count: nights })}
              </p>
            )}

            <button
              onClick={handleDateSubmit}
              disabled={!checkIn || !checkOut || nights <= 0}
              className="w-full py-2 px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              data-testid="continue-to-rooms"
            >
              {t('common.continue')}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Select Room Type */}
      {currentStep === 2 && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">
              {t('booking.availableRooms')}
            </h2>
            <button
              onClick={() => setCurrentStep(1)}
              className="text-primary-600 hover:underline"
            >
              {t('booking.changeDates')}
            </button>
          </div>

          <p className="text-gray-600 mb-4">
            {t('booking.stayDates', {
              checkIn: new Date(checkIn).toLocaleDateString(),
              checkOut: new Date(checkOut).toLocaleDateString(),
              nights
            })}
          </p>

          {isLoadingRoomTypes ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
            </div>
          ) : roomTypesWithAvailability?.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
              <p className="text-yellow-800">{t('booking.noRoomsAvailable')}</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {roomTypesWithAvailability?.map((roomType: RoomTypeWithAvailability) => (
                <div
                  key={roomType.id}
                  className={`bg-white rounded-lg shadow overflow-hidden ${
                    roomType.availableRooms === 0 ? 'opacity-50' : 'hover:shadow-lg cursor-pointer'
                  }`}
                  onClick={() => roomType.availableRooms > 0 && handleRoomTypeSelect(roomType.id)}
                  data-testid={`room-type-${roomType.id}`}
                >
                  {/* Room Image */}
                  {roomType.images && roomType.images.length > 0 ? (
                    <img
                      src={roomType.images[0]}
                      alt={roomType.name}
                      className="w-full h-48 object-cover"
                    />
                  ) : (
                    <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                      <span className="text-gray-400">{t('booking.noImage')}</span>
                    </div>
                  )}

                  <div className="p-4">
                    <h3 className="text-lg font-semibold">{roomType.name}</h3>
                    {roomType.description && (
                      <p className="text-gray-600 text-sm mt-1 line-clamp-2">{roomType.description}</p>
                    )}

                    {/* Amenities */}
                    {roomType.amenities && roomType.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {roomType.amenities.slice(0, 4).map((amenity: string) => (
                          <span
                            key={amenity}
                            className="inline-flex items-center px-2 py-1 bg-gray-100 rounded text-xs text-gray-600"
                          >
                            {amenityIcons[amenity] ?? null}
                            <span className="ml-1">{amenity}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Room Info */}
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center text-sm text-gray-500">
                        <FiUsers className="mr-1" />
                        {t('booking.maxGuests', { count: roomType.maxGuests })}
                      </div>
                      {roomType.bedType && (
                        <span className="text-sm text-gray-500 capitalize">{roomType.bedType}</span>
                      )}
                    </div>

                    {/* Price and Availability */}
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-2xl font-bold text-primary-600">
                            ฿{roomType.pricePerNight.toLocaleString()}
                          </span>
                          <span className="text-gray-500 text-sm">/{t('booking.night')}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold">
                            ฿{(roomType.pricePerNight * nights).toLocaleString()}
                          </div>
                          <div className="text-sm text-gray-500">
                            {t('booking.totalForNights', { nights })}
                          </div>
                        </div>
                      </div>

                      <div className={`mt-2 text-sm ${
                        roomType.availableRooms === 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {roomType.availableRooms === 0
                          ? t('booking.soldOut')
                          : t('booking.roomsLeft', { count: roomType.availableRooms })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Confirm Booking */}
      {currentStep === 3 && selectedRoomType && (
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">{t('booking.confirmBooking')}</h2>
            <button
              onClick={() => setCurrentStep(2)}
              className="text-primary-600 hover:underline"
            >
              {t('booking.changeRoom')}
            </button>
          </div>

          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            {/* Booking Summary */}
            <div className="border-b pb-6">
              <h3 className="font-semibold text-lg mb-4">{t('booking.bookingSummary')}</h3>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">{t('booking.roomType')}:</span>
                  <span className="ml-2 font-medium">{selectedRoomType.name}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t('booking.checkIn')}:</span>
                  <span className="ml-2 font-medium">{new Date(checkIn).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t('booking.checkOut')}:</span>
                  <span className="ml-2 font-medium">{new Date(checkOut).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t('booking.nights')}:</span>
                  <span className="ml-2 font-medium">{nights}</span>
                </div>
              </div>
            </div>

            {/* Guest Details */}
            <div className="border-b pb-6">
              <h3 className="font-semibold text-lg mb-4">{t('booking.guestDetails')}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('booking.numberOfGuests')}
                  </label>
                  <select
                    value={numGuests}
                    onChange={(e) => setNumGuests(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    data-testid="num-guests"
                  >
                    {Array.from({ length: selectedRoomType.maxGuests }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? t('booking.guest') : t('booking.guests')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('booking.specialRequests')}
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder={t('booking.specialRequestsPlaceholder')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    data-testid="special-requests"
                  />
                </div>
              </div>
            </div>

            {/* Price Details */}
            <div className="border-b pb-6">
              <h3 className="font-semibold text-lg mb-4">{t('booking.priceDetails')}</h3>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>
                    ฿{selectedRoomType.pricePerNight.toLocaleString()} x {nights} {nights === 1 ? t('booking.night') : t('booking.nights')}
                  </span>
                  <span>฿{totalPrice.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-semibold text-lg pt-2 border-t">
                  <span>{t('booking.total')}</span>
                  <span className="text-primary-600">฿{totalPrice.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Points Earned */}
            <div className="bg-yellow-50 rounded-lg p-4 flex items-center">
              <FiStar className="w-8 h-8 text-yellow-500 mr-4" />
              <div>
                <p className="font-semibold text-yellow-800">
                  {t('booking.pointsYouWillEarn', { points: pointsEarned.toLocaleString() })}
                </p>
                <p className="text-sm text-yellow-700">
                  {t('booking.pointsDescription')}
                </p>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleBookingSubmit}
              disabled={createBookingMutation.isPending}
              className="w-full py-3 px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-semibold"
              data-testid="confirm-booking"
            >
              {createBookingMutation.isPending ? (
                <span className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                  {t('booking.processing')}
                </span>
              ) : (
                t('booking.confirmAndBook')
              )}
            </button>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
