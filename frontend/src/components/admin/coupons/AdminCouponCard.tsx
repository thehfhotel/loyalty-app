import React from 'react';
import { 
  MoreVertical, 
  BarChart3, 
  Users, 
  Eye,
  EyeOff,
  Calendar,
  Tag,
  TrendingUp
} from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatDate } from '../../../utils/dateUtils';
import { AdminCoupon } from '../../../services/adminCouponService';

interface AdminCouponCardProps {
  coupon: AdminCoupon;
  onViewAnalytics: (coupon: AdminCoupon) => void;
  onDistribute: (coupon: AdminCoupon) => void;
  onToggleStatus: (couponId: string, isActive: boolean) => void;
}

export const AdminCouponCard: React.FC<AdminCouponCardProps> = ({
  coupon,
  onViewAnalytics,
  onDistribute,
  onToggleStatus,
}) => {
  const isExpired = new Date() > new Date(coupon.validUntil);
  const isActive = coupon.isActive && !isExpired;
  const utilizationRate = coupon.usageLimit ? (coupon.usageCount / coupon.usageLimit) * 100 : 0;

  const getStatusColor = () => {
    if (isExpired) return 'red';
    if (!coupon.isActive) return 'gray';
    return 'green';
  };

  const getStatusText = () => {
    if (isExpired) return 'Expired';
    if (!coupon.isActive) return 'Draft';
    return 'Active';
  };

  const formatDiscountValue = () => {
    switch (coupon.type) {
      case 'percentage':
        return `${coupon.value}% OFF`;
      case 'fixed_amount':
        return `$${coupon.value} OFF`;
      case 'free_item':
        return 'FREE ITEM';
      default:
        return `$${coupon.value}`;
    }
  };

  const getCategoryDisplayName = () => {
    const categories = {
      room: 'Room',
      dining: 'Dining',
      spa: 'Spa',
      experience: 'Experience',
      general: 'General'
    };
    return categories[coupon.category as keyof typeof categories] || coupon.category;
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={getStatusColor() as any} size="sm">
                {getStatusText()}
              </Badge>
              <Badge variant="outline" size="sm">
                {getCategoryDisplayName()}
              </Badge>
            </div>
            <h3 className="font-semibold text-lg text-gray-900 mb-1">
              {coupon.title}
            </h3>
            <p className="text-sm text-gray-600 line-clamp-2">
              {coupon.description}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-gray-600"
          >
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>

        {/* Discount Value */}
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary-700">
              {formatDiscountValue()}
            </div>
            <div className="text-xs text-primary-600 font-medium">
              Code: {coupon.code}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">{coupon.usageCount}</div>
            <div className="text-xs text-gray-600">Redeemed</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              {coupon.usageLimit || '∞'}
            </div>
            <div className="text-xs text-gray-600">Limit</div>
          </div>
        </div>

        {/* Utilization Bar */}
        {coupon.usageLimit && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Utilization</span>
              <span>{Math.round(utilizationRate)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all ${
                  utilizationRate >= 90 ? 'bg-red-500' : 
                  utilizationRate >= 70 ? 'bg-orange-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(utilizationRate, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="space-y-2 mb-4 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <Calendar className="w-3 h-3" />
            <span>Valid: {formatDate(coupon.validFrom)} - {formatDate(coupon.validUntil)}</span>
          </div>
          {coupon.minSpend && (
            <div className="flex items-center gap-2">
              <Tag className="w-3 h-3" />
              <span>Min. spend: ${coupon.minSpend}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<BarChart3 className="w-4 h-4" />}
            onClick={() => onViewAnalytics(coupon)}
            className="flex-1"
          >
            Analytics
          </Button>
          
          {isActive && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Users className="w-4 h-4" />}
              onClick={() => onDistribute(coupon)}
              className="flex-1"
            >
              Distribute
            </Button>
          )}
          
          <Button
            variant="outline"
            size="sm"
            leftIcon={coupon.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            onClick={() => onToggleStatus(coupon.id, !coupon.isActive)}
            disabled={isExpired}
            title={isExpired ? 'Cannot modify expired coupon' : ''}
          >
            {coupon.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};