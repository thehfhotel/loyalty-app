import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionList from '../TransactionList';
import { PointsTransaction } from '../../../services/loyaltyService';

// Mock dependencies
const mockTranslate = vi.fn((key: string, params?: any) => {
  const translations: Record<string, string> = {
    'loyalty.transactionHistory': 'Transaction History',
    'loyalty.noTransactions': 'No transactions yet',
    'loyalty.points': 'points',
    'loyalty.pointsEarned': 'Points Earned',
    'loyalty.pointsDeducted': 'Points Deducted',
    'loyalty.expires': 'Expires',
    'common.loadMore': 'Load More',
    'loyalty.transactionTypes.earnedStay': 'Earned from stay',
    'loyalty.transactionTypes.earnedBonus': 'Bonus points',
    'loyalty.transactionTypes.redeemed': 'Redeemed',
    'loyalty.transactionTypes.expired': 'Expired',
    'loyalty.transactionTypes.adminAdjustment': 'Admin adjustment',
    'loyalty.transactionTypes.adminAward': 'Admin award',
    'loyalty.transactionTypes.adminDeduction': 'Admin deduction',
  };

  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiPlus: () => <span data-testid="plus-icon">+</span>,
  FiMinus: () => <span data-testid="minus-icon">-</span>,
  FiClock: () => <span data-testid="clock-icon">🕐</span>,
  FiUser: () => <span data-testid="user-icon">👤</span>,
}));

vi.mock('../../../utils/dateFormatter', () => ({
  formatDateToDDMMYYYY: vi.fn((date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }),
}));

