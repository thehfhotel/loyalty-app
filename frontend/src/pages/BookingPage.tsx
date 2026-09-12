import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { FiCalendar, FiUsers, FiCheck, FiUpload, FiX, FiCheckCircle, FiClock, FiAlertCircle, FiMapPin } from 'react-icons/fi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import clsx from 'clsx';
import AppShell from '../components/layout/AppShell';
import { Button, Card, Badge, Input, Select, FormField } from '../components/ui';
import { bookingService } from '../services/bookingService';
import {
  channelBookingService,
  type Property,
  type PaymentOption,
  type ChannelBookingResponse,
} from '../services/channelBookingService';
import { useAuthStore } from '../store/authStore';
import { logger } from '../utils/logger';
import { isPmsOutage } from '../utils/pmsOutage';
import { pmsReasonOf, reasonWantsPanel, type PmsReason } from '../utils/pmsReason';
import BookingErrorNotice from '../components/booking/BookingErrorNotice';
import DeskContactFooter from '../components/booking/DeskContactFooter';
import toast from 'react-hot-toast';

// The booking flow is a CHANNEL into the PMS (ADR-0003): availability is
// queried live and a confirmed booking is created in the PMS. Payment is a
// PromptPay transfer into the booked property's own receiving account —
// the QR payload arrives with the booking response; nothing is hardcoded
// here.

const PROPERTIES: Property[] = ['hf', 'hfville'];

interface BookingStep {
  number: number;
  title: string;
  completed: boolean;
}

type SlipStatus = 'pending' | 'uploaded' | 'verified' | 'failed';

