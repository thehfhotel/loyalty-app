import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CouponCard from '../CouponCard';
import { UserActiveCoupon } from '../../../types/coupon';
import { couponService } from '../../../services/couponService';
import * as dateFormatter from '../../../utils/dateFormatter';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'coupons.expiringSoon': 'Expiring Soon',
    'coupons.useCoupon': 'Use Coupon',
    'coupons.viewDetails': 'View Details',
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
    getExpiryDate: vi.fn(),
    isExpiringSoon: vi.fn(),
    formatMinimumSpend: vi.fn(),
  },
}));

vi.mock('../../../utils/dateFormatter', () => ({
  formatExpiryDateWithRelative: vi.fn(),
}));

describe('CouponCard', () => {
  const mockCoupon: UserActiveCoupon = {
    userCouponId: 'uc-1',
    userId: 'user-123',
    status: 'available',
    qrCode: 'QR123456',
    expiresAt: '2024-12-31T23:59:59Z',
    assignedAt: '2024-01-01T00:00:00Z',
    couponId: 'coupon-1',
    code: 'SAVE20',
    name: '20% Off Your Purchase',
    description: 'Get 20% discount on your next purchase',
    termsAndConditions: 'Valid on purchases over 1000 THB',
    type: 'percentage',
    value: 20,
    currency: 'THB',
    minimumSpend: 1000,
    maximumDiscount: 500,
    couponExpiresAt: '2024-12-31T23:59:59Z',
    effectiveExpiry: '2024-12-31T23:59:59Z',
    expiringSoon: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(couponService.getExpiryDate).mockReturnValue(new Date('2024-12-31T23:59:59Z'));
    vi.mocked(couponService.isExpiringSoon).mockReturnValue(false);
    vi.mocked(couponService.formatMinimumSpend).mockReturnValue('Min. spend: ฿1,000');
    vi.mocked(dateFormatter.formatExpiryDateWithRelative).mockReturnValue('Expires on 31 Dec 2024');
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('20% Off Your Purchase')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('bg-white', 'rounded-lg', 'shadow-md');
    });
  });

  describe('Expiring Soon Badge', () => {
    it('should not display expiring soon badge by default', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.queryByText('Expiring Soon')).not.toBeInTheDocument();
    });

    it('should display expiring soon badge when coupon is expiring', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('Expiring Soon')).toBeInTheDocument();
    });

    it('should style expiring soon badge correctly', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponCard coupon={mockCoupon} />);

      const badge = screen.getByText('Expiring Soon');
      expect(badge).toHaveClass('bg-red-500', 'text-white');
    });

    it('should position expiring soon badge at top right', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponCard coupon={mockCoupon} />);

      const badge = screen.getByText('Expiring Soon');
      expect(badge).toHaveClass('absolute', 'top-2', 'right-2');
    });
  });

  describe('Styling - Border and Background', () => {
    it('should have default border when not expiring', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('border-gray-200');
      expect(card).not.toHaveClass('border-red-300', 'bg-red-50');
    });

    it('should have red border and background when expiring', () => {
      // Clear previous mocks
      vi.clearAllMocks();

      // Set mock return value
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      // Verify mock setup BEFORE render
      expect(couponService.isExpiringSoon(mockCoupon)).toBe(true);

      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('border-red-300', 'bg-red-50');

      // Verify mock was actually called by component
      expect(couponService.isExpiringSoon).toHaveBeenCalledWith(mockCoupon);
    });

    it('should apply custom className', () => {
      const { container } = render(
        <CouponCard coupon={mockCoupon} className="custom-class" />
      );

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('custom-class');
    });
  });

  describe('Coupon Information Display', () => {
    it('should display coupon name', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('20% Off Your Purchase')).toBeInTheDocument();
    });

    it('should display coupon code', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should display coupon description', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('Get 20% discount on your next purchase')).toBeInTheDocument();
    });

    it('should not display description when not provided', () => {
      const couponWithoutDesc = { ...mockCoupon, description: undefined };

      render(<CouponCard coupon={couponWithoutDesc} />);

      expect(screen.queryByText('Get 20% discount on your next purchase')).not.toBeInTheDocument();
    });

    it('should truncate long coupon names', () => {
      render(<CouponCard coupon={mockCoupon} />);

      const nameElement = screen.getByText('20% Off Your Purchase');
      expect(nameElement).toHaveClass('truncate');
    });

    it('should limit description to 2 lines', () => {
      render(<CouponCard coupon={mockCoupon} />);

      const descElement = screen.getByText('Get 20% discount on your next purchase');
      expect(descElement).toHaveClass('line-clamp-2');
    });
  });

  describe('Expiry Date Display', () => {
    it('should display expiry date', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('Expires on 31 Dec 2024')).toBeInTheDocument();
    });

    it('should call dateFormatter with correct params', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(dateFormatter.formatExpiryDateWithRelative).toHaveBeenCalledWith(
        '2024-12-31T23:59:59Z',
        mockTranslate
      );
    });

    it('should not display expiry date when null', () => {
      vi.mocked(dateFormatter.formatExpiryDateWithRelative).mockReturnValue(null);

      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.queryByText('Expires on 31 Dec 2024')).not.toBeInTheDocument();
    });

    it('should style expiry date as red when expiring', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponCard coupon={mockCoupon} />);

      const expiryElement = screen.getByText('Expires on 31 Dec 2024');
      expect(expiryElement).toHaveClass('text-red-600', 'font-medium');
    });

    it('should style expiry date as gray when not expiring', () => {
      render(<CouponCard coupon={mockCoupon} />);

      const expiryElement = screen.getByText('Expires on 31 Dec 2024');
      expect(expiryElement).toHaveClass('text-gray-500');
      expect(expiryElement).not.toHaveClass('text-red-600');
    });
  });

  describe('Minimum Spend Display', () => {
    it('should display minimum spend text', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.getByText('Min. spend: ฿1,000')).toBeInTheDocument();
    });

    it('should call formatMinimumSpend service method', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(couponService.formatMinimumSpend).toHaveBeenCalledWith(mockCoupon);
    });

    it('should not display minimum spend when null', () => {
      vi.mocked(couponService.formatMinimumSpend).mockReturnValue(null);

      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.queryByText('Min. spend: ฿1,000')).not.toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should not display any buttons by default', () => {
      render(<CouponCard coupon={mockCoupon} />);

      expect(screen.queryByText('Use Coupon')).not.toBeInTheDocument();
      expect(screen.queryByText('View Details')).not.toBeInTheDocument();
    });

    it('should display use button when onUse provided', () => {
      const onUse = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} />);

      expect(screen.getByText('Use Coupon')).toBeInTheDocument();
    });

    it('should display view details button when onViewDetails provided', () => {
      const onViewDetails = vi.fn();

      render(<CouponCard coupon={mockCoupon} onViewDetails={onViewDetails} />);

      expect(screen.getByText('View Details')).toBeInTheDocument();
    });

    it('should display both buttons when both callbacks provided', () => {
      const onUse = vi.fn();
      const onViewDetails = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} onViewDetails={onViewDetails} />);

      expect(screen.getByText('Use Coupon')).toBeInTheDocument();
      expect(screen.getByText('View Details')).toBeInTheDocument();
    });

    it('should style use button with blue background', () => {
      const onUse = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} />);

      const button = screen.getByText('Use Coupon');
      expect(button).toHaveClass('bg-blue-600', 'text-white');
    });

    it('should style view details button with gray background', () => {
      const onViewDetails = vi.fn();

      render(<CouponCard coupon={mockCoupon} onViewDetails={onViewDetails} />);

      const button = screen.getByText('View Details');
      expect(button).toHaveClass('bg-gray-100', 'text-gray-700');
    });
  });

  describe('Button Interactions', () => {
    it('should call onUse when use button clicked', async () => {
      const user = userEvent.setup();
      const onUse = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} />);

      const button = screen.getByText('Use Coupon');
      await user.click(button);

      expect(onUse).toHaveBeenCalledTimes(1);
      expect(onUse).toHaveBeenCalledWith(mockCoupon);
    });

    it('should call onViewDetails when view details button clicked', async () => {
      const user = userEvent.setup();
      const onViewDetails = vi.fn();

      render(<CouponCard coupon={mockCoupon} onViewDetails={onViewDetails} />);

      const button = screen.getByText('View Details');
      await user.click(button);

      expect(onViewDetails).toHaveBeenCalledTimes(1);
      expect(onViewDetails).toHaveBeenCalledWith(mockCoupon);
    });

    it('should handle multiple button clicks', async () => {
      const user = userEvent.setup();
      const onUse = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} />);

      const button = screen.getByText('Use Coupon');
      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(onUse).toHaveBeenCalledTimes(3);
    });
  });

  describe('Decorative Elements', () => {
    it('should display left perforation', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const perforations = container.querySelectorAll('.rounded-full');
      expect(perforations.length).toBeGreaterThanOrEqual(2);
    });

    it('should display right perforation', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const perforations = container.querySelectorAll('.rounded-full');
      expect(perforations.length).toBeGreaterThanOrEqual(2);
    });

    it('should position perforations at center height', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const perforations = container.querySelectorAll('.top-1\\/2');
      expect(perforations.length).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle coupon without description', () => {
      const couponNoDesc = { ...mockCoupon, description: undefined };

      const { container } = render(<CouponCard coupon={couponNoDesc} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should handle coupon without expiry date', () => {
      vi.mocked(dateFormatter.formatExpiryDateWithRelative).mockReturnValue(null);

      const { container } = render(<CouponCard coupon={mockCoupon} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should handle coupon without minimum spend', () => {
      vi.mocked(couponService.formatMinimumSpend).mockReturnValue(null);

      const { container } = render(<CouponCard coupon={mockCoupon} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should handle coupon with very long name', () => {
      const longNameCoupon = {
        ...mockCoupon,
        name: 'This is a very long coupon name that should be truncated properly to maintain layout integrity',
      };

      render(<CouponCard coupon={longNameCoupon} />);

      const nameElement = screen.getByText(/This is a very long coupon name/);
      expect(nameElement).toHaveClass('truncate');
    });

    it('should handle coupon with very long description', () => {
      const longDescCoupon = {
        ...mockCoupon,
        description: 'This is a very long description that goes on and on explaining all the wonderful benefits and conditions of this amazing coupon offer that customers will love',
      };

      render(<CouponCard coupon={longDescCoupon} />);

      const descElement = screen.getByText(/This is a very long description/);
      expect(descElement).toHaveClass('line-clamp-2');
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);
      const onUse = vi.fn();
      const onViewDetails = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} onViewDetails={onViewDetails} />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.expiringSoon');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.useCoupon');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.viewDetails');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button elements', () => {
      const onUse = vi.fn();
      const onViewDetails = vi.fn();

      render(<CouponCard coupon={mockCoupon} onUse={onUse} onViewDetails={onViewDetails} />);

      const useButton = screen.getByText('Use Coupon');
      const detailsButton = screen.getByText('View Details');

      expect(useButton.tagName).toBe('BUTTON');
      expect(detailsButton.tagName).toBe('BUTTON');
    });

    it('should have proper text hierarchy', () => {
      render(<CouponCard coupon={mockCoupon} />);

      const heading = screen.getByText('20% Off Your Purchase');
      expect(heading.tagName).toBe('H3');
    });

    it('should maintain semantic structure', () => {
      const { container } = render(<CouponCard coupon={mockCoupon} />);

      const heading = container.querySelector('h3');
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveClass('text-lg', 'font-semibold');
    });
  });
});
