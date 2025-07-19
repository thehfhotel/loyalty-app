import React, { useState } from 'react';
import { format } from 'date-fns';
import { 
  Gift, 
  Calendar, 
  Tag, 
  Clock, 
  QrCode,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Copy,
  ExternalLink
} from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { couponService, Coupon, CustomerCoupon } from '../../services/couponService';
import toast from 'react-hot-toast';

interface CouponCardProps {
  coupon: Coupon;
  customerCoupon?: CustomerCoupon;
  variant?: 'available' | 'owned' | 'used';
  onRedeem?: (coupon: Coupon) => void;
  onViewQR?: (coupon: Coupon) => void;
}

export const CouponCard: React.FC<CouponCardProps> = ({
  coupon,
  customerCoupon,
  variant = 'available',
  onRedeem,
  onViewQR
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const isExpired = couponService.isCouponExpired(coupon);
  const isValid = couponService.isCouponValid(coupon);
  const isUsed = customerCoupon?.isUsed || false;
  const daysUntilExpiry = couponService.getDaysUntilExpiry(coupon);
  
  const handleCopyCode = () => {
    navigator.clipboard.writeText(coupon.code);
    toast.success('Coupon code copied!');
  };
  
  const handleRedeem = () => {
    if (onRedeem && !isUsed && isValid) {
      onRedeem(coupon);
    }
  };
  
  const handleViewQR = () => {
    if (onViewQR) {
      onViewQR(coupon);
    }
  };
  
  const getStatusBadge = () => {
    if (isUsed) {
      return <Badge variant="secondary">Used</Badge>;
    }
    if (isExpired) {
      return <Badge variant="danger">Expired</Badge>;
    }
    if (daysUntilExpiry <= 3) {
      return <Badge variant="warning">Expires Soon</Badge>;
    }
    if (isValid) {
      return <Badge variant="success">Active</Badge>;
    }
    return <Badge variant="secondary">Inactive</Badge>;
  };
  
  const getCategoryIcon = () => {
    const iconClass = "w-5 h-5";
    switch (coupon.category) {
      case 'room':
        return <MapPin className={iconClass} />;
      case 'dining':
        return <Gift className={iconClass} />;
      case 'spa':
        return <Gift className={iconClass} />;
      case 'experience':
        return <Gift className={iconClass} />;
      default:
        return <Gift className={iconClass} />;
    }
  };
  
  return (
    <Card 
      className={`transition-all duration-200 ${
        isUsed ? 'opacity-60' : 'hover:shadow-lg'
      } ${!isValid && !isUsed ? 'border-gray-300' : ''}`}
    >
      {coupon.imageUrl && (
        <div className="h-32 bg-gradient-to-r from-primary-100 to-secondary-100 rounded-t-xl relative overflow-hidden">
          <img 
            src={coupon.imageUrl} 
            alt={coupon.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-3 right-3">
            {getStatusBadge()}
          </div>
        </div>
      )}
      
      <CardContent className="p-4">
        {!coupon.imageUrl && (
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-primary-600">
              {getCategoryIcon()}
              <span className="text-sm font-medium">
                {couponService.getCategoryDisplayName(coupon.category)}
              </span>
            </div>
            {getStatusBadge()}
          </div>
        )}
        
        <div className="space-y-3">
          {/* Title and Value */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-lg leading-tight">
                {coupon.title}
              </h3>
              <p className="text-gray-600 text-sm mt-1 line-clamp-2">
                {coupon.description}
              </p>
            </div>
            <div className="ml-4 text-right">
              <div className="text-2xl font-bold text-primary-600">
                {couponService.formatDiscountValue(coupon)}
              </div>
              {coupon.minSpend && (
                <div className="text-xs text-gray-500">
                  Min. spend ${coupon.minSpend}
                </div>
              )}
            </div>
          </div>
          
          {/* Coupon Code */}
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
            <Tag className="w-4 h-4 text-gray-500" />
            <code className="font-mono text-sm font-semibold text-gray-900 flex-1">
              {coupon.code}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyCode}
              className="p-1 h-auto"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          
          {/* Expiry and Usage Info */}
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>
                Expires {format(new Date(coupon.validUntil), 'MMM dd, yyyy')}
              </span>
            </div>
            {daysUntilExpiry > 0 && daysUntilExpiry <= 7 && (
              <div className="flex items-center gap-1 text-orange-600">
                <Clock className="w-4 h-4" />
                <span>{daysUntilExpiry} days left</span>
              </div>
            )}
          </div>
          
          {/* Used Info */}
          {isUsed && customerCoupon?.redeemedAt && (
            <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <div className="text-sm">
                <div className="text-green-800 font-medium">Redeemed</div>
                <div className="text-green-600">
                  {format(new Date(customerCoupon.redeemedAt), 'MMM dd, yyyy')}
                  {customerCoupon.redemptionLocation && (
                    <span> at {customerCoupon.redemptionLocation}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Terms and Conditions */}
          {coupon.terms && (
            <div className="border-t pt-3 mt-3">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
              >
                Terms & Conditions
                <ExternalLink className="w-3 h-3" />
              </button>
              {isExpanded && (
                <div className="mt-2 text-xs text-gray-500 leading-relaxed">
                  {coupon.terms}
                </div>
              )}
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            {variant === 'available' && !isUsed && isValid && (
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={handleRedeem}
              >
                <Gift className="w-4 h-4 mr-2" />
                Add to Wallet
              </Button>
            )}
            
            {variant === 'owned' && !isUsed && isValid && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1"
                  onClick={handleRedeem}
                >
                  Use Coupon
                </Button>
                {coupon.qrCode && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleViewQR}
                  >
                    <QrCode className="w-4 h-4" />
                  </Button>
                )}
              </>
            )}
            
            {!isValid && !isUsed && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>
                  {isExpired ? 'This coupon has expired' : 'This coupon is not active'}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};