// Fixed action bar pinned above the guest tab bar's space (hidden via
// AppShell's `hideTabBar` on this flow) so the primary action always sits in
// the LIFF webview's thumb zone.
const STICKY_CTA_CLASSES =
  'fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-hairline bg-surface-card/85 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md';

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function BookingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  // Form state
  const [property, setProperty] = useState<Property | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [numGuests, setNumGuests] = useState(1);
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState(
    [user?.firstName, user?.lastName].filter(Boolean).join(' '),
  );
  const [guestPhone, setGuestPhone] = useState(user?.phone ?? '');
  const [paymentOption, setPaymentOption] = useState<PaymentOption>('deposit50');
  const [currentStep, setCurrentStep] = useState(1);
  // The last create attempt did not produce a hold (A17, widened by A19).
  //
  // Sticky, not a toast: a guest who has to phone reception needs the number
  // to still be on screen while they find their phone, and a guest whose
  // dates are sold out needs the button back to step 1 to stay put.
  //
  // `null` means the last attempt did not fail. A *failure with no reason*
  // is `{ reason: null }`, which is why this is an object and not just the
  // reason — the two are different states and collapsing them would lose
  // the outage case the PMS could not put a name to.
  const [bookingFailure, setBookingFailure] = useState<{ reason: PmsReason | null } | null>(null);

  // Payment state
  const [createdBooking, setCreatedBooking] = useState<ChannelBookingResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [holdMsLeft, setHoldMsLeft] = useState<number | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [slipStatus, setSlipStatus] = useState<SlipStatus>('pending');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Date validation
  const today = new Date().toISOString().split('T')[0];
  const minCheckOut = checkIn ? new Date(new Date(checkIn).getTime() + 86400000).toISOString().split('T')[0] : today;

  const nights = checkIn && checkOut
    ? Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Live availability from the PMS via the channel endpoint
  const { data: availability, isLoading: isLoadingRoomTypes } = useQuery({
    queryKey: ['bookings', 'channel-availability', property, checkIn, checkOut, numGuests],
    queryFn: () => {
      if (!property) {
        throw new Error('property is required when availability query is enabled');
      }
      return channelBookingService.getAvailability(property, checkIn, checkOut, numGuests);
    },
    enabled: !!property && !!checkIn && !!checkOut && nights > 0,
  });

  const roomTypes = availability?.room_types;
  const selectedRoomType = roomTypes?.find(rt => rt.room_type_id === selectedRoomTypeId);
  const totalPrice = selectedRoomType ? selectedRoomType.nightly_price * nights : 0;
  const depositAmount = Math.round(totalPrice * 0.5);
  const amountDueNow = paymentOption === 'deposit50' ? depositAmount : totalPrice;

  const createBookingMutation = useMutation({
    mutationFn: () => {
      if (!property || !selectedRoomTypeId) {
        throw new Error('property and room type are required');
      }
      return channelBookingService.createBooking({
        property,
        room_type_id: selectedRoomTypeId,
        check_in: checkIn,
        check_out: checkOut,
        guests: numGuests,
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim(),
        payment_option: paymentOption,
      });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(t('booking.bookingSuccess'));
      setBookingFailure(null);
      setCreatedBooking(data);
      setCurrentStep(4);
    },
    onError: (error: Error) => {
      // Two things get the sticky panel rather than a toast carrying the
      // backend's words:
      //
      // * **the PMS named a reason** (A19) — `sold_out` needs a button, not
      //   a toast that scrolls away, and `last_room_held_for_desk` needs a
      //   number the guest can still tap thirty seconds later;
      // * **the PMS could not answer at all** (A17) — same argument, no
      //   reason to name.
      //
      // Everything else — a validation error, a duplicate in flight — is
      // still a toast: the guest's next step is on the form in front of
      // them.
      const reason = pmsReasonOf(error);
      if (reasonWantsPanel(reason) || isPmsOutage(error)) {
        setBookingFailure({ reason });
        return;
      }
      setBookingFailure(null);
      toast.error(error.message || t('booking.bookingError'));
    },
  });

  // Render the per-property PromptPay QR from the payload in the booking
  // response (same QRCode.toDataURL pattern as the coupon QR modal).
  useEffect(() => {
    if (!createdBooking?.promptpay_qr_payload) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(createdBooking.promptpay_qr_payload, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch((error: unknown) => {
        logger.error(
          'Failed to render PromptPay QR:',
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [createdBooking]);

  // Hold-expiry countdown. The PMS releases the room if the deposit is not
  // verified before hold_expires_at; keep the guest aware of the clock.
  useEffect(() => {
    if (!createdBooking?.hold_expires_at) {
      setHoldMsLeft(null);
      return;
    }
    const expiresAt = new Date(createdBooking.hold_expires_at).getTime();
    const tick = () => setHoldMsLeft(expiresAt - Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [createdBooking]);

  const holdExpired = holdMsLeft !== null && holdMsLeft <= 0 && slipStatus === 'pending' && !slipPreview;

  // File handling functions
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
    if (!slipFile || !createdBooking) {return;}

    setIsUploading(true);
    try {
      // Two-step flow (mirrors MyBookingsPage):
      //   1. POST /api/slips/upload      -> stores the file, returns the URL
      //   2. POST /api/bookings/:id/slips -> attaches the URL to the booking
      const { url } = await bookingService.uploadSlip(slipFile);
      await bookingService.addSlip(createdBooking.booking_id, url);

      setSlipStatus('uploaded');
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(t('payment.slipUploaded'));
    } catch (_error) {
      setSlipStatus('failed');
      toast.error(t('payment.uploadError'));
    } finally {
      setIsUploading(false);
    }
  }, [slipFile, createdBooking, t, queryClient]);

  const handleSkipPayment = useCallback(() => {
    navigate('/my-bookings');
  }, [navigate]);

  const handleDateSubmit = () => {
    if (property && checkIn && checkOut && nights > 0) {
      setCurrentStep(2);
    }
  };

  const handleRoomTypeSelect = (roomTypeId: string) => {
    const roomType = roomTypes?.find(rt => rt.room_type_id === roomTypeId);
    if (roomType && roomType.available_count > 0) {
      setSelectedRoomTypeId(roomTypeId);
      setCurrentStep(3);
    }
  };

  const handleBookingSubmit = () => {
    if (!selectedRoomTypeId || !checkIn || !checkOut || !property) {
      return;
    }
    if (!guestName.trim() || !guestPhone.trim()) {
      toast.error(t('booking.guestDetailsRequired'));
      return;
    }
    createBookingMutation.mutate();
  };

  const restartBooking = () => {
    setCreatedBooking(null);
    setSelectedRoomTypeId(null);
    setSlipFile(null);
    setSlipPreview(null);
    setSlipStatus('pending');
    setCurrentStep(1);
  };

  const steps: BookingStep[] = [
    { number: 1, title: t('booking.selectDates'), completed: currentStep > 1 },
    { number: 2, title: t('booking.selectRoom'), completed: currentStep > 2 },
    { number: 3, title: t('booking.confirm'), completed: currentStep > 3 },
    { number: 4, title: t('payment.title'), completed: slipStatus === 'uploaded' || slipStatus === 'verified' },
  ];

  return (
    <AppShell variant="guest" title={t('booking.title')} hideTabBar>
      {/* Progress Steps — compact numbered pills connected by hairlines */}
      <ol className="mb-8 flex items-center justify-center" aria-label={t('booking.title')}>
        {steps.map((step, index) => {
          const isCurrent = currentStep === step.number;
          const isDone = !isCurrent && step.completed;
          return (
            <li key={step.number} className="flex items-center">
              <span
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={step.title}
                className={clsx(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                  isCurrent && 'bg-brand-600 text-white',
                  isDone && 'bg-brand-50 text-brand-700',
                  !isCurrent && !isDone && 'bg-surface-sunken text-ink-muted',
                )}
              >
                {isDone ? <FiCheck className="h-4 w-4" aria-hidden="true" /> : step.number}
              </span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={clsx('mx-2 h-px w-8', isDone ? 'bg-brand-600' : 'bg-hairline')}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step 1: Property, dates, guests */}
      {currentStep === 1 && (
        <div className="pb-28">
          <Card className="mx-auto max-w-md">
            <h2 className="mb-6 flex items-center gap-2 text-title text-ink">
              <FiCalendar className="h-5 w-5" aria-hidden="true" />
              {t('booking.selectDates')}
            </h2>

            <div className="space-y-4">
              <div>
                <span className="mb-2 block text-caption font-semibold text-ink">
                  {t('booking.selectProperty')}
                </span>
                <div className="grid grid-cols-1 gap-3">
                  {PROPERTIES.map((p) => (
                    <label
                      key={p}
                      className={clsx('flex min-h-11 cursor-pointer items-center gap-3 rounded-card border p-4 transition-colors',
                        property === p ? 'border-brand-600 ring-1 ring-brand-600 bg-brand-50' : 'border-hairline hover:border-hairline-strong'
                      )}
                    >
                      <input
                        type="radio"
                        name="property"
                        value={p}
                        checked={property === p}
                        onChange={() => setProperty(p)}
                        className="sr-only"
                        data-testid={`property-${p}`}
                      />
                      <FiMapPin className="h-5 w-5 flex-shrink-0 text-brand-600" aria-hidden="true" />
                      <span className="text-body font-semibold text-ink">{t(`property.${p}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <FormField label={t('booking.checkIn')} htmlFor="check-in-date">
                <Input
                  type="date"
                  value={checkIn}
                  min={today}
                  onChange={(e) => {
                    setCheckIn(e.target.value);
                    if (checkOut && e.target.value >= checkOut) {
                      setCheckOut('');
                    }
                  }}
                  data-testid="check-in-date"
                />
              </FormField>

              <FormField label={t('booking.checkOut')} htmlFor="check-out-date">
                <Input
                  type="date"
                  value={checkOut}
                  min={minCheckOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  disabled={!checkIn}
                  data-testid="check-out-date"
                />
              </FormField>

              <FormField label={t('booking.numberOfGuests')} htmlFor="num-guests">
                <Select
                  value={numGuests}
                  onChange={(e) => setNumGuests(parseInt(e.target.value))}
                  data-testid="num-guests"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? t('booking.guest') : t('booking.guests')}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </Card>

          <div className={STICKY_CTA_CLASSES}>
            <span className="text-body font-semibold text-ink">
              {nights > 0 ? t('booking.nightsSelected', { count: nights }) : null}
            </span>
            <Button
              onClick={handleDateSubmit}
              disabled={!property || !checkIn || !checkOut || nights <= 0}
              data-testid="continue-to-rooms"
            >
              {t('common.continue')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Select Room Type */}
      {currentStep === 2 && (
        <div>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-title text-ink">
              {t('booking.availableRooms')}
            </h2>
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="text-caption font-semibold text-brand-700 hover:underline"
            >
              {t('booking.changeDates')}
            </button>
          </div>

          <p className="mb-4 text-caption text-ink-muted">
            {property && <span className="font-semibold text-ink">{t(`property.${property}`)} · </span>}
            {t('booking.stayDates', {
              checkIn: new Date(checkIn).toLocaleDateString(),
              checkOut: new Date(checkOut).toLocaleDateString(),
              nights
            })}
          </p>

          {isLoadingRoomTypes ? (
            <div className="flex justify-center py-12">
              <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-brand-600" />
            </div>
          ) : roomTypes?.length === 0 ? (
            <Card surface="sunken" className="text-center">
              <p className="text-warning-700">{t('booking.noRoomsAvailable')}</p>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {roomTypes?.map((roomType) => {
                const isSoldOut = roomType.available_count === 0;
                const isSelected = selectedRoomTypeId === roomType.room_type_id;
                return (
                  <label
                    key={roomType.room_type_id}
                    className={clsx(
                      'flex flex-col overflow-hidden rounded-card border bg-surface-card transition-colors',
                      isSoldOut
                        ? 'cursor-not-allowed border-hairline opacity-50'
                        : clsx(
                            'cursor-pointer',
                            isSelected ? 'border-brand-600 ring-1 ring-brand-600 bg-brand-50' : 'border-hairline hover:border-hairline-strong'
                          )
                    )}
                  >
                    <input
                      type="radio"
                      name="roomType"
                      value={roomType.room_type_id}
                      checked={isSelected}
                      disabled={isSoldOut}
                      onChange={() => handleRoomTypeSelect(roomType.room_type_id)}
                      className="sr-only"
                      data-testid={`room-type-${roomType.room_type_id}`}
                    />

                    {/* Room Image */}
                    {roomType.photo_url ? (
                      <img
                        src={roomType.photo_url}
                        alt={roomType.name}
                        className="h-48 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-48 w-full items-center justify-center bg-surface-sunken">
                        <span className="text-caption text-ink-faint">{t('booking.noImage')}</span>
                      </div>
                    )}

                    <div className="p-4">
                      <h3 className="text-title text-ink">{roomType.name}</h3>
                      {roomType.description && (
                        <p className="mt-1 line-clamp-2 text-caption text-ink-muted">{roomType.description}</p>
                      )}

                      {/* Price and Availability */}
                      <div className="mt-4 border-t border-hairline pt-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-title text-ink">
                              ฿{roomType.nightly_price.toLocaleString()}
                            </span>
                            <span className="text-caption text-ink-muted">/{t('booking.night')}</span>
                          </div>
                          <div className="text-right">
                            <div className="text-body font-semibold text-ink">
                              ฿{(roomType.nightly_price * nights).toLocaleString()}
                            </div>
                            <div className="text-fine text-ink-muted">
                              {t('booking.totalForNights', { nights })}
                            </div>
                          </div>
                        </div>

                        <Badge tone={isSoldOut ? 'error' : 'success'} size="sm" className="mt-2">
                          {isSoldOut
                            ? t('booking.soldOut')
                            : t('booking.roomsLeft', { count: roomType.available_count })}
                        </Badge>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Confirm Booking */}
      {currentStep === 3 && selectedRoomType && (
        <div className="pb-28">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-title text-ink">{t('booking.confirmBooking')}</h2>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="text-caption font-semibold text-brand-700 hover:underline"
              >
                {t('booking.changeRoom')}
              </button>
            </div>

            <Card className="space-y-6">
              {/* Booking Summary */}
              <div className="border-b border-hairline pb-6">
                <h3 className="mb-4 text-title text-ink">{t('booking.bookingSummary')}</h3>

                <div className="grid grid-cols-2 gap-4 text-caption">
                  <div>
                    <span className="text-ink-muted">{t('booking.property')}:</span>
                    <span className="ml-2 font-semibold text-ink">{property ? t(`property.${property}`) : ''}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('booking.roomType')}:</span>
                    <span className="ml-2 font-semibold text-ink">{selectedRoomType.name}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('booking.checkIn')}:</span>
                    <span className="ml-2 font-semibold text-ink">{new Date(checkIn).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('booking.checkOut')}:</span>
                    <span className="ml-2 font-semibold text-ink">{new Date(checkOut).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('booking.nights')}:</span>
                    <span className="ml-2 font-semibold text-ink">{nights}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">{t('booking.numberOfGuests')}:</span>
                    <span className="ml-2 font-semibold text-ink">{numGuests}</span>
                  </div>
                </div>
              </div>

              {/* Guest Details */}
              <div className="space-y-4 border-b border-hairline pb-6">
                <h3 className="flex items-center gap-2 text-title text-ink">
                  <FiUsers className="h-5 w-5" aria-hidden="true" />
                  {t('booking.guestDetails')}
                </h3>

                <FormField label={t('booking.guestName')} htmlFor="guest-name">
                  <Input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    data-testid="guest-name"
                  />
                </FormField>

                <FormField label={t('booking.guestPhone')} htmlFor="guest-phone">
                  <Input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder={t('booking.guestPhonePlaceholder')}
                    data-testid="guest-phone"
                  />
                </FormField>
              </div>

              {/* Payment option (50% deposit or full) */}
              <div className="border-b border-hairline pb-6">
                <h3 className="mb-4 text-title text-ink">{t('payment.selectPaymentType')}</h3>

                <div className="space-y-3">
                  <label
                    className={clsx('flex min-h-11 cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors',
                      paymentOption === 'deposit50' ? 'border-brand-600 ring-1 ring-brand-600 bg-brand-50' : 'border-hairline hover:border-hairline-strong'
                    )}
                  >
                    <input
                      type="radio"
                      name="paymentOption"
                      value="deposit50"
                      checked={paymentOption === 'deposit50'}
                      onChange={() => setPaymentOption('deposit50')}
                      className="sr-only"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-body font-semibold text-ink">{t('payment.deposit')}</span>
                        <span className="text-title text-brand-600">
                          ฿{depositAmount.toLocaleString('th-TH')}
                        </span>
                      </div>
                      <p className="mt-1 text-caption text-ink-muted">{t('payment.depositDescription')}</p>
                    </div>
                  </label>

                  <label
                    className={clsx('flex min-h-11 cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors',
                      paymentOption === 'full' ? 'border-brand-600 ring-1 ring-brand-600 bg-brand-50' : 'border-hairline hover:border-hairline-strong'
                    )}
                  >
                    <input
                      type="radio"
                      name="paymentOption"
                      value="full"
                      checked={paymentOption === 'full'}
                      onChange={() => setPaymentOption('full')}
                      className="sr-only"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-body font-semibold text-ink">{t('payment.payInFull')}</span>
                        <span className="text-title text-brand-600">
                          ฿{totalPrice.toLocaleString('th-TH')}
                        </span>
                      </div>
                      <p className="mt-1 text-caption text-ink-muted">{t('payment.payInFullDescription')}</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Price Details */}
              <div>
                <h3 className="mb-4 text-title text-ink">{t('booking.priceDetails')}</h3>

                <div className="space-y-2 text-caption">
                  <div className="flex justify-between text-ink-muted">
                    <span>
                      ฿{selectedRoomType.nightly_price.toLocaleString()} x {nights} {nights === 1 ? t('booking.night') : t('booking.nights')}
                    </span>
                    <span>฿{totalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t border-hairline pt-2 text-body font-semibold text-ink">
                    <span>{t('booking.total')}</span>
                    <span className="text-brand-600">฿{totalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>{t('payment.amountToPay')}</span>
                    <span>฿{amountDueNow.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {bookingFailure && (
            <BookingErrorNotice
              property={property}
              reason={bookingFailure.reason}
              onPickOtherDates={() => {
                // Back to step 1 with the room choice dropped: the dates are
                // what the guest has to change, and keeping a selection made
                // against the old ones is how you get them to press "book"
                // on the same sold-out room again.
                setBookingFailure(null);
                setSelectedRoomTypeId(null);
                setCurrentStep(1);
              }}
            />
          )}

          <div className={STICKY_CTA_CLASSES}>
            <span className="text-body font-semibold text-ink">฿{totalPrice.toLocaleString()}</span>
            <Button
              onClick={handleBookingSubmit}
              loading={createBookingMutation.isPending}
              disabled={!guestName.trim() || !guestPhone.trim()}
              data-testid="confirm-booking"
            >
              {t('booking.confirmAndBook')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Payment */}
      {currentStep === 4 && createdBooking && (
        <div className={clsx('mx-auto max-w-2xl', !holdExpired && 'pb-28')}>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-title text-ink">{t('payment.title')}</h2>
          </div>

          <Card className="space-y-6">
            {/* Amount summary */}
            <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-ink">
                    {paymentOption === 'deposit50' ? t('payment.deposit') : t('payment.payInFull')}
                  </p>
                  <p className="text-caption text-ink-muted">{t('payment.amountToPay')}</p>
                </div>
                <p className="text-display text-brand-600" data-testid="amount-due-now">
                  ฿{createdBooking.amount_due_now.toLocaleString('th-TH')}
                </p>
              </div>
              {createdBooking.balance_due_at_checkin > 0 && (
                <div className="flex items-center justify-between border-t border-brand-200 pt-2 text-caption">
                  <span className="text-ink-muted">{t('payment.balanceDueAtCheckin')}</span>
                  <span className="font-semibold text-ink" data-testid="balance-due">
                    ฿{createdBooking.balance_due_at_checkin.toLocaleString('th-TH')}
                  </span>
                </div>
              )}
            </div>

            {/* Hold expiry countdown */}
            {holdMsLeft !== null && !holdExpired && slipStatus === 'pending' && (
              <Badge
                tone="warning"
                size="md"
                className="w-full justify-center gap-2 py-3"
                data-testid="hold-countdown"
              >
                <FiClock className="h-4 w-4" aria-hidden="true" />
                <span>{t('payment.holdExpiresIn', { time: formatCountdown(holdMsLeft) })}</span>
              </Badge>
            )}

            {holdExpired ? (
              <div
                className="space-y-4 rounded-card border border-error-600 bg-error-50 p-6 text-center"
                data-testid="hold-expired"
              >
                <FiAlertCircle className="mx-auto h-8 w-8 text-error-600" aria-hidden="true" />
                <p className="font-semibold text-error-700">{t('payment.holdExpired')}</p>
                <Button onClick={restartBooking}>{t('payment.startOver')}</Button>
              </div>
            ) : (
              <>
                {/* Per-property PromptPay QR — pure white panel, imagery elevation */}
                <div className="border-b border-hairline pb-6">
                  <h3 className="mb-4 text-title text-ink">{t('payment.scanQRCode')}</h3>

                  <div className="space-y-4 rounded-lg bg-white p-4 shadow-soft">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="PromptPay QR Code"
                        className="mx-auto w-full max-w-xs"
                        data-testid="promptpay-qr"
                      />
                    ) : (
                      <div
                        className="flex h-48 items-center justify-center"
                        data-testid="qr-loading"
                      >
                        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-brand-600" />
                      </div>
                    )}

                    <p className="text-center text-caption text-ink-muted">
                      {t('payment.scanInstructions')}
                    </p>
                    <p className="text-center text-fine text-ink-faint">
                      {t('payment.propertyAccount', { property: t(`property.${availability?.property ?? 'hf'}`) })}
                    </p>
                  </div>
                </div>

                {/* Slip Upload Section */}
                <div>
                  <h3 className="mb-4 text-title text-ink">{t('payment.uploadSlip')}</h3>
                  <p className="mb-4 text-caption text-ink-muted">{t('payment.uploadSlipDescription')}</p>

                  {slipStatus === 'pending' && !slipPreview && (
                    <div
                      className={clsx('rounded-card border-2 border-dashed bg-surface-sunken p-8 text-center transition-colors',
                        isDragging ? 'border-brand-600' : 'border-hairline-strong hover:border-brand-600'
                      )}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      data-testid="slip-dropzone"
                    >
                      <FiUpload className="mx-auto mb-3 h-12 w-12 text-ink-faint" aria-hidden="true" />
                      <p className="mb-2 text-body text-ink-muted">{t('payment.dragDropSlip')}</p>
                      <p className="mb-4 text-fine text-ink-faint">JPG, PNG (max 10MB)</p>
                      <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                        {t('payment.browseFiles')}
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png"
                        onChange={handleFileInputChange}
                        className="hidden"
                        data-testid="slip-input"
                      />
                    </div>
                  )}

                  {slipPreview && slipStatus === 'pending' && (
                    <div className="relative overflow-hidden rounded-card border border-hairline">
                      <img
                        src={slipPreview}
                        alt="Transfer slip preview"
                        className="max-h-64 w-full bg-surface-sunken object-contain"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={removeSlip}
                        className="absolute right-2 top-2"
                        data-testid="remove-slip"
                        aria-label={t('common.close', 'Close')}
                      >
                        <FiX className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}

                  {slipStatus === 'uploaded' && (
                    <div className="space-y-4">
                      {slipPreview && (
                        <div className="overflow-hidden rounded-card border border-hairline">
                          <img
                            src={slipPreview}
                            alt="Uploaded slip"
                            className="max-h-64 w-full bg-surface-sunken object-contain"
                          />
                        </div>
                      )}

                      <Badge tone="warning" size="md" className="w-full gap-3 py-4">
                        <FiClock className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
                        <span className="flex flex-col text-left">
                          <span className="font-semibold">{t('payment.slipUploaded')}</span>
                          <span className="font-normal">{t('payment.awaitingVerification')}</span>
                        </span>
                      </Badge>

                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => navigate(`/my-bookings?openBooking=${createdBooking.booking_id}&tab=payment`)}
                      >
                        {t('payment.changeSlip')}
                      </Button>
                    </div>
                  )}

                  {slipStatus === 'verified' && (
                    <Badge tone="success" size="md" className="w-full gap-3 py-4">
                      <FiCheckCircle className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
                      <span className="font-semibold">{t('payment.verified')}</span>
                    </Badge>
                  )}

                  {slipStatus === 'failed' && (
                    <Badge tone="error" size="md" className="w-full gap-3 py-4">
                      <FiAlertCircle className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
                      <span className="font-semibold">{t('payment.verificationFailed')}</span>
                    </Badge>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Step 4 action bar — thumb-zone, mirrors steps 1 & 3 */}
      {currentStep === 4 && createdBooking && !holdExpired && (
        <div className={STICKY_CTA_CLASSES}>
          <span className="text-body font-semibold text-ink">
            ฿{createdBooking.amount_due_now.toLocaleString('th-TH')}
          </span>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleSkipPayment} data-testid="skip-payment">
              {t('payment.payLater')}
            </Button>

            {slipPreview && slipStatus === 'pending' && (
              <Button
                loading={isUploading}
                onClick={handleSlipUpload}
                data-testid="submit-slip"
              >
                {t('payment.submitSlip')}
              </Button>
            )}

            {(slipStatus === 'uploaded' || slipStatus === 'verified') && (
              <Button onClick={() => navigate('/my-bookings')} data-testid="view-bookings">
                {t('booking.myBookings')}
              </Button>
            )}
          </div>
        </div>
      )}
      {/* B16 — the way out, on every step of the flow. `pb-28` clears the
          sticky action bar on the steps that have one. */}
      <DeskContactFooter property={property} className="mx-auto mt-8 max-w-2xl pb-28" />
    </AppShell>
  );
}
