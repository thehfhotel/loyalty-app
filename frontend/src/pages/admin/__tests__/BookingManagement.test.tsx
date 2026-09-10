import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The page talks to the backend only through this service, so mocking it is
// the whole seam: nothing here touches axios or a real URL.
const {
  mockListBookings,
  mockGetBooking,
  mockGetSlip,
  mockVerifySlip,
  mockMarkSlipNeedsAction,
} = vi.hoisted(() => ({
  mockListBookings: vi.fn(),
  mockGetBooking: vi.fn(),
  mockGetSlip: vi.fn(),
  mockVerifySlip: vi.fn(),
  mockMarkSlipNeedsAction: vi.fn(),
}));

const { mockListLinks } = vi.hoisted(() => ({ mockListLinks: vi.fn() }));

// The links surface talks to the backend only through this service. Without
// the mock, clicking its tab reaches for axios.
vi.mock('../../../services/depositLinkService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../services/depositLinkService')>();
  return {
    ...actual,
    depositLinkService: {
      ...actual.depositLinkService,
      listLinks: mockListLinks,
    },
  };
});

vi.mock('../../../services/adminBookingService', () => ({
  adminBookingService: {
    listBookings: mockListBookings,
    getBooking: mockGetBooking,
    getSlip: mockGetSlip,
    verifySlip: mockVerifySlip,
    markSlipNeedsAction: mockMarkSlipNeedsAction,
  },
}));

const SLIP = {
  id: 'slip-1',
  imageUrl: 'https://example.test/slip-1.png',
  uploadedAt: '2027-06-01T10:00:00Z',
  slipokStatus: 'manual' as const,
  slipokVerifiedAt: null,
  adminStatus: 'pending' as const,
  adminVerifiedAt: null,
  adminVerifiedBy: null,
  adminVerifiedByName: null,
};

const BOOKING = {
  id: 'booking-1',
  userId: 'user-1',
  user: {
    id: 'user-1',
    firstName: 'Somchai',
    lastName: 'Sooksan',
    email: 'somchai@example.test',
    membershipId: 'M-001',
    phone: null,
  },
  roomTypeId: 'rt-1',
  roomType: { id: 'rt-1', name: 'Deluxe Room' },
  checkInDate: '2027-06-15',
  checkOutDate: '2027-06-18',
  numberOfGuests: 2,
  totalPrice: 4500,
  paymentType: 'deposit' as const,
  paymentAmount: 2250,
  discountAmount: null,
  discountReason: null,
  status: 'confirmed' as const,
  notes: null,
  adminNotes: null,
  slip: SLIP,
  createdAt: '2027-06-01T09:00:00Z',
  updatedAt: '2027-06-01T09:00:00Z',
};

const EMPTY_LIST = {
  bookings: [],
  total: 0,
  page: 1,
  limit: 10,
  statusCounts: { all: 0, confirmed: 0, cancelled: 0, completed: 0 },
};

