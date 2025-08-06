import React from 'react';
import { UserActiveCoupon } from '../../types/coupon';
import { useTranslation } from 'react-i18next';
import { couponService } from '../../services/couponService';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';

interface CouponDetailsModalProps {
  coupon: UserActiveCoupon;
  onClose?: () => void;
  className?: string;
}

const CouponDetailsModal: React.FC<CouponDetailsModalProps> = ({
  coupon,
  onClose,
  className = ''
}) => {
  const { t } = useTranslation();
  const isExpiring = couponService.isExpiringSoon(coupon);

  const getCouponTypeIcon = (type: string) => {
    switch (type) {
      case 'percentage':
        return '📊';
      case 'fixed_amount':
        return '💰';
      case 'bogo':
        return '🎁';
      case 'free_upgrade':
        return '⬆️';
      case 'free_service':
        return '🎁';
      default:
        return '🎫';
    }
  };

  const formatValue = (coupon: UserActiveCoupon) => {
    switch (coupon.type) {
      case 'percentage':
        return `${coupon.value}%`;
      case 'fixed_amount':
        return `${coupon.currency}${coupon.value}`;
      case 'bogo':
        return t('coupons.types.bogo');
      case 'free_upgrade':
        return t('coupons.types.free_upgrade');
      case 'free_service':
        return t('coupons.types.free_service');
      default:
        return t('coupons.discount');
    }
  };

  return (
    <div className={`bg-white rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center">
          <span className="text-xl mr-3">{getCouponTypeIcon(coupon.type)}</span>
          <h3 className="text-lg font-semibold text-gray-900">
            {t('coupons.couponDetails')}
          </h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Coupon Header */}
        <div className="text-center mb-6 pb-4 border-b">
          <h4 className="text-2xl font-bold text-gray-900 mb-2">
            {coupon.name}
          </h4>
          <div className="flex items-center justify-center space-x-4">
            <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-mono">
              {coupon.code}
            </span>
            {isExpiring && (
              <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-medium">
                {t('coupons.expiringSoon')}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {coupon.description && (
          <div className="mb-6">
            <h5 className="font-medium text-gray-900 mb-2">
              📝 {t('coupons.description')}
            </h5>
            <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">
              {coupon.description}
            </p>
          </div>
        )}

        {/* Coupon Value & Details */}
        <div className="bg-green-50 rounded-lg p-4 mb-6">
          <h5 className="font-medium text-green-900 mb-3 flex items-center">
            <span className="mr-2">💎</span>
            {t('coupons.value')}
          </h5>
          <div className="text-center">
            <span className="text-3xl font-bold text-green-600">
              {formatValue(coupon)}
            </span>
          </div>
        </div>

        {/* Detailed Information */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h5 className="font-medium text-gray-900 mb-3 flex items-center">
            <span className="mr-2">📋</span>
            {t('coupons.details')}
          </h5>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-200">
              <span className="text-gray-600">{t('coupons.type')}:</span>
              <span className="font-medium flex items-center">
                <span className="mr-1">{getCouponTypeIcon(coupon.type)}</span>
                {t(`coupons.types.${coupon.type}`)}
              </span>
            </div>
            
            {coupon.minimumSpend && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-600">{t('coupons.minimumSpend')}:</span>
                <span className="font-medium text-blue-600">
                  {coupon.currency}{coupon.minimumSpend}
                </span>
              </div>
            )}
            
            {coupon.maximumDiscount && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-gray-600">{t('coupons.maximumDiscount')}:</span>
                <span className="font-medium text-blue-600">
                  {coupon.currency}{coupon.maximumDiscount}
                </span>
              </div>
            )}
            
            {coupon.effectiveExpiry && (
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-600">{t('coupons.expiresOn')}:</span>
                <span className={`font-medium ${isExpiring ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatDateToDDMMYYYY(coupon.effectiveExpiry)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Terms and Conditions */}
        {coupon.termsAndConditions && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <h5 className="font-medium text-yellow-900 mb-2 flex items-center">
              <span className="mr-2">⚠️</span>
              {t('coupons.termsAndConditions')}
            </h5>
            <p className="text-sm text-yellow-800 leading-relaxed">
              {coupon.termsAndConditions}
            </p>
          </div>
        )}

        {/* Usage Status */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-blue-600 mr-2">🎫</span>
              <span className="font-medium text-blue-900">{t('coupons.status')}:</span>
            </div>
            <span className="bg-blue-200 text-blue-800 px-3 py-1 rounded-full text-sm font-medium capitalize">
              {t(`coupons.statuses.${coupon.status}`)}
            </span>
          </div>
        </div>

        {/* Close Button */}
        <div className="text-center">
          {onClose && (
            <button
              onClick={onClose}
              className="bg-gray-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors"
            >
              {t('common.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CouponDetailsModal;