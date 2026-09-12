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
  'admin.booking.bookingManagement.slipStatus.unavailable': 'Auto-check not available — staff will verify',
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
  'admin.booking.bookingManagement.errors.verifyFailed': 'Failed to verify slip',
  'admin.booking.bookingManagement.errors.verifyRefused': 'Not confirmed: {{detail}}',
  'admin.booking.bookingManagement.errors.verifyUnavailable':
    'Could not reach the hotel system. Nothing was changed.',
  'payment.slipok.reason.confirm_refused': 'The room has been released; re-book at the desk',
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
  // A11
  'payment.slipok.reason.booking_not_payable': 'This booking cannot take a payment right now',
  'admin.booking.bookingManagement.slipViewer.bookingNotConfirmed':
    'Slip verified, but the booking was not confirmed: {{reason}}',
  'admin.booking.bookingManagement.slipViewer.bookingNotConfirmedHint':
    'The money arrived but the booking is still pending.',
  'admin.booking.bookingManagement.slipViewer.bookingNotConfirmedReasonUnknown':
    'reason not recorded',
  'admin.booking.bookingManagement.auditActions.bookingNotConfirmed': 'Booking not confirmed',
  'admin.booking.bookingManagement.auditActions.slipVerifyReverted':
    'Automatic slip verification reverted',
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
    // `GET /admin/bookings/slips/:id` hard-codes both — "a read decides
    // nothing" — so this is what a plain read of any slip looks like.
    bookingConfirmed: false,
    bookingNotConfirmedReason: null,
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

type BookingOverrides = {
  auditHistory?: AuditEntry[];
};

type AuditEntry = {
  id: string;
  action: string;
  adminId: string;
  adminName: string;
  oldValue: string | null;
  newValue: string | null;
  notes: string | null;
  createdAt: string;
};

