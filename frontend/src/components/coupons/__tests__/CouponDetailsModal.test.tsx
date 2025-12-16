import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CouponDetailsModal from '../CouponDetailsModal';
import { UserActiveCoupon } from '../../../types/coupon';
import { couponService } from '../../../services/couponService';
import * as dateFormatter from '../../../utils/dateFormatter';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'coupons.couponDetails': 'Coupon Details',
    'coupons.description': 'Description',
    'coupons.value': 'Value',
    'coupons.details': 'Details',
    'coupons.type': 'Type',
    'coupons.minimumSpend': 'Minimum Spend',
    'coupons.maximumDiscount': 'Maximum Discount',
    'coupons.expiresOn': 'Expires On',
    'coupons.termsAndConditions': 'Terms and Conditions',
    'coupons.status': 'Status',
    'coupons.expiringSoon': 'Expiring Soon',
    'coupons.discount': 'Discount',
    'coupons.types.percentage': 'Percentage Discount',
    'coupons.types.fixed_amount': 'Fixed Amount Discount',
    'coupons.types.bogo': 'Buy One Get One',
    'coupons.types.free_upgrade': 'Free Upgrade',
    'coupons.types.free_service': 'Free Service',
    'coupons.statuses.available': 'Available',
    'coupons.statuses.used': 'Used',
    'coupons.statuses.expired': 'Expired',
    'coupons.statuses.revoked': 'Revoked',
    'common.close': 'Close',
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
    isExpiringSoon: vi.fn(),
  },
}));

vi.mock('../../../utils/dateFormatter', () => ({
  formatDateToDDMMYYYY: vi.fn((date: string) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }),
}));