describe('TransactionList', () => {
  const mockTransactions: PointsTransaction[] = [
    {
      id: 'txn-1',
      user_id: 'user-123',
      points: 500,
      type: 'earned_stay',
      description: 'Points earned from hotel stay',
      reference_id: 'booking-456',
      admin_user_id: null,
      admin_reason: null,
      admin_email: null,
      expires_at: null,
      created_at: '2024-01-15T10:30:00Z',
    },
    {
      id: 'txn-2',
      user_id: 'user-123',
      points: -200,
      type: 'redeemed',
      description: 'Points redeemed for discount',
      reference_id: 'redemption-789',
      admin_user_id: null,
      admin_reason: null,
      admin_email: null,
      expires_at: null,
      created_at: '2024-01-10T14:20:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.getByText('Transaction History')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<TransactionList transactions={mockTransactions} />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<TransactionList transactions={mockTransactions} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('bg-white', 'rounded-lg', 'shadow-md', 'p-6');
    });
  });

  describe('Loading State', () => {
    it('should display loading skeleton when isLoading is true', () => {
      render(<TransactionList transactions={[]} isLoading={true} />);

      expect(screen.getByText('Transaction History')).toBeInTheDocument();
      const skeletonElements = document.querySelectorAll('.animate-pulse');
      expect(skeletonElements.length).toBeGreaterThan(0);
    });

    it('should not display transactions when loading', () => {
      render(<TransactionList transactions={mockTransactions} isLoading={true} />);

      expect(screen.queryByText('Earned from stay')).not.toBeInTheDocument();
    });

    it('should display 5 skeleton items', () => {
      const { container } = render(<TransactionList transactions={[]} isLoading={true} />);

      const skeletonElements = container.querySelectorAll('.animate-pulse');
      expect(skeletonElements).toHaveLength(5);
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no transactions', () => {
      render(<TransactionList transactions={[]} />);

      expect(screen.getByText('No transactions yet')).toBeInTheDocument();
      expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
    });

    it('should not display empty state when transactions exist', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    });
  });

  describe('Transaction List Rendering', () => {
    it('should render all transactions', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.getByText('Earned from stay')).toBeInTheDocument();
      expect(screen.getByText('Redeemed')).toBeInTheDocument();
    });

    it('should display correct number of transactions', () => {
      render(<TransactionList transactions={mockTransactions} />);

      const plusIcons = screen.getAllByTestId('plus-icon');
      const minusIcons = screen.getAllByTestId('minus-icon');
      expect(plusIcons.length + minusIcons.length).toBe(mockTransactions.length);
    });

    it('should display transaction points', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.getByText('+500 points')).toBeInTheDocument();
      expect(screen.getByText('-200 points')).toBeInTheDocument();
    });
  });

  describe('Transaction Icons and Colors', () => {
    it('should display plus icon for positive points', () => {
      render(<TransactionList transactions={mockTransactions} />);

      const plusIcons = screen.getAllByTestId('plus-icon');
      expect(plusIcons.length).toBeGreaterThan(0);
    });

    it('should display minus icon for negative points', () => {
      render(<TransactionList transactions={mockTransactions} />);

      const minusIcons = screen.getAllByTestId('minus-icon');
      expect(minusIcons.length).toBeGreaterThan(0);
    });

    it('should apply green background for positive points', () => {
      const { container } = render(<TransactionList transactions={mockTransactions} />);

      const greenBackgrounds = container.querySelectorAll('.bg-green-50');
      expect(greenBackgrounds.length).toBeGreaterThan(0);
    });

    it('should apply red background for negative points', () => {
      const { container } = render(<TransactionList transactions={mockTransactions} />);

      const redBackgrounds = container.querySelectorAll('.bg-red-50');
      expect(redBackgrounds.length).toBeGreaterThan(0);
    });
  });

  describe('Transaction Types and Descriptions', () => {
    it('should display earned stay description', () => {
      const earnedStayTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        type: 'earned_stay',
        points: 500,
      }];

      render(<TransactionList transactions={earnedStayTxn} />);

      expect(screen.getByText('Earned from stay')).toBeInTheDocument();
    });

    it('should display redeemed description', () => {
      const redeemedTxn: PointsTransaction[] = [{
        ...mockTransactions[1],
        type: 'redeemed',
        points: -200,
      }];

      render(<TransactionList transactions={redeemedTxn} />);

      expect(screen.getByText('Redeemed')).toBeInTheDocument();
    });

    it('should display admin award description', () => {
      const adminAwardTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        type: 'admin_award',
        points: 1000,
      }];

      render(<TransactionList transactions={adminAwardTxn} />);

      expect(screen.getByText('Admin award')).toBeInTheDocument();
    });

    it('should display expired description', () => {
      const expiredTxn: PointsTransaction[] = [{
        ...mockTransactions[1],
        type: 'expired',
        points: -100,
      }];

      render(<TransactionList transactions={expiredTxn} />);

      expect(screen.getByText('Expired')).toBeInTheDocument();
    });
  });

  describe('Date Formatting', () => {
    it('should display formatted date and time', () => {
      render(<TransactionList transactions={mockTransactions} />);

      // Should display date in DD/MM/YYYY HH:MM format
      expect(screen.getByText(/15\/01\/2024/)).toBeInTheDocument();
      expect(screen.getByText(/10\/01\/2024/)).toBeInTheDocument();
    });
  });

  describe('Admin Information Display', () => {
    it('should not display admin email by default', () => {
      const txnWithAdmin: PointsTransaction[] = [{
        ...mockTransactions[0],
        admin_email: 'admin@example.com',
      }];

      render(<TransactionList transactions={txnWithAdmin} />);

      expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
    });

    it('should display admin email when showAdminInfo is true', () => {
      const txnWithAdmin: PointsTransaction[] = [{
        ...mockTransactions[0],
        admin_email: 'admin@example.com',
      }];

      render(<TransactionList transactions={txnWithAdmin} showAdminInfo={true} />);

      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      expect(screen.getByTestId('user-icon')).toBeInTheDocument();
    });

    it('should display admin reason when present', () => {
      const txnWithReason: PointsTransaction[] = [{
        ...mockTransactions[0],
        admin_reason: 'Bonus for loyalty',
      }];

      render(<TransactionList transactions={txnWithReason} />);

      expect(screen.getByText('Bonus for loyalty')).toBeInTheDocument();
    });

    it('should not display admin reason containing THB', () => {
      const txnWithThb: PointsTransaction[] = [{
        ...mockTransactions[0],
        admin_reason: 'Spent 5000 THB',
      }];

      render(<TransactionList transactions={txnWithThb} />);

      expect(screen.queryByText('Spent 5000 THB')).not.toBeInTheDocument();
    });
  });

  describe('Expiry Date Display', () => {
    it('should display expiry date when present', () => {
      const txnWithExpiry: PointsTransaction[] = [{
        ...mockTransactions[0],
        expires_at: '2024-12-31T23:59:59Z',
      }];

      const { container } = render(<TransactionList transactions={txnWithExpiry} />);

      expect(screen.getByText(/Expires/)).toBeInTheDocument();
      // Check that the expiry date container has the date format
      const expiryContainer = container.querySelector('.text-yellow-600');
      expect(expiryContainer).toBeTruthy();
      expect(expiryContainer?.textContent).toMatch(/Expires.*\d{2}\/\d{2}\/\d{4}/);
    });

    it('should not display expiry date when null', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
    });
  });

  describe('Load More Button', () => {
    it('should not display load more button by default', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.queryByText('Load More')).not.toBeInTheDocument();
    });

    it('should display load more button when showLoadMore is true', () => {
      render(<TransactionList transactions={mockTransactions} showLoadMore={true} />);

      expect(screen.getByText('Load More')).toBeInTheDocument();
    });

    it('should call onLoadMore when button clicked', async () => {
      const user = userEvent.setup();
      const mockLoadMore = vi.fn();

      render(
        <TransactionList
          transactions={mockTransactions}
          showLoadMore={true}
          onLoadMore={mockLoadMore}
        />
      );

      const loadMoreButton = screen.getByText('Load More');
      await user.click(loadMoreButton);

      expect(mockLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  describe('Points Formatting', () => {
    it('should format large numbers with thousands separator', () => {
      const largeTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        points: 12345,
      }];

      render(<TransactionList transactions={largeTxn} />);

      expect(screen.getByText(/12,345/)).toBeInTheDocument();
    });

    it('should display positive sign for earned points', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.getByText(/\+500/)).toBeInTheDocument();
    });

    it('should display negative sign for deducted points', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(screen.getByText(/-200/)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero points transaction', () => {
      const zeroTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        points: 0,
      }];

      const { container } = render(<TransactionList transactions={zeroTxn} />);

      expect(container).toBeTruthy();
    });

    it('should handle null description', () => {
      const nullDescTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        description: null,
      }];

      const { container } = render(<TransactionList transactions={nullDescTxn} />);

      expect(container).toBeTruthy();
    });

    it('should handle unknown transaction type', () => {
      const unknownTypeTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        type: 'unknown_type',
      }];

      render(<TransactionList transactions={unknownTypeTxn} />);

      expect(screen.getByText('Points Earned')).toBeInTheDocument();
    });

    it('should handle very long admin reasons', () => {
      const longReasonTxn: PointsTransaction[] = [{
        ...mockTransactions[0],
        admin_reason: 'This is a very long admin reason that should still display properly without breaking the layout or causing issues',
      }];

      render(<TransactionList transactions={longReasonTxn} />);

      expect(screen.getByText(/This is a very long admin reason/)).toBeInTheDocument();
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.transactionHistory');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.points');
    });

    it('should use transaction type translation keys', () => {
      render(<TransactionList transactions={mockTransactions} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.transactionTypes.earnedStay');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.transactionTypes.redeemed');
    });

    it('should use empty state translation', () => {
      render(<TransactionList transactions={[]} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.noTransactions');
    });
  });

  describe('Accessibility', () => {
    it('should have proper text hierarchy', () => {
      render(<TransactionList transactions={mockTransactions} />);

      const heading = screen.getByText('Transaction History');
      expect(heading.tagName).toBe('H3');
    });

    it('should have accessible button for load more', () => {
      render(<TransactionList transactions={mockTransactions} showLoadMore={true} />);

      const button = screen.getByText('Load More');
      expect(button.tagName).toBe('BUTTON');
    });
  });
});
