import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CouponScanner from '../CouponScanner';
import { couponService } from '../../../services/couponService';
import { logger } from '../../../utils/logger';
import { notify } from '../../../utils/notificationManager';
import { Coupon, UserActiveCoupon } from '../../../types/coupon';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'coupons.scanCoupon': 'Scan Coupon',
    'coupons.manualEntry': 'Manual Entry',
    'coupons.scanCamera': 'Scan Camera',
    'coupons.pointCameraAtQR': 'Point camera at QR code',
    'coupons.qrCode': 'QR Code',
    'coupons.enterQRCode': 'Enter QR Code',
    'coupons.originalAmount': 'Original Amount',
    'coupons.transactionReference': 'Transaction Reference',
    'coupons.enterTransactionReference': 'Enter Transaction Reference',
    'coupons.location': 'Location',
    'coupons.enterLocation': 'Enter Location',
    'coupons.redeemCoupon': 'Redeem Coupon',
    'coupons.discountPreview': 'Discount Preview',
    'coupons.discount': 'Discount',
    'coupons.finalAmount': 'Final Amount',
    'coupons.value': 'Value',
    'coupons.invalidAmount': 'Invalid amount',
    'coupons.cameraError': 'Camera access error',
    'coupons.discountApplied': 'Discount Applied',
    'coupons.customerPays': 'Customer Pays',
    'common.processing': 'Processing...',
    'errors.validationFailed': 'Validation failed',
    'errors.redemptionFailed': 'Redemption failed',
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
    validateCoupon: vi.fn(),
    redeemCoupon: vi.fn(),
    calculateDiscount: vi.fn(),
    formatCouponValue: vi.fn(),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../../../utils/notificationManager', () => ({
  notify: {
    error: vi.fn(),
  },
}));

// Mock navigator.mediaDevices
const mockGetUserMedia = vi.fn();
Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: mockGetUserMedia,
  },
});