function makeBooking(overrides: SlipOverrides = {}, booking: BookingOverrides = {}) {
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
    auditHistory: booking.auditHistory ?? [],
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
  props: { onRefresh?: () => void; booking?: BookingOverrides } = {}
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
        booking={makeBooking(overrides, props.booking ?? {}) as never}
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
      ['unavailable', 'Auto-check not available — staff will verify'],
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

/**
 * A11 — a verified slip whose booking never moved.
 *
 * `slip_confirm.rs` writes the `booking_not_confirmed` audit row when a
 * verified slip meets a hold that lapsed during the SlipOK round-trip. The
 * money arrived, both badges read "verified", and the booking is still
 * pending — the desk has to be told in words.
 */
describe('SlipViewerSidebar booking-not-confirmed notice', () => {
  const REFUSAL: AuditEntry = {
    id: 'audit-1',
    action: 'booking_not_confirmed',
    adminId: '00000000-0000-4000-8000-0000005110b1',
    adminName: 'SlipOK',
    oldValue: JSON.stringify({ status: 'pending', holdExpiresAt: '2027-06-01T09:00:00Z' }),
    newValue: JSON.stringify({
      status: 'pending',
      holdExpiresAt: '2027-06-01T09:00:00Z',
      slipId: 'slip-1',
      reason: 'booking_not_payable',
    }),
    notes:
      'การจองนี้ยังรับชำระเงินไม่ได้ในตอนนี้ (หมดเวลาถือห้องแล้ว ...) / ' +
      'This booking cannot take a payment right now (booking_not_payable: ...)',
    createdAt: '2027-06-01T10:05:00Z',
  };

  it('states it in one line, with the badge wording for the reason', async () => {
    renderSidebar(
      { slipokStatus: 'verified', adminStatus: 'verified' },
      { booking: { auditHistory: [REFUSAL] } }
    );

    const notice = await screen.findByTestId('booking-not-confirmed-notice');
    expect(notice).toHaveTextContent(
      'Slip verified, but the booking was not confirmed: This booking cannot take a payment right now'
    );
    // Never the raw enum: the desk reads Thai, and `booking_not_payable`
    // is not a sentence in any language.
    expect(notice).not.toHaveTextContent('booking_not_payable');
  });

  it('says "reason not recorded" rather than nothing when the snapshot carries no reason', async () => {
    renderSidebar(
      { slipokStatus: 'verified', adminStatus: 'verified' },
      { booking: { auditHistory: [{ ...REFUSAL, newValue: 'not json at all' }] } }
    );

    const notice = await screen.findByTestId('booking-not-confirmed-notice');
    expect(notice).toHaveTextContent('reason not recorded');
  });

  it('stays quiet on a booking whose slip verified normally', () => {
    renderSidebar({ slipokStatus: 'verified', adminStatus: 'verified' });

    expect(screen.queryByTestId('booking-not-confirmed-notice')).not.toBeInTheDocument();
  });

  it('clears once a newer verify or edit has cured it', () => {
    // A human's Verify overrides the lapsed hold and flips the booking, so a
    // `slip_verified` row newer than the refusal means it is dealt with —
    // and the booking DTO cannot say so itself, because `status` normalises
    // `pending` to `confirmed` on the wire.
    renderSidebar(
      { slipokStatus: 'verified', adminStatus: 'verified' },
      {
        booking: {
          auditHistory: [
            {
              ...REFUSAL,
              id: 'audit-2',
              action: 'slip_verified',
              newValue: null,
              createdAt: '2027-06-01T11:00:00Z',
            },
            REFUSAL,
          ],
        },
      }
    );

    expect(screen.queryByTestId('booking-not-confirmed-notice')).not.toBeInTheDocument();
  });

  it('appears the moment the verify response refuses the booking, before any refetch', async () => {
    const user = userEvent.setup();
    // The refusal reaches the frontend live only here: the per-slip GET
    // reports `bookingConfirmed: false` and no reason for every slip.
    mockVerifySlip.mockResolvedValue(
      slipResponse({
        adminStatus: 'verified',
        bookingConfirmed: false,
        bookingNotConfirmedReason: 'booking_not_payable',
      })
    );
    renderSidebar();

    expect(screen.queryByTestId('booking-not-confirmed-notice')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verify' }));

    const notice = await screen.findByTestId('booking-not-confirmed-notice');
    expect(notice).toHaveTextContent('This booking cannot take a payment right now');
  });

  it('says nothing when the verify confirmed the booking', async () => {
    const user = userEvent.setup();
    mockVerifySlip.mockResolvedValue(
      slipResponse({ adminStatus: 'verified', bookingConfirmed: true })
    );
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(mockVerifySlip).toHaveBeenCalled());
    expect(screen.queryByTestId('booking-not-confirmed-notice')).not.toBeInTheDocument();
  });

  it('names the audit row in words instead of the raw action key', async () => {
    renderSidebar(
      { slipokStatus: 'verified', adminStatus: 'verified' },
      { booking: { auditHistory: [REFUSAL] } }
    );

    await screen.findByTestId('booking-not-confirmed-notice');
    expect(screen.getByText('Booking not confirmed')).toBeInTheDocument();
    expect(screen.queryByText('booking_not_confirmed')).not.toBeInTheDocument();
  });

  // A15 (N8/N9): the desk has to tell "this booking is gone, re-book it"
  // from "the hotel system did not answer, press it again". Swallowing both
  // into one message left reception re-pressing a button that could never
  // work — and interpolating the backend's English sentence into the Thai
  // string gave a Thai-first desk half a line in each language.
  /** The message of the most recent `toast.error` call. */
  async function lastToastError(): Promise<unknown> {
    const { toast } = await import('react-hot-toast');
    const calls = vi.mocked(toast.error).mock.calls;
    return calls[calls.length - 1]?.[0];
  }

  /** Resolves once the component has reported a failure. */
  async function waitForToastError(): Promise<void> {
    const { toast } = await import('react-hot-toast');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  }

  describe('verify failures', () => {
    async function pressVerify() {
      const user = userEvent.setup();
      renderSidebar({ adminStatus: 'pending' });
      const button = await screen.findByRole('button', { name: 'Verify' });
      await user.click(button);
    }

    it('renders a 409 in the desk language, from the reason key not the sentence', async () => {
      const { ApiError } = await import('../../../utils/axiosInterceptor');
      mockVerifySlip.mockRejectedValue(
        new ApiError(
          'conflict',
          'conflict',
          409,
          'confirm_refused: the PMS refused the payment event — the booking was not confirmed'
        )
      );

      await pressVerify();

      await waitForToastError();
      const message = await lastToastError();
      expect(message).toBe('Not confirmed: The room has been released; re-book at the desk');
      // The backend's English clause must not reach the desk verbatim.
      expect(String(message)).not.toContain('payment event');
    });

    it('falls back to the generic reason when the key is not one we render', async () => {
      const { ApiError } = await import('../../../utils/axiosInterceptor');
      mockVerifySlip.mockRejectedValue(
        new ApiError('conflict', 'conflict', 409, 'something_unmapped: who knows')
      );

      await pressVerify();

      await waitForToastError();
      expect(await lastToastError()).toBe(
        'Not confirmed: reason not recorded'
      );
    });

    it('tells the admin to retry on a 5xx rather than calling the booking dead', async () => {
      const { ApiError } = await import('../../../utils/axiosInterceptor');
      mockVerifySlip.mockRejectedValue(
        new ApiError('external_service_unavailable', 'external_service_unavailable', 503, 'PMS down')
      );

      await pressVerify();

      await waitForToastError();
      expect(await lastToastError()).toBe(
        'Could not reach the hotel system. Nothing was changed.'
      );
    });

    it('keeps the generic message for a failure with no status at all', async () => {
      mockVerifySlip.mockRejectedValue(new Error('network down'));

      await pressVerify();

      await waitForToastError();
      expect(await lastToastError()).toBe('Failed to verify slip');
    });
  });

});
