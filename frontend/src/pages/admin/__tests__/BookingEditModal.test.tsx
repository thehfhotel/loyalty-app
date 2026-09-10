import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Mock toast - use vi.hoisted to ensure mocks are available in factory
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

// The modal talks to the backend only through this service.
const { mockListRoomTypes, mockUpdateBooking, mockApplyDiscount, mockCancelBooking } =
  vi.hoisted(() => ({
    mockListRoomTypes: vi.fn(),
    mockUpdateBooking: vi.fn(),
    mockApplyDiscount: vi.fn(),
    mockCancelBooking: vi.fn(),
  }));

vi.mock('../../../services/adminBookingService', () => ({
  adminBookingService: {
    listRoomTypes: mockListRoomTypes,
    updateBooking: mockUpdateBooking,
    applyDiscount: mockApplyDiscount,
    cancelBooking: mockCancelBooking,
  },
}));

// Mock data for testing
const mockBookingBase = {
  id: 'booking-1',
  userId: 'user-1',
  user: {
    id: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    membershipId: 'MEM001',
    phone: '0812345678',
  },
  roomTypeId: 'room-type-1',
  roomType: {
    id: 'room-type-1',
    name: 'Deluxe Suite',
  },
  checkInDate: '2025-01-15',
  checkOutDate: '2025-01-17',
  numberOfGuests: 2,
  totalPrice: 14000,
  paymentType: 'full' as const,
  paymentAmount: 14000,
  discountAmount: 0,
  discountReason: null,
  status: 'confirmed' as const,
  notes: 'Test booking',
  adminNotes: null,
  slip: null,
  auditHistory: [],
  createdAt: '2025-01-10T09:00:00Z',
  updatedAt: '2025-01-10T10:00:00Z',
};

const mockCancelledBooking = {
  ...mockBookingBase,
  status: 'cancelled' as const,
  cancelledAt: '2025-01-12T10:00:00Z',
  cancelledByAdmin: true,
  cancellationReason: 'Guest no-show',
};

const mockOnClose = vi.fn();
const mockOnSave = vi.fn();

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'admin.booking.bookingManagement.editModal.title': 'Edit Booking',
        'admin.booking.bookingManagement.editModal.bookingId': 'Booking ID',
        'admin.booking.bookingManagement.editModal.tabs.details': 'Details',
        'admin.booking.bookingManagement.editModal.tabs.payment': 'Payment',
        'admin.booking.bookingManagement.editModal.tabs.audit': 'Audit',
        'admin.booking.bookingManagement.editModal.tabs.cancel': 'Cancel',
        'admin.booking.cancel.title': 'Cancel Booking',
        'admin.booking.cancel.warning': 'This action cannot be undone. The booking will be permanently cancelled.',
        'admin.booking.cancel.reasonLabel': 'Cancellation Reason *',
        'admin.booking.cancel.reasonPlaceholder': 'Enter the reason for cancellation...',
        'admin.booking.cancel.confirmCheckbox': 'I confirm that I want to cancel this booking',
        'admin.booking.cancel.button': 'Cancel Booking',
        'admin.booking.cancel.cancelling': 'Cancelling...',
        'admin.booking.cancel.success': 'Booking cancelled successfully',
        'admin.booking.cancel.error': 'Failed to cancel booking',
        'admin.booking.cancel.alreadyCancelled': 'This booking has already been cancelled',
        'admin.booking.bookingManagement.editModal.userInfo': 'User Information',
        'admin.booking.bookingManagement.editModal.name': 'Name',
        'admin.booking.bookingManagement.editModal.email': 'Email',
        'admin.booking.bookingManagement.editModal.membershipId': 'Membership ID',
        'admin.booking.bookingManagement.editModal.phone': 'Phone',
        'admin.booking.bookingManagement.editModal.checkInDate': 'Check-in Date',
        'admin.booking.bookingManagement.editModal.checkOutDate': 'Check-out Date',
        'admin.booking.bookingManagement.editModal.totalPrice': 'Total Price',
        'admin.booking.bookingManagement.editModal.adminNotes': 'Internal Notes',
        'admin.booking.bookingManagement.editModal.paymentAmount': 'Payment Amount',
        'admin.booking.bookingManagement.editModal.calculatedPayment': 'Calculated payment',
        'admin.booking.bookingManagement.editModal.currentDiscount': 'Current Discount',
        'admin.booking.bookingManagement.editModal.applyDiscount': 'Apply Discount',
        'admin.booking.bookingManagement.editModal.applyDiscountBtn': 'Apply',
        'admin.booking.bookingManagement.editModal.discountAmount': 'Discount Amount',
        'admin.booking.bookingManagement.editModal.discountReason': 'Discount Reason',
        'admin.booking.bookingManagement.messages.bookingUpdated': 'Booking updated',
        'admin.booking.bookingManagement.messages.discountApplied': 'Discount applied',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.saving': 'Saving...',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Import component after mocks
import BookingEditModal from '../BookingEditModal';

