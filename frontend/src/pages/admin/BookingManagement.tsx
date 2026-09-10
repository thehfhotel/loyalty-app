import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  FiSearch,
  FiCheck,
  FiX,
  FiAlertTriangle,
  FiCalendar,
  FiClock,
  FiRefreshCw,
  FiChevronUp,
  FiChevronDown,
  FiLink
} from 'react-icons/fi';
import AppShell from '../../components/layout/AppShell';
import { Badge, Button, EmptyState, Input, Table, TabNav } from '../../components/ui';
import type { BadgeTone, TableColumn, TabItem } from '../../components/ui';
import SlipViewerSidebar from '../../components/admin/SlipViewerSidebar';
import BookingEditModal from './BookingEditModal';
import DepositLinkModal from './DepositLinkModal';
import DepositLinkListPanel from './DepositLinkListPanel';
import { formatDateToDDMMYYYY, formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminBookingSSE } from '../../hooks/useAdminBookingSSE';
import { deskSlipOkStatus, type SlipOkStatusValue } from '../../types/slipok';
import { adminBookingService } from '../../services/adminBookingService';
import type {
  AdminBooking as Booking,
  AdminBookingStatusCounts as StatusCounts,
} from '../../services/adminBookingService';

// Booking shapes come from the admin booking service, which mirrors the
// serde DTOs in `backend-rust/src/routes/admin_bookings.rs`. Keeping one
// definition means the table, the slip viewer and the edit modal cannot
// drift apart from each other or from the wire.
type SortField = 'created_at' | 'check_in_date' | 'room_type' | 'status' | 'total_price' | 'user_name';
type SortDirection = 'asc' | 'desc';

// Semantic tone lookups — kept in sync with the guest-facing booking page
// (src/pages/MyBookingsPage.tsx) so the same status reads the same color
// on both sides of a booking's lifecycle.
const BOOKING_STATUS_TONE: Record<string, BadgeTone> = {
  confirmed: 'success',
  cancelled: 'error',
  completed: 'brand',
};

// One tone per locked `slipok_status`, plus the two pre-lock values old rows
// still carry. Desk-facing, so unlike the guest badge these stay distinct.
// Keyed by the locked vocabulary, not `string`, so a status added to
// `SLIPOK_STATUSES` breaks this build instead of showing the desk "Pending"
// for a slip the machine has already rejected.
const SLIP_OK_STATUS_TONE: Record<SlipOkStatusValue, BadgeTone> = {
  verified: 'success',
  pending: 'warning',
  shadow_pass: 'info',
  manual: 'warning',
  unavailable: 'neutral',
  failed: 'error',
  quota_exceeded: 'warning',
};

const ADMIN_STATUS_TONE: Record<string, BadgeTone> = {
  verified: 'success',
  needs_action: 'error',
  pending: 'warning',
};

const ROW_ACTION_BUTTON_CLASSES =
  'flex h-11 w-11 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40';

