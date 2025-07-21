import React from 'react';
import { UserActiveCoupon } from '../../types/coupon';
import { couponService } from '../../services/couponService';
import { useTranslation } from 'react-i18next';

interface CouponCardProps {
  coupon: UserActiveCoupon;
  onUse?: (coupon: UserActiveCoupon) => void;
  onViewDetails?: (coupon: UserActiveCoupon) => void;
  className?: string;
}

const CouponCard: React.FC<CouponCardProps> = ({
  coupon,
  onUse,
  onViewDetails,
  className = ''
}) => {
  const { t } = useTranslation();

  const getCouponTypeIcon = (type: string) => {
    switch (type) {
      case 'percentage':
        return '%';
      case 'fixed_amount':
        return '$';
      case 'bogo':
        return '2x';
      case 'free_upgrade':
        return '↗';
      case 'free_service':
        return '🎁';
      default:
        return '🎫';
    }
  };

  const getCouponTypeColor = (type: string) => {
    switch (type) {
      case 'percentage':
        return 'bg-blue-500';
      case 'fixed_amount':
        return 'bg-green-500';
      case 'bogo':
        return 'bg-purple-500';
      case 'free_upgrade':
        return 'bg-orange-500';
      case 'free_service':
        return 'bg-pink-500';
      default:
        return 'bg-gray-500';
    }
  };

  const isExpiring = couponService.isExpiringSoon(coupon);
  const expiryText = couponService.formatExpiryDate(coupon);
  const valueText = couponService.formatCouponValue(coupon);
  const minimumSpendText = couponService.formatMinimumSpend(coupon);

  return (
    <div className={`
      relative bg-white rounded-lg shadow-md overflow-hidden border 
      ${isExpiring ? 'border-red-300 bg-red-50' : 'border-gray-200'}
      ${className}
    `}>
      {/* Expiring Soon Badge */}
      {isExpiring && (
        <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">
          {t('coupons.expiringSoon')}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start space-x-3">
          {/* Coupon Type Icon */}
          <div className={`
            flex-shrink-0 w-12 h-12 rounded-full ${getCouponTypeColor(coupon.type)}
            flex items-center justify-center text-white font-bold text-lg
          `}>
            {getCouponTypeIcon(coupon.type)}
          </div>

          {/* Coupon Details */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate">
              {coupon.name}
            </h3>
            
            <p className="text-sm text-gray-600 mt-1">
              {coupon.code}
            </p>

            {coupon.description && (
              <p className="text-sm text-gray-700 mt-2 line-clamp-2">
                {coupon.description}
              </p>
            )}

            {/* Value and Conditions */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-green-600">
                  {valueText} {t('coupons.off')}
                </span>
                {expiryText && (
                  <span className={`text-sm ${isExpiring ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {expiryText}
                  </span>
                )}
              </div>

              {minimumSpendText && (
                <p className="text-xs text-gray-500">
                  {minimumSpendText}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex space-x-2">
          {onUse && (
            <button
              onClick={() => onUse(coupon)}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {t('coupons.useCoupon')}
            </button>
          )}
          
          {onViewDetails && (
            <button
              onClick={() => onViewDetails(coupon)}
              className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              {t('coupons.viewDetails')}
            </button>
          )}
        </div>
      </div>

      {/* Decorative Perforations */}
      <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-4 h-4 bg-gray-100 rounded-full -ml-2"></div>
      <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-4 h-4 bg-gray-100 rounded-full -mr-2"></div>
    </div>
  );
};

export default CouponCard;