const ONE_BOOKING_LIST = {
  bookings: [BOOKING],
  total: 1,
  page: 1,
  limit: 10,
  statusCounts: { all: 1, confirmed: 1, cancelled: 0, completed: 0 },
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// Mock toast
const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'admin.booking.bookingManagement.title': 'Booking Management',
        'admin.booking.bookingManagement.subtitle': 'Manage all bookings',
        'admin.booking.bookingManagement.searchPlaceholder': 'Search bookings...',
        'admin.booking.bookingManagement.searchHint': 'Search by name, email, or membership ID',
        'admin.booking.bookingManagement.table.created': 'Created',
        'admin.booking.bookingManagement.table.user': 'User',
        'admin.booking.bookingManagement.table.roomType': 'Room Type',
        'admin.booking.bookingManagement.table.dates': 'Dates',
        'admin.booking.bookingManagement.table.payment': 'Payment',
        'admin.booking.bookingManagement.table.slipStatus': 'Slip Status',
        'admin.booking.bookingManagement.table.adminStatus': 'Admin Status',
        'admin.booking.bookingManagement.table.status': 'Status',
        'admin.booking.bookingManagement.table.actions': 'Actions',
        'admin.booking.bookingManagement.noBookings': 'No bookings found',
        'admin.booking.bookingManagement.allStatuses': 'All',
        'booking.status.confirmed': 'Confirmed',
        'booking.status.cancelled': 'Cancelled',
        'booking.status.completed': 'Completed',
        'admin.booking.bookingManagement.actions.verify': 'Verify',
        'admin.booking.bookingManagement.actions.needsAction': 'Needs Action',
        'admin.booking.bookingManagement.actions.edit': 'Edit Booking',
        'admin.booking.bookingManagement.actions.enterNotes': 'Enter notes for this action:',
        'admin.booking.bookingManagement.messages.slipVerified': 'Slip verified successfully',
        'admin.booking.bookingManagement.messages.markedNeedsAction': 'Marked as needs action',
        'admin.booking.bookingManagement.noSlip': 'No slip',
        'common.refresh': 'Refresh',
        'common.previous': 'Previous',
        'common.next': 'Next',
        'admin.booking.bookingManagement.surfaceBookings': 'Bookings',
        'depositLink.admin.list.tab': 'Deposit links',
      };
      return translations[key] ?? key;
    },
    // The links panel formats its relative times against the active
    // language, so the stub has to carry one.
    i18n: { language: 'th' },
  }),
}));

