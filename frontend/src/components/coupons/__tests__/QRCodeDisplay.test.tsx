import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QRCodeDisplay from '../QRCodeDisplay';
import { UserActiveCoupon } from '../../../types/coupon';
import toast from 'react-hot-toast';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'coupons.qrCode': 'QR Code',
    'coupons.howToUse': 'How to Use',
    'coupons.showQRCode': 'Show this QR code to staff',
    'coupons.letStaffScan': 'Let staff scan the code',
    'coupons.enjoyDiscount': 'Enjoy your discount',
    'coupons.details': 'Coupon Details',
    'coupons.type': 'Type',
    'coupons.value': 'Value',
    'coupons.minimumSpend': 'Minimum Spend',
    'coupons.maximumDiscount': 'Maximum Discount',
    'coupons.expiresOn': 'Expires On',
    'coupons.termsAndConditions': 'Terms and Conditions',
    'coupons.copyCode': 'Copy Code',
    'coupons.share': 'Share',
    'coupons.qrCodeCopied': 'QR Code copied to clipboard',
    'coupons.types.percentage': 'Percentage Discount',
    'coupons.types.fixed_amount': 'Fixed Amount Discount',
    'coupons.types.bogo': 'Buy One Get One',
    'coupons.types.free_upgrade': 'Free Upgrade',
  };
  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
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