describe('BookingEditModal - Cancel Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRoomTypes.mockResolvedValue([{ id: 'room-type-1', name: 'Deluxe Suite' }]);
    mockUpdateBooking.mockResolvedValue({ ...mockBookingBase, auditHistory: [] });
    mockApplyDiscount.mockResolvedValue({ ...mockBookingBase, auditHistory: [] });
    mockCancelBooking.mockResolvedValue({
      ...mockBookingBase,
      status: 'cancelled',
      auditHistory: [],
    });
  });

  describe('Cancel tab rendering', () => {
    it('should render Cancel tab correctly with warning message', () => {
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      fireEvent.click(cancelTab);

      // Warning message should be visible
      expect(screen.getAllByText('Cancel Booking').length).toBeGreaterThan(0);
      expect(screen.getByText('This action cannot be undone. The booking will be permanently cancelled.')).toBeInTheDocument();
    });

    it('should render reason textarea with required label', () => {
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      fireEvent.click(cancelTab);

      // Reason textarea should be present
      expect(screen.getByText('Cancellation Reason *')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter the reason for cancellation...')).toBeInTheDocument();
    });

    it('should render confirmation checkbox', () => {
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      fireEvent.click(cancelTab);

      // Confirmation checkbox should be present
      expect(screen.getByText('I confirm that I want to cancel this booking')).toBeInTheDocument();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });
  });

  describe('Cancel button disabled state', () => {
    it('should disable cancel button when reason is empty', () => {
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      fireEvent.click(cancelTab);

      // Cancel button should be disabled initially
      const cancelButton = screen.getByRole('button', { name: 'Cancel Booking' });
      expect(cancelButton).toBeDisabled();
    });

    it('should disable cancel button when checkbox is not checked', async () => {
      const user = userEvent.setup();
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      await user.click(cancelTab);

      // Enter reason but don't check the checkbox
      const reasonTextarea = screen.getByPlaceholderText('Enter the reason for cancellation...');
      await user.type(reasonTextarea, 'Guest requested cancellation');

      // Cancel button should still be disabled
      const cancelButton = screen.getByRole('button', { name: 'Cancel Booking' });
      expect(cancelButton).toBeDisabled();
    });

    it('should enable cancel button when form is valid (reason + checkbox)', async () => {
      const user = userEvent.setup();
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      await user.click(cancelTab);

      // Enter reason
      const reasonTextarea = screen.getByPlaceholderText('Enter the reason for cancellation...');
      await user.type(reasonTextarea, 'Guest requested cancellation');

      // Check the confirmation checkbox
      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      // Cancel button should now be enabled
      const cancelButton = screen.getByRole('button', { name: 'Cancel Booking' });
      expect(cancelButton).not.toBeDisabled();
    });
  });

  describe('Cancellation mutation', () => {
    async function fillAndSubmitCancelForm() {
      const user = userEvent.setup();
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Navigate to Cancel tab and fill form
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      await user.click(cancelTab);

      const reasonTextarea = screen.getByPlaceholderText('Enter the reason for cancellation...');
      await user.type(reasonTextarea, 'Guest requested cancellation');

      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      await user.click(screen.getByRole('button', { name: 'Cancel Booking' }));
    }

    it('should cancel through the admin cancel endpoint', async () => {
      await fillAndSubmitCancelForm();

      await waitFor(() => {
        expect(mockCancelBooking).toHaveBeenCalledWith('booking-1', {
          reason: 'Guest requested cancellation',
        });
      });
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('Booking cancelled successfully');
    });

    it('should surface a failed cancel as an error toast', async () => {
      // handleCancelBooking calls mutateAsync without a try/catch, so the
      // rejection surfaces as an unhandled rejection. Suppress it here.
      const originalListeners = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      process.on('unhandledRejection', () => { /* suppress */ });

      mockCancelBooking.mockRejectedValue(new Error('409 already cancelled'));

      await fillAndSubmitCancelForm();

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Failed to cancel booking');
      });

      // Restore original listeners
      process.removeAllListeners('unhandledRejection');
      for (const listener of originalListeners) {
        process.on('unhandledRejection', listener as (...args: unknown[]) => void);
      }
    });
  });

  describe('Room type dropdown', () => {
    it('should populate the dropdown from the admin room-types endpoint', async () => {
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(mockListRoomTypes).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Deluxe Suite' })).toBeInTheDocument();
      });
    });
  });

  describe('Already cancelled booking', () => {
    it('should keep the Cancel tab unreachable for an already cancelled booking', async () => {
      const user = userEvent.setup();
      render(
        <BookingEditModal
          booking={mockCancelledBooking}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // TabNav has no per-item disabled state, so the old disabled <button>
      // is now a guard in the tab-change handler — clicking the Cancel tab
      // while the booking is already cancelled must not activate it.
      const cancelTabButton = screen.getByRole('tab', { name: /Cancel/ });
      await user.click(cancelTabButton);

      expect(cancelTabButton).toHaveAttribute('aria-selected', 'false');
      expect(screen.queryByPlaceholderText('Enter the reason for cancellation...')).not.toBeInTheDocument();
    });

    it('should display already cancelled message when viewing cancel tab for cancelled booking', async () => {
      const user = userEvent.setup();
      render(
        <BookingEditModal
          booking={mockCancelledBooking}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // The cancel tab stays unreachable for cancelled bookings, so the
      // "already cancelled" panel behind it never renders either.
      const cancelTabButton = screen.getByRole('tab', { name: /Cancel/ });
      await user.click(cancelTabButton);

      expect(cancelTabButton).toHaveAttribute('aria-selected', 'false');
      expect(screen.queryByText('This booking has already been cancelled')).not.toBeInTheDocument();
    });
  });

  describe('Booking summary in Cancel tab', () => {
    it('should display booking details in the cancel tab', async () => {
      const user = userEvent.setup();
      render(
        <BookingEditModal
          booking={mockBookingBase}
          isOpen={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />,
        { wrapper }
      );

      // Click on Cancel tab
      const cancelTab = screen.getAllByText('Cancel')[0]!; // First 'Cancel' is the tab
      await user.click(cancelTab);

      // Should show user info
      expect(screen.getByText('John Doe')).toBeInTheDocument();

      // Should show booking dates
      expect(screen.getAllByText('Check-in Date:').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Check-out Date:').length).toBeGreaterThan(0);

      // Should show total price
      expect(screen.getByText('14,000 THB')).toBeInTheDocument();
    });
  });
});

/**
 * The money columns are Postgres `numeric`, mapped to `rust_decimal::Decimal`,
 * and `backend-rust` pins that crate with only the `serde` feature — no
 * `serde-float`. So `Decimal` serialises through `serialize_str` and every
 * amount reaches this modal as a string ("6000.00"), never a number. These
 * cover what that breaks if the modal takes the wire value at face value.
 */
describe('BookingEditModal - string-decimal wire values', () => {
  const wireBooking = {
    ...mockBookingBase,
    paymentType: 'deposit' as const,
    totalPrice: '6000.00',
    paymentAmount: '3000.00',
    discountAmount: '500.00',
    discountReason: 'Loyalty gesture',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListRoomTypes.mockResolvedValue([{ id: 'room-type-1', name: 'Deluxe Suite' }]);
    mockUpdateBooking.mockResolvedValue({ ...wireBooking, auditHistory: [] });
    mockApplyDiscount.mockResolvedValue({ ...wireBooking, auditHistory: [] });
  });

  async function openPaymentTab() {
    const user = userEvent.setup();
    render(
      <BookingEditModal
        booking={wireBooking}
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
      { wrapper }
    );
    await user.click(screen.getByRole('tab', { name: 'Payment' }));
    return user;
  }

  it('formats the string amounts as money instead of printing them raw', async () => {
    await openPaymentTab();

    // `'6000.00'.toLocaleString()` is `'6000.00'` — the grouped form only
    // appears if the value was coerced first.
    expect(screen.getByText(/3,000 THB/)).toBeInTheDocument();
    expect(screen.getByText(/-500 THB/)).toBeInTheDocument();
  });

  it('posts a number to the discount route, which deserialises an f64', async () => {
    const user = await openPaymentTab();

    // Re-apply an existing discount without retyping the amount — the exact
    // path that used to ship `discountAmount: '500.00'` into a handler that
    // rejects a string.
    await user.click(screen.getByRole('button', { name: 'Apply Discount' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApplyDiscount).toHaveBeenCalledWith('booking-1', {
        discountAmount: 500,
        reason: 'Loyalty gesture',
      });
    });
  });

  it('persists the payment amount it just showed the admin', async () => {
    const user = await openPaymentTab();

    const totalInput = screen.getByLabelText('Total Price');
    await user.clear(totalInput);
    await user.type(totalInput, '8000');

    // A 50% deposit on 8000 less the 500 discount.
    expect(screen.getByText(/Calculated payment: 3,750 THB/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateBooking).toHaveBeenCalledWith(
        'booking-1',
        expect.objectContaining({ totalPrice: 8000, paymentAmount: 3750 })
      );
    });
  });
});

describe('BookingEditModal - internal notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRoomTypes.mockResolvedValue([{ id: 'room-type-1', name: 'Deluxe Suite' }]);
    mockUpdateBooking.mockResolvedValue({ ...mockBookingBase, auditHistory: [] });
  });

  it('sends a cleared note as an empty string rather than dropping the field', async () => {
    const user = userEvent.setup();
    render(
      <BookingEditModal
        booking={{ ...mockBookingBase, adminNotes: 'Guest is a no-show risk' }}
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />,
      { wrapper }
    );

    await user.clear(screen.getByLabelText('Internal Notes'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // `update_booking` reads an absent `adminNotes` as "keep current", so an
    // omitted field would rewrite the old note behind a success toast.
    await waitFor(() => {
      expect(mockUpdateBooking).toHaveBeenCalledWith(
        'booking-1',
        expect.objectContaining({ adminNotes: '' })
      );
    });
  });
});
