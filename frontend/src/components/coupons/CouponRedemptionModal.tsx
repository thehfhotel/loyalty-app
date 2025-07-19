import React, { useState } from 'react';
import { X, Calculator, MapPin, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Coupon, couponService } from '../../services/couponService';
import toast from 'react-hot-toast';

interface CouponRedemptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  coupon: Coupon;
  onRedemptionSuccess: () => void;
}

export const CouponRedemptionModal: React.FC<CouponRedemptionModalProps> = ({
  isOpen,
  onClose,
  coupon,
  onRedemptionSuccess
}) => {
  const [amount, setAmount] = useState('');
  const [location, setLocation] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [calculatedDiscount, setCalculatedDiscount] = useState<number | null>(null);

  if (!isOpen) return null;

  const calculateDiscount = (purchaseAmount: number) => {
    if (coupon.minSpend && purchaseAmount < coupon.minSpend) {
      return 0;
    }

    let discount = 0;
    switch (coupon.type) {
      case 'percentage':
        discount = (purchaseAmount * coupon.value) / 100;
        if (coupon.maxDiscount) {
          discount = Math.min(discount, coupon.maxDiscount);
        }
        break;
      case 'fixed_amount':
        discount = Math.min(coupon.value, purchaseAmount);
        break;
      case 'free_item':
        discount = coupon.value;
        break;
    }
    
    return discount;
  };

  const handleAmountChange = (value: string) => {
    setAmount(value);
    const numAmount = parseFloat(value);
    if (!isNaN(numAmount) && numAmount > 0) {
      setCalculatedDiscount(calculateDiscount(numAmount));
    } else {
      setCalculatedDiscount(null);
    }
  };

  const handleRedeem = async () => {
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid purchase amount');
      return;
    }

    const purchaseAmount = parseFloat(amount);
    
    if (coupon.minSpend && purchaseAmount < coupon.minSpend) {
      toast.error(`Minimum spend of $${coupon.minSpend} required`);
      return;
    }

    setIsRedeeming(true);
    
    try {
      const result = await couponService.redeemCoupon({
        code: coupon.code,
        amount: purchaseAmount,
        location: location || undefined
      });

      toast.success(`Coupon redeemed! You saved $${result.discountAmount.toFixed(2)}`);
      onRedemptionSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to redeem coupon');
    } finally {
      setIsRedeeming(false);
    }
  };

  const finalAmount = calculatedDiscount !== null ? 
    Math.max(0, parseFloat(amount || '0') - calculatedDiscount) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Redeem Coupon</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-2"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Coupon Info */}
          <div className="bg-gradient-to-r from-primary-50 to-secondary-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">{coupon.title}</h3>
              <Badge variant="success">
                {couponService.formatDiscountValue(coupon)}
              </Badge>
            </div>
            <p className="text-sm text-gray-600 mb-2">{coupon.description}</p>
            <div className="text-xs text-gray-500 space-y-1">
              <div>Code: <code className="font-mono">{coupon.code}</code></div>
              {coupon.minSpend && (
                <div>Minimum spend: ${coupon.minSpend}</div>
              )}
              {coupon.maxDiscount && coupon.type === 'percentage' && (
                <div>Maximum discount: ${coupon.maxDiscount}</div>
              )}
            </div>
          </div>

          {/* Purchase Amount */}
          <Input
            label="Purchase Amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            leftIcon={<Calculator className="w-4 h-4" />}
            helperText={coupon.minSpend ? `Minimum spend: $${coupon.minSpend}` : undefined}
          />

          {/* Location (Optional) */}
          <Input
            label="Location (Optional)"
            placeholder="Restaurant, Spa, Room Service..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            leftIcon={<MapPin className="w-4 h-4" />}
            helperText="Where are you using this coupon?"
          />

          {/* Discount Calculation */}
          {calculatedDiscount !== null && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="text-sm font-medium text-green-800 mb-2">
                Discount Calculation
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Purchase Amount:</span>
                  <span className="font-medium">${parseFloat(amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>Discount:</span>
                  <span className="font-medium">-${calculatedDiscount.toFixed(2)}</span>
                </div>
                <div className="border-t border-green-200 pt-1 flex justify-between font-semibold">
                  <span>Final Amount:</span>
                  <span>${finalAmount?.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Validation Warnings */}
          {amount && coupon.minSpend && parseFloat(amount) < coupon.minSpend && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <span className="text-sm text-orange-800">
                Purchase amount must be at least ${coupon.minSpend}
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onClose}
              disabled={isRedeeming}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleRedeem}
              disabled={
                isRedeeming || 
                !amount || 
                isNaN(parseFloat(amount)) || 
                parseFloat(amount) <= 0 ||
                (coupon.minSpend && parseFloat(amount) < coupon.minSpend)
              }
            >
              {isRedeeming ? (
                <LoadingSpinner size="sm" />
              ) : (
                'Redeem Coupon'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};