import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RedeemCouponResponse, Coupon, UserActiveCoupon } from '../../types/coupon';
import { couponService } from '../../services/couponService';
import { logger } from '../../utils/logger';
import { notify } from '../../utils/notificationManager';
import { trpc } from '../../hooks/useTRPC';
import { getTRPCErrorMessage } from '../../hooks/useTRPC';

interface CouponScannerProps {
  onRedemptionComplete?: (result: RedeemCouponResponse) => void;
  onClose?: () => void;
  className?: string;
}

const CouponScanner: React.FC<CouponScannerProps> = ({
  onRedemptionComplete,
  onClose,
  className = ''
}) => {
  const { t } = useTranslation();
  const [scanMode, setScanMode] = useState<'camera' | 'manual'>('manual');
  const [qrCode, setQrCode] = useState('');
  const [originalAmount, setOriginalAmount] = useState<string>('');
  const [transactionReference, setTransactionReference] = useState('');
  const [location, setLocation] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [validationResult, setValidationResult] = useState<{success: boolean; valid: boolean; message: string; data?: unknown} | null>(null);
  const [redemptionResult, setRedemptionResult] = useState<RedeemCouponResponse | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const validationTimeout = useRef<number | null>(null);

  // tRPC mutation for redeeming coupons
  const redeemCouponMutation = trpc.coupon.redeemCoupon.useMutation();

  // Camera functionality (simplified - in production, use a proper QR code scanner library)
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Use back camera on mobile
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      logger.error('Error accessing camera:', err);
      notify.error(t('coupons.cameraError'));
      setScanMode('manual');
    }
  }, [t]);

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  useEffect(() => {
    if (scanMode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }

    return () => stopCamera();
  }, [scanMode, startCamera]);

  useEffect(() => {
    return () => {
      if (validationTimeout.current) {
        window.clearTimeout(validationTimeout.current);
      }
    };
  }, []);

  const validateCoupon = async (code: string) => {
    if (!code.trim()) {
      setValidationResult(null);
      return null;
    }

    try {
      const result = await couponService.validateCoupon(code.trim());
      setValidationResult(result);
      return result;
    } catch (err: unknown) {
      logger.error('Error validating coupon:', err);
      const errorResponse = (err as { response?: { data?: { message?: string } } })?.response?.data;
      const errorMessage = errorResponse?.message ?? t('errors.validationFailed');
      setValidationResult({
        success: false,
        valid: false,
        message: errorMessage
      });
      return {
        success: false,
        valid: false,
        message: errorMessage
      };
    }
  };

  const handleQRCodeChange = (value: string) => {
    setQrCode(value);
    setRedemptionResult(null);
    if (validationTimeout.current) {
      window.clearTimeout(validationTimeout.current);
    }

    validationTimeout.current = window.setTimeout(() => {
      if (value.trim().length >= 6) {
        validateCoupon(value);
      } else {
        setValidationResult(null);
      }
    }, 150);
  };

  const handleRedeemCoupon = async (e: React.FormEvent) => {
    e.preventDefault();

    let latestValidation = validationResult;
    if (!latestValidation?.message) {
      latestValidation = await validateCoupon(qrCode);
    }

    if (!qrCode.trim() || !originalAmount || !latestValidation?.valid) {
      return;
    }

    const amount = parseFloat(originalAmount);
    if (isNaN(amount) || amount <= 0) {
      notify.error(t('coupons.invalidAmount'));
      return;
    }

    try {
      setIsRedeeming(true);

      const result = await redeemCouponMutation.mutateAsync({
        qrCode: qrCode.trim(),
        originalAmount: amount,
        transactionReference: transactionReference.trim() || undefined,
        location: location.trim() || undefined,
        metadata: {
          redemptionChannel: 'staff_interface',
          timestamp: new Date().toISOString()
        }
      });

      setRedemptionResult(result);

      if (result.success) {
        // Reset form for next redemption
        setQrCode('');
        setOriginalAmount('');
        setTransactionReference('');
        setValidationResult(null);

        if (onRedemptionComplete) {
          onRedemptionComplete(result);
        }
      }
    } catch (err: unknown) {
      logger.error('Error redeeming coupon:', err);
      const errorMessage = getTRPCErrorMessage(err);
      const errorResult: RedeemCouponResponse = {
        success: false,
        message: errorMessage,
        discountAmount: 0,
        finalAmount: parseFloat(originalAmount) || 0
      };
      setRedemptionResult(errorResult);
    } finally {
      setIsRedeeming(false);
    }
  };

  // Calculate preview of discount
  const couponData = validationResult?.data as Coupon | UserActiveCoupon | undefined;
  const discountPreview = validationResult?.valid && originalAmount && couponData
    ? couponService.calculateDiscount(couponData, parseFloat(originalAmount))
    : null;

  return (
    <div className={`bg-white rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-xl font-semibold text-gray-900">
          {t('coupons.scanCoupon')}
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        )}
      </div>

      <div className="p-6">
        {/* Scan Mode Toggle */}
        <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setScanMode('manual')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              scanMode === 'manual' 
                ? 'bg-white text-gray-900 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t('coupons.manualEntry')}
          </button>
          <button
            onClick={() => setScanMode('camera')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              scanMode === 'camera' 
                ? 'bg-white text-gray-900 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t('coupons.scanCamera')}
          </button>
        </div>

        {/* Camera View */}
        {scanMode === 'camera' && (
          <div className="mb-6">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full max-w-sm mx-auto rounded-lg bg-gray-100"
            />
            {cameraActive && (
              <p className="text-center text-sm text-gray-600 mt-2">
                {t('coupons.pointCameraAtQR')}
              </p>
            )}
          </div>
        )}

        {/* Redemption Form */}
        <form onSubmit={handleRedeemCoupon} className="space-y-4" noValidate>
          {/* QR Code Input */}
          <div>
            <label htmlFor="qrCode" className="block text-sm font-medium text-gray-700 mb-1">
              {t('coupons.qrCode')} *
            </label>
            <input
              type="text"
              id="qrCode"
              value={qrCode}
              onChange={(e) => handleQRCodeChange(e.target.value)}
              placeholder={t('coupons.enterQRCode')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Validation Result */}
          {validationResult && (
            <div className={`p-3 rounded-md ${
              validationResult.valid 
                ? 'bg-green-50 border border-green-200' 
                : 'bg-red-50 border border-red-200'
            }`}
            >
              <div className={`flex items-center ${
                validationResult.valid ? 'text-green-800' : 'text-red-800 bg-red-50 border-red-200'
              } ${validationResult.valid ? '' : 'bg-red-50 border border-red-200 rounded-md p-2'}`}
              >
                <span className="mr-2">
                  {validationResult.valid ? '✅' : '❌'}
                </span>
                <span className="font-medium">{String(validationResult?.message ?? '')}</span>
              </div>
              
              {validationResult.valid && validationResult.data ? (
                <div className="mt-2 text-sm text-green-700">
                  <div className="font-medium">{(validationResult.data as Coupon | UserActiveCoupon)?.name ?? ''}</div>
                  <div>{(validationResult.data as Coupon | UserActiveCoupon)?.description ?? ''}</div>
                  <div className="mt-1">
                    {t('coupons.value')}: {couponService.formatCouponValue(validationResult.data as Coupon | UserActiveCoupon)}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Original Amount */}
          <div>
            <label htmlFor="originalAmount" className="block text-sm font-medium text-gray-700 mb-1">
              {t('coupons.originalAmount')} *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                type="number"
                id="originalAmount"
                value={originalAmount}
                onChange={(e) => setOriginalAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Discount Preview */}
          {discountPreview && discountPreview.isValid && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <h4 className="font-medium text-blue-900 mb-2">
                {t('coupons.discountPreview')}
              </h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-700">{t('coupons.originalAmount')}:</span>
                  <span className="font-medium">฿{parseFloat(originalAmount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-700">{t('coupons.discount')}:</span>
                  <span className="font-medium text-green-600">
                    -฿{discountPreview.discountAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-blue-200 pt-1">
                  <span className="text-blue-900 font-medium">{t('coupons.finalAmount')}:</span>
                  <span className="font-bold text-blue-900">
                    ฿{discountPreview.finalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Transaction Reference */}
          <div>
            <label htmlFor="transactionReference" className="block text-sm font-medium text-gray-700 mb-1">
              {t('coupons.transactionReference')}
            </label>
            <input
              type="text"
              id="transactionReference"
              value={transactionReference}
              onChange={(e) => setTransactionReference(e.target.value)}
              placeholder={t('coupons.enterTransactionReference')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
              {t('coupons.location')}
            </label>
            <input
              type="text"
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('coupons.enterLocation')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isRedeeming || !qrCode.trim() || !originalAmount}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRedeeming ? t('common.processing') : t('coupons.redeemCoupon')}
          </button>
        </form>

        {/* Redemption Result */}
        {redemptionResult && (
          <div className={`mt-6 p-4 rounded-md ${
            redemptionResult.success 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-red-50 border border-red-200'
          }`}
          >
            <div className={`flex items-center mb-2 ${
              redemptionResult.success ? 'text-green-800' : 'text-red-800'
            }`}
            >
              <span className="mr-2 text-xl">
                {redemptionResult.success ? '🎉' : '❌'}
              </span>
              <span className="font-medium">{redemptionResult.message}</span>
            </div>
            
            {redemptionResult.success && (
              <div className="text-sm text-green-700 space-y-1">
                <div className="flex justify-between">
                  <span>{t('coupons.discountApplied')}:</span>
                  <span className="font-medium">
                    ฿{redemptionResult.discountAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t('coupons.customerPays')}:</span>
                  <span className="font-bold text-lg">
                    ฿{redemptionResult.finalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CouponScanner;
