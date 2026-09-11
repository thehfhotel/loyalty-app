import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The sidebar reaches the backend only through this service.
const { mockGetSlip, mockVerifySlip, mockMarkSlipNeedsAction } = vi.hoisted(() => ({
  mockGetSlip: vi.fn(),
  mockVerifySlip: vi.fn(),
  mockMarkSlipNeedsAction: vi.fn(),
}));

vi.mock('../../../services/adminBookingService', () => ({
  adminBookingService: {
    getSlip: mockGetSlip,
    verifySlip: mockVerifySlip,
    markSlipNeedsAction: mockMarkSlipNeedsAction,
  },
}));

import SlipViewerSidebar from '../SlipViewerSidebar';

// Only the strings this file asserts on; anything else falls through as its
// own key, which is exactly what a missing translation would look like in
// the app — so an assertion on a real word also proves the key exists.
const translations: Record<string, string> = {
  'admin.booking.bookingManagement.slipStatus.verified': 'Verified',
  'admin.booking.bookingManagement.slipStatus.pending': 'Pending',
  'admin.booking.bookingManagement.slipStatus.shadowPass': 'System pass (awaiting admin)',
  'admin.booking.bookingManagement.slipStatus.manual': 'Manual check needed',
  'admin.booking.bookingManagement.slipStatus.unavailable': 'Auto-check unavailable',
  'admin.booking.bookingManagement.adminStatus.verified': 'Verified',
  'admin.booking.bookingManagement.adminStatus.needsAction': 'Needs Action',
  'admin.booking.bookingManagement.adminStatus.pending': 'Pending',
  'admin.booking.bookingManagement.slipViewer.title': 'Slip Viewer',
  'admin.booking.bookingManagement.slipViewer.slipokStatus': 'SlipOK Status',
  'admin.booking.bookingManagement.slipViewer.adminStatus': 'Admin Status',
  'admin.booking.bookingManagement.slipViewer.slipokReason': 'Reason',
  'admin.booking.bookingManagement.slipViewer.slipokCheckedAt': 'Checked',
  'admin.booking.bookingManagement.slipViewer.autoVerifier': 'SlipOK',
  'admin.booking.bookingManagement.slipViewer.uploaded': 'Uploaded',
  'admin.booking.bookingManagement.slipViewer.noAuditHistory': 'No activity history',
  'admin.booking.bookingManagement.slipViewer.auditSummary': 'Recent Activity',
  'admin.booking.bookingManagement.slipViewer.slipImage': 'Payment slip image',
  'admin.booking.bookingManagement.slipViewer.fullscreen': 'View fullscreen',
  'payment.slipErased': 'Erased under the retention policy on {{date}}',
  'payment.slipErasedNote': 'The payment record itself is unchanged.',
  'payment.slipUnavailable': 'No slip image',
  'admin.booking.bookingManagement.by': 'By',
  'admin.booking.bookingManagement.actions.verify': 'Verify',
  'admin.booking.bookingManagement.actions.needsAction': 'Needs Action',
  'admin.booking.bookingManagement.actions.replaceSlip': 'Replace Slip',
  'admin.booking.bookingManagement.actions.edit': 'Edit',
  'payment.slipok.reason.amount_mismatch': 'Transferred amount does not match the booking',
  'payment.slipok.reason.duplicate': 'This slip has already been used',
  'payment.slipok.reason.receiver_mismatch': 'The receiving account does not match',
  'admin.booking.bookingManagement.modals.needsAction.title': 'Mark as needs action',
  'admin.booking.bookingManagement.modals.needsAction.placeholder': 'What does the guest need to fix?',
  'admin.booking.bookingManagement.modals.needsAction.submit': 'Submit',
  'admin.booking.bookingManagement.messages.slipVerified': 'Slip verified successfully',
  'admin.booking.bookingManagement.messages.needsActionMarked': 'Marked as needs action',
  'common.cancel': 'Cancel',
};