describe('CouponScanner', () => {
  const mockValidCoupon: Coupon | UserActiveCoupon = {
    couponId: 'coupon-1',
    code: 'SAVE20',
    name: '20% Off Coupon',
    description: 'Get 20% off your purchase',
    type: 'percentage',
    value: 20,
    currency: 'THB',
    minimumSpend: 1000,
    maximumDiscount: 500,
    userCouponId: 'uc-1',
    userId: 'user-1',
    status: 'available',
    qrCode: 'QR123456',
    expiresAt: '2024-12-31T23:59:59Z',
    assignedAt: '2024-01-01T00:00:00Z',
    couponExpiresAt: '2024-12-31T23:59:59Z',
    effectiveExpiry: '2024-12-31T23:59:59Z',
    expiringSoon: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(couponService.validateCoupon).mockResolvedValue({
      success: true,
      valid: true,
      message: 'Valid coupon',
      data: mockValidCoupon,
    });

    vi.mocked(couponService.redeemCoupon).mockResolvedValue({
      success: true,
      message: 'Coupon redeemed successfully',
      discountAmount: 200,
      finalAmount: 800,
      userCouponId: 'uc-1',
    });

    vi.mocked(couponService.calculateDiscount).mockReturnValue({
      isValid: true,
      discountAmount: 200,
      finalAmount: 800,
      message: 'Valid discount',
    });

    vi.mocked(couponService.formatCouponValue).mockReturnValue('20% off');

    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [
        {
          stop: vi.fn(),
        },
      ],
    });
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<CouponScanner />);

      expect(screen.getByText('Scan Coupon')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<CouponScanner />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<CouponScanner />);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('bg-white', 'rounded-lg', 'shadow-lg');
    });

    it('should apply custom className', () => {
      const { container } = render(<CouponScanner className="custom-class" />);

      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass('custom-class');
    });
  });

  describe('Scan Mode Toggle', () => {
    it('should default to manual entry mode', () => {
      render(<CouponScanner />);

      const manualButton = screen.getByText('Manual Entry');
      expect(manualButton).toHaveClass('bg-white', 'text-gray-900', 'shadow-sm');
    });

    it('should switch to camera mode when camera button clicked', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const cameraButton = screen.getByText('Scan Camera');
      await user.click(cameraButton);

      expect(cameraButton).toHaveClass('bg-white', 'text-gray-900', 'shadow-sm');
    });

    it('should switch back to manual mode when manual button clicked', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const cameraButton = screen.getByText('Scan Camera');
      const manualButton = screen.getByText('Manual Entry');

      await user.click(cameraButton);
      await user.click(manualButton);

      expect(manualButton).toHaveClass('bg-white', 'text-gray-900', 'shadow-sm');
    });

    it('should not display camera view in manual mode', () => {
      render(<CouponScanner />);

      expect(screen.queryByText('Point camera at QR code')).not.toBeInTheDocument();
    });
  });

  describe('Camera Permissions', () => {
    it('should request camera access when switching to camera mode', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const cameraButton = screen.getByText('Scan Camera');
      await user.click(cameraButton);

      await waitFor(() => {
        expect(mockGetUserMedia).toHaveBeenCalledWith({
          video: { facingMode: 'environment' },
        });
      });
    });

    it('should display camera helper text when camera is active', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const cameraButton = screen.getByText('Scan Camera');
      await user.click(cameraButton);

      await waitFor(() => {
        expect(screen.getByText('Point camera at QR code')).toBeInTheDocument();
      });
    });

    it('should handle camera access error', async () => {
      const user = userEvent.setup();
      mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'));

      render(<CouponScanner />);

      const cameraButton = screen.getByText('Scan Camera');
      await user.click(cameraButton);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalledWith('Camera access error');
      });
    });

    it('should fallback to manual mode on camera error', async () => {
      const user = userEvent.setup();
      mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'));

      render(<CouponScanner />);

      const cameraButton = screen.getByText('Scan Camera');
      await user.click(cameraButton);

      await waitFor(() => {
        const manualButton = screen.getByText('Manual Entry');
        expect(manualButton).toHaveClass('bg-white', 'text-gray-900', 'shadow-sm');
      });
    });
  });

  describe('QR Code Input', () => {
    it('should display QR code input field', () => {
      render(<CouponScanner />);

      expect(screen.getByLabelText(/QR Code/)).toBeInTheDocument();
    });

    it('should update QR code value when typing', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/) as HTMLInputElement;
      await user.type(input, 'QR123456');

      expect(input.value).toBe('QR123456');
    });

    it('should trigger validation when QR code length is 8 or more', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123456');

      await waitFor(() => {
        expect(couponService.validateCoupon).toHaveBeenCalledWith('QR123456');
      });
    });

    it('should not validate when QR code length is less than 8', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123');

      expect(couponService.validateCoupon).not.toHaveBeenCalled();
    });

    it('should clear redemption result when QR code changes', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123456');

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Coupon redeemed successfully')).toBeInTheDocument();
      });

      await user.clear(input);
      await user.type(input, 'QR789012');

      expect(screen.queryByText('Coupon redeemed successfully')).not.toBeInTheDocument();
    });
  });

  describe('Validation Result Display', () => {
    it('should display valid coupon message', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });
    });

    it('should display coupon details when valid', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('20% Off Coupon')).toBeInTheDocument();
        expect(screen.getByText('Get 20% off your purchase')).toBeInTheDocument();
      });
    });

    it('should display invalid coupon message', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.validateCoupon).mockResolvedValueOnce({
        success: false,
        valid: false,
        message: 'Invalid coupon code',
      });

      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'INVALID');

      await waitFor(() => {
        expect(screen.getByText('Invalid coupon code')).toBeInTheDocument();
      });
    });

    it('should style valid coupon with green background', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123456');

      await waitFor(() => {
        const validationMessage = screen.getByText(/Valid coupon/);
        const validationDiv = validationMessage.closest('div.bg-green-50');
        expect(validationDiv).toHaveClass('bg-green-50', 'border-green-200');
      });
    });

    it('should style invalid coupon with red background', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.validateCoupon).mockResolvedValueOnce({
        success: false,
        valid: false,
        message: 'Invalid coupon code',
      });

      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'INVALID');

      await waitFor(() => {
        const validationDiv = screen.getByText('Invalid coupon code').closest('div');
        expect(validationDiv).toHaveClass('bg-red-50', 'border-red-200');
      });
    });

    it('should handle validation error', async () => {
      const user = userEvent.setup();
      const error = new Error('Network error');
      vi.mocked(couponService.validateCoupon).mockRejectedValueOnce(error);

      render(<CouponScanner />);

      const input = screen.getByLabelText(/QR Code/);
      await user.type(input, 'QR123456');

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith('Error validating coupon:', error);
        expect(screen.getByText(/Validation failed/)).toBeInTheDocument();
      });
    });
  });

  describe('Amount Input and Discount Preview', () => {
    it('should display original amount input', () => {
      render(<CouponScanner />);

      expect(screen.getByLabelText(/Original Amount/)).toBeInTheDocument();
    });

    it('should update amount value when typing', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const input = screen.getByLabelText(/Original Amount/) as HTMLInputElement;
      await user.type(input, '1000');

      expect(input.value).toBe('1000');
    });

    it('should display discount preview when valid coupon and amount', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText(/Valid coupon/)).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      await waitFor(() => {
        expect(screen.getByText('Discount Preview')).toBeInTheDocument();
      });
    });

    it('should not display discount preview without valid coupon', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      expect(screen.queryByText('Discount Preview')).not.toBeInTheDocument();
    });

    it('should calculate and display discount amounts', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      await waitFor(() => {
        expect(couponService.calculateDiscount).toHaveBeenCalledWith(mockValidCoupon, 1000);
      });
    });
  });

  describe('Form Submission', () => {
    it('should disable submit button when no valid coupon', () => {
      render(<CouponScanner />);

      const submitButton = screen.getByText('Redeem Coupon');
      expect(submitButton).toBeDisabled();
    });

    it('should disable submit button when no amount', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        const submitButton = screen.getByText('Redeem Coupon');
        expect(submitButton).toBeDisabled();
      });
    });

    it('should enable submit button when valid coupon and amount', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      await waitFor(() => {
        const submitButton = screen.getByText('Redeem Coupon');
        expect(submitButton).not.toBeDisabled();
      });
    });

    it('should call redeemCoupon service on submit', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(couponService.redeemCoupon).toHaveBeenCalledWith(
          expect.objectContaining({
            qrCode: 'QR123456',
            originalAmount: 1000,
          })
        );
      });
    });

    it('should include optional fields in redemption request', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const refInput = screen.getByLabelText(/Transaction Reference/);
      await user.type(refInput, 'TXN-001');

      const locationInput = screen.getByLabelText(/Location/);
      await user.type(locationInput, 'Bangkok Hotel');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(couponService.redeemCoupon).toHaveBeenCalledWith(
          expect.objectContaining({
            qrCode: 'QR123456',
            originalAmount: 1000,
            transactionReference: 'TXN-001',
            location: 'Bangkok Hotel',
          })
        );
      });
    });

    it('should display success message on successful redemption', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Coupon redeemed successfully')).toBeInTheDocument();
      });
    });

    it('should reset form after successful redemption', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/) as HTMLInputElement;
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/) as HTMLInputElement;
      await user.type(amountInput, '1000');

      const refInput = screen.getByLabelText(/Transaction Reference/) as HTMLInputElement;
      await user.type(refInput, 'TXN-001');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(qrInput.value).toBe('');
        expect(amountInput.value).toBe('');
        expect(refInput.value).toBe('');
      });
    });

    it('should call onRedemptionComplete callback on success', async () => {
      const user = userEvent.setup();
      const onRedemptionComplete = vi.fn();
      render(<CouponScanner onRedemptionComplete={onRedemptionComplete} />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(onRedemptionComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            message: 'Coupon redeemed successfully',
          })
        );
      });
    });

    it('should handle redemption error', async () => {
      const user = userEvent.setup();
      const error = new Error('Network error');
      vi.mocked(couponService.redeemCoupon).mockRejectedValueOnce(error);

      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith('Error redeeming coupon:', error);
        expect(screen.getByText('Redemption failed')).toBeInTheDocument();
      });
    });

    it('should reject invalid amount (zero)', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '0');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(notify.error).toHaveBeenCalledWith('Invalid amount');
      });
    });

    it('should reject invalid amount (negative)', async () => {
      const user = userEvent.setup();
      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText(/Valid coupon/)).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '-100');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      await waitFor(() => {
        expect(notify.error).toHaveBeenCalledWith('Invalid amount');
      });
    });

    it('should show loading state during redemption', async () => {
      const user = userEvent.setup();
      vi.mocked(couponService.redeemCoupon).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          success: true,
          message: 'Success',
          discountAmount: 200,
          finalAmount: 800,
        }), 100))
      );

      render(<CouponScanner />);

      const qrInput = screen.getByLabelText(/QR Code/);
      await user.type(qrInput, 'QR123456');

      await waitFor(() => {
        expect(screen.getByText('Valid coupon')).toBeInTheDocument();
      });

      const amountInput = screen.getByLabelText(/Original Amount/);
      await user.type(amountInput, '1000');

      const submitButton = screen.getByText('Redeem Coupon');
      await user.click(submitButton);

      expect(screen.getByText('Processing...')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Redeem Coupon')).toBeInTheDocument();
      });
    });
  });

  describe('Close Button', () => {
    it('should display close button when onClose provided', () => {
      const onClose = vi.fn();
      render(<CouponScanner onClose={onClose} />);

      const closeButton = screen.getByText('×');
      expect(closeButton).toBeInTheDocument();
    });

    it('should not display close button when onClose not provided', () => {
      render(<CouponScanner />);

      expect(screen.queryByText('×')).not.toBeInTheDocument();
    });

    it('should call onClose when close button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<CouponScanner onClose={onClose} />);

      const closeButton = screen.getByText('×');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<CouponScanner />);

      expect(mockTranslate).toHaveBeenCalledWith('coupons.scanCoupon');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.manualEntry');
      expect(mockTranslate).toHaveBeenCalledWith('coupons.scanCamera');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible form labels', () => {
      render(<CouponScanner />);

      expect(screen.getByLabelText(/QR Code/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Original Amount/)).toBeInTheDocument();
    });

    it('should have accessible submit button', () => {
      render(<CouponScanner />);

      const button = screen.getByText('Redeem Coupon');
      expect(button.tagName).toBe('BUTTON');
    });

    it('should have proper heading hierarchy', () => {
      render(<CouponScanner />);

      const heading = screen.getByText('Scan Coupon');
      expect(heading.tagName).toBe('H2');
    });
  });
});