describe('QRCodeDisplay', () => {
  const mockCoupon: UserActiveCoupon = {
    userCouponId: 'uc-1',
    userId: 'user-123',
    status: 'available',
    qrCode: 'QR123456789',
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

  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };
  let mockShare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mocks for each test
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    mockShare = vi.fn().mockResolvedValue(undefined);

    // Use vi.stubGlobal for proper global mocking in Vitest
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: mockClipboard,
      share: mockShare,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('QR Code')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<QRCodeDisplay coupon={mockCoupon} />);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('bg-white', 'rounded-lg', 'shadow-lg');
    });
  });

  describe('Header with Close Button', () => {
    it('should display QR Code title', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('QR Code')).toBeInTheDocument();
    });

    it('should not display close button by default', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.queryByText('×')).not.toBeInTheDocument();
    });

    it('should display close button when onClose provided', () => {
      const onClose = vi.fn();

      render(<QRCodeDisplay coupon={mockCoupon} onClose={onClose} />);

      expect(screen.getByText('×')).toBeInTheDocument();
    });

    it('should call onClose when close button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<QRCodeDisplay coupon={mockCoupon} onClose={onClose} />);

      const closeButton = screen.getByText('×');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Coupon Information Display', () => {
    it('should display coupon name', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('20% Off Your Purchase')).toBeInTheDocument();
    });

    it('should display coupon code', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should display coupon description', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Get 20% discount on your next purchase')).toBeInTheDocument();
    });

    it('should not display description when not provided', () => {
      const couponNoDesc = { ...mockCoupon, description: undefined };

      render(<QRCodeDisplay coupon={couponNoDesc} />);

      expect(screen.queryByText('Get 20% discount on your next purchase')).not.toBeInTheDocument();
    });
  });

  describe('QR Code Display', () => {
    it('should display QR code value', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('QR123456789')).toBeInTheDocument();
    });

    it('should display QR code in placeholder container', () => {
      const { container } = render(<QRCodeDisplay coupon={mockCoupon} />);

      const qrContainer = container.querySelector('.bg-gray-100.border-dashed');
      expect(qrContainer).toBeInTheDocument();
    });

    it('should display phone emoji icon', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('📱')).toBeInTheDocument();
    });
  });

  describe('Instructions Section', () => {
    it('should display how to use title', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('How to Use')).toBeInTheDocument();
    });

    it('should display all three instructions', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText(/Show this QR code to staff/)).toBeInTheDocument();
      expect(screen.getByText(/Let staff scan the code/)).toBeInTheDocument();
      expect(screen.getByText(/Enjoy your discount/)).toBeInTheDocument();
    });

    it('should display instructions in ordered list', () => {
      const { container } = render(<QRCodeDisplay coupon={mockCoupon} />);

      const orderedList = container.querySelector('ol');
      expect(orderedList).toBeInTheDocument();
    });
  });

  describe('Coupon Details Section', () => {
    it('should display details title', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Coupon Details')).toBeInTheDocument();
    });

    it('should display coupon type', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Type:')).toBeInTheDocument();
      expect(screen.getByText('Percentage Discount')).toBeInTheDocument();
    });

    it('should display coupon value label', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Value:')).toBeInTheDocument();
    });

    it('should display minimum spend when provided', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Minimum Spend:')).toBeInTheDocument();
      expect(screen.getByText('THB1000')).toBeInTheDocument();
    });

    it('should not display minimum spend when not provided', () => {
      const couponNoMin = { ...mockCoupon, minimumSpend: undefined };

      render(<QRCodeDisplay coupon={couponNoMin} />);

      expect(screen.queryByText('Minimum Spend:')).not.toBeInTheDocument();
    });

    it('should display maximum discount when provided', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Maximum Discount:')).toBeInTheDocument();
      expect(screen.getByText('THB500')).toBeInTheDocument();
    });

    it('should not display maximum discount when not provided', () => {
      const couponNoMax = { ...mockCoupon, maximumDiscount: undefined };

      render(<QRCodeDisplay coupon={couponNoMax} />);

      expect(screen.queryByText('Maximum Discount:')).not.toBeInTheDocument();
    });

    it('should display expiry date when provided', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Expires On:')).toBeInTheDocument();
      // Date format may vary due to timezone conversion
      expect(screen.getByText(/\d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
    });

    it('should not display expiry date when not provided', () => {
      const couponNoExpiry = { ...mockCoupon, effectiveExpiry: undefined };

      render(<QRCodeDisplay coupon={couponNoExpiry} />);

      expect(screen.queryByText('Expires On:')).not.toBeInTheDocument();
    });
  });

  describe('Value Formatting', () => {
    it('should format percentage value correctly', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('20%')).toBeInTheDocument();
    });

    it('should format fixed amount value correctly', () => {
      const fixedAmountCoupon = {
        ...mockCoupon,
        type: 'fixed_amount' as const,
        value: 100,
      };

      render(<QRCodeDisplay coupon={fixedAmountCoupon} />);

      expect(screen.getByText('THB100')).toBeInTheDocument();
    });

    it('should display type name for other coupon types', () => {
      const bogoCoupon = {
        ...mockCoupon,
        type: 'bogo' as const,
      };

      render(<QRCodeDisplay coupon={bogoCoupon} />);

      const bogoElements = screen.getAllByText('Buy One Get One');
      expect(bogoElements.length).toBeGreaterThan(0);
    });
  });

  describe('Terms and Conditions', () => {
    it('should display terms and conditions when provided', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Terms and Conditions')).toBeInTheDocument();
      expect(screen.getByText('Valid on purchases over 1000 THB')).toBeInTheDocument();
    });

    it('should not display terms section when not provided', () => {
      const couponNoTerms = { ...mockCoupon, termsAndConditions: undefined };

      render(<QRCodeDisplay coupon={couponNoTerms} />);

      expect(screen.queryByText('Terms and Conditions')).not.toBeInTheDocument();
    });

    it('should style terms section with yellow background', () => {
      const { container } = render(<QRCodeDisplay coupon={mockCoupon} />);

      const termsSection = container.querySelector('.bg-yellow-50');
      expect(termsSection).toBeInTheDocument();
    });
  });

  describe('Copy to Clipboard', () => {
    it('should display copy code button', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Copy Code')).toBeInTheDocument();
    });

    it('should copy QR code to clipboard when button clicked', async () => {
      const user = userEvent.setup();

      render(<QRCodeDisplay coupon={mockCoupon} />);

      const copyButton = screen.getByText('Copy Code');
      await user.click(copyButton);

      // Verify toast is shown (which proves clipboard.writeText was successful)
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('QR Code copied to clipboard');
      });
    });

    it('should show success toast after copying', async () => {
      const user = userEvent.setup();

      render(<QRCodeDisplay coupon={mockCoupon} />);

      const copyButton = screen.getByText('Copy Code');
      await user.click(copyButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('QR Code copied to clipboard');
      });
    });

    it('should handle clipboard copy errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock clipboard to reject
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: {
          writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')),
        },
        share: mockShare,
      });

      render(<QRCodeDisplay coupon={mockCoupon} />);

      const copyButton = screen.getByText('Copy Code');
      await user.click(copyButton);

      // Give the async error handler time to execute
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to copy QR code:', expect.any(Error));
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Share Functionality', () => {
    it('should display share button', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    it('should call navigator.share when available', async () => {
      const user = userEvent.setup();

      render(<QRCodeDisplay coupon={mockCoupon} />);

      const shareButton = screen.getByText('Share');
      await user.click(shareButton);

      expect(mockShare).toHaveBeenCalledWith({
        title: '20% Off Your Purchase',
        text: 'Use this coupon: SAVE20',
        url: window.location.href,
      });
    });

    it('should fallback to copy when navigator.share not available', async () => {
      const user = userEvent.setup();

      // Remove navigator.share using vi.stubGlobal
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: mockClipboard,
        share: undefined,
      });

      render(<QRCodeDisplay coupon={mockCoupon} />);

      const shareButton = screen.getByText('Share');
      await user.click(shareButton);

      await waitFor(() => {
        expect(mockClipboard.writeText).toHaveBeenCalledWith('QR123456789');
      });
    });

    it('should handle share errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockShare.mockRejectedValueOnce(new Error('Share error'));

      render(<QRCodeDisplay coupon={mockCoupon} />);

      const shareButton = screen.getByText('Share');
      await user.click(shareButton);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to share:', expect.any(Error));
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <QRCodeDisplay coupon={mockCoupon} className="custom-class" />
      );

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('custom-class');
    });

    it('should maintain base classes with custom className', () => {
      const { container } = render(
        <QRCodeDisplay coupon={mockCoupon} className="custom-class" />
      );

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('bg-white', 'rounded-lg', 'shadow-lg', 'custom-class');
    });
  });

  describe('Edge Cases', () => {
    it('should handle coupon without description', () => {
      const couponNoDesc = { ...mockCoupon, description: undefined };

      const { container } = render(<QRCodeDisplay coupon={couponNoDesc} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    it('should handle coupon without terms', () => {
      const couponNoTerms = { ...mockCoupon, termsAndConditions: undefined };

      const { container } = render(<QRCodeDisplay coupon={couponNoTerms} />);

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

      const { container } = render(<QRCodeDisplay coupon={minimalCoupon} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('20% Off Your Purchase')).toBeInTheDocument();
    });

    it('should handle very long QR code', () => {
      const longQRCoupon = {
        ...mockCoupon,
        qrCode: 'VERYLONGQRCODE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      };

      render(<QRCodeDisplay coupon={longQRCoupon} />);

      expect(screen.getByText(/VERYLONGQRCODE/)).toBeInTheDocument();
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.qrCode');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.howToUse');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.details');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.copyCode');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.share');
    });

    it('should use coupon type translation keys', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.types.percentage');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button elements', () => {
      const onClose = vi.fn();

      render(<QRCodeDisplay coupon={mockCoupon} onClose={onClose} />);

      const copyButton = screen.getByText('Copy Code');
      const shareButton = screen.getByText('Share');
      const closeButton = screen.getByText('×');

      expect(copyButton.tagName).toBe('BUTTON');
      expect(shareButton.tagName).toBe('BUTTON');
      expect(closeButton.tagName).toBe('BUTTON');
    });

    it('should have proper text hierarchy', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      const mainHeading = screen.getByText('QR Code');
      const couponHeading = screen.getByText('20% Off Your Purchase');

      expect(mainHeading.tagName).toBe('H3');
      expect(couponHeading.tagName).toBe('H4');
    });

    it('should have proper section headings', () => {
      render(<QRCodeDisplay coupon={mockCoupon} />);

      const howToUseHeading = screen.getByText('How to Use');
      const detailsHeading = screen.getByText('Coupon Details');

      expect(howToUseHeading.tagName).toBe('H5');
      expect(detailsHeading.tagName).toBe('H5');
    });
  });
});
