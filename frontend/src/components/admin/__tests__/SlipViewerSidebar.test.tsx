import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  'admin.booking.bookingManagement.by': 'By',
  'admin.booking.bookingManagement.actions.verify': 'Verify',
  'admin.booking.bookingManagement.actions.needsAction': 'Needs Action',
  'admin.booking.bookingManagement.actions.replaceSlip': 'Replace Slip',
  'admin.booking.bookingManagement.actions.edit': 'Edit',
  'payment.slipok.reason.amount_mismatch': 'Transferred amount does not match the booking',
  'payment.slipok.reason.duplicate': 'This slip has already been used',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type SlipOverrides = {
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

function renderSidebar(overrides: SlipOverrides = {}) {
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
