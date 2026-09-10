import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { FiCalendar, FiUsers, FiStar, FiAlertCircle, FiPlus, FiChevronRight, FiX, FiUpload, FiCheckCircle, FiClock, FiDollarSign, FiDownload } from 'react-icons/fi';
import AppShell from '../components/layout/AppShell';
import {
  Button,
  buttonVariants,
  Card,
  Badge,
  Modal,
  TabNav,
  EmptyState,
  PageHeader,
  FormField,
  Textarea,
  type BadgeTone,
  type TabItem,
} from '../components/ui';
import { useQuery, useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { bookingService } from '../services/bookingService';
import type { Booking } from '../services/bookingService';
import { guestSlipOkStatusKey, isSlipOkStatus, type SlipOkStatus } from '../types/slipok';
import companyQRCode from '../assets/company-promptpay-qr.png';
import kbankLogo from '../assets/kbank-logo.png';

type BookingStatus = 'confirmed' | 'cancelled' | 'completed';
type BookingTab = 'current' | 'history';
type StatusGlyphName = 'clock' | 'check' | 'alert';

// The four status-color records this page has always kept at the top of the
// file — now mapping each API status value to a design-system Badge tone
// (+ optional glyph) instead of a bespoke bg/text class pair. Semantics are
// unchanged: same states, same grouping, just routed through the shared
// token grammar.
const STATUS_BADGE_TONE: Record<BookingStatus | 'cancelledByAdmin', BadgeTone> = {
  confirmed: 'success',
  cancelled: 'error',
  completed: 'brand',
  cancelledByAdmin: 'warning',
};

const PAYMENT_TYPE_BADGE_TONE: Record<string, BadgeTone> = {
  deposit: 'warning',
  full: 'success',
};

// The guest half of the locked SlipOK vocabulary. Every status other than
// `verified` is a slip we have not finished confirming, so it gets the same
// calm "being checked" badge — a guest must never read a vendor outage
// (`unavailable`), a shadow-mode pass or a queued manual review as a problem
// with their money. The wording collapse lives in the
// `payment.slipok.status.*` strings; the tones collapse here.
const SLIP_OK_STATUS: Record<SlipOkStatus, { tone: BadgeTone; icon: StatusGlyphName }> = {
  pending: { tone: 'warning', icon: 'clock' },
  verified: { tone: 'success', icon: 'check' },
  shadow_pass: { tone: 'warning', icon: 'clock' },
  manual: { tone: 'warning', icon: 'clock' },
  unavailable: { tone: 'warning', icon: 'clock' },
};

// Legacy rows (`failed`, `quota_exceeded`) and any status a newer backend
// starts writing land here rather than on a bare neutral badge.
const SLIP_OK_STATUS_FALLBACK = SLIP_OK_STATUS.pending;

function slipOkBadge(status: string | null | undefined) {
  return isSlipOkStatus(status) ? SLIP_OK_STATUS[status] : SLIP_OK_STATUS_FALLBACK;
}

const ADMIN_STATUS: Record<string, { tone: BadgeTone; icon: StatusGlyphName }> = {
  pending: { tone: 'warning', icon: 'clock' },
  verified: { tone: 'success', icon: 'check' },
  needs_action: { tone: 'error', icon: 'alert' },
};

function StatusGlyph({ icon }: { icon?: StatusGlyphName }) {
  if (icon === 'check') {
    return <FiCheckCircle className="h-3 w-3" aria-hidden="true" />;
  }
  if (icon === 'clock') {
    return <FiClock className="h-3 w-3" aria-hidden="true" />;
  }
  if (icon === 'alert') {
    return <FiAlertCircle className="h-3 w-3" aria-hidden="true" />;
  }
  return null;
}

export default function MyBookingsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
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
  const [showBankDetails, setShowBankDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals default their initial focus to the first focusable descendant,
  // which would otherwise be each modal's own icon-only close button —
  // landing default focus on a dismiss control is bad UX (and, combined
  // with keyboard-triggered opens, can even race a still-in-flight Enter
  // keypress into an accidental immediate close). Point initial focus at
  // the heading instead.
  const detailsModalHeadingRef = useRef<HTMLHeadingElement>(null);
  const slipUploadModalHeadingRef = useRef<HTMLHeadingElement>(null);

  // QR code URL - use env variable or fallback to bundled image
  const promptPayQRUrl = import.meta.env.VITE_PROMPTPAY_QR_IMAGE_URL ?? companyQRCode;

  // Queries - disable caching to always show fresh data
  const { data: bookings, isLoading, refetch } = useQuery({
    queryKey: ['bookings', 'my'],
    queryFn: () => bookingService.getMyBookings(),
    staleTime: 0,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
  });

  // Handle URL params for auto-opening booking
  useEffect(() => {
    if (!bookings || isLoading) {return;}

    const params = new URLSearchParams(location.search);
    const openBookingId = params.get('openBooking');
    const tab = params.get('tab');

    if (openBookingId) {
      const booking = bookings.find((b) => b.id === openBookingId);
      if (booking) {
        // If tab is 'payment', open the slip upload modal directly
        if (tab === 'payment') {
          setSlipUploadBookingId(openBookingId);
          setShowSlipUploadModal(true);
        } else {
          // Otherwise open the details modal
          setSelectedBooking(booking as Booking);
        }
        // Clear URL params after handling
        navigate('/my-bookings', { replace: true });
      }
    }
  }, [bookings, isLoading, location.search, navigate]);

  // Mutations
  const cancelBookingMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      bookingService.cancelBooking(id, reason),
    onSuccess: () => {
      toast.success(t('booking.cancelSuccess'));
      setShowCancelModal(false);
      setSelectedBookingId(null);
      setCancelReason('');
      refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || t('booking.cancelError'));
    },
  });

  // Use new addSlip mutation (multi-slip support)
  const addSlipMutation = useMutation({
    mutationFn: ({ bookingId, slipUrl }: { bookingId: string; slipUrl: string }) =>
      bookingService.addSlip(bookingId, slipUrl),
  });

  // Remove slip mutation
  const removeSlipMutation = useMutation({
    mutationFn: ({ slipId }: { slipId: string }) =>
      bookingService.removeSlip(slipId),
    onSuccess: () => {
      toast.success(t('payment.removeSlip'));
      refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || t('errors.error'));
    },
  });

  // Handle remove slip
  const handleRemoveSlip = useCallback((slipId: string) => {
    if (confirm(t('common.confirm'))) {
      removeSlipMutation.mutate({ slipId });
    }
  }, [removeSlipMutation, t]);

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
    if (!slipFile || !slipUploadBookingId) {return;}

    setIsUploading(true);
    try {
      // Step 1: Upload file to get URL
      const { url } = await bookingService.uploadSlip(slipFile);

      // Step 2: Call addSlip mutation with URL (multi-slip support)
      await addSlipMutation.mutateAsync({
        bookingId: slipUploadBookingId,
        slipUrl: url,
      });

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
  }, [slipFile, slipUploadBookingId, t, refetch, addSlipMutation]);

  const closeSlipUploadModal = useCallback(() => {
    setShowSlipUploadModal(false);
    setSlipUploadBookingId(null);
    setSlipFile(null);
    setSlipPreview(null);
    setShowBankDetails(false);
  }, []);

  // Helper to check if slip can be uploaded (multi-slip: always allow for confirmed bookings)
  const canUploadSlip = (booking: Booking) => {
    return booking.status === 'confirmed';
  };

  // Helper to check if booking has any slips
  const hasSlips = (booking: Booking) => {
    return booking.slips && booking.slips.length > 0;
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
    booking.status === 'confirmed' && new Date(booking.checkOutDate) > new Date();

  const isHistoryBooking = (booking: Booking) =>
    booking.status === 'completed' ||
    booking.status === 'cancelled' ||
    (booking.status === 'confirmed' && new Date(booking.checkOutDate) <= new Date());

  // Filtered bookings
  const currentBookings = bookings?.filter((b) => isCurrentBooking(b as Booking)) ?? [];
  const historyBookings = bookings?.filter((b) => isHistoryBooking(b as Booking)) ?? [];
  const displayedBookings = activeTab === 'current' ? currentBookings : historyBookings;

  if (isLoading) {
    return (
      <AppShell variant="guest" title={t('booking.myBookings')}>
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600" />
        </div>
      </AppShell>
    );
  }

  const tabItems: TabItem[] = [
    { value: 'current', label: `${t('booking.currentBookings')} (${currentBookings.length})` },
    { value: 'history', label: `${t('booking.bookingHistory')} (${historyBookings.length})` },
  ];

  return (
    <AppShell variant="guest" title={t('booking.myBookings')}>
      <PageHeader
        title={t('booking.myBookings')}
        actions={
          <Link to="/booking" className={buttonVariants({ size: 'sm' })} data-testid="new-booking-button">
            <FiPlus className="h-4 w-4" aria-hidden="true" />
            {t('booking.bookRoom')}
          </Link>
        }
      />

      <div className="mb-6">
        <TabNav
          items={tabItems}
          value={activeTab}
          onChange={(value) => setActiveTab(value as BookingTab)}
          aria-label={t('booking.myBookings')}
        />
      </div>

      {displayedBookings.length === 0 ? (
        <EmptyState
          icon={FiCalendar}
          title={activeTab === 'current' ? t('booking.noCurrentBookings') : t('booking.noBookingHistory')}
          description={
            activeTab === 'current'
              ? t('booking.noCurrentBookingsDescription')
              : t('booking.noBookingHistoryDescription')
          }
          action={
            activeTab === 'current' ? (
              <Link to="/booking" className={buttonVariants()}>
                <FiPlus className="h-4 w-4" aria-hidden="true" />
                {t('booking.bookYourFirstRoom')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {displayedBookings.map((rawBooking) => {
            const booking = rawBooking as Booking;
            const displayStatus = getDisplayStatus(booking);
            return (
              <Card
                key={booking.id}
                padding="none"
                data-testid={`booking-card-${booking.id}`}
                onClick={() => handleCardClick(booking)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleCardClick(booking);
                  }
                }}
                className="cursor-pointer overflow-hidden transition-colors hover:border-hairline-strong"
              >
                <div className="p-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    {/* Booking Details */}
                    <div className="flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h3 className="text-title text-ink">{booking.roomTypeName}</h3>
                        <Badge tone={STATUS_BADGE_TONE[displayStatus.key]} size="sm">
                          {t(displayStatus.translationKey)}
                        </Badge>
                        {/* Payment Type Badge */}
                        {booking.paymentType && (
                          <Badge tone={PAYMENT_TYPE_BADGE_TONE[booking.paymentType] ?? 'neutral'} size="sm">
                            <FiDollarSign className="h-3 w-3" aria-hidden="true" />
                            {booking.paymentType === 'deposit' ? t('payment.deposit') : t('payment.payInFull')}
                          </Badge>
                        )}
                        {/* SlipOK Status Badge */}
                        {booking.slipOkStatus && (
                          <Badge tone={slipOkBadge(booking.slipOkStatus).tone} size="sm">
                            <StatusGlyph icon={slipOkBadge(booking.slipOkStatus).icon} />
                            {t(guestSlipOkStatusKey(booking.slipOkStatus))}
                          </Badge>
                        )}
                        {/* Admin Status Badge */}
                        {booking.adminVerificationStatus && (
                          <Badge tone={ADMIN_STATUS[booking.adminVerificationStatus]?.tone ?? 'neutral'} size="sm">
                            <StatusGlyph icon={ADMIN_STATUS[booking.adminVerificationStatus]?.icon} />
                            {t(`payment.admin.${booking.adminVerificationStatus}`)}
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-4 text-caption text-ink-muted md:grid-cols-2">
                        <div className="flex items-center">
                          <FiCalendar className="mr-2 h-4 w-4 text-ink-faint" aria-hidden="true" />
                          <div>
                            <span className="font-semibold text-ink">{t('booking.checkIn')}:</span>{' '}
                            {new Date(booking.checkInDate).toLocaleDateString()}
                          </div>
                        </div>

                        <div className="flex items-center">
                          <FiCalendar className="mr-2 h-4 w-4 text-ink-faint" aria-hidden="true" />
                          <div>
                            <span className="font-semibold text-ink">{t('booking.checkOut')}:</span>{' '}
                            {new Date(booking.checkOutDate).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Price, Upload Button and Chevron */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-title text-brand-600">
                          ฿{Number(booking.totalPrice).toLocaleString()}
                        </div>
                        <div className="text-caption text-ink-muted">
                          {calculateNights(booking.checkInDate, booking.checkOutDate)} {t('booking.nights')}
                        </div>
                        {/* Payment amount if exists */}
                        {booking.paymentAmount && (
                          <div className="text-caption font-semibold text-success-700">
                            {t('payment.paid')}: ฿{(booking.paymentAmount ?? 0).toLocaleString('th-TH')}
                          </div>
                        )}
                      </div>
                      <FiChevronRight className="h-5 w-5 text-ink-faint" aria-hidden="true" />
                    </div>
                  </div>
                </div>

                {/* Booking Footer */}
                <div className="flex items-center justify-between border-t border-hairline bg-surface-sunken px-6 py-3 text-caption text-ink-muted">
                  <span>{t('booking.bookedOn')}: {new Date(booking.createdAt).toLocaleDateString()}</span>
                  <span className="text-brand-700">{t('booking.clickForDetails')}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Booking Details Modal */}
      <Modal
        open={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
        initialFocusRef={detailsModalHeadingRef}
        footer={
          selectedBooking && (
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setSelectedBooking(null)}>
                {t('common.close')}
              </Button>
              {canCancel(selectedBooking) && (
                <Button
                  variant="destructive"
                  onClick={() => handleCancelClick(selectedBooking.id)}
                  data-testid="booking-details-cancel"
                >
                  {t('booking.cancelBooking')}
                </Button>
              )}
            </div>
          )
        }
      >
        {selectedBooking && (
          <div className="space-y-6">
            {/* Custom header (kept distinct from Modal's own title slot so the
                icon-only close button stays name-less, matching the footer's
                text "Close" button as the only accessible-name match). */}
            <div className="mb-2 flex items-center justify-between border-b border-hairline pb-4">
              <div className="flex items-center gap-3">
                <h3 ref={detailsModalHeadingRef} tabIndex={-1} className="text-title text-ink outline-none">
                  {selectedBooking.roomTypeName}
                </h3>
                <Badge tone={STATUS_BADGE_TONE[getDisplayStatus(selectedBooking).key]} size="sm">
                  {t(getDisplayStatus(selectedBooking).translationKey)}
                </Badge>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                className="text-ink-faint hover:text-ink"
                data-testid="booking-details-close"
              >
                <FiX className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>

            {/* Dates Section */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1 text-caption text-ink-muted">{t('booking.checkIn')}</div>
                <div className="flex items-center font-semibold text-ink">
                  <FiCalendar className="mr-2 h-4 w-4 text-brand-600" aria-hidden="true" />
                  {new Date(selectedBooking.checkInDate).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="mb-1 text-caption text-ink-muted">{t('booking.checkOut')}</div>
                <div className="flex items-center font-semibold text-ink">
                  <FiCalendar className="mr-2 h-4 w-4 text-brand-600" aria-hidden="true" />
                  {new Date(selectedBooking.checkOutDate).toLocaleDateString()}
                </div>
              </div>
            </div>

            {/* Nights Count */}
            <div className="rounded-lg bg-surface-sunken py-3 text-center" data-testid="booking-nights-count">
              <span className="text-body font-semibold text-brand-600">
                {calculateNights(selectedBooking.checkInDate, selectedBooking.checkOutDate)}
              </span>{' '}
              <span className="text-ink-muted">
                {calculateNights(selectedBooking.checkInDate, selectedBooking.checkOutDate) === 1
                  ? t('booking.night')
                  : t('booking.nights')}
              </span>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center">
                <FiUsers className="mr-2 h-4 w-4 text-ink-faint" aria-hidden="true" />
                <div>
                  <div className="text-caption text-ink-muted">{t('booking.guests')}</div>
                  <div className="font-semibold text-ink">
                    {selectedBooking.numGuests} {selectedBooking.numGuests === 1 ? t('booking.guest') : t('booking.guests')}
                  </div>
                </div>
              </div>
              <div className="flex items-center">
                <FiStar className="mr-2 h-4 w-4 text-gold-600" aria-hidden="true" />
                <div>
                  <div className="text-caption text-ink-muted">{t('booking.pointsEarned')}</div>
                  <div className={clsx('font-semibold', selectedBooking.status === 'cancelled' ? 'text-ink-faint' : 'text-gold-700')}>
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
            <div className="rounded-lg bg-brand-50 py-4 text-center">
              <div className="mb-1 text-caption text-ink-muted">{t('booking.totalPrice')}</div>
              <div className="text-display text-brand-600">
                ฿{Number(selectedBooking.totalPrice).toLocaleString()}
              </div>
            </div>

            {/* Payment Button - Only show if no slips uploaded yet */}
            {canUploadSlip(selectedBooking) && !hasSlips(selectedBooking) && (
              <Button
                className="w-full"
                onClick={() => {
                  setSelectedBooking(null);
                  handleUploadSlipClick(selectedBooking.id);
                }}
              >
                {t('payment.title')}
              </Button>
            )}

            {/* Uploaded Slips Display (Multi-slip support) */}
            {hasSlips(selectedBooking) && (
              <div className="border-t border-hairline pt-4">
                <h4 className="mb-3 font-semibold text-ink">{t('payment.uploadedSlips')}</h4>
                <div className="space-y-3">
                  {/* Slip Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {selectedBooking.slips?.map((slip, index) => (
                      <div key={slip.id} className="group relative">
                        <img
                          src={slip.slipUrl}
                          alt={`${t('payment.slipPreview')} ${index + 1}`}
                          className="h-32 w-full cursor-pointer rounded-lg border border-hairline object-cover transition-opacity hover:opacity-90"
                          onClick={() => window.open(slip.slipUrl, '_blank')}
                        />
                        {/* Status badge overlay */}
                        <div className="absolute bottom-1 right-1">
                          {slip.slipokStatus && (
                            <Badge
                              tone={slipOkBadge(slip.slipokStatus).tone}
                              size="sm"
                              // Badge renders a bare <span> (role=generic), and
                              // ARIA ignores aria-label there — with the glyph
                              // aria-hidden, this badge would be silent. role=img
                              // gives the label something to attach to.
                              role="img"
                              aria-label={t(guestSlipOkStatusKey(slip.slipokStatus))}
                            >
                              <StatusGlyph icon={slipOkBadge(slip.slipokStatus).icon} />
                            </Badge>
                          )}
                        </div>
                        {/* Upload time tooltip */}
                        <div className="absolute left-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="rounded bg-tile/90 px-1.5 py-0.5 text-fine text-tile-text">
                            {new Date(slip.uploadedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Upload More Button */}
                  {canUploadSlip(selectedBooking) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleUploadSlipClick(selectedBooking.id)}
                    >
                      <FiPlus className="h-4 w-4" aria-hidden="true" />
                      {t('payment.uploadMore')}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedBooking.notes && (
              <div className="rounded-lg bg-surface-sunken p-4">
                <div className="mb-1 text-caption font-semibold text-ink">{t('booking.notes')}</div>
                <div className="text-ink-muted">{selectedBooking.notes}</div>
              </div>
            )}

            {/* Cancellation Info */}
            {selectedBooking.status === 'cancelled' && (
              <div
                className={clsx(
                  'rounded-lg border p-4',
                  selectedBooking.cancelledByAdmin ? 'border-warning-600 bg-warning-50' : 'border-error-600 bg-error-50'
                )}
              >
                <div className="flex items-start">
                  <FiAlertCircle
                    className={clsx(
                      'mr-2 mt-0.5 h-4 w-4 flex-shrink-0',
                      selectedBooking.cancelledByAdmin ? 'text-warning-700' : 'text-error-600'
                    )}
                    aria-hidden="true"
                  />
                  <div>
                    {selectedBooking.cancelledByAdmin && (
                      <div className="mb-2 text-caption font-semibold text-warning-700">
                        {t('booking.cancelledByAdmin')}
                      </div>
                    )}
                    {selectedBooking.cancellationReason && (
                      <>
                        <div className={clsx('text-caption font-semibold', selectedBooking.cancelledByAdmin ? 'text-warning-700' : 'text-error-700')}>
                          {t('booking.cancellationReason')}
                        </div>
                        <div className={selectedBooking.cancelledByAdmin ? 'text-warning-700' : 'text-error-600'}>
                          {selectedBooking.cancellationReason}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Booked On */}
            <div className="text-center text-caption text-ink-muted">
              {t('booking.bookedOn')}: {new Date(selectedBooking.createdAt).toLocaleDateString()}
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel Modal */}
      <Modal
        open={showCancelModal}
        onClose={() => {
          setShowCancelModal(false);
          setSelectedBookingId(null);
          setCancelReason('');
        }}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCancelModal(false);
                setSelectedBookingId(null);
                setCancelReason('');
              }}
              data-testid="cancel-modal-close"
            >
              {t('common.close')}
            </Button>
            <Button
              variant="destructive"
              loading={cancelBookingMutation.isPending}
              onClick={handleConfirmCancel}
              data-testid="confirm-cancel-button"
            >
              {t('booking.confirmCancel')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <h3 className="text-title text-ink">{t('booking.cancelBookingTitle')}</h3>
          <p className="text-caption text-ink-muted">{t('booking.cancelBookingConfirm')}</p>

          <FormField label={`${t('booking.cancelReason')} (${t('common.optional')})`} htmlFor="cancel-reason-input">
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder={t('booking.cancelReasonPlaceholder')}
              data-testid="cancel-reason-input"
            />
          </FormField>

          <Badge tone="warning" className="w-full gap-2 py-3">
            <FiAlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{t('booking.cancelWarning')}</span>
          </Badge>
        </div>
      </Modal>

      {/* Slip Upload Modal */}
      <Modal
        open={showSlipUploadModal && !!slipUploadBooking}
        onClose={closeSlipUploadModal}
        initialFocusRef={slipUploadModalHeadingRef}
        footer={
          slipUploadBooking && (
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={closeSlipUploadModal}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={isUploading}
                disabled={!slipFile}
                onClick={handleSlipUpload}
                data-testid="slip-upload-submit"
              >
                <FiUpload className="h-4 w-4" aria-hidden="true" />
                {t('payment.submitSlip')}
              </Button>
            </div>
          )
        }
      >
        {slipUploadBooking && (
          <div className="space-y-6">
            <div className="mb-2 flex items-center justify-between border-b border-hairline pb-4">
              <h3 ref={slipUploadModalHeadingRef} tabIndex={-1} className="text-title text-ink outline-none">
                {t('payment.uploadSlip')}
              </h3>
              <button
                type="button"
                onClick={closeSlipUploadModal}
                className="text-ink-faint hover:text-ink"
                data-testid="slip-upload-modal-close"
              >
                <FiX className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>

            {/* Booking Summary */}
            <div className="rounded-lg bg-surface-sunken p-4">
              <h4 className="mb-2 font-semibold text-ink">{slipUploadBooking.roomTypeName}</h4>
              <div className="grid grid-cols-2 gap-2 text-caption text-ink-muted">
                <div>{t('booking.checkIn')}: {new Date(slipUploadBooking.checkInDate).toLocaleDateString()}</div>
                <div>{t('booking.checkOut')}: {new Date(slipUploadBooking.checkOutDate).toLocaleDateString()}</div>
              </div>
              <div className="mt-2 text-title text-brand-600">
                ฿{Number(slipUploadBooking.totalPrice).toLocaleString('th-TH')}
              </div>
            </div>

            {/* Existing Slips Section - Only show if booking has slips */}
            {hasSlips(slipUploadBooking) && (
              <div>
                <h4 className="mb-3 font-semibold text-ink">{t('payment.yourSlips')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  {slipUploadBooking.slips?.map((slip, index) => (
                    <div key={slip.id} className="group relative">
                      <img
                        src={slip.slipUrl}
                        alt={`${t('payment.slipPreview')} ${index + 1}`}
                        className="h-32 w-full cursor-pointer rounded-lg border border-hairline object-cover transition-opacity hover:opacity-90"
                        onClick={() => window.open(slip.slipUrl, '_blank')}
                      />
                      {/* Status badge overlay */}
                      <div className="absolute bottom-1 right-1">
                        {slip.slipokStatus && (
                          <Badge
                            tone={slipOkBadge(slip.slipokStatus).tone}
                            size="sm"
                            // See the details-modal badge: role=img is what
                            // makes the aria-label reach a screen reader.
                            role="img"
                            aria-label={t(guestSlipOkStatusKey(slip.slipokStatus))}
                          >
                            <StatusGlyph icon={slipOkBadge(slip.slipokStatus).icon} />
                          </Badge>
                        )}
                      </div>
                      {/* Remove button - only show for non-verified slips */}
                      {slip.adminStatus !== 'verified' && (
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute right-1 top-1 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSlip(slip.id);
                          }}
                          aria-label={t('payment.removeSlip')}
                        >
                          <FiX className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bank/QR Section - Show directly if no slips, or toggle if slips exist */}
            {hasSlips(slipUploadBooking) && (
              <Button variant="secondary" className="w-full" onClick={() => setShowBankDetails(!showBankDetails)}>
                {showBankDetails ? t('payment.hideBankDetails') : t('payment.showBankDetails')}
              </Button>
            )}

            {(!hasSlips(slipUploadBooking) || showBankDetails) && (
              <>
                {/* Bank Transfer Option */}
                <div className="text-center">
                  <h4 className="mb-3 font-semibold text-ink">{t('payment.bankTransfer')}</h4>
                  <div
                    className="cursor-pointer space-y-2 rounded-lg border border-hairline bg-white p-4 text-left shadow-soft transition-colors hover:border-brand-300"
                    onClick={() => {
                      navigator.clipboard.writeText('0461430473');
                      toast.success(t('payment.copied'));
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-ink-muted">{t('payment.bankName')}</span>
                      <div className="flex items-center gap-2">
                        <img src={kbankLogo} alt="KBank" className="h-6" />
                        <span className="font-semibold text-ink">กสิกรไทย</span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-muted">{t('payment.accountName')}</span>
                      <span className="font-semibold text-ink">บจก. สายชล เฮอริเทจ</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-muted">{t('payment.accountNumber')}</span>
                      <span className="font-mono font-semibold text-ink">046-1-43047-3</span>
                    </div>
                    <p className="text-center text-fine text-ink-faint">{t('payment.clickToCopy')}</p>
                  </div>
                </div>

                {/* Divider with "or" */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-hairline" />
                  <span className="text-caption text-ink-faint">{t('payment.or')}</span>
                  <div className="flex-1 border-t border-hairline" />
                </div>

                {/* QR Code Display */}
                <div className="text-center">
                  <h4 className="mb-3 font-semibold text-ink">{t('payment.scanQRCode')}</h4>
                  <div className="rounded-lg bg-white p-4 shadow-soft">
                    <img
                      src={promptPayQRUrl}
                      alt="PromptPay QR Code"
                      className="w-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"%3E%3Crect fill="%23f3f4f6" width="160" height="160"/%3E%3Ctext x="80" y="80" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12"%3EQR Code%3C/text%3E%3C/svg%3E';
                      }}
                    />
                    <a
                      href={promptPayQRUrl}
                      download="promptpay-qr.png"
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 py-2 text-caption text-ink-muted transition-colors hover:text-brand-600"
                    >
                      <FiDownload className="h-4 w-4" aria-hidden="true" />
                      {t('payment.downloadQR')}
                    </a>
                  </div>
                </div>
              </>
            )}

            {/* Slip Upload Section */}
            <div>
              <h4 className="mb-3 font-semibold text-ink">{t('payment.uploadSlipDescription')}</h4>

              {!slipPreview ? (
                <div
                  className={clsx(
                    'cursor-pointer rounded-card border-2 border-dashed bg-surface-sunken p-8 text-center transition-colors',
                    isDragging ? 'border-brand-600' : 'border-hairline-strong hover:border-brand-600'
                  )}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="slip-upload-dropzone"
                >
                  <FiUpload className="mx-auto mb-3 h-10 w-10 text-ink-faint" aria-hidden="true" />
                  <p className="mb-2 text-body text-ink-muted">{t('payment.dragDropSlip')}</p>
                  <p className="text-fine text-ink-faint">JPG, PNG (max 10MB)</p>
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
                <div className="relative overflow-hidden rounded-card border border-hairline">
                  <img
                    src={slipPreview}
                    alt="Transfer slip preview"
                    className="max-h-48 w-full bg-surface-sunken object-contain"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={removeSlip}
                    className="absolute right-2 top-2 h-9 w-9"
                    data-testid="slip-upload-remove"
                  >
                    <FiX className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