const BookingManagement: React.FC = () => {
  const { t } = useTranslation();

  // State management
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [totalBookings, setTotalBookings] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({ all: 0, confirmed: 0, cancelled: 0, completed: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'confirmed' | 'cancelled' | 'completed' | ''>('');
  // B1: reception issues a deposit link for a booking it already took by
  // phone, LINE or at the desk. The booking it creates lands in the table on
  // this page because it carries a room type, so the slip is verified from
  // the screen reception already uses. The link's own lifecycle — expiry,
  // revoke, reissue — lives on the "ลิงก์มัดจำ" tab below.
  const [showDepositLinkModal, setShowDepositLinkModal] = useState(false);
  // B2: the same page, two surfaces. Bookings is where a slip is verified;
  // "ลิงก์มัดจำ" is where reception asks which links are still unpaid, which
  // guest never opened theirs, and which one needs killing. They are one
  // page because they are one job — the desk moves between them mid-call.
  const [surface, setSurface] = useState<'bookings' | 'links'>('bookings');

  const pageSize = 10;
  const totalPages = Math.ceil(totalBookings / pageSize);

  // `GET /api/admin/bookings` — the page's filters, sort and pagination go
  // to the handler verbatim; the query key mirrors them so a filter change
  // is a new cache entry rather than a refetch of the same one.
  const listParams = {
    page: currentPage,
    limit: pageSize,
    search: debouncedSearchTerm || undefined,
    status: statusFilter || undefined,
    sortBy: sortField,
    sortOrder: sortDirection,
  } as const;

  const bookingsQuery = useQuery({
    queryKey: ['admin', 'bookings', listParams],
    queryFn: () => adminBookingService.listBookings(listParams),
  });

  // Real-time updates via SSE - refetch when slip is uploaded
  useAdminBookingSSE(() => {
    bookingsQuery.refetch();
  });

  // Update state when query data changes
  useEffect(() => {
    if (bookingsQuery.data) {
      setBookings(bookingsQuery.data.bookings);
      setTotalBookings(bookingsQuery.data.total);
      // Set statusCounts from API response, with fallback to default values
      const apiStatusCounts: StatusCounts | undefined = bookingsQuery.data.statusCounts;
      if (apiStatusCounts) {
        setStatusCounts(apiStatusCounts);
      }
      setInitialLoading(false);
      setIsSearching(false);
    }
  }, [bookingsQuery.data]);

  // Handle query error
  useEffect(() => {
    if (bookingsQuery.error) {
      toast.error(t('admin.booking.bookingManagement.errors.loadFailed'));
      setInitialLoading(false);
      setIsSearching(false);
    }
  }, [bookingsQuery.error, t]);

  // `GET /api/admin/bookings/:id` — the list projection carries no audit
  // rows, so the slip viewer and the edit modal read the selected booking's
  // history from the detail route instead of an N+1 on every row.
  const selectedBookingId = selectedBooking?.id ?? null;
  const bookingDetailQuery = useQuery({
    queryKey: ['admin', 'booking', selectedBookingId],
    queryFn: () => adminBookingService.getBooking(selectedBookingId as string),
    enabled: selectedBookingId !== null,
  });

  // Detail wins where it has more to say (audit history, a freshly verified
  // slip); the row keeps the page rendering while the read is in flight.
  const selectedBookingDetail = React.useMemo(() => {
    if (!selectedBooking) {return null;}
    const detail = bookingDetailQuery.data;
    if (detail?.id !== selectedBooking.id) {return selectedBooking;}
    return detail;
  }, [selectedBooking, bookingDetailQuery.data]);

  const queryClient = useQueryClient();

  const refreshBooking = useCallback(() => {
    bookingsQuery.refetch();
    if (selectedBookingId) {bookingDetailQuery.refetch();}
    // refetch identities are stable per query instance; listing the queries
    // themselves would re-create this callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookingId]);

  // `POST /api/admin/bookings/slips/:slipId/verify`. The row action verifies
  // the booking's primary slip, whose id the list response already carries —
  // the booking-scoped `/:id/verify-slip` route is still missing
  // (docs/admin-backend-gaps.md), and the button is disabled without a slip,
  // so the desk never reaches for it.
  const verifySlipMutation = useMutation({
    mutationFn: (data: { slipId: string }) => adminBookingService.verifySlip(data.slipId),
    onSuccess: (slip) => {
      // The sidebar renders the per-slip read on top of the list row, and
      // `refreshBooking` never touches that key (staleTime is 5 min and
      // refetchOnWindowFocus is off). Without this seed a verify done from
      // the table leaves the open sidebar showing "Pending" beside a
      // "Verified" badge — two verdicts for one slip.
      queryClient.setQueryData(['admin', 'slip', slip.id], slip);
      toast.success(t('admin.booking.bookingManagement.messages.slipVerified'));
      refreshBooking();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.verifyFailed'));
    }
  });

  // `POST /api/admin/bookings/slips/:slipId/needs-action`.
  const markNeedsActionMutation = useMutation({
    mutationFn: (data: { slipId: string; notes: string }) =>
      adminBookingService.markSlipNeedsAction(data.slipId, { notes: data.notes }),
    onSuccess: (slip) => {
      queryClient.setQueryData(['admin', 'slip', slip.id], slip);
      toast.success(t('admin.booking.bookingManagement.messages.markedNeedsAction'));
      refreshBooking();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.markFailed'));
    }
  });

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      if (searchTerm !== debouncedSearchTerm) {
        setIsSearching(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, debouncedSearchTerm]);

  // Reset to page 1 when search term changes
  useEffect(() => {
    if (!initialLoading && debouncedSearchTerm !== '') {
      setCurrentPage(1);
    }
  }, [debouncedSearchTerm, initialLoading]);

  // Reset to page 1 when status filter changes
  useEffect(() => {
    if (!initialLoading) {
      setCurrentPage(1);
    }
  }, [statusFilter, initialLoading]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    // Search is automatic via debounce
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // The per-slip routes need a slip id. Resolve it from the row (or from the
  // detail read, when the sidebar acts on the selected booking). A booking
  // with no slip has nothing to verify: the booking-scoped fallback route
  // does not exist yet, so the controls for that case stay disabled.
  const primarySlipId = (bookingId: string): string | null => {
    if (selectedBookingDetail?.id === bookingId && selectedBookingDetail.slip) {
      return selectedBookingDetail.slip.id;
    }
    return bookings.find(b => b.id === bookingId)?.slip?.id ?? null;
  };

  const handleVerifySlip = async (bookingId: string) => {
    const slipId = primarySlipId(bookingId);
    if (!slipId) {
      // Not a migration — this booking simply has no slip to act on.
      toast.error(t('admin.booking.bookingManagement.noSlip'));
      return;
    }
    await verifySlipMutation.mutateAsync({ slipId });
  };

  const handleNeedsAction = async (bookingId: string, notes: string) => {
    const slipId = primarySlipId(bookingId);
    if (!slipId) {
      toast.error(t('admin.booking.bookingManagement.noSlip'));
      return;
    }
    await markNeedsActionMutation.mutateAsync({ slipId, notes });
  };

  const handleEditBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    setShowEditModal(true);
  };

  const handleEditModalClose = () => {
    setShowEditModal(false);
  };

  const handleEditSave = () => {
    refreshBooking();
    setShowEditModal(false);
  };

  // Status badge components
  const BookingStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const icons: Record<string, React.ReactNode> = {
      confirmed: <FiCheck className="h-3 w-3" aria-hidden="true" />,
      cancelled: <FiX className="h-3 w-3" aria-hidden="true" />,
      completed: <FiCheck className="h-3 w-3" aria-hidden="true" />,
    };
    const labels: Record<string, string> = {
      confirmed: t('booking.status.confirmed'),
      cancelled: t('booking.status.cancelled'),
      completed: t('booking.status.completed'),
    };

    return (
      <Badge tone={BOOKING_STATUS_TONE[status] ?? 'success'}>
        {icons[status] ?? icons.confirmed}
        {labels[status] ?? labels.confirmed}
      </Badge>
    );
  };

  const SlipOkStatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
    const icons: Record<SlipOkStatusValue, React.ReactNode> = {
      verified: <FiCheck className="h-3 w-3" aria-hidden="true" />,
      pending: <FiClock className="h-3 w-3" aria-hidden="true" />,
      shadow_pass: <FiCheck className="h-3 w-3" aria-hidden="true" />,
      manual: <FiAlertTriangle className="h-3 w-3" aria-hidden="true" />,
      unavailable: <FiAlertTriangle className="h-3 w-3" aria-hidden="true" />,
      failed: <FiAlertTriangle className="h-3 w-3" aria-hidden="true" />,
      quota_exceeded: <FiAlertTriangle className="h-3 w-3" aria-hidden="true" />,
    };
    const labels: Record<SlipOkStatusValue, string> = {
      verified: t('admin.booking.bookingManagement.slipStatus.verified'),
      pending: t('admin.booking.bookingManagement.slipStatus.pending'),
      shadow_pass: t('admin.booking.bookingManagement.slipStatus.shadowPass'),
      manual: t('admin.booking.bookingManagement.slipStatus.manual'),
      unavailable: t('admin.booking.bookingManagement.slipStatus.unavailable'),
      failed: t('admin.booking.bookingManagement.slipStatus.failed'),
      quota_exceeded: t('admin.booking.bookingManagement.slipStatus.quotaExceeded'),
    };

    // A status this bundle predates still renders — as "pending" — rather
    // than as a blank badge.
    const known = deskSlipOkStatus(status);

    return (
      <Badge tone={SLIP_OK_STATUS_TONE[known]}>
        {icons[known]}
        {labels[known]}
      </Badge>
    );
  };

  const AdminStatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
    const icons: Record<string, React.ReactNode> = {
      verified: <FiCheck className="h-3 w-3" aria-hidden="true" />,
      needs_action: <FiAlertTriangle className="h-3 w-3" aria-hidden="true" />,
      pending: <FiClock className="h-3 w-3" aria-hidden="true" />,
    };
    const labels: Record<string, string> = {
      verified: t('admin.booking.bookingManagement.adminStatus.verified'),
      needs_action: t('admin.booking.bookingManagement.adminStatus.needsAction'),
      pending: t('admin.booking.bookingManagement.adminStatus.pending'),
    };

    // A NULL `admin_status` on a legacy row reads as "pending", the same
    // way an unknown value does.
    const known = status ?? 'pending';

    return (
      <Badge tone={ADMIN_STATUS_TONE[known] ?? 'warning'}>
        {icons[known] ?? icons.pending}
        {labels[known] ?? labels.pending}
      </Badge>
    );
  };

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) {return null;}
    return sortDirection === 'asc' ? (
      <FiChevronUp className="h-4 w-4" aria-hidden="true" />
    ) : (
      <FiChevronDown className="h-4 w-4" aria-hidden="true" />
    );
  };

  const SortableHeader: React.FC<{ field: SortField; label: string }> = ({ field, label }) => (
    <button
      type="button"
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-ink"
    >
      {label}
      <SortIcon field={field} />
    </button>
  );

  const guestDisplayName = (booking: Booking) =>
    booking.user.firstName && booking.user.lastName
      ? `${booking.user.firstName} ${booking.user.lastName}`
      : booking.user.email;

  const rowActionButtons = (booking: Booking) => (
    <div className="flex gap-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (booking.slip) {handleVerifySlip(booking.id);}
        }}
        disabled={!booking.slip || verifySlipMutation.isPending}
        className={`${ROW_ACTION_BUTTON_CLASSES} text-success-600 hover:bg-success-50`}
        title={t('admin.booking.bookingManagement.actions.verify')}
      >
        <FiCheck className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (booking.slip) {
            const notes = prompt(t('admin.booking.bookingManagement.actions.enterNotes'));
            if (notes) {handleNeedsAction(booking.id, notes);}
          }
        }}
        disabled={!booking.slip || markNeedsActionMutation.isPending}
        className={`${ROW_ACTION_BUTTON_CLASSES} text-warning-600 hover:bg-warning-50`}
        title={t('admin.booking.bookingManagement.actions.needsAction')}
      >
        <FiAlertTriangle className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleEditBooking(booking);
        }}
        className={`${ROW_ACTION_BUTTON_CLASSES} text-brand-600 hover:bg-brand-50`}
        title={t('admin.booking.bookingManagement.actions.edit')}
      >
        <FiCalendar className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  const columns: TableColumn<Booking>[] = [
    {
      key: 'created',
      header: <SortableHeader field="created_at" label={t('admin.booking.bookingManagement.table.created')} />,
      cell: (booking) => formatDateTimeToEuropean(booking.createdAt),
    },
    {
      key: 'user',
      header: <SortableHeader field="user_name" label={t('admin.booking.bookingManagement.table.user')} />,
      cell: (booking) => (
        <div>
          <p className="text-body font-semibold text-ink">{guestDisplayName(booking)}</p>
          <p className="font-mono text-fine text-ink-muted">{booking.user.membershipId ?? '-'}</p>
        </div>
      ),
    },
    {
      key: 'roomType',
      header: <SortableHeader field="room_type" label={t('admin.booking.bookingManagement.table.roomType')} />,
      cell: (booking) => booking.roomType.name,
    },
    {
      key: 'dates',
      header: <SortableHeader field="check_in_date" label={t('admin.booking.bookingManagement.table.dates')} />,
      cell: (booking) => (
        <div>
          <div>{formatDateToDDMMYYYY(booking.checkInDate)}</div>
          <div className="text-ink-muted">- {formatDateToDDMMYYYY(booking.checkOutDate)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: <SortableHeader field="status" label={t('admin.booking.bookingManagement.table.status')} />,
      cell: (booking) => <BookingStatusBadge status={booking.status} />,
    },
    {
      key: 'payment',
      header: <SortableHeader field="total_price" label={t('admin.booking.bookingManagement.table.payment')} />,
      cell: (booking) => (
        <div>
          <p>
            {booking.paymentType === 'full'
              ? t('admin.booking.bookingManagement.paymentType.full')
              : t('admin.booking.bookingManagement.paymentType.deposit')}
          </p>
          <p className="font-semibold text-ink">
            {booking.paymentAmount !== null ? `${Number(booking.paymentAmount).toLocaleString()} THB` : '-'}
          </p>
        </div>
      ),
    },
    {
      key: 'slipStatus',
      header: t('admin.booking.bookingManagement.table.slipStatus'),
      cell: (booking) =>
        booking.slip ? (
          <SlipOkStatusBadge status={booking.slip.slipokStatus} />
        ) : (
          <span className="text-fine text-ink-faint">{t('admin.booking.bookingManagement.noSlip')}</span>
        ),
      hideOnMobile: true,
    },
    {
      key: 'adminStatus',
      header: t('admin.booking.bookingManagement.table.adminStatus'),
      cell: (booking) => (booking.slip ? <AdminStatusBadge status={booking.slip.adminStatus} /> : '-'),
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: t('admin.booking.bookingManagement.table.actions'),
      cell: rowActionButtons,
    },
  ];

  const statusTabItems: TabItem[] = [
    { value: '', label: t('admin.booking.bookingManagement.allStatuses'), count: statusCounts.all },
    { value: 'confirmed', label: t('booking.status.confirmed'), count: statusCounts.confirmed },
    { value: 'cancelled', label: t('booking.status.cancelled'), count: statusCounts.cancelled },
    { value: 'completed', label: t('booking.status.completed'), count: statusCounts.completed },
  ];

  // The two surfaces of this page. Not a route each: reception switches
  // between them mid-phone-call, and a route change would drop the search
  // term, the open sidebar and the slip they were part-way through reading.
  const surfaceTabItems: TabItem[] = [
    { value: 'bookings', label: t('admin.booking.bookingManagement.surfaceBookings') },
    { value: 'links', label: t('depositLink.admin.list.tab') },
  ];

  // The bookings surface, still skeleton-first: `initialLoading` covers the
  // first list read only, so switching to the links tab never waits on it.
  const bookingsSurface = initialLoading ? (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-64 rounded-lg bg-surface-sunken" />
      <div className="h-12 rounded-lg bg-surface-sunken" />
      <div className="space-y-4 rounded-card border border-hairline bg-surface-card p-6">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-16 rounded-lg bg-surface-sunken" />
        ))}
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: Table Section */}
        <div className="min-w-0 lg:w-[70%]">
          {/* Status Tabs */}
          <TabNav
            aria-label={t('admin.booking.bookingManagement.title')}
            items={statusTabItems}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as typeof statusFilter)}
            className="mb-6"
          />

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="mb-6">
            <Input
              type="text"
              placeholder={t('admin.booking.bookingManagement.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leadingIcon={<FiSearch aria-hidden="true" />}
              trailingSlot={
                isSearching ? (
                  <span className="pr-3">
                    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                  </span>
                ) : undefined
              }
            />
            <p className="mt-2 text-fine text-ink-muted">
              {t('admin.booking.bookingManagement.searchHint')}
            </p>
          </form>

          {/* Bookings Table */}
          <div className="relative">
            {isSearching && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-surface-card/60 backdrop-blur-sm">
                <span className="block h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
              </div>
            )}
            <Table<Booking>
              aria-label={t('admin.booking.bookingManagement.title')}
              columns={columns}
              rows={bookings}
              rowKey={(booking) => booking.id}
              onRowClick={handleEditBooking}
              empty={<EmptyState title={t('admin.booking.bookingManagement.noBookings')} />}
              mobileCard={(booking) => (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-body font-semibold text-ink">{guestDisplayName(booking)}</p>
                      <p className="text-caption text-ink-muted">
                        {formatDateToDDMMYYYY(booking.checkInDate)} - {formatDateToDDMMYYYY(booking.checkOutDate)}
                      </p>
                    </div>
                    <BookingStatusBadge status={booking.status} />
                  </div>
                  <div className="flex items-center justify-between text-caption text-ink-muted">
                    <span>{booking.roomType.name}</span>
                    <span>{formatDateTimeToEuropean(booking.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {booking.slip ? (
                      <>
                        <SlipOkStatusBadge status={booking.slip.slipokStatus} />
                        <AdminStatusBadge status={booking.slip.adminStatus} />
                      </>
                    ) : (
                      <span className="text-fine text-ink-faint">{t('admin.booking.bookingManagement.noSlip')}</span>
                    )}
                    <span className="ml-auto text-caption font-semibold text-ink">
                      {booking.paymentAmount !== null ? `${Number(booking.paymentAmount).toLocaleString()} THB` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-end gap-1 pt-1">{rowActionButtons(booking)}</div>
                </div>
              )}
            />
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <div className="text-caption text-ink-muted">
                {t('admin.booking.bookingManagement.pagination', {
                  current: currentPage,
                  total: totalPages
                })}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  {t('common.previous')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Slip Viewer Sidebar */}
        <div className="min-w-0 lg:w-[30%]">
          <SlipViewerSidebar
            booking={selectedBookingDetail}
            onVerify={handleVerifySlip}
            onNeedsAction={handleNeedsAction}
            onEdit={handleEditBooking}
            onRefresh={refreshBooking}
          />
        </div>
    </div>
  );

  return (
    <AppShell variant="admin" title={t('admin.booking.bookingManagement.title')}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <p className="text-caption text-ink-muted">{t('admin.booking.bookingManagement.subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => setShowDepositLinkModal(true)}
            data-testid="open-deposit-link-modal"
          >
            <FiLink className="h-4 w-4" aria-hidden="true" />
            {t('depositLink.admin.open')}
          </Button>
          {/* Refreshes the bookings list, so it belongs to that surface only —
              the links panel carries its own refresh next to its own filter. */}
          {surface === 'bookings' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => bookingsQuery.refetch()}
              disabled={bookingsQuery.isRefetching}
            >
              <FiRefreshCw className={`h-4 w-4 ${bookingsQuery.isRefetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('common.refresh')}
            </Button>
          )}
        </div>
      </div>

      <TabNav
        aria-label={t('admin.booking.bookingManagement.title')}
        items={surfaceTabItems}
        value={surface}
        onChange={(value) => setSurface(value === 'links' ? 'links' : 'bookings')}
        className="mb-6"
      />

      {surface === 'links' ? <DepositLinkListPanel /> : bookingsSurface}

      <DepositLinkModal
        open={showDepositLinkModal}
        onClose={() => setShowDepositLinkModal(false)}
      />

      {/* Edit Modal */}
      {showEditModal && selectedBookingDetail && (
        <BookingEditModal
          booking={selectedBookingDetail}
          isOpen={showEditModal}
          onClose={handleEditModalClose}
          onSave={handleEditSave}
        />
      )}
    </AppShell>
  );
};

export default React.memo(BookingManagement);
