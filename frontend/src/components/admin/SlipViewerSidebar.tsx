import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiCheck,
  FiAlertTriangle,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Badge, Button, type BadgeTone } from '../ui';
import { deskSlipOkStatus, slipOkReasonKey, type SlipOkStatusValue } from '../../types/slipok';
import { adminBookingService } from '../../services/adminBookingService';
import { ApiError } from '../../utils/axiosInterceptor';
import { SlipErasedNotice } from '../SlipErasedNotice';
import type {
  AdminBooking as Booking,
  AdminBookingAuditEntry,
  AdminBookingSlip as BookingSlip,
} from '../../services/adminBookingService';

// Booking and slip shapes live in the admin booking service, which mirrors
// the serde DTOs in `backend-rust/src/routes/admin_bookings.rs` and
// `admin_slips.rs`. `AdminBookingSlip` is the multi-slip gallery row;
// `AdminBookingSlipSummary` is the legacy single slip the list carries.

interface SlipViewerSidebarProps {
  booking: Booking | null;
  onVerify: (bookingId: string) => Promise<void>;
  onNeedsAction: (bookingId: string, notes: string) => Promise<void>;
  onEdit: (booking: Booking) => void;
  onRefresh: () => void;
}

const ICON_BUTTON_CLASSES =
  'flex h-11 w-11 items-center justify-center rounded-full bg-ink/50 text-white transition hover:bg-ink/70 disabled:opacity-30 disabled:cursor-not-allowed';

/**
 * A11 — "the slip verified, the booking did not move".
 *
 * `slip_confirm.rs` writes this audit action when a verified slip could not
 * confirm the booking it pays for: in practice the automatic SlipOK path
 * meeting a hold that lapsed during the round-trip. The money arrived, the
 * slip says `verified`, and the booking is still `pending` — the one state
 * where the desk must act and nothing on screen used to say so.
 *
 * The audit row is the durable record, and the only one a reload can read:
 * the refusal reaches the frontend live on the verify *response*
 * (`bookingNotConfirmedReason`), but that is the rare human case, and
 * `GET /admin/bookings/slips/:id` deliberately reports neither field.
 */
const ACTION_BOOKING_NOT_CONFIRMED = 'booking_not_confirmed';

/**
 * Audit actions that mean the refusal above has been dealt with.
 *
 * A human's Verify overrides the lapsed hold and flips the booking
 * (`slip_confirm.rs`: `admin_override = actor.is_some()`), and an edit
 * rewrites the booking; either writes a row strictly newer than the refusal
 * (a separate transaction, so `occurred_at` strictly increases). Without
 * this the warning would be permanent, because the desk cannot read the
 * booking's real status back: `AdminBookingListItem.status` normalises
 * `pending` to `confirmed` on the wire, which is the very distinction this
 * notice exists to make.
 */
const BOOKING_REFUSAL_CURE_ACTIONS = new Set(['slip_verified', 'booking_updated']);

/**
 * The locked reason key out of a `booking_not_confirmed` audit row.
 *
 * `after_data` is `{status, holdExpiresAt, slipId, reason}` — the structured
 * half. Deliberately NOT `notes`: that field is one bilingual sentence built
 * for the history list, and pulling a machine key out of prose is how a desk
 * ends up reading half an English paragraph inside a Thai line.
 */
function auditReasonKey(entry: AdminBookingAuditEntry): string | null {
  if (!entry.newValue) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(entry.newValue);
    const reason = (parsed as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? reason : null;
  } catch {
    // A snapshot that will not parse still proves the refusal happened; the
    // caller then says so without naming a reason, which beats saying
    // nothing about a booking nobody confirmed.
    return null;
  }
}

/**
 * The newest unresolved `booking_not_confirmed` row on this booking, or
 * `null` when there is none (or it has since been cured).
 */