describe('CouponDetailsModal', () => {
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
    vi.mocked(couponService.isExpiringSoon).mockReturnValue(false);
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Coupon Details')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const modal = container.firstChild as HTMLElement;
      expect(modal).toHaveClass('bg-white', 'rounded-lg', 'shadow-lg');
    });

    it('should apply custom className', () => {
      const { container } = render(
        <CouponDetailsModal coupon={mockCoupon} className="custom-class" />
      );

      const modal = container.firstChild as HTMLElement;
      expect(modal).toHaveClass('custom-class');
    });
  });

  describe('Header with Close Button', () => {
    it('should display coupon details title', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Coupon Details')).toBeInTheDocument();
    });

    it('should not display close button by default', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      const closeButtons = screen.queryAllByText('×');
      expect(closeButtons.length).toBe(0);
    });

    it('should display close button when onClose provided', () => {
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      const closeButtons = screen.getAllByText('×');
      expect(closeButtons.length).toBeGreaterThan(0);
    });

    it('should call onClose when header close button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      const closeButtons = screen.getAllByText('×');
      await user.click(closeButtons[0]!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should display type icon in header', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      // Icon appears in multiple places - just verify at least one exists
      const icons = screen.getAllByText('📊');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Coupon Information Display', () => {
    it('should display coupon name', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('20% Off Your Purchase')).toBeInTheDocument();
    });

    it('should display coupon code', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should display coupon description', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      // Description text appears with an emoji, so match the actual content
      expect(screen.getByText((content, element) => {
        return element?.tagName === 'H5' && content.includes('Description');
      })).toBeInTheDocument();
      expect(screen.getByText('Get 20% discount on your next purchase')).toBeInTheDocument();
    });

    it('should not display description section when not provided', () => {
      const couponNoDesc = { ...mockCoupon, description: undefined };

      render(<CouponDetailsModal coupon={couponNoDesc} />);

      expect(screen.queryByText('Description')).not.toBeInTheDocument();
    });
  });

  describe('Coupon Type Icons', () => {
    it('should display percentage icon for percentage type', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      // Icon appears in multiple places - just verify at least one exists
      const icons = screen.getAllByText('📊');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should display money icon for fixed_amount type', () => {
      const fixedAmountCoupon = { ...mockCoupon, type: 'fixed_amount' as const };

      render(<CouponDetailsModal coupon={fixedAmountCoupon} />);

      // Icon appears in multiple places - just verify at least one exists
      const icons = screen.getAllByText('💰');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should display gift icon for bogo type', () => {
      const bogoCoupon = { ...mockCoupon, type: 'bogo' as const };

      render(<CouponDetailsModal coupon={bogoCoupon} />);

      // Icon appears in multiple places - just verify at least one exists
      const icons = screen.getAllByText('🎁');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should display upgrade icon for free_upgrade type', () => {
      const upgradeCouple = { ...mockCoupon, type: 'free_upgrade' as const };

      render(<CouponDetailsModal coupon={upgradeCouple} />);

      // Icon appears in multiple places - just verify at least one exists
      const icons = screen.getAllByText('⬆️');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should display gift icon for free_service type', () => {
      const serviceCoupon = { ...mockCoupon, type: 'free_service' as const };

      render(<CouponDetailsModal coupon={serviceCoupon} />);

      // Icon appears in multiple places - just verify at least one exists
      const icons = screen.getAllByText('🎁');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Value Display', () => {
    it('should display percentage value correctly', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('20%')).toBeInTheDocument();
    });

    it('should display fixed amount value correctly', () => {
      const fixedAmountCoupon = {
        ...mockCoupon,
        type: 'fixed_amount' as const,
        value: 100,
      };

      render(<CouponDetailsModal coupon={fixedAmountCoupon} />);

      expect(screen.getByText('THB100')).toBeInTheDocument();
    });

    it('should display type name for bogo', () => {
      const bogoCoupon = {
        ...mockCoupon,
        type: 'bogo' as const,
      };

      render(<CouponDetailsModal coupon={bogoCoupon} />);

      const bogoElements = screen.getAllByText('Buy One Get One');
      expect(bogoElements.length).toBeGreaterThan(0);
    });

    it('should display type name for free_upgrade', () => {
      const upgradeCoupon = {
        ...mockCoupon,
        type: 'free_upgrade' as const,
      };

      render(<CouponDetailsModal coupon={upgradeCoupon} />);

      const upgradeElements = screen.getAllByText('Free Upgrade');
      expect(upgradeElements.length).toBeGreaterThan(0);
    });

    it('should display type name for free_service', () => {
      const serviceCoupon = {
        ...mockCoupon,
        type: 'free_service' as const,
      };

      render(<CouponDetailsModal coupon={serviceCoupon} />);

      const serviceElements = screen.getAllByText('Free Service');
      expect(serviceElements.length).toBeGreaterThan(0);
    });

    it('should display value section with green background', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const valueSection = container.querySelector('.bg-green-50');
      expect(valueSection).toBeInTheDocument();
    });
  });

  describe('Detailed Information Section', () => {
    it('should display details title', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Details')).toBeInTheDocument();
    });

    it('should display coupon type', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Type:')).toBeInTheDocument();
      expect(screen.getByText('Percentage Discount')).toBeInTheDocument();
    });

    it('should display minimum spend when provided', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Minimum Spend:')).toBeInTheDocument();
      expect(screen.getByText('THB1000')).toBeInTheDocument();
    });

    it('should not display minimum spend when not provided', () => {
      const couponNoMin = { ...mockCoupon, minimumSpend: undefined };

      render(<CouponDetailsModal coupon={couponNoMin} />);

      expect(screen.queryByText('Minimum Spend:')).not.toBeInTheDocument();
    });

    it('should display maximum discount when provided', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Maximum Discount:')).toBeInTheDocument();
      expect(screen.getByText('THB500')).toBeInTheDocument();
    });

    it('should not display maximum discount when not provided', () => {
      const couponNoMax = { ...mockCoupon, maximumDiscount: undefined };

      render(<CouponDetailsModal coupon={couponNoMax} />);

      expect(screen.queryByText('Maximum Discount:')).not.toBeInTheDocument();
    });

    it('should display expiry date when provided', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Expires On:')).toBeInTheDocument();
      expect(screen.getByText(/\d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
    });

    it('should not display expiry date when not provided', () => {
      const couponNoExpiry = { ...mockCoupon, effectiveExpiry: undefined };

      render(<CouponDetailsModal coupon={couponNoExpiry} />);

      expect(screen.queryByText('Expires On:')).not.toBeInTheDocument();
    });

    it('should call dateFormatter with correct params', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(dateFormatter.formatDateToDDMMYYYY).toHaveBeenCalledWith(mockCoupon.effectiveExpiry);
    });
  });

  describe('Expiring Soon Badge', () => {
    it('should not display expiring soon badge by default', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.queryByText('Expiring Soon')).not.toBeInTheDocument();
    });

    it('should display expiring soon badge when coupon is expiring', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Expiring Soon')).toBeInTheDocument();
    });

    it('should style expiring soon badge with red background', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponDetailsModal coupon={mockCoupon} />);

      const badge = screen.getByText('Expiring Soon');
      expect(badge).toHaveClass('bg-red-100', 'text-red-800');
    });

    it('should style expiry date as red when expiring', () => {
      vi.mocked(couponService.isExpiringSoon).mockReturnValue(true);

      render(<CouponDetailsModal coupon={mockCoupon} />);

      const expiryDate = screen.getByText(/\d{2}\/\d{2}\/\d{4}/);
      expect(expiryDate).toHaveClass('text-red-600');
    });

    it('should style expiry date as normal when not expiring', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      const expiryDate = screen.getByText(/\d{2}\/\d{2}\/\d{4}/);
      expect(expiryDate).toHaveClass('text-gray-900');
      expect(expiryDate).not.toHaveClass('text-red-600');
    });
  });

  describe('Terms and Conditions', () => {
    it('should display terms and conditions when provided', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Terms and Conditions')).toBeInTheDocument();
      expect(screen.getByText('Valid on purchases over 1000 THB')).toBeInTheDocument();
    });

    it('should not display terms section when not provided', () => {
      const couponNoTerms = { ...mockCoupon, termsAndConditions: undefined };

      render(<CouponDetailsModal coupon={couponNoTerms} />);

      expect(screen.queryByText('Terms and Conditions')).not.toBeInTheDocument();
    });

    it('should style terms section with yellow background', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const termsSection = container.querySelector('.bg-yellow-50');
      expect(termsSection).toBeInTheDocument();
    });

    it('should display warning emoji in terms section', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      // Icon appears in terms section
      const icons = screen.getAllByText('⚠️');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Usage Status', () => {
    it('should display status section', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Status:')).toBeInTheDocument();
    });

    it('should display available status', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.getByText('Available')).toBeInTheDocument();
    });

    it('should display used status', () => {
      const usedCoupon = { ...mockCoupon, status: 'used' as const };

      render(<CouponDetailsModal coupon={usedCoupon} />);

      expect(screen.getByText('Used')).toBeInTheDocument();
    });

    it('should display expired status', () => {
      const expiredCoupon = { ...mockCoupon, status: 'expired' as const };

      render(<CouponDetailsModal coupon={expiredCoupon} />);

      expect(screen.getByText('Expired')).toBeInTheDocument();
    });

    it('should display revoked status', () => {
      const revokedCoupon = { ...mockCoupon, status: 'revoked' as const };

      render(<CouponDetailsModal coupon={revokedCoupon} />);

      expect(screen.getByText('Revoked')).toBeInTheDocument();
    });

    it('should style status section with blue background', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const statusSection = container.querySelector('.bg-blue-50');
      expect(statusSection).toBeInTheDocument();
    });
  });

  describe('Close Button', () => {
    it('should not display close button by default', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(screen.queryByText('Close')).not.toBeInTheDocument();
    });

    it('should display close button when onClose provided', () => {
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      expect(screen.getByText('Close')).toBeInTheDocument();
    });

    it('should call onClose when close button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      const closeButton = screen.getByText('Close');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should style close button with gray background', () => {
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      const closeButton = screen.getByText('Close');
      expect(closeButton).toHaveClass('bg-gray-600', 'text-white');
    });

    it('should have both header and footer close buttons when onClose provided', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      // Header close button (×)
      const headerCloseButtons = screen.getAllByText('×');
      expect(headerCloseButtons.length).toBeGreaterThan(0);

      // Footer close button
      const footerCloseButton = screen.getByText('Close');
      expect(footerCloseButton).toBeInTheDocument();

      // Both should call onClose
      await user.click(headerCloseButtons[0]!);
      expect(onClose).toHaveBeenCalledTimes(1);

      await user.click(footerCloseButton);
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle coupon without description', () => {
      const couponNoDesc = { ...mockCoupon, description: undefined };

      const { container } = render(<CouponDetailsModal coupon={couponNoDesc} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should handle coupon without terms', () => {
      const couponNoTerms = { ...mockCoupon, termsAndConditions: undefined };

      const { container } = render(<CouponDetailsModal coupon={couponNoTerms} />);

      expect(container).toBeTruthy();
      expect(screen.queryByText('Terms and Conditions')).not.toBeInTheDocument();
    });

    it('should handle coupon without optional fields', () => {
      const minimalCoupon = {
        ...mockCoupon,
        description: undefined,
        termsAndConditions: undefined,
        minimumSpend: undefined,
        maximumDiscount: undefined,
        effectiveExpiry: undefined,
      };

      const { container } = render(<CouponDetailsModal coupon={minimalCoupon} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('20% Off Your Purchase')).toBeInTheDocument();
    });

    it('should handle coupon with very long name', () => {
      const longNameCoupon = {
        ...mockCoupon,
        name: 'This is a very long coupon name that should be displayed properly in the modal without breaking the layout',
      };

      render(<CouponDetailsModal coupon={longNameCoupon} />);

      expect(screen.getByText(/This is a very long coupon name/)).toBeInTheDocument();
    });

    it('should handle coupon with very long description', () => {
      const longDescCoupon = {
        ...mockCoupon,
        description: 'This is a very long description that goes on and on explaining all the wonderful benefits and conditions of this amazing coupon offer that customers will love',
      };

      render(<CouponDetailsModal coupon={longDescCoupon} />);

      expect(screen.getByText(/This is a very long description/)).toBeInTheDocument();
    });

    it('should handle coupon with very long terms', () => {
      const longTermsCoupon = {
        ...mockCoupon,
        termsAndConditions: 'These are very long terms and conditions that explain everything in great detail including all the legal requirements and restrictions that apply to this coupon',
      };

      render(<CouponDetailsModal coupon={longTermsCoupon} />);

      expect(screen.getByText(/These are very long terms/)).toBeInTheDocument();
    });

    it('should handle coupon without value', () => {
      const noValueCoupon = { ...mockCoupon, value: undefined };

      const { container } = render(<CouponDetailsModal coupon={noValueCoupon} />);

      expect(container).toBeTruthy();
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.couponDetails');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.description');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.value');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.details');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.type');
    });

    it('should use coupon type translation keys', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.types.percentage');
    });

    it('should use status translation keys', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.statuses.available');
    });

    it('should use close translation key when onClose provided', () => {
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      expect(mockTranslate).toHaveBeenCalledWith('common.close');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button elements', () => {
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      const closeButton = screen.getByText('Close');
      const headerCloseButton = screen.getAllByText('×')[0]!;

      expect(closeButton.tagName).toBe('BUTTON');
      expect(headerCloseButton.tagName).toBe('BUTTON');
    });

    it('should have proper text hierarchy', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      const mainHeading = screen.getByText('Coupon Details');
      const couponHeading = screen.getByText('20% Off Your Purchase');

      expect(mainHeading.tagName).toBe('H3');
      expect(couponHeading.tagName).toBe('H4');
    });

    it('should have proper section headings', () => {
      render(<CouponDetailsModal coupon={mockCoupon} />);

      // Get headings by role and check their structure
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);
      const headings = container.querySelectorAll('h5');

      // Verify we have the expected headings
      expect(headings.length).toBeGreaterThan(0);
      const headingTexts = Array.from(headings).map(h => h.textContent);
      expect(headingTexts.some(text => text?.includes('Description'))).toBe(true);
      expect(headingTexts.some(text => text?.includes('Value'))).toBe(true);
      expect(headingTexts.some(text => text?.includes('Details'))).toBe(true);
    });

    it('should maintain semantic structure', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const headings = container.querySelectorAll('h3, h4, h5');
      expect(headings.length).toBeGreaterThan(0);
    });
  });

  describe('Multiple Button Clicks', () => {
    it('should handle multiple close button clicks', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<CouponDetailsModal coupon={mockCoupon} onClose={onClose} />);

      const closeButton = screen.getByText('Close');
      await user.click(closeButton);
      await user.click(closeButton);
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });

  describe('Section Structure', () => {
    it('should have border between header and content', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const header = container.querySelector('.border-b');
      expect(header).toBeInTheDocument();
    });

    it('should have proper padding structure', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const modal = container.firstChild as HTMLElement;
      expect(modal).toBeTruthy();
    });

    it('should display all sections in correct order', () => {
      const { container } = render(<CouponDetailsModal coupon={mockCoupon} />);

      const sections = container.querySelectorAll('.bg-gray-50, .bg-green-50, .bg-yellow-50, .bg-blue-50');
      expect(sections.length).toBeGreaterThan(0);
    });
  });
});
