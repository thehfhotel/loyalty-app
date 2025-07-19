import axios from 'axios';
import { API_CONFIG } from '@hotel-loyalty/shared';

const API_BASE = `${API_CONFIG.BASE_URL}/api/coupons`;

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string;
  type: 'percentage' | 'fixed_amount' | 'free_item';
  category: 'room' | 'dining' | 'spa' | 'experience' | 'general';
  value: number;
  minSpend?: number;
  maxDiscount?: number;
  validFrom: string;
  validUntil: string;
  usageLimit?: number;
  usageCount: number;
  isActive: boolean;
  terms?: string;
  imageUrl?: string;
  qrCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerCoupon {
  id: string;
  customerId: string;
  couponId: string;
  isUsed: boolean;
  usedAt?: string;
  redeemedAt?: string;
  redemptionLocation?: string;
  redemptionAmount?: number;
  createdAt: string;
}

export interface CouponWithCustomerInfo {
  coupon: Coupon;
  customerCoupon: CustomerCoupon;
}

export interface RedemptionResult {
  success: boolean;
  discountAmount: number;
  finalAmount: number;
  customerCoupon: CustomerCoupon;
}

class CouponService {
  private getAuthHeaders() {
    const token = localStorage.getItem('loyalty_token');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get available coupons for customer
   */
  async getAvailableCoupons(): Promise<Coupon[]> {
    try {
      const response = await axios.get(`${API_BASE}/available`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching available coupons:', error);
      throw error;
    }
  }

  /**
   * Get customer's coupons
   */
  async getCustomerCoupons(): Promise<CouponWithCustomerInfo[]> {
    try {
      const response = await axios.get(`${API_BASE}/my-coupons`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching customer coupons:', error);
      throw error;
    }
  }

  /**
   * Redeem a coupon
   */
  async redeemCoupon(data: {
    code: string;
    amount: number;
    location?: string;
  }): Promise<RedemptionResult> {
    try {
      const response = await axios.post(`${API_BASE}/redeem`, data, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error redeeming coupon:', error);
      throw error;
    }
  }

  /**
   * Validate QR code
   */
  async validateQRCode(qrData: string): Promise<{
    coupon: Coupon;
    valid: boolean;
    code: string;
  }> {
    try {
      const response = await axios.post(`${API_BASE}/validate-qr`, { qrData });
      return response.data.data;
    } catch (error) {
      console.error('Error validating QR code:', error);
      throw error;
    }
  }

  /**
   * Format discount value for display
   */
  formatDiscountValue(coupon: Coupon): string {
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
  }

  /**
   * Get coupon category display name
   */
  getCategoryDisplayName(category: string): string {
    const categories = {
      room: 'Room & Accommodation',
      dining: 'Dining & Restaurant',
      spa: 'Spa & Wellness',
      experience: 'Experiences & Activities',
      general: 'General'
    };
    return categories[category as keyof typeof categories] || category;
  }

  /**
   * Check if coupon is expired
   */
  isCouponExpired(coupon: Coupon): boolean {
    return new Date() > new Date(coupon.validUntil);
  }

  /**
   * Check if coupon is valid for use
   */
  isCouponValid(coupon: Coupon): boolean {
    const now = new Date();
    return coupon.isActive && 
           now >= new Date(coupon.validFrom) && 
           now <= new Date(coupon.validUntil) &&
           (coupon.usageLimit === null || coupon.usageCount < coupon.usageLimit);
  }

  /**
   * Calculate days until expiry
   */
  getDaysUntilExpiry(coupon: Coupon): number {
    const now = new Date();
    const expiry = new Date(coupon.validUntil);
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}

export const couponService = new CouponService();