// Mock AppShell (admin chrome renders DashboardButton/nav internally and needs a Router)
vi.mock('../../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

// Mock SlipViewerSidebar. It forwards `onVerify` so the page's
// "this booking has no slip" guard — unreachable through the row button,
// which is disabled and guarded again in its onClick — stays testable.
vi.mock('../../../components/admin/SlipViewerSidebar', () => ({
  default: ({
    booking,
    onVerify,
  }: {
    booking: { id: string } | null;
    onVerify: (bookingId: string) => void;
  }) => (
    <div data-testid="slip-viewer-sidebar">
      Slip Viewer
      {/* Uncontrolled on purpose: its value lives in the DOM node, so it
          survives a re-render and dies with an unmount — exactly the
          half-typed verification note the tab strip must not throw away. */}
      <input data-testid="sidebar-note" defaultValue="" />
      {booking && (
        <button type="button" onClick={() => onVerify(booking.id)}>
          sidebar-verify
        </button>
      )}
    </div>
  ),
}));

// Mock BookingEditModal
vi.mock('../BookingEditModal', () => ({
  default: () => <div data-testid="booking-edit-modal">Edit Modal</div>,
}));

// Mock useAdminBookingSSE hook
vi.mock('../../../hooks/useAdminBookingSSE', () => ({
  useAdminBookingSSE: vi.fn(),
}));

/** First match, or a failure that names what was missing — the Table
 *  primitive renders every row twice (desktop + mobile card), so these
 *  queries are legitimately plural. */
function first(elements: HTMLElement[], what: string): HTMLElement {
  const element = elements[0];
  if (!element) {
    throw new Error(`expected at least one ${what}`);
  }
  return element;
}

// Import component after mocks
import BookingManagement from '../BookingManagement';

describe('BookingManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBookings.mockResolvedValue(EMPTY_LIST);
    mockListLinks.mockResolvedValue({ links: [], total: 0 });
    mockGetBooking.mockResolvedValue({ ...BOOKING, auditHistory: [] });
    mockVerifySlip.mockResolvedValue({ id: SLIP.id, adminStatus: 'verified' });
    // `getSlip` is not reached from this file (SlipViewerSidebar is mocked
    // out below), but the service mock is the page's whole seam — leaving a
    // method off it turns any future call into a swallowed query error
    // rather than a failing test.
    mockMarkSlipNeedsAction.mockResolvedValue({ id: SLIP.id, adminStatus: 'needs_action' });
    mockGetSlip.mockResolvedValue({
      id: SLIP.id,
      bookingId: BOOKING.id,
      slipUrl: SLIP.imageUrl,
      uploadedAt: SLIP.uploadedAt,
      adminStatus: 'pending',
      adminVerifiedAt: null,
      adminVerifiedBy: null,
      adminNotes: null,
      slipokStatus: SLIP.slipokStatus,
      slipokReason: null,
      slipokTransRef: null,
      slipokCheckedAt: null,
      slipokVerifiedAt: null,
      autoVerified: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('The two surfaces', () => {
    it('shows the deposit-link panel on its tab, and hides the bookings table', async () => {
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      await screen.findByPlaceholderText('Search bookings...');

      await user.click(screen.getByRole('tab', { name: 'Deposit links' }));

      expect(await screen.findByTestId('deposit-link-list-panel')).toBeInTheDocument();
      // Hidden, not unmounted — but out of the accessibility tree, so the
      // desk cannot tab into a surface it is not looking at.
      expect(
        screen.queryByRole('table', { name: 'Booking Management' }),
      ).not.toBeInTheDocument();
      expect(mockListLinks).toHaveBeenCalled();
    });

    it('keeps the slip sidebar mounted across a tab switch', async () => {
      const user = userEvent.setup();
      mockListBookings.mockResolvedValue(ONE_BOOKING_LIST);
      render(<BookingManagement />, { wrapper });

      const note = await screen.findByTestId('sidebar-note');
      await user.type(note, 'Transfer is 500 short');

      await user.click(screen.getByRole('tab', { name: 'Deposit links' }));
      await screen.findByTestId('deposit-link-list-panel');
      await user.click(screen.getByRole('tab', { name: 'Bookings' }));

      // Reception flipped to the links tab mid-phone-call to check whether
      // the guest ever opened their link. The note they were part-way
      // through typing is still there.
      expect(screen.getByTestId('sidebar-note')).toHaveValue('Transfer is 500 short');
    });
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<BookingManagement />, { wrapper });

      // Wait for initial loading to complete (the stub query resolves immediately)
      await waitFor(() => {
        expect(screen.getByText('Booking Management')).toBeInTheDocument();
      });
    });

    it('should render without crashing', async () => {
      const { container } = render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    });

    it('should render search input', async () => {
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search bookings...')).toBeInTheDocument();
      });
    });

    it('should render table headers', async () => {
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Created')).toBeInTheDocument();
        expect(screen.getByText('User')).toBeInTheDocument();
        expect(screen.getByText('Room Type')).toBeInTheDocument();
        expect(screen.getByText('Payment')).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('renders no bookings message when the list comes back empty', async () => {
      render(<BookingManagement />, { wrapper });

      // The Table primitive renders the empty node in both the desktop and
      // mobile layouts, so it appears twice in the DOM.
      await waitFor(() => {
        expect(screen.getAllByText('No bookings found').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Wired list call', () => {
    it('sends the page filters, sort and pagination to the list endpoint', async () => {
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(mockListBookings).toHaveBeenCalled();
      });

      expect(mockListBookings).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: undefined,
        status: undefined,
        sortBy: 'created_at',
        sortOrder: 'desc',
      });
    });

    it('re-requests with the status filter when a tab is selected', async () => {
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      // Wait past the initial skeleton — the tabs only render once the
      // first list response has landed.
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Cancelled/ })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /Cancelled/ }));

      await waitFor(() => {
        expect(mockListBookings).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'cancelled', page: 1 })
        );
      });
    });

    it('re-requests with the opposite sort order when a header is toggled', async () => {
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByText('Created').length).toBeGreaterThan(0);
      });

      await user.click(first(screen.getAllByText('Created'), 'Created header'));

      await waitFor(() => {
        expect(mockListBookings).toHaveBeenCalledWith(
          expect.objectContaining({ sortBy: 'created_at', sortOrder: 'asc' })
        );
      });
    });

    it('renders a booking row from the list response', async () => {
      mockListBookings.mockResolvedValue(ONE_BOOKING_LIST);
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText('Deluxe Room').length).toBeGreaterThan(0);
    });
  });

  describe('Wired slip actions', () => {
    it('verifies the row\'s primary slip through the per-slip endpoint', async () => {
      mockListBookings.mockResolvedValue(ONE_BOOKING_LIST);
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByTitle('Verify').length).toBeGreaterThan(0);
      });

      await user.click(first(screen.getAllByTitle('Verify'), 'Verify button'));

      // The booking-scoped verify route does not exist; the desk reaches the
      // same outcome through the slip id the list row already carries.
      await waitFor(() => {
        expect(mockVerifySlip).toHaveBeenCalledWith('slip-1');
      });
      // A successful verify refetches the list so the badge updates.
      await waitFor(() => {
        expect(mockListBookings.mock.calls.length).toBeGreaterThan(1);
      });
    });

    it('seeds the per-slip cache the open sidebar reads, so one verify has one verdict', async () => {
      mockListBookings.mockResolvedValue(ONE_BOOKING_LIST);
      // A client this test holds, so the seeded entry can be read back. The
      // shared `wrapper` builds a fresh one per render and hands it to
      // nobody.
      const queryClient = createTestQueryClient();
      const user = userEvent.setup();
      render(
        <QueryClientProvider client={queryClient}>
          <BookingManagement />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getAllByTitle('Verify').length).toBeGreaterThan(0);
      });

      await user.click(first(screen.getAllByTitle('Verify'), 'Verify button'));

      // The sidebar renders `['admin','slip',id]` on top of the list row and
      // `refreshBooking()` never touches that key (staleTime is 5 min,
      // refetchOnWindowFocus is off). Without the seed a verify from the
      // table leaves the open sidebar showing "Pending" beside the row's
      // fresh "Verified" badge.
      await waitFor(() => {
        expect(queryClient.getQueryData(['admin', 'slip', 'slip-1'])).toEqual(
          expect.objectContaining({ id: 'slip-1', adminStatus: 'verified' })
        );
      });
    });

    it('tells the desk the booking has no slip, not that anything is migrating', async () => {
      const slipless = { ...BOOKING, slip: null };
      mockListBookings.mockResolvedValue({ ...ONE_BOOKING_LIST, bookings: [slipless] });
      mockGetBooking.mockResolvedValue({ ...slipless, auditHistory: [] });
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0);
      });

      // Select the booking so the sidebar has one, then take its verify
      // action — the guard's only reachable caller.
      await user.click(first(screen.getAllByText('Somchai Sooksan'), 'booking row'));
      await user.click(await screen.findByRole('button', { name: 'sidebar-verify' }));

      // Nothing is migrating: this booking simply has no slip.
      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('No slip');
      });
      expect(mockToastError).not.toHaveBeenCalledWith(
        'This action is being migrated to the new backend'
      );
      expect(mockVerifySlip).not.toHaveBeenCalled();
    });

    it('marks the row\'s primary slip as needing action with the notes the admin typed', async () => {
      mockListBookings.mockResolvedValue(ONE_BOOKING_LIST);
      vi.spyOn(window, 'prompt').mockReturnValue('Amount is short by 500 THB');
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByTitle('Needs Action').length).toBeGreaterThan(0);
      });

      await user.click(first(screen.getAllByTitle('Needs Action'), 'Needs Action button'));

      await waitFor(() => {
        expect(mockMarkSlipNeedsAction).toHaveBeenCalledWith('slip-1', {
          notes: 'Amount is short by 500 THB',
        });
      });
    });

    it('does not call the endpoint when the admin dismisses the notes prompt', async () => {
      mockListBookings.mockResolvedValue(ONE_BOOKING_LIST);
      vi.spyOn(window, 'prompt').mockReturnValue(null);
      const user = userEvent.setup();
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getAllByTitle('Needs Action').length).toBeGreaterThan(0);
      });

      await user.click(first(screen.getAllByTitle('Needs Action'), 'Needs Action button'));

      expect(mockMarkSlipNeedsAction).not.toHaveBeenCalled();
    });
  });
});
