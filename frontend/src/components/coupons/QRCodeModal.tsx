import React, { useRef } from 'react';
import { UserActiveCoupon } from '../../types/coupon';
import { useTranslation } from 'react-i18next';

interface QRCodeModalProps {
  coupon: UserActiveCoupon;
  onClose?: () => void;
  className?: string;
}

const QRCodeModal: React.FC<QRCodeModalProps> = ({
  coupon,
  onClose,
  className = ''
}) => {
  const { t } = useTranslation();
  const qrCodeRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(coupon.qrCode);
      alert(t('coupons.qrCodeCopied'));
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
          {t('coupons.useCoupon')}
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
        {/* Coupon Basic Info */}
        <div className="mb-6">
          <h4 className="text-xl font-bold text-gray-900 mb-2">
            {coupon.name}
          </h4>
          <p className="text-lg text-gray-600 font-mono bg-gray-100 px-3 py-1 rounded">
            {coupon.code}
          </p>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-6" ref={qrCodeRef}>
          <div className="bg-white p-6 rounded-lg shadow-inner border-2 border-gray-200">
            {/* QR Code Display */}
            <div className="w-56 h-56 bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center rounded-lg">
              <div className="text-center">
                <div className="text-4xl mb-3">📱</div>
                <div className="text-sm text-gray-600 mb-2 font-semibold">
                  {t('coupons.scanToRedeem')}
                </div>
                <div className="text-xs text-gray-500 font-mono break-all px-2 bg-white rounded p-2">
                  {coupon.qrCode}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Redemption Instructions */}
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <h5 className="font-medium text-blue-900 mb-3 flex items-center justify-center">
            <span className="mr-2">📋</span>
            {t('coupons.howToUse')}
          </h5>
          <ol className="text-sm text-blue-800 text-left space-y-2">
            <li className="flex items-start">
              <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mr-3 mt-0.5">1</span>
              {t('coupons.showQRCode')}
            </li>
            <li className="flex items-start">
              <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mr-3 mt-0.5">2</span>
              {t('coupons.letStaffScan')}
            </li>
            <li className="flex items-start">
              <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mr-3 mt-0.5">3</span>
              {t('coupons.enjoyDiscount')}
            </li>
          </ol>
        </div>

        {/* Important Note */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">⚠️ {t('common.important')}:</span> {t('coupons.oneTimeUse')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <button
            onClick={copyToClipboard}
            className="flex-1 bg-gray-100 text-gray-700 py-3 px-4 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors flex items-center justify-center"
          >
            <span className="mr-2">📋</span>
            {t('coupons.copyCode')}
          </button>
          <button
            onClick={shareQRCode}
            className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center"
          >
            <span className="mr-2">📤</span>
            {t('coupons.share')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRCodeModal;