import React, { useRef, useState, useEffect } from 'react';
import { UserActiveCoupon } from '../../types/coupon';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { logger } from '../../utils/logger';
import { notify } from '../../utils/notificationManager';

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
  const [qrCodeDataURL, setQrCodeDataURL] = useState<string>('');
  const [isGeneratingQR, setIsGeneratingQR] = useState(true);

  // Generate QR code when component mounts or coupon changes
  useEffect(() => {
    const generateQRCode = async () => {
      try {
        setIsGeneratingQR(true);
        // Generate QR code with unique redemption ID for backend processing
        const qrData = coupon.qrCode;
        const dataURL = await QRCode.toDataURL(qrData, {
          width: 256,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
          errorCorrectionLevel: 'M',
        });
        setQrCodeDataURL(dataURL);
      } catch (error) {
        logger.error('Error generating QR code:', error);
      } finally {
        setIsGeneratingQR(false);
      }
    };

    generateQRCode();
  }, [coupon.qrCode]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      notify.success(t('coupons.couponCodeCopied', 'Coupon code copied!'));
    } catch (err) {
      logger.error('Failed to copy coupon code:', err);
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
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center mb-6" ref={qrCodeRef}>
          <div className="bg-white p-6 rounded-lg shadow-inner border-2 border-gray-200 mb-4">
            {/* QR Code Display */}
            <div className="w-64 h-64 flex items-center justify-center rounded-lg">
              {isGeneratingQR ? (
                <div className="text-center">
                  <div className="text-4xl mb-3">⏳</div>
                  <div className="text-sm text-gray-600 font-semibold">
                    {t('coupons.generatingQR', 'Generating QR Code...')}
                  </div>
                </div>
              ) : qrCodeDataURL ? (
                <img 
                  src={qrCodeDataURL} 
                  alt={`QR Code for ${coupon.code}`}
                  className="w-full h-full object-contain rounded-lg"
                />
              ) : (
                <div className="text-center">
                  <div className="text-4xl mb-3">❌</div>
                  <div className="text-sm text-gray-600 font-semibold">
                    {t('coupons.qrError', 'Error generating QR code')}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Coupon Code underneath */}
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-1 font-medium">
              {t('coupons.couponCode', 'Coupon Code')}
            </div>
            <div className="text-lg font-mono bg-gray-100 px-4 py-2 rounded-lg border">
              {coupon.code}
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
        <div className="flex justify-center">
          <button
            onClick={copyToClipboard}
            className="bg-gray-100 text-gray-700 py-3 px-6 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors flex items-center justify-center"
          >
            <span className="mr-2">📋</span>
            {t('coupons.copyCode')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRCodeModal;