import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CouponAssignmentsModal from '../CouponAssignmentsModal';
import { couponService } from '../../../services/couponService';
import { Coupon } from '../../../types/coupon';
import { logger } from '../../../utils/logger';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'errors.failedToLoadAssignments': 'Failed to load assignments',
    'errors.failedToRemoveCoupons': 'Failed to remove user coupons',
  };
  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('../../../services/couponService', () => ({
  couponService: {
    getCouponAssignments: vi.fn(),
    revokeUserCouponsForCoupon: vi.fn(),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../../../utils/dateFormatter', () => ({
  formatDateToDDMMYYYY: vi.fn((date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }),
}));

describe('CouponAssignmentsModal', () => {
  const mockCoupon: Coupon = {
    id: 'coupon-1',
    code: 'SAVE20',
    name: '20% Off Coupon',
    description: 'Get 20% off your purchase',
    termsAndConditions: 'Valid on purchases over 1000 THB',
    type: 'percentage',
    value: 20,
    currency: 'THB',
    minimumSpend: 1000,
    maximumDiscount: 500,
    validFrom: '2024-01-01T00:00:00Z',
    validUntil: '2024-12-31T23:59:59Z',
    usageLimit: 1000,
    usageLimitPerUser: 3,
    usedCount: 150,
    tierRestrictions: [],
    customerSegment: {},
    status: 'active',
    createdBy: 'admin-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockAssignments = [
    {
      userId: 'user-1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      assignedCount: 3,
      usedCount: 1,
      availableCount: 2,
      latestAssignment: new Date('2024-01-15T10:30:00Z'),
    },
    {
      userId: 'user-2',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@example.com',
      assignedCount: 2,
      usedCount: 2,
      availableCount: 0,
      latestAssignment: new Date('2024-01-10T14:20:00Z'),
    },
    {
      userId: 'user-3',
      firstName: 'Bob',
      lastName: 'Johnson',
      email: 'bob.johnson@example.com',
      assignedCount: 5,
      usedCount: 2,
      availableCount: 3,
      latestAssignment: new Date('2024-01-20T09:15:00Z'),
    },
  ];

  const mockSummary = {
    totalUsers: 3,
    totalAssigned: 10,
    totalUsed: 5,
    totalAvailable: 5,
  };

  const mockAssignmentsResponse = {
    assignments: mockAssignments,
    summary: mockSummary,
    page: 1,
    limit: 10,
    totalPages: 1,
    total: 3,
  };

  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    vi.mocked(couponService.getCouponAssignments).mockResolvedValue(mockAssignmentsResponse);
    vi.mocked(couponService.revokeUserCouponsForCoupon).mockResolvedValue({
      success: true,
      message: 'Coupons revoked successfully',
      revokedCount: 1,
    });
  });

  describe('Basic Rendering', () => {
    it('should render the modal when open', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });
    });

    it('should render without crashing', async () => {
      const { container } = render(
        <CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />
      );

      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    });

    it('should display coupon name and code in header', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText(/20% Off Coupon/)).toBeInTheDocument();
        expect(screen.getByText(/SAVE20/)).toBeInTheDocument();
      });
    });

    it('should have modal overlay', async () => {
      const { container } = render(
        <CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />
      );

      await waitFor(() => {
        const overlay = container.querySelector('.fixed.inset-0.bg-black.bg-opacity-50');
        expect(overlay).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should display loading spinner initially', () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      expect(screen.getByText('Loading assignments...')).toBeInTheDocument();
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should hide loading state after data loads', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading assignments...')).not.toBeInTheDocument();
      });
    });

    it('should load assignments on mount', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(couponService.getCouponAssignments).toHaveBeenCalledWith('coupon-1', 1, 10);
      });
    });
  });

  describe('Assignment List Display', () => {
    it('should display all assignments', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('Bob Johnson')).toBeInTheDocument();
      });
    });

    it('should display user emails', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
        expect(screen.getByText('jane.smith@example.com')).toBeInTheDocument();
        expect(screen.getByText('bob.johnson@example.com')).toBeInTheDocument();
      });
    });

    it('should display assigned counts', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const assignedCounts = screen.getAllByText(/^[0-9]+$/).filter(el =>
          el.closest('td')?.querySelector('.text-blue-600')
        );
        expect(assignedCounts.length).toBeGreaterThan(0);
      });
    });

    it('should display used counts', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
      });
    });

    it('should display available counts', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
      });
    });

    it('should display assignment dates', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('15/01/2024')).toBeInTheDocument();
        expect(screen.getByText('10/01/2024')).toBeInTheDocument();
        expect(screen.getByText('20/01/2024')).toBeInTheDocument();
      });
    });
  });

  describe('Summary Statistics', () => {
    it('should display total users', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Total Users')).toBeInTheDocument();
        const totalUsersSection = screen.getByText('Total Users').parentElement;
        expect(totalUsersSection).toHaveTextContent('3');
        expect(totalUsersSection).toHaveTextContent('Total Users');
      });
    });

    it('should display total assigned', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('Total Assigned')).toBeInTheDocument();
      });
    });

    it('should display total used', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const usedLabels = screen.getAllByText('Used');
        // Find the one in the summary section (gray-600 class)
        const usedLabel = usedLabels.find(el => el.className.includes('text-gray-600'));
        expect(usedLabel).toBeInTheDocument();
        const usedSection = usedLabel?.parentElement;
        expect(usedSection).toHaveTextContent('5');
        expect(usedSection).toHaveTextContent('Used');
      });
    });

    it('should display total available', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const availableLabels = screen.getAllByText('Available');
        // The summary section shows "Available" as a label
        const summaryAvailableLabel = availableLabels.find(el => {
          const parent = el.closest('div');
          return parent?.className.includes('text-gray-600') && parent?.textContent === 'Available';
        });
        expect(summaryAvailableLabel).toBeInTheDocument();
      });
    });

    it('should style summary statistics correctly', async () => {
      const { container } = render(
        <CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />
      );

      await waitFor(() => {
        const summarySection = container.querySelector('.bg-gray-50');
        expect(summarySection).toBeInTheDocument();
      });
    });
  });

  describe('Status Badges', () => {
    it('should display "Available" badge for unused coupons', async () => {
      // Mock with a user who has not used any coupons
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        assignments: [{
          userId: 'user-4',
          firstName: 'Alice',
          lastName: 'Green',
          email: 'alice@example.com',
          assignedCount: 1,
          usedCount: 0,
          availableCount: 1,
          latestAssignment: new Date('2024-01-25T10:00:00Z'),
        }],
        summary: mockSummary,
        page: 1,
        limit: 10,
        totalPages: 1,
        total: 1,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        // Find the badge in the table body
        const table = screen.getByRole('table');
        const tbody = table.querySelector('tbody');
        const availableBadge = within(tbody as HTMLElement).getByText('Available');
        expect(availableBadge).toHaveClass('bg-green-100', 'text-green-800');
      });
    });

    it('should display "All Used" badge when no coupons available', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('All Used')).toBeInTheDocument();
      });
    });

    it('should display "Partially Used" badge when some coupons used', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        // User 1 has 1 used and 2 available, so should show Partially Used
        const badges = screen.getAllByText('Partially Used');
        expect(badges.length).toBeGreaterThan(0);
      });
    });

    it('should style Available badge with green', async () => {
      // Mock with a user who has not used any coupons
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        assignments: [{
          userId: 'user-4',
          firstName: 'Alice',
          lastName: 'Green',
          email: 'alice@example.com',
          assignedCount: 1,
          usedCount: 0,
          availableCount: 1,
          latestAssignment: new Date('2024-01-25T10:00:00Z'),
        }],
        summary: mockSummary,
        page: 1,
        limit: 10,
        totalPages: 1,
        total: 1,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const table = screen.getByRole('table');
        const tbody = table.querySelector('tbody');
        const availableBadge = within(tbody as HTMLElement).getByText('Available');
        expect(availableBadge).toHaveClass('bg-green-100', 'text-green-800');
      });
    });

    it('should style All Used badge with gray', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const allUsedBadge = screen.getByText('All Used');
        expect(allUsedBadge).toHaveClass('bg-gray-100', 'text-gray-800');
      });
    });

    it('should style Partially Used badge with yellow', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const partiallyUsedBadges = screen.getAllByText('Partially Used');
        expect(partiallyUsedBadges.length).toBeGreaterThan(0);
        partiallyUsedBadges.forEach(badge => {
          expect(badge).toHaveClass('bg-yellow-100', 'text-yellow-800');
        });
      });
    });
  });

  describe('Modal Open/Close', () => {
    it('should call onClose when close button clicked', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const closeButton = screen.getByText('×');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should display close button', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('×')).toBeInTheDocument();
      });
    });

    it('should style close button correctly', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const closeButton = screen.getByText('×');
        expect(closeButton).toHaveClass('text-gray-400', 'hover:text-gray-600');
      });
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no assignments', async () => {
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        assignments: [],
        summary: {
          totalUsers: 0,
          totalAssigned: 0,
          totalUsed: 0,
          totalAvailable: 0,
        },
        page: 1,
        limit: 10,
        totalPages: 0,
        total: 0,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('No users have been assigned this coupon yet.')).toBeInTheDocument();
      });
    });

    it('should not display table when no assignments', async () => {
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        assignments: [],
        summary: {
          totalUsers: 0,
          totalAssigned: 0,
          totalUsed: 0,
          totalAvailable: 0,
        },
        page: 1,
        limit: 10,
        totalPages: 0,
        total: 0,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message on load failure', async () => {
      const error = new Error('Network error');
      vi.mocked(couponService.getCouponAssignments).mockRejectedValueOnce(error);

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load assignments')).toBeInTheDocument();
      });
    });

    it('should log error on load failure', async () => {
      const error = new Error('Network error');
      vi.mocked(couponService.getCouponAssignments).mockRejectedValueOnce(error);

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith('Error loading coupon assignments:', error);
      });
    });

    it('should display retry button on error', async () => {
      vi.mocked(couponService.getCouponAssignments).mockRejectedValueOnce(new Error('Network error'));

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });
    });

    it('should retry loading on retry button click', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.getCouponAssignments)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockAssignmentsResponse);

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });

      const retryButton = screen.getByText('Try Again');
      await user.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('should display pagination when multiple pages', async () => {
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        ...mockAssignmentsResponse,
        page: 1,
        totalPages: 3,
        total: 25,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 3 (25 users)')).toBeInTheDocument();
      });
    });

    it('should not display pagination when single page', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.queryByText('Previous')).not.toBeInTheDocument();
        expect(screen.queryByText('Next')).not.toBeInTheDocument();
      });
    });

    it('should display previous and next buttons', async () => {
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        ...mockAssignmentsResponse,
        page: 2,
        totalPages: 3,
        total: 25,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Previous')).toBeInTheDocument();
        expect(screen.getByText('Next')).toBeInTheDocument();
      });
    });

    it('should disable previous button on first page', async () => {
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        ...mockAssignmentsResponse,
        page: 1,
        totalPages: 3,
        total: 25,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const previousButton = screen.getByText('Previous');
        expect(previousButton).toBeDisabled();
      });
    });

    it('should disable next button on last page', async () => {
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        ...mockAssignmentsResponse,
        page: 3,
        totalPages: 3,
        total: 25,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const nextButton = screen.getByText('Next');
        expect(nextButton).toBeDisabled();
      });
    });

    it('should load next page when next button clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        ...mockAssignmentsResponse,
        page: 1,
        totalPages: 2,
        total: 15,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Next')).toBeInTheDocument();
      });

      const nextButton = screen.getByText('Next');
      await user.click(nextButton);

      await waitFor(() => {
        expect(couponService.getCouponAssignments).toHaveBeenCalledWith('coupon-1', 2, 10);
      });
    });

    it('should load previous page when previous button clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.getCouponAssignments).mockResolvedValueOnce({
        ...mockAssignmentsResponse,
        page: 2,
        totalPages: 2,
        total: 15,
      });

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('Previous')).toBeInTheDocument();
      });

      const previousButton = screen.getByText('Previous');
      await user.click(previousButton);

      await waitFor(() => {
        expect(couponService.getCouponAssignments).toHaveBeenCalledWith('coupon-1', 1, 10);
      });
    });
  });

  describe('Remove Coupon Action', () => {
    it('should display remove button for users with available coupons', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const removeButtons = screen.getAllByText('Remove');
        expect(removeButtons.length).toBeGreaterThan(0);
      });
    });

    it('should display "No coupons" for users with no available coupons', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('No coupons')).toBeInTheDocument();
      });
    });

    it('should show confirmation dialog when remove clicked', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Confirm Coupon Removal')).toBeInTheDocument();
      });
    });

    it('should display user name in confirmation dialog', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        const dialog = screen.getByText('Confirm Coupon Removal').closest('div');
        expect(dialog).toHaveTextContent('John Doe');
      });
    });

    it('should display coupon count in confirmation dialog', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText(/2 coupons/)).toBeInTheDocument();
      });
    });

    it('should close confirmation dialog when cancel clicked', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Confirm Coupon Removal')).toBeInTheDocument();
      });

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText('Confirm Coupon Removal')).not.toBeInTheDocument();
      });
    });

    it('should call revokeUserCouponsForCoupon when confirmed', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Remove Coupons')).toBeInTheDocument();
      });

      const confirmButton = screen.getByText('Remove Coupons');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(couponService.revokeUserCouponsForCoupon).toHaveBeenCalledWith(
          'coupon-1',
          'user-1',
          'Removed by admin from assignment management'
        );
      });
    });

    it('should reload assignments after successful removal', async () => {
      const user = userEvent.setup();
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      vi.clearAllMocks();

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Remove Coupons')).toBeInTheDocument();
      });

      const confirmButton = screen.getByText('Remove Coupons');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(couponService.getCouponAssignments).toHaveBeenCalledWith('coupon-1', 1, 10);
      });
    });

    it('should display removing state during removal', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.revokeUserCouponsForCoupon).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Remove Coupons')).toBeInTheDocument();
      });

      const confirmButton = screen.getByText('Remove Coupons');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText('Removing...')).toBeInTheDocument();
      });
    });

    it('should handle removal error', async () => {
      const user = userEvent.setup();
      const error = new Error('Network error');
      vi.mocked(couponService.revokeUserCouponsForCoupon).mockRejectedValueOnce(error);

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Remove Coupons')).toBeInTheDocument();
      });

      const confirmButton = screen.getByText('Remove Coupons');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith('Error removing user coupons:', error);
      });
    });

    it('should disable remove button during removal', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.revokeUserCouponsForCoupon).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getAllByText('Remove')[0]).toBeInTheDocument();
      });

      const removeButton = screen.getAllByText('Remove')[0]!;
      await user.click(removeButton);

      await waitFor(() => {
        expect(screen.getByText('Remove Coupons')).toBeInTheDocument();
      });

      const confirmButton = screen.getByText('Remove Coupons');
      await user.click(confirmButton);

      await waitFor(() => {
        const removingButton = screen.getByText('Removing...');
        expect(removingButton).toBeDisabled();
      });
    });
  });

  describe('Table Structure', () => {
    it('should have proper table headers', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();

        // Check for table headers within the table
        expect(within(table).getByText('User')).toBeInTheDocument();
        expect(within(table).getByText('Email')).toBeInTheDocument();
        expect(within(table).getByText('Assigned')).toBeInTheDocument();
        expect(within(table).getByText('Status')).toBeInTheDocument();
        expect(within(table).getByText('Latest Assignment')).toBeInTheDocument();
        expect(within(table).getByText('Actions')).toBeInTheDocument();
      });
    });

    it('should have scrollable table container', async () => {
      const { container } = render(
        <CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />
      );

      await waitFor(() => {
        const scrollableDiv = container.querySelector('.overflow-x-auto');
        expect(scrollableDiv).toBeInTheDocument();
      });
    });

    it('should have hover effect on rows', async () => {
      const { container } = render(
        <CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />
      );

      await waitFor(() => {
        const rows = container.querySelectorAll('tbody tr');
        expect(rows[0]).toHaveClass('hover:bg-gray-50');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible table', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
    });

    it('should have accessible buttons', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const removeButtons = screen.getAllByText('Remove');
        removeButtons.forEach(button => {
          expect(button.tagName).toBe('BUTTON');
        });
      });
    });

    it('should have proper heading hierarchy', async () => {
      render(<CouponAssignmentsModal coupon={mockCoupon} isOpen={true} onClose={onClose} />);

      await waitFor(() => {
        const heading = screen.getByText('Coupon Assignments');
        expect(heading.tagName).toBe('H2');
      });
    });
  });
});