/** An `AdminSlipResponse` as `admin_slips.rs` serialises it. */
function slipResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slip-1',
    bookingId: 'booking-1',
    slipUrl: 'https://example.test/slip-1.png',
    uploadedAt: '2027-06-01T10:00:00Z',
    adminStatus: 'pending',
    adminVerifiedAt: null,
    adminVerifiedBy: null,
    adminNotes: null,
    slipokStatus: 'pending',
    slipokReason: null,
    slipokTransRef: null,
    slipokCheckedAt: null,
    slipokVerifiedAt: null,
    autoVerified: false,
    ...overrides,
  };
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (translations[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(opts?.[name] ?? `{{${name}}}`)
      ),
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type SlipOverrides = {
  slipUrl?: string | null;
  deletedAt?: string | null;
  slipokStatus?: string;
  slipokReason?: string | null;
  slipokCheckedAt?: string | null;
  slipokVerifiedAt?: string | null;
  adminStatus?: string;
  adminVerifiedAt?: string | null;
  adminVerifiedByName?: string | null;
  autoVerified?: boolean;
};

function makeBooking(overrides: SlipOverrides = {}) {
  return {
    id: 'booking-1',
    userId: 'user-1',
    user: {
      id: 'user-1',
      firstName: 'Somchai',
      lastName: 'S',
      email: 'somchai@example.com',
      membershipId: 'M-1',
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
    slips: [
      {
        id: 'slip-1',
        slipUrl: 'https://example.test/slip-1.png',
        uploadedAt: '2027-06-01T10:00:00Z',
        slipokStatus: 'pending' as const,
        slipokVerifiedAt: null,
        slipokReason: null,
        slipokCheckedAt: null,
        adminStatus: 'pending' as const,
        adminVerifiedAt: null,
        adminVerifiedBy: null,
        adminVerifiedByName: null,
        isPrimary: true,
        ...overrides,
      },
    ],
    slip: null,
    auditHistory: [],
    createdAt: '2027-06-01T09:00:00Z',
    updatedAt: '2027-06-01T09:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySlip.mockResolvedValue(slipResponse({ adminStatus: 'verified' }));
  mockMarkSlipNeedsAction.mockResolvedValue(slipResponse({ adminStatus: 'needs_action' }));
});

function renderSidebar(
  overrides: SlipOverrides = {},
  props: { onRefresh?: () => void } = {}
) {
  // By default the per-slip read agrees with the row the list rendered, so
  // the badge assertions below stay about the data under test rather than
  // about which of the two reads won the merge. Tests that care about the
  // decision record the list cannot carry override `mockGetSlip` themselves.
  if (!mockGetSlip.getMockImplementation()) {
    mockGetSlip.mockResolvedValue(
      slipResponse({
        slipokStatus: overrides.slipokStatus ?? 'pending',
        slipokReason: overrides.slipokReason ?? null,
        slipokCheckedAt: overrides.slipokCheckedAt ?? null,
        slipokVerifiedAt: overrides.slipokVerifiedAt ?? null,
        adminStatus: overrides.adminStatus ?? 'pending',
        adminVerifiedAt: overrides.adminVerifiedAt ?? null,
        autoVerified: overrides.autoVerified ?? false,
      })
    );
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SlipViewerSidebar
        booking={makeBooking(overrides) as never}
        onVerify={vi.fn()}
        onNeedsAction={vi.fn()}
        onEdit={vi.fn()}
        onRefresh={props.onRefresh ?? vi.fn()}
      />
    </QueryClientProvider>
  );
}

/** A booking with nothing attached — the only state in which the legacy
 *  booking-scoped controls are the ones on screen. */
function renderSidebarWithoutSlips() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const booking = { ...makeBooking(), slips: [], slip: null };

  return render(
    <QueryClientProvider client={queryClient}>
      <SlipViewerSidebar
        booking={booking as never}
        onVerify={vi.fn()}
        onNeedsAction={vi.fn()}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>
  );
}

/**
 * The SlipOK column only. The admin column sits in a sibling block and
 * renders labels of its own ("Pending", "Verified", a bare timestamp), so an
 * unscoped query can be satisfied by the wrong badge — which would let a
 * broken SlipOK lookup pass.
 */
function slipOkColumn(): HTMLElement {
  const heading = screen.getByText('SlipOK Status');
  const column = heading.closest('div');
  if (!column) {
    throw new Error('SlipOK column not found');
  }
  return column;
}

describe('SlipViewerSidebar SlipOK surfacing', () => {
  it('shows the manual status, its reason and the time the machine checked', () => {
    renderSidebar({
      slipokStatus: 'manual',
      slipokReason: 'amount_mismatch',
      slipokCheckedAt: '2027-06-01T10:05:00Z',
    });

    const column = within(slipOkColumn());
    expect(column.getByText('Manual check needed')).toBeInTheDocument();
    expect(
      column.getByText(/Transferred amount does not match the booking/)
    ).toBeInTheDocument();
    expect(column.getByText(/Reason:/)).toBeInTheDocument();
    // The check time is labelled: the admin badge beside it prints its own
    // timestamp, and two bare dates tell reception nothing.
    // dd/mm/yyyy, hh:mm from formatDateTimeToEuropean — the date part is
    // timezone-stable enough to assert on, the hour is not.
    expect(column.getByText(/^Checked: /)).toHaveTextContent(/01\/06\/2027/);
  });

  it('renders a distinct badge for every locked status', () => {
    const cases: Array<[string, string]> = [
      ['pending', 'Pending'],
      ['verified', 'Verified'],
      ['shadow_pass', 'System pass (awaiting admin)'],
      ['manual', 'Manual check needed'],
      ['unavailable', 'Auto-check unavailable'],
    ];

    for (const [status, label] of cases) {
      const { unmount } = renderSidebar({ slipokStatus: status });
      expect(within(slipOkColumn()).getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('falls back to a raw reason when the reason key is not one we translate', () => {
    renderSidebar({ slipokStatus: 'manual', slipokReason: 'brand_new_reason' });

    expect(screen.getByText(/brand_new_reason/)).toBeInTheDocument();
  });

  it('attributes an auto-verified slip to SlipOK', () => {
    renderSidebar({
      slipokStatus: 'verified',
      slipokVerifiedAt: '2027-06-01T10:05:00Z',
      adminStatus: 'verified',
      adminVerifiedAt: '2027-06-01T10:05:01Z',
      autoVerified: true,
    });

    expect(screen.getByText('By: SlipOK')).toBeInTheDocument();
  });

  it('attributes a slip with no autoVerified flag to the human who verified it', () => {
    renderSidebar({
      slipokStatus: 'verified',
      adminStatus: 'verified',
      adminVerifiedAt: '2027-06-01T10:05:01Z',
      adminVerifiedByName: 'Khun Ploy',
    });

    expect(screen.getByText('By: Khun Ploy')).toBeInTheDocument();
    expect(screen.queryByText('By: SlipOK')).not.toBeInTheDocument();
  });

  it('attributes nothing when a human verify carries no name', () => {
    renderSidebar({
      slipokStatus: 'verified',
      adminStatus: 'verified',
      adminVerifiedAt: '2027-06-01T10:05:01Z',
    });

    expect(screen.queryByText(/^By:/)).not.toBeInTheDocument();
  });

  it('keeps the verify and needs-action actions available', () => {
    renderSidebar({ slipokStatus: 'manual', slipokReason: 'duplicate' });

    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs Action' })).toBeInTheDocument();
  });
});

describe('SlipViewerSidebar wired calls', () => {
  it('reads the slip it is showing so the decision record the list omits can render', async () => {
    // `slipokReason` / `slipokCheckedAt` / `autoVerified` exist only on the
    // per-slip route; the booking list projection has no columns for them.
    mockGetSlip.mockResolvedValue(
      slipResponse({
        slipokStatus: 'manual',
        slipokReason: 'receiver_mismatch',
        slipokCheckedAt: '2027-06-01T10:05:00Z',
      })
    );

    renderSidebar();

    await waitFor(() => {
      expect(mockGetSlip).toHaveBeenCalledWith('slip-1');
    });

    const column = within(slipOkColumn());
    await waitFor(() => {
      expect(column.getByText('Manual check needed')).toBeInTheDocument();
    });
    expect(column.getByText(/The receiving account does not match/)).toBeInTheDocument();
    expect(column.getByText(/^Checked: /)).toHaveTextContent(/01\/06\/2027/);
  });

  it('keeps the list badge when the per-slip read fails', async () => {
    mockGetSlip.mockRejectedValue(new Error('boom'));

    renderSidebar({ slipokStatus: 'manual' });

    await waitFor(() => {
      expect(mockGetSlip).toHaveBeenCalled();
    });
    // Merge, never replace: a failed read must not blank the badge.
    expect(within(slipOkColumn()).getByText('Manual check needed')).toBeInTheDocument();
  });

  it('attributes the slip to SlipOK when the per-slip read says the machine verified it', async () => {
    mockGetSlip.mockResolvedValue(
      slipResponse({
        slipokStatus: 'verified',
        adminStatus: 'verified',
        adminVerifiedAt: '2027-06-01T10:05:01Z',
        autoVerified: true,
      })
    );

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('By: SlipOK')).toBeInTheDocument();
    });
  });

  it('verifies through the per-slip endpoint', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    renderSidebar({}, { onRefresh });

    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(mockVerifySlip).toHaveBeenCalledWith('slip-1');
    });
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('sends the admin notes with the needs-action call', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    renderSidebar({}, { onRefresh });

    await user.click(screen.getByRole('button', { name: 'Needs Action' }));

    const notes = screen.getByPlaceholderText('What does the guest need to fix?');
    await user.type(notes, 'Please re-upload a clearer photo');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(mockMarkSlipNeedsAction).toHaveBeenCalledWith('slip-1', {
        notes: 'Please re-upload a clearer photo',
      });
    });
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('shows an erased slip as a tombstone instead of a broken image, with no way to open it', async () => {
    // The per-slip read is what F2 makes authoritative for the tombstone, so
    // the detail says erased even though the list row still carries a URL —
    // exactly the stale-list case the sidebar has to get right.
    mockGetSlip.mockResolvedValue(
      slipResponse({ slipUrl: null, deletedAt: '2027-06-01T10:00:00Z', deletionReason: 'retention_sweep' })
    );

    renderSidebar();

    await waitFor(() => {
      expect(
        screen.getByText('Erased under the retention policy on 01/06/2027')
      ).toBeInTheDocument();
    });

    // The payment record survived, and the panel says so.
    expect(screen.getByText('The payment record itself is unchanged.')).toBeInTheDocument();

    // No image element, and the action that would open it is gone — not
    // merely disabled: there is nothing behind it to open.
    expect(
      screen.queryByAltText('Payment slip image')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View fullscreen' })
    ).not.toBeInTheDocument();
  });

  it('leaves the booking-scoped fallbacks disabled while their routes are missing', () => {
    // `POST /api/admin/bookings/:id/verify-slip` and `.../needs-action` have
    // no Rust handler (docs/admin-backend-gaps.md), and a booking with no
    // slip gives the per-slip routes nothing to act on.
    renderSidebarWithoutSlips();

    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Needs Action' })).toBeDisabled();
    // Slip replacement has no admin upload route at all.
    expect(screen.getByRole('button', { name: 'Replace Slip' })).toBeDisabled();
  });
});