function unresolvedBookingRefusal(
  history: AdminBookingAuditEntry[] | undefined
): { reason: string | null; at: string } | null {
  if (!history || history.length === 0) {
    return null;
  }
  // Newest first is what the API promises, but the decision here turns on
  // "is anything newer than this row", so compare instants rather than
  // trusting an array order a future caller could re-sort. Parsed, not
  // string-compared: RFC 3339 with and without fractional seconds does not
  // order lexicographically ('.' sorts before 'Z').
  const at = (entry: AdminBookingAuditEntry) => Date.parse(entry.createdAt);
  const refusal = history
    .filter((entry) => entry.action === ACTION_BOOKING_NOT_CONFIRMED)
    .reduce<AdminBookingAuditEntry | null>(
      (newest, entry) => (newest === null || at(entry) > at(newest) ? entry : newest),
      null
    );
  if (!refusal) {
    return null;
  }
  const cured = history.some(
    (entry) => BOOKING_REFUSAL_CURE_ACTIONS.has(entry.action) && at(entry) > at(refusal)
  );
  return cured ? null : { reason: auditReasonKey(refusal), at: refusal.createdAt };
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
  /**
   * The refusal the verify response just reported, if any (A11).
   *
   * Kept in state rather than read back off the slip: `bookingConfirmed` and
   * `bookingNotConfirmedReason` are populated only on the verify /
   * needs-action responses, and the per-slip GET hard-codes them — so a
   * refetch would erase the very line the desk needs. Keyed by slip id so
   * moving through the gallery does not carry one slip's verdict onto
   * another's.
   */
  const [verifyRefusal, setVerifyRefusal] = useState<{ slipId: string; reason: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Per-slip moderation — `POST /api/admin/bookings/slips/:slipId/verify`
  // and `.../needs-action` in `backend-rust/src/routes/admin_slips.rs`.
  const verifySlipByIdMutation = useMutation({
    mutationFn: (data: { slipId: string }) => adminBookingService.verifySlip(data.slipId),
    onSuccess: (slip) => {
      // Both routes return the updated slip, so seed the per-slip cache with
      // it: without this the viewer would keep rendering the pre-verify read
      // (the booking refetch below does not touch that key).
      queryClient.setQueryData(['admin', 'slip', slip.id], slip);
      // A11: the verify response is the only place a refused confirmation is
      // reported in real time. `bookingConfirmed === false` alone is not it —
      // the GET sends that for every slip — the reason is the signal.
      setVerifyRefusal(
        slip.bookingConfirmed === false && slip.bookingNotConfirmedReason
          ? { slipId: slip.id, reason: slip.bookingNotConfirmedReason }
          : null
      );
      toast.success(t('admin.booking.bookingManagement.messages.slipVerified'));
      onRefresh();
    },
    // A15: the two failures the desk has to tell apart. A 409 is the hotel
    // system refusing this booking — pressing the button again will not help,
    // and the backend sends a sentence saying which refusal it is. A 5xx (or
    // anything else) is the hotel system not answering: nothing was changed
    // and retrying is exactly right. Swallowing both into "Failed to verify
    // slip" left reception re-pressing a button that could never work.
    onError: (error: Error) => {
      const api = error instanceof ApiError ? error : null;
      if (api?.status === 409) {
        toast.error(
          t('admin.booking.bookingManagement.errors.verifyRefused', {
            detail: api.detail ?? api.message
          })
        );
        return;
      }
      if (api?.status !== undefined && api.status >= 500) {
        toast.error(t('admin.booking.bookingManagement.errors.verifyUnavailable'));
        return;
      }
      toast.error(t('admin.booking.bookingManagement.errors.verifyFailed'));
    }
  });

  const markSlipNeedsActionMutation = useMutation({
    mutationFn: (data: { slipId: string; notes: string }) =>
      adminBookingService.markSlipNeedsAction(data.slipId, { notes: data.notes }),
    onSuccess: (slip) => {
      queryClient.setQueryData(['admin', 'slip', slip.id], slip);
      toast.success(t('admin.booking.bookingManagement.messages.needsActionMarked'));
      onRefresh();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.needsActionFailed'));
    }
  });

  // Get slips array - prefer multi-slip, fallback to legacy single slip
  const getSlips = (): BookingSlip[] => {
    if (!booking) {return [];}

    // Check for multi-slip array first
    if (booking.slips && booking.slips.length > 0) {
      return booking.slips;
    }

    // Fallback to legacy single slip
    if (booking.slip) {
      return [{
        id: booking.slip.id,
        slipUrl: booking.slip.imageUrl,
        deletedAt: booking.slip.deletedAt,
        uploadedAt: booking.slip.uploadedAt,
        slipokStatus: booking.slip.slipokStatus,
        slipokVerifiedAt: booking.slip.slipokVerifiedAt,
        slipokReason: booking.slip.slipokReason ?? null,
        slipokCheckedAt: booking.slip.slipokCheckedAt ?? null,
        adminStatus: booking.slip.adminStatus,
        adminVerifiedAt: booking.slip.adminVerifiedAt,
        adminVerifiedBy: booking.slip.adminVerifiedBy,
        adminVerifiedByName: booking.slip.adminVerifiedByName,
        autoVerified: booking.slip.autoVerified ?? false,
        isPrimary: true
      }];
    }

    return [];
  };

  const slips = getSlips();
  const hasMultipleSlips = slips.length > 1;
  const listSlip = slips[currentSlipIndex];

  // `GET /api/admin/bookings/slips/:slipId`. The booking list projection
  // carries no `slipokReason` / `slipokCheckedAt` / `autoVerified` — that
  // decision record only exists on the per-slip route. Reception seeing
  // *why* the machine stopped is the whole point of the reason panel, so the
  // viewer reads the slip it is showing rather than rendering a blank.
  const slipDetailQuery = useQuery({
    queryKey: ['admin', 'slip', listSlip?.id ?? null],
    queryFn: () => adminBookingService.getSlip(listSlip?.id as string),
    enabled: Boolean(listSlip?.id),
  });

  // Merge, never replace: a failed or in-flight read leaves the badges
  // exactly as the list rendered them.
  const currentSlip: BookingSlip | undefined = React.useMemo(() => {
    if (!listSlip) {return undefined;}
    const detail = slipDetailQuery.data;
    if (detail?.id !== listSlip.id) {return listSlip;}
    return {
      ...listSlip,
      // The per-slip read is authoritative for the F2 tombstone, and no `??`
      // fallback here: if the detail says the image is erased, a `slipUrl`
      // the list fetched before the sweep ran is exactly the stale value that
      // would render a dead <img>.
      slipUrl: detail.slipUrl,
      deletedAt: detail.deletedAt ?? listSlip.deletedAt ?? null,
      deletionReason: detail.deletionReason ?? listSlip.deletionReason ?? null,
      slipokStatus: (detail.slipokStatus as SlipOkStatusValue | null) ?? listSlip.slipokStatus,
      slipokReason: detail.slipokReason ?? listSlip.slipokReason ?? null,
      slipokCheckedAt: detail.slipokCheckedAt ?? listSlip.slipokCheckedAt ?? null,
      slipokVerifiedAt: detail.slipokVerifiedAt ?? listSlip.slipokVerifiedAt,
      adminStatus: detail.adminStatus,
      adminVerifiedAt: detail.adminVerifiedAt,
      adminVerifiedBy: detail.adminVerifiedBy,
      adminNotes: detail.adminNotes,
      autoVerified: detail.autoVerified,
    };
  }, [listSlip, slipDetailQuery.data]);

  /**
   * "The slip is verified, the booking is not" — the A11 line.
   *
   * Two sources, because neither alone covers the desk's day. The audit row
   * is the durable one and the only one that survives a reload, and it is
   * the one that fires for the case this actually happens in (SlipOK
   * auto-verify against a lapsed hold, decided while nobody was looking).
   * The verify response covers the seconds before the booking refetch lands,
   * and the rarer human verify. When both speak, the live one wins: it is
   * about the slip on screen.
   */
  const auditRefusal = React.useMemo(
    () => unresolvedBookingRefusal(booking?.auditHistory),
    [booking?.auditHistory]
  );
  const liveRefusal = verifyRefusal?.slipId === currentSlip?.id ? verifyRefusal : null;
  const bookingRefused = Boolean(liveRefusal ?? auditRefusal);
  const refusalReasonKey = slipOkReasonKey(liveRefusal?.reason ?? auditRefusal?.reason);
  // Never the raw key: an unrecognised or missing reason reads as "not
  // recorded" in the desk's own language rather than as an enum value.
  const refusalReasonText = refusalReasonKey
    ? t(refusalReasonKey)
    : t('admin.booking.bookingManagement.slipViewer.bookingNotConfirmedReasonUnknown');

  // Legacy verify handler (for backward compatibility)
  const handleLegacyVerifyClick = async () => {
    if (!booking) {return;}
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
    if (!booking || !notesInput.trim()) {return;}

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
    if (!booking || !event.target.files || event.target.files.length === 0) {return;}

    const file = event.target.files[0];
    if (!file) {return;}

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

  /**
   * Desk-facing slip badge: one distinct label per locked `slipok_status`
   * (unlike the guest badge, which collapses everything but `verified` into
   * "being checked"), plus the machine's reason and the time it decided.
   * Reception seeing *why* the machine stopped is the whole point — without
   * it the desk re-checks every slip by hand and the automation buys
   * nothing. `failed`/`quota_exceeded` stay for rows written before the
   * vocabulary lock.
   */
  const SlipStatusBadge: React.FC<{
    status: string | null;
    verifiedAt: string | null;
    reason?: string | null;
    checkedAt?: string | null;
  }> = ({ status, verifiedAt, reason, checkedAt }) => {
    // Keyed by the locked vocabulary, not `string`: adding a status to
    // `SLIPOK_STATUSES` must break this build rather than quietly render the
    // machine's new verdict as "not yet checked" at the desk.
    const badges: Record<SlipOkStatusValue, { tone: BadgeTone; text: string }> = {
      verified: { tone: 'success', text: t('admin.booking.bookingManagement.slipStatus.verified') },
      pending: { tone: 'warning', text: t('admin.booking.bookingManagement.slipStatus.pending') },
      shadow_pass: { tone: 'info', text: t('admin.booking.bookingManagement.slipStatus.shadowPass') },
      manual: { tone: 'warning', text: t('admin.booking.bookingManagement.slipStatus.manual') },
      unavailable: { tone: 'neutral', text: t('admin.booking.bookingManagement.slipStatus.unavailable') },
      failed: { tone: 'error', text: t('admin.booking.bookingManagement.slipStatus.failed') },
      quota_exceeded: { tone: 'warning', text: t('admin.booking.bookingManagement.slipStatus.quotaExceeded') }
    };

    // A status this bundle predates still renders — as "pending" — rather
    // than as a blank badge; `deskSlipOkStatus` is the only place that
    // decision is made.
    const badge = badges[deskSlipOkStatus(status)];
    const reasonKey = slipOkReasonKey(reason);
    // An unknown reason still reaches the desk verbatim — a raw key beats a
    // blank space when reception is deciding whether to call the guest.
    const reasonText = reasonKey ? t(reasonKey) : (reason ?? null);
    const decidedAt = checkedAt ?? verifiedAt;

    return (
      <div className="flex flex-col gap-1">
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {reasonText && (
          <span className="text-fine text-ink-muted">
            {t('admin.booking.bookingManagement.slipViewer.slipokReason')}: {reasonText}
          </span>
        )}
        {decidedAt && (
          // Labelled, because the admin badge beside it prints its own bare
          // timestamp — an unlabelled pair leaves reception guessing which
          // one is the machine's check, exactly when they are deciding
          // whether that verdict is stale.
          <span className="text-fine text-ink-muted">
            {t('admin.booking.bookingManagement.slipViewer.slipokCheckedAt')}:{' '}
            {formatDateTimeToEuropean(decidedAt)}
          </span>
        )}
      </div>
    );
  };

  const AdminStatusBadge: React.FC<{
    status: string | null;
    verifiedAt: string | null;
    verifiedByName?: string | null;
    autoVerified?: boolean;
  }> = ({ status, verifiedAt, verifiedByName, autoVerified = false }) => {
    const badges: Record<string, { tone: BadgeTone; text: string }> = {
      verified: { tone: 'success', text: t('admin.booking.bookingManagement.adminStatus.verified') },
      needs_action: { tone: 'error', text: t('admin.booking.bookingManagement.adminStatus.needsAction') },
      pending: { tone: 'warning', text: t('admin.booking.bookingManagement.adminStatus.pending') }
    };

    // NULL on a legacy row, or a value this bundle predates: both read as
    // "pending" rather than as a blank badge.
    const badge = (status ? badges[status] : undefined) ?? badges.pending;
    // A machine verify is attributed to the SlipOK system actor, never to a
    // human admin — that attribution is what makes the human-touch KPI
    // countable, so it has to be visible at the desk too.
    const verifier = autoVerified
      ? t('admin.booking.bookingManagement.slipViewer.autoVerifier')
      : verifiedByName;

    return (
      <div className="flex flex-col gap-1">
        <Badge tone={badge?.tone ?? 'warning'}>{badge?.text ?? ''}</Badge>
        {verifiedAt && (
          <span className="text-fine text-ink-muted">
            {formatDateTimeToEuropean(verifiedAt)}
          </span>
        )}
        {verifier && (
          <span className="text-fine text-ink-muted">
            {t('admin.booking.bookingManagement.by')}: {verifier}
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
      payment_updated: t('admin.booking.bookingManagement.auditActions.paymentUpdated'),
      // A11. Without these two the desk reads the raw English identifier in
      // a Thai-first history — and these are exactly the rows that mean
      // "money arrived and the booking did not move".
      booking_not_confirmed: t('admin.booking.bookingManagement.auditActions.bookingNotConfirmed'),
      slip_verify_reverted: t('admin.booking.bookingManagement.auditActions.slipVerifyReverted')
    };
    return actionMap[action] ?? action;
  };

  // No booking selected state
  if (!booking) {
    return (
      <div className="h-full rounded-card border border-hairline bg-surface-card">
        <div className="border-b border-hairline p-4">
          <h3 className="text-body font-semibold text-ink">
            {t('admin.booking.bookingManagement.slipViewer.title')}
          </h3>
        </div>
        <div className="flex h-64 flex-col items-center justify-center p-6 text-ink-muted">
          <FiImage className="mb-4 h-12 w-12 opacity-50" aria-hidden="true" />
          <p className="text-center text-caption">{t('admin.booking.bookingManagement.slipViewer.selectBooking')}</p>
        </div>
      </div>
    );
  }

  const recentAudit = booking.auditHistory?.slice(0, 3) ?? [];

  return (
    <div className="flex h-full flex-col rounded-card border border-hairline bg-surface-card">
      {/* Header */}
      <div className="border-b border-hairline p-4">
        <h3 className="text-body font-semibold text-ink">
          {t('admin.booking.bookingManagement.slipViewer.title')}
        </h3>
        {slips.length > 0 && slips[0] && (
          <p className="mt-1 text-caption text-ink-muted">
            {slips.length > 1
              ? t('admin.booking.bookingManagement.slipViewer.slipCount', { count: slips.length })
              : t('admin.booking.bookingManagement.slipViewer.uploaded') + ': ' + formatDateTimeToEuropean(slips[0].uploadedAt)
            }
          </p>
        )}
      </div>

      {/* Status Section - Show current slip status */}
      {currentSlip && (
        <div className="grid grid-cols-2 gap-4 border-b border-hairline p-4">
          <div>
            <p className="mb-1 text-fine text-ink-muted">
              {t('admin.booking.bookingManagement.slipViewer.slipokStatus')}
            </p>
            <SlipStatusBadge
              status={currentSlip.slipokStatus}
              verifiedAt={currentSlip.slipokVerifiedAt}
              reason={currentSlip.slipokReason}
              checkedAt={currentSlip.slipokCheckedAt}
            />
          </div>
          <div>
            <p className="mb-1 text-fine text-ink-muted">
              {t('admin.booking.bookingManagement.slipViewer.adminStatus')}
            </p>
            <AdminStatusBadge
              status={currentSlip.adminStatus}
              verifiedAt={currentSlip.adminVerifiedAt}
              verifiedByName={currentSlip.adminVerifiedByName ?? null}
              autoVerified={currentSlip.autoVerified ?? false}
            />
          </div>
        </div>
      )}

      {/* A11. Two green badges and a booking that never moved is the one
          screen reception can misread into doing nothing, so this says it in
          a sentence rather than leaving it to be inferred from a badge pair.
          `role="status"`, not `alert`: it is a standing fact about the
          booking, announced when it appears, not an interruption. */}
      {bookingRefused && (
        <div
          role="status"
          className="border-b border-hairline bg-warning-50 p-4"
          data-testid="booking-not-confirmed-notice"
        >
          <p className="flex items-start gap-2 text-caption font-semibold text-warning-700">
            <FiClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {t('admin.booking.bookingManagement.slipViewer.bookingNotConfirmed', {
                reason: refusalReasonText
              })}
            </span>
          </p>
          <p className="mt-1 text-fine text-ink-muted">
            {t('admin.booking.bookingManagement.slipViewer.bookingNotConfirmedHint')}
          </p>
        </div>
      )}

      {/* Image Section - Gallery View for Multiple Slips */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-hairline p-4">
        {slips.length > 0 ? (
          <>
          <div className="relative min-h-[300px] flex-1 rounded-lg border border-hairline bg-surface-card p-2">
            {/* Main Image, or the tombstone once retention has erased it.
                F2: `slipUrl` is null after the sweep unlinks the file, and an
                empty `src` resolves to the page itself — a broken image with
                no explanation. The fullscreen action goes with it: there is
                nothing to open. */}
            {currentSlip?.slipUrl ? (
              <>
                <img
                  src={currentSlip.slipUrl}
                  alt={t('admin.booking.bookingManagement.slipViewer.slipImage')}
                  className="h-full w-full cursor-pointer object-contain rounded-lg"
                  onClick={() => openFullscreen(currentSlip.slipUrl as string)}
                />

                {/* Fullscreen Button */}
                <button
                  onClick={() => openFullscreen(currentSlip.slipUrl as string)}
                  className={`absolute right-2 top-2 ${ICON_BUTTON_CLASSES}`}
                  title={t('admin.booking.bookingManagement.slipViewer.fullscreen')}
                >
                  <FiMaximize2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : (
              <SlipErasedNotice deletedAt={currentSlip?.deletedAt} />
            )}

            {/* Multi-slip Navigation */}
            {hasMultipleSlips && (
              <>
                {/* Slip Counter */}
                <div className="absolute left-2 top-2 rounded bg-ink/50 px-2 py-1 text-caption text-white">
                  {currentSlipIndex + 1} / {slips.length}
                </div>

                {/* Previous/Next Buttons */}
                <button
                  onClick={() => setCurrentSlipIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentSlipIndex === 0}
                  className={`absolute left-2 top-1/2 -translate-y-1/2 ${ICON_BUTTON_CLASSES}`}
                >
                  <FiChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  onClick={() => setCurrentSlipIndex(prev => Math.min(slips.length - 1, prev + 1))}
                  disabled={currentSlipIndex === slips.length - 1}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 ${ICON_BUTTON_CLASSES}`}
                >
                  <FiChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>

                {/* Thumbnail Strip */}
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded bg-ink/40 p-1 backdrop-blur-sm">
                  {slips.map((slip, index) => (
                    <button
                      key={slip.id}
                      onClick={() => setCurrentSlipIndex(index)}
                      className={`h-11 w-11 overflow-hidden rounded border-2 transition-all ${
                        index === currentSlipIndex ? 'border-white' : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      {slip.slipUrl ? (
                        <img
                          src={slip.slipUrl}
                          alt={`Slip ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <SlipErasedNotice deletedAt={slip.deletedAt} compact />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Pagination Dots - Always visible below image */}
          {hasMultipleSlips && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={() => setCurrentSlipIndex(prev => Math.max(0, prev - 1))}
                disabled={currentSlipIndex === 0}
                className="flex h-11 w-11 items-center justify-center text-ink-faint transition hover:text-ink-muted disabled:cursor-not-allowed disabled:opacity-30"
              >
                <FiChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-1.5">
                {slips.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlipIndex(index)}
                    className={`rounded-full transition-all duration-200 ${
                      currentSlipIndex === index
                        ? 'h-2 w-6 bg-brand-600'
                        : 'h-2 w-2 bg-hairline-strong hover:bg-ink-faint'
                    }`}
                    aria-label={`Go to slip ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setCurrentSlipIndex(prev => Math.min(slips.length - 1, prev + 1))}
                disabled={currentSlipIndex === slips.length - 1}
                className="flex h-11 w-11 items-center justify-center text-ink-faint transition hover:text-ink-muted disabled:cursor-not-allowed disabled:opacity-30"
              >
                <FiChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>

              <span className="ml-2 text-caption text-ink-muted">
                {currentSlipIndex + 1} / {slips.length}
              </span>
            </div>
          )}
          </>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center rounded-lg bg-surface-sunken text-ink-faint">
            <FiImage className="mb-2 h-12 w-12" aria-hidden="true" />
            <p className="text-caption">{t('admin.booking.bookingManagement.slipViewer.noSlip')}</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 border-b border-hairline p-4">
        {currentSlip ? (
          <>
            {/* Multi-slip actions - operate on current slip */}
            <Button
              type="button"
              variant="primary"
              className="w-full bg-success-600 hover:bg-success-700"
              onClick={() => handleVerifySlip(currentSlip.id)}
              loading={verifySlipByIdMutation.isPending}
            >
              {!verifySlipByIdMutation.isPending && <FiCheck className="h-4 w-4" aria-hidden="true" />}
              {hasMultipleSlips
                ? t('admin.booking.bookingManagement.actions.verifySlip', { number: currentSlipIndex + 1 })
                : t('admin.booking.bookingManagement.actions.verify')
              }
            </Button>
            <Button
              type="button"
              variant="primary"
              className="w-full bg-warning-600 hover:bg-warning-700"
              onClick={() => handleNeedsActionClick(currentSlip.id)}
              loading={markSlipNeedsActionMutation.isPending}
            >
              {!markSlipNeedsActionMutation.isPending && <FiAlertTriangle className="h-4 w-4" aria-hidden="true" />}
              {t('admin.booking.bookingManagement.actions.needsAction')}
            </Button>
          </>
        ) : (
          <>
            {/* Legacy booking-scoped actions. `POST /api/admin/bookings/:id/
                verify-slip` and `.../needs-action` are still missing
                (docs/admin-backend-gaps.md), and with no slip on the booking
                there is nothing for the per-slip routes to act on — so these
                stay disabled and say why, rather than firing a request that
                cannot succeed. */}
            <Button
              type="button"
              variant="primary"
              className="w-full bg-success-600 hover:bg-success-700"
              onClick={handleLegacyVerifyClick}
              disabled={true}
              title={t('admin.booking.bookingManagement.actions.legacyMigrating')}
            >
              <FiCheck className="h-4 w-4" aria-hidden="true" />
              {t('admin.booking.bookingManagement.actions.verify')}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="w-full bg-warning-600 hover:bg-warning-700"
              onClick={() => handleNeedsActionClick()}
              disabled={true}
              title={t('admin.booking.bookingManagement.actions.legacyMigrating')}
            >
              <FiAlertTriangle className="h-4 w-4" aria-hidden="true" />
              {t('admin.booking.bookingManagement.actions.needsAction')}
            </Button>
          </>
        )}
        {/* Slip replacement has no admin upload route yet — no handler in
            `admin_slips.rs`, and no entry in docs/admin-backend-gaps.md to
            wire against. Disabled rather than a button that opens a file
            picker only to report a failure. */}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
          loading={isUploading}
          disabled={true}
          title={t('admin.booking.bookingManagement.actions.legacyMigrating')}
        >
          {!isUploading && <FiUpload className="h-4 w-4" aria-hidden="true" />}
          {t('admin.booking.bookingManagement.actions.replaceSlip')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleReplaceSlip}
          className="hidden"
        />
        <Button type="button" variant="ghost" className="w-full" onClick={() => onEdit(booking)}>
          <FiEdit className="h-4 w-4" aria-hidden="true" />
          {t('admin.booking.bookingManagement.actions.edit')}
        </Button>
      </div>

      {/* Audit Summary */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-caption font-semibold text-ink">
            {t('admin.booking.bookingManagement.slipViewer.auditSummary')}
          </h4>
          {booking.auditHistory && booking.auditHistory.length > 0 && (
            <button
              onClick={() => setShowAuditModal(true)}
              className="text-fine text-brand-600 hover:text-brand-800"
            >
              {t('admin.booking.bookingManagement.slipViewer.viewFullHistory')}
            </button>
          )}
        </div>
        {recentAudit.length > 0 ? (
          <div className="space-y-2">
            {recentAudit.map((entry) => (
              <div key={entry.id} className="border-l-2 border-hairline pl-2 text-fine">
                <p className="font-semibold text-ink">{formatAuditAction(entry.action)}</p>
                <p className="text-ink-muted">
                  {entry.adminName} - {formatDateTimeToEuropean(entry.createdAt)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-fine text-ink-muted">
            {t('admin.booking.bookingManagement.slipViewer.noAuditHistory')}
          </p>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && fullscreenSlipUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink"
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
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
          >
            <FiX className="h-6 w-6" aria-hidden="true" />
          </button>
          <img
            src={fullscreenSlipUrl}
            alt={t('admin.booking.bookingManagement.slipViewer.slipImage')}
            className="max-h-full max-w-full object-contain p-4"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-card border border-hairline bg-surface-card p-6">
            <h3 className="mb-4 text-body font-semibold text-ink">
              {t('admin.booking.bookingManagement.modals.needsAction.title')}
            </h3>
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder={t('admin.booking.bookingManagement.modals.needsAction.placeholder')}
              className="h-32 w-full resize-none rounded-lg border border-hairline-strong bg-surface-card p-3 text-body text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <div className="mt-4 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowNotesModal(false);
                  setNotesInput('');
                  setActiveSlipId(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                className="bg-warning-600 hover:bg-warning-700"
                onClick={handleNotesSubmit}
                disabled={!notesInput.trim()}
                loading={markSlipNeedsActionMutation.isPending}
              >
                {t('admin.booking.bookingManagement.modals.needsAction.submit')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-card border border-hairline bg-surface-card">
            <div className="flex items-center justify-between border-b border-hairline p-4">
              <h3 className="flex items-center gap-2 text-body font-semibold text-ink">
                <FiList className="h-5 w-5" aria-hidden="true" />
                {t('admin.booking.bookingManagement.modals.auditHistory.title')}
              </h3>
              <button
                onClick={() => setShowAuditModal(false)}
                className="flex h-11 w-11 items-center justify-center text-ink-faint hover:text-ink-muted"
              >
                <FiX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {booking.auditHistory && booking.auditHistory.length > 0 ? (
                <div className="space-y-4">
                  {booking.auditHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="border-l-4 border-brand-500 py-2 pl-4"
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
                        <div className="mt-2 text-caption">
                          {entry.oldValue && (
                            <p className="text-error-600">
                              <span className="font-semibold">
                                {t('admin.booking.bookingManagement.modals.auditHistory.oldValue')}:
                              </span>{' '}
                              {entry.oldValue}
                            </p>
                          )}
                          {entry.newValue && (
                            <p className="text-success-600">
                              <span className="font-semibold">
                                {t('admin.booking.bookingManagement.modals.auditHistory.newValue')}:
                              </span>{' '}
                              {entry.newValue}
                            </p>
                          )}
                        </div>
                      )}
                      {entry.notes && (
                        <p className="mt-1 text-caption italic text-ink-muted">
                          &quot;{entry.notes}&quot;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-ink-muted">
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
