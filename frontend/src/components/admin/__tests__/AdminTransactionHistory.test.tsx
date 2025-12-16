import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminTransactionHistory from '../AdminTransactionHistory';
import { loyaltyService, AdminTransaction } from '../../../services/loyaltyService';
import { logger } from '../../../utils/logger';
import toast from 'react-hot-toast';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'admin.loyalty.transactionHistory': 'Transaction History',
    'admin.loyalty.transactions': 'transactions',
    'loyalty.noTransactions': 'No transactions yet',
    'errors.networkError': 'Network error',
    'common.showing': 'Showing',
    'common.of': 'of',
  };
  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('../../../services/loyaltyService', () => ({
  loyaltyService: {
    getAdminTransactions: vi.fn(),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('react-icons/fi', () => ({
  FiUser: () => <span data-testid="user-icon">User</span>,
}));

vi.mock('../../../utils/dateFormatter', () => ({
  formatDateToDDMMYYYY: vi.fn((date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }),
}));

describe('AdminTransactionHistory', () => {
  const mockTransactions: AdminTransaction[] = [
    {
      id: 'txn-1',
      user_id: 'user-1',
      points: 500,
      type: 'earned_stay',
      description: 'Points earned from hotel stay',
      reference_id: 'booking-001',
      admin_user_id: null,
      admin_reason: null,
      admin_email: undefined,
      expires_at: null,
      created_at: '2024-01-15T10:30:00Z',
      user_email: 'user1@example.com',
      user_first_name: 'John',
      user_last_name: 'Doe',
      user_membership_id: 'M001',
    },
    {
      id: 'txn-2',
      user_id: 'user-2',
      points: -200,
      type: 'redeemed',
      description: 'Points redeemed',
      reference_id: 'redemption-001',
      admin_user_id: null,
      admin_reason: null,
      admin_email: undefined,
      expires_at: null,
      created_at: '2024-01-10T14:20:00Z',
      user_email: 'user2@example.com',
      user_first_name: 'Jane',
      user_last_name: 'Smith',
      user_membership_id: 'M002',
    },
    {
      id: 'txn-3',
      user_id: 'user-3',
      points: 1000,
      type: 'admin_award',
      description: 'Admin bonus',
      reference_id: null,
      admin_user_id: 'admin-1',
      admin_reason: 'Loyalty bonus for frequent guest',
      admin_email: 'admin@example.com',
      expires_at: null,
      created_at: '2024-01-05T09:15:00Z',
      user_email: 'user3@example.com',
      user_first_name: 'Bob',
      user_last_name: 'Johnson',
      user_membership_id: 'M003',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValue({
      transactions: mockTransactions,
      total: 23,
    });
  });

  describe('Basic Rendering', () => {
    it('should render the component', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('Transaction History')).toBeInTheDocument();
      });
    });

    it('should render without crashing', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    });

    it('should have proper heading', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const heading = screen.getByText('Transaction History');
        expect(heading.tagName).toBe('H4');
      });
    });
  });

  describe('Loading State', () => {
    it('should display loading skeleton initially', () => {
      render(<AdminTransactionHistory />);

      expect(screen.getByText('Transaction History')).toBeInTheDocument();
      const skeletonElements = document.querySelectorAll('.animate-pulse');
      expect(skeletonElements.length).toBeGreaterThan(0);
    });

    it('should display 5 skeleton items while loading', () => {
      render(<AdminTransactionHistory />);

      const skeletonElements = document.querySelectorAll('.animate-pulse');
      expect(skeletonElements).toHaveLength(5);
    });

    it('should hide loading skeleton after data loads', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const skeletonElements = document.querySelectorAll('.animate-pulse');
        expect(skeletonElements).toHaveLength(0);
      });
    });

    it('should load transactions on mount', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(loyaltyService.getAdminTransactions).toHaveBeenCalledWith(20, 0);
      });
    });
  });

  describe('Transaction List Display', () => {
    it('should display all transactions', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('+500 pts')).toBeInTheDocument();
        expect(screen.getByText('-200 pts')).toBeInTheDocument();
        expect(screen.getByText('+1000 pts')).toBeInTheDocument();
      });
    });

    it('should display transaction types', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('earned_stay')).toBeInTheDocument();
        expect(screen.getByText('redeemed')).toBeInTheDocument();
        expect(screen.getByText('admin_award')).toBeInTheDocument();
      });
    });

    it('should format positive points with plus sign and green color', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        const positivePoints = screen.getByText('+500 pts');
        expect(positivePoints).toHaveClass('text-green-600');
      });
    });

    it('should format negative points with red color', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const negativePoints = screen.getByText('-200 pts');
        expect(negativePoints).toHaveClass('text-red-600');
      });
    });

    it('should display transaction dates in DD/MM/YYYY HH:MM format', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText(/15\/01\/2024/)).toBeInTheDocument();
        expect(screen.getByText(/10\/01\/2024/)).toBeInTheDocument();
        expect(screen.getByText(/05\/01\/2024/)).toBeInTheDocument();
      });
    });

    it('should display user names when available', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        expect(screen.getByText('Bob Johnson')).toBeInTheDocument();
      });
    });

    it('should display user email when name not available', async () => {
      const transactionWithoutName: AdminTransaction[] = [
        {
          ...mockTransactions[0],
          user_first_name: null,
          user_last_name: null,
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: transactionWithoutName,
        total: 1,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('user1@example.com')).toBeInTheDocument();
      });
    });

    it('should display user icons', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const userIcons = screen.getAllByTestId('user-icon');
        expect(userIcons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Admin Information Display', () => {
    it('should display admin email when present', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText(/Admin: admin@example.com/)).toBeInTheDocument();
      });
    });

    it('should display admin reason when present', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('Loyalty bonus for frequent guest')).toBeInTheDocument();
      });
    });

    it('should not display admin info for non-admin transactions', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.queryByText(/Admin:/)).toBeInTheDocument();
        const adminEmails = screen.getAllByText(/Admin:/);
        expect(adminEmails).toHaveLength(1); // Only one admin transaction
      });
    });

    it('should not display admin reason containing THB', async () => {
      const transactionWithTHB: AdminTransaction[] = [
        {
          ...mockTransactions[2],
          admin_reason: 'Spent 5000 THB at hotel',
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: transactionWithTHB,
        total: 1,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.queryByText('Spent 5000 THB at hotel')).not.toBeInTheDocument();
      });
    });

    it('should not display admin reason containing baht', async () => {
      const transactionWithBaht: AdminTransaction[] = [
        {
          ...mockTransactions[2],
          admin_reason: 'Purchase of 2000 baht',
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: transactionWithBaht,
        total: 1,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.queryByText('Purchase of 2000 baht')).not.toBeInTheDocument();
      });
    });

    it('should style admin email with blue color', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const adminEmail = screen.getByText(/Admin: admin@example.com/);
        expect(adminEmail).toHaveClass('text-blue-600');
      });
    });

    it('should style admin reason as italic', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const adminReason = screen.getByText('Loyalty bonus for frequent guest');
        expect(adminReason).toHaveClass('italic');
      });
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no transactions', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: [],
        total: 0,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('No transactions yet')).toBeInTheDocument();
      });
    });

    it('should center empty state text', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: [],
        total: 0,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const emptyState = screen.getByText('No transactions yet');
        expect(emptyState).toHaveClass('text-center');
      });
    });

    it('should not display pagination when no transactions', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: [],
        total: 0,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Pagination Display', () => {
    it('should display pagination info when total exceeds 20', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText(/Showing 20 of 23 transactions/)).toBeInTheDocument();
      });
    });

    it('should not display pagination info when total is 20 or less', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: mockTransactions,
        total: 15,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
      });
    });

    it('should display correct total count', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: mockTransactions,
        total: 50,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText(/50 transactions/)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network error', async () => {
      const error = new Error('Network error');
      vi.mocked(loyaltyService.getAdminTransactions).mockRejectedValueOnce(error);

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith('Error loading admin transactions:', error);
        expect(toast.error).toHaveBeenCalledWith('Network error');
      });
    });

    it('should not display transactions on error', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockRejectedValueOnce(new Error('Network error'));

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.queryByText('+500 pts')).not.toBeInTheDocument();
      });
    });

    it('should stop loading state on error', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockRejectedValueOnce(new Error('Network error'));

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const skeletonElements = document.querySelectorAll('.animate-pulse');
        expect(skeletonElements).toHaveLength(0);
      });
    });
  });

  describe('Scrollable Container', () => {
    it('should have max height constraint', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        const scrollableDiv = container.querySelector('.max-h-64');
        expect(scrollableDiv).toBeInTheDocument();
      });
    });

    it('should have overflow-y-auto for scrolling', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        const scrollableDiv = container.querySelector('.overflow-y-auto');
        expect(scrollableDiv).toBeInTheDocument();
      });
    });
  });

  describe('Transaction Type Badge', () => {
    it('should display type badge for each transaction', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const badges = document.querySelectorAll('.bg-gray-100');
        expect(badges.length).toBeGreaterThan(0);
      });
    });

    it('should style type badge correctly', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        const badge = screen.getByText('earned_stay').closest('div');
        expect(badge).toHaveClass('bg-gray-100', 'px-2', 'py-1', 'rounded');
      });
    });
  });

  describe('Transaction Formatting', () => {
    it('should handle zero points with earned_stay type', async () => {
      const zeroPointsTransaction: AdminTransaction[] = [
        {
          ...mockTransactions[0],
          points: 0,
          type: 'earned_stay',
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: zeroPointsTransaction,
        total: 1,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const points = screen.getByText('+0 pts');
        expect(points).toHaveClass('text-green-600');
      });
    });

    it('should format dates with time', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        // Should display both date and time
        expect(screen.getByText(/15\/01\/2024, \d{2}:\d{2}/)).toBeInTheDocument();
      });
    });

    it('should display partial user names correctly', async () => {
      const partialNameTransaction: AdminTransaction[] = [
        {
          ...mockTransactions[0],
          user_first_name: 'John',
          user_last_name: null,
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: partialNameTransaction,
        total: 1,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('John')).toBeInTheDocument();
      });
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(mockTranslate).toHaveBeenCalledWith('admin.loyalty.transactionHistory');
      });
    });

    it('should use translation for empty state', async () => {
      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: [],
        total: 0,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(mockTranslate).toHaveBeenCalledWith('loyalty.noTransactions');
      });
    });

    it('should use translation for pagination', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(mockTranslate).toHaveBeenCalledWith('common.showing');
        expect(mockTranslate).toHaveBeenCalledWith('common.of');
        expect(mockTranslate).toHaveBeenCalledWith('admin.loyalty.transactions');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', async () => {
      render(<AdminTransactionHistory />);

      await waitFor(() => {
        const heading = screen.getByText('Transaction History');
        expect(heading.tagName).toBe('H4');
      });
    });

    it('should have readable text sizes', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        const textElements = container.querySelectorAll('.text-sm');
        expect(textElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle transactions with missing optional fields', async () => {
      const minimalTransaction: AdminTransaction[] = [
        {
          id: 'txn-min',
          user_id: 'user-min',
          points: 100,
          type: 'earned_stay',
          description: null,
          reference_id: null,
          admin_user_id: null,
          admin_reason: null,
          admin_email: undefined,
          expires_at: null,
          created_at: '2024-01-01T00:00:00Z',
          user_email: 'minimal@example.com',
          user_first_name: null,
          user_last_name: null,
          user_membership_id: null,
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: minimalTransaction,
        total: 1,
      });

      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(container).toBeTruthy();
        expect(screen.getByText('minimal@example.com')).toBeInTheDocument();
      });
    });

    it('should handle very large point values', async () => {
      const largePointsTransaction: AdminTransaction[] = [
        {
          ...mockTransactions[0],
          points: 999999,
        },
      ];

      vi.mocked(loyaltyService.getAdminTransactions).mockResolvedValueOnce({
        transactions: largePointsTransaction,
        total: 1,
      });

      render(<AdminTransactionHistory />);

      await waitFor(() => {
        expect(screen.getByText('+999999 pts')).toBeInTheDocument();
      });
    });

    it('should remove last border from last transaction', async () => {
      const { container } = render(<AdminTransactionHistory />);

      await waitFor(() => {
        const transactions = container.querySelectorAll('.border-b');
        const lastTransaction = transactions[transactions.length - 1];
        expect(lastTransaction).toHaveClass('last:border-b-0');
      });
    });
  });
});
