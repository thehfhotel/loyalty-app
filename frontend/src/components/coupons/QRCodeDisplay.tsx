import React, { useRef } from 'react';
import { UserActiveCoupon } from '../../types/coupon';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';

interface QRCodeDisplayProps {
  coupon: UserActiveCoupon;
  onClose?: () => void;
  className?: string;
}

const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  coupon,
  onClose,
  className = ''
}) => {
  const { t } = useTranslation();
  const qrCodeRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(coupon.qrCode);
      toast.success(t('coupons.qrCodeCopied'));
    } catch (err) {
      console.error('Failed to copy QR code:', err);
    }
  };

  const shareQRCode = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: coupon.name,
          text: `Use this coupon: ${coupon.code}`,
          url: window.location.href
        });
      } catch (err) {
        console.error('Failed to share:', err);
      }
    } else {
      // Fallback to copying
      copyToClipboard();
    }
  };

  return (
    <div className={`bg-white rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('coupons.qrCode')}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        )}
      </div>

      {/* QR Code Content */}
      <div className="p-6 text-center">
        {/* Coupon Info */}
        <div className="mb-6">
          <h4 className="text-xl font-bold text-gray-900 mb-2">
            {coupon.name}
          </h4>
          <p className="text-gray-600 mb-2">
            {coupon.code}
          </p>
          {coupon.description && (
            <p className="text-sm text-gray-500">
              {coupon.description}
            </p>
          )}
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-6" ref={qrCodeRef}>
          <div className="bg-white p-4 rounded-lg shadow-inner border-2 border-gray-200">
            {/* Placeholder for QR code - in production, use a proper QR code library */}
            <div className="w-48 h-48 bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl mb-2">📱</div>
                <div className="text-xs text-gray-500 font-mono break-all px-2">
                  {coupon.qrCode}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <h5 className="font-medium text-blue-900 mb-2">
            {t('coupons.howToUse')}
          </h5>
          <ol className="text-sm text-blue-800 text-left space-y-1">
            <li>1. {t('coupons.showQRCode')}</li>
            <li>2. {t('coupons.letStaffScan')}</li>
            <li>3. {t('coupons.enjoyDiscount')}</li>
          </ol>
        </div>

        {/* Coupon Details */}
        <div className="text-left bg-gray-50 rounded-lg p-4 mb-6">
          <h5 className="font-medium text-gray-900 mb-2">
            {t('coupons.details')}
          </h5>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">{t('coupons.type')}:</span>
              <span className="font-medium">
                {t(`coupons.types.${coupon.type}`)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">{t('coupons.value')}:</span>
              <span className="font-medium text-green-600">
                {coupon.type === 'percentage' ? `${coupon.value}%` : 
                 coupon.type === 'fixed_amount' ? `${coupon.currency}${coupon.value}` :
                 t(`coupons.types.${coupon.type}`)}
              </span>
            </div>
            {coupon.minimumSpend && (
              <div className="flex justify-between">
                <span className="text-gray-600">{t('coupons.minimumSpend')}:</span>
                <span className="font-medium">
                  {coupon.currency}{coupon.minimumSpend}
                </span>
              </div>
            )}
            {coupon.maximumDiscount && (
              <div className="flex justify-between">
                <span className="text-gray-600">{t('coupons.maximumDiscount')}:</span>
                <span className="font-medium">
                  {coupon.currency}{coupon.maximumDiscount}
                </span>
              </div>
            )}
            {coupon.effectiveExpiry && (
              <div className="flex justify-between">
                <span className="text-gray-600">{t('coupons.expiresOn')}:</span>
                <span className="font-medium">
                  {formatDateToDDMMYYYY(coupon.effectiveExpiry)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Terms and Conditions */}
        {coupon.termsAndConditions && (
          <div className="text-left bg-yellow-50 rounded-lg p-4 mb-6">
            <h5 className="font-medium text-yellow-900 mb-2">
              {t('coupons.termsAndConditions')}
            </h5>
            <p className="text-sm text-yellow-800">
              {coupon.termsAndConditions}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <button
            onClick={copyToClipboard}
            className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            {t('coupons.copyCode')}
          </button>
          <button
            onClick={shareQRCode}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {t('coupons.share')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRCodeDisplay;