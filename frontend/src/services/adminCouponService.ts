import axios from 'axios';
import { API_CONFIG } from '@hotel-loyalty/shared';

const API_BASE = `${API_CONFIG.BASE_URL}/api/coupons`;

export interface AdminCoupon {
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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCouponData {
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
  terms?: string;
  isActive: boolean;
}

export interface CouponAnalytics {
  coupon: AdminCoupon;
  totalRedemptions: number;
  totalSavings: number;
  averageOrderValue: number;
  topLocations: Array<{
    location: string;
    count: number;
  }>;
  usageOverTime: Array<{
    date: string;
    count: number;
  }>;
  customerSegments: Array<{
    segment: string;
    count: number;
    percentage: number;
  }>;
}

export interface DistributionData {
  couponId: string;
  customerIds?: string[];
  tierIds?: string[];
  segments?: string[];
  batchSize?: number;
}

class AdminCouponService {
  private getAuthHeaders() {
    const token = localStorage.getItem('loyalty_token');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get all coupons (admin only)
   */
  async getAllCoupons(): Promise<AdminCoupon[]> {
    try {
      const response = await axios.get(`${API_BASE}`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching all coupons:', error);
      throw error;
    }
  }

  /**
   * Create new coupon
   */
  async createCoupon(couponData: CreateCouponData): Promise<AdminCoupon> {
    try {
      const response = await axios.post(`${API_BASE}`, couponData, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error creating coupon:', error);
      throw error;
    }
  }

  /**
   * Get coupon by ID
   */
  async getCoupon(couponId: string): Promise<AdminCoupon> {
    try {
      const response = await axios.get(`${API_BASE}/${couponId}`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching coupon:', error);
      throw error;
    }
  }

  /**
   * Update coupon status
   */
  async updateCouponStatus(couponId: string, isActive: boolean): Promise<void> {
    try {
      await axios.patch(`${API_BASE}/${couponId}/status`, { isActive }, {
        headers: this.getAuthHeaders()
      });
    } catch (error) {
      console.error('Error updating coupon status:', error);
      throw error;
    }
  }

  /**
   * Distribute coupon to single customer
   */
  async distributeCoupon(couponId: string, customerId: string): Promise<void> {
    try {
      await axios.post(`${API_BASE}/distribute`, {
        couponId,
        customerId
      }, {
        headers: this.getAuthHeaders()
      });
    } catch (error) {
      console.error('Error distributing coupon:', error);
      throw error;
    }
  }

  /**
   * Batch distribute coupons
   */
  async batchDistributeCoupons(distributionData: DistributionData): Promise<{
    success: boolean;
    distributed: number;
    failed: number;
    errors?: string[];
  }> {
    try {
      const response = await axios.post(`${API_BASE}/batch-distribute`, distributionData, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error batch distributing coupons:', error);
      throw error;
    }
  }

  /**
   * Get coupon analytics
   */
  async getCouponAnalytics(couponId: string): Promise<CouponAnalytics> {
    try {
      const response = await axios.get(`${API_BASE}/${couponId}/analytics`, {
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching coupon analytics:', error);
      throw error;
    }
  }

  /**
   * Get coupon redemption history
   */
  async getRedemptionHistory(couponId: string, page = 1, limit = 50): Promise<{
    redemptions: Array<{
      id: string;
      customerId: string;
      customerName: string;
      redeemedAt: string;
      location?: string;
      amount: number;
      discountAmount: number;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    try {
      const response = await axios.get(`${API_BASE}/${couponId}/redemptions`, {
        params: { page, limit },
        headers: this.getAuthHeaders()
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching redemption history:', error);
      throw error;
    }
  }

  /**
   * Format discount value for display
   */
  formatDiscountValue(coupon: AdminCoupon): string {
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
  isCouponExpired(coupon: AdminCoupon): boolean {
    return new Date() > new Date(coupon.validUntil);
  }

  /**
   * Get coupon utilization rate
   */
  getUtilizationRate(coupon: AdminCoupon): number {
    if (!coupon.usageLimit) return 0;
    return (coupon.usageCount / coupon.usageLimit) * 100;
  }

  /**
   * Calculate days until expiry
   */
  getDaysUntilExpiry(coupon: AdminCoupon): number {
    const now = new Date();
    const expiry = new Date(coupon.validUntil);
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}

export const adminCouponService = new AdminCouponService();