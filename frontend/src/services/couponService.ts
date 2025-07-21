import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import type {
  Coupon,
  UserActiveCoupon,
  CreateCouponRequest,
  UpdateCouponRequest,
  AssignCouponRequest,
  RedeemCouponRequest,
  RedeemCouponResponse,
  CouponListResponse,
  UserCouponListResponse,
  CouponStatsResponse,
  CouponType,
  CouponStatus
} from '../types/coupon';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Create axios instance with auth interceptor
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token interceptor
addAuthTokenInterceptor(api);

export class CouponService {
  // Customer coupon management
  async getUserCoupons(page: number = 1, limit: number = 20): Promise<UserCouponListResponse> {
    const response = await api.get(`/coupons/my-coupons`, {
      params: { page, limit }
    });
    return response.data.data;
  }

  async redeemCoupon(data: RedeemCouponRequest): Promise<RedeemCouponResponse> {
    const response = await api.post(`/coupons/redeem`, data);
    return response.data.data;
  }

  async validateCoupon(qrCode: string): Promise<{
    success: boolean;
    valid: boolean;
    data?: any;
    message: string;
  }> {
    const response = await api.get(`/coupons/validate/${qrCode}`);
    return response.data;
  }

  // Public coupon listing
  async listCoupons(
    page: number = 1,
    limit: number = 20,
    filters: {
      status?: CouponStatus;
      type?: CouponType;
      search?: string;
    } = {}
  ): Promise<CouponListResponse> {
    const response = await api.get(`/coupons`, {
      params: { page, limit, ...filters }
    });
    return response.data.data;
  }

  async getCoupon(couponId: string): Promise<Coupon> {
    const response = await api.get(`/coupons/${couponId}`);
    return response.data.data;
  }

  // Admin coupon management
  async getAdminCoupons(
    page: number = 1,
    limit: number = 20,
    filters: {
      status?: CouponStatus;
      type?: CouponType;
      search?: string;
    } = {}
  ): Promise<CouponListResponse> {
    const response = await api.get(`/coupons`, {
      params: { page, limit, ...filters }
    });
    return response.data.data;
  }

  async createCoupon(data: CreateCouponRequest): Promise<Coupon> {
    const response = await api.post(`/coupons`, data);
    return response.data.data;
  }

  async updateCoupon(couponId: string, data: UpdateCouponRequest): Promise<Coupon> {
    const response = await api.put(`/coupons/${couponId}`, data);
    return response.data.data;
  }

  async deleteCoupon(couponId: string): Promise<void> {
    await api.delete(`/coupons/${couponId}`);
  }

  async updateCouponStatus(couponId: string, status: CouponStatus): Promise<Coupon> {
    const response = await api.put(`/coupons/${couponId}`, { status });
    return response.data.data;
  }

  async assignCoupon(data: AssignCouponRequest): Promise<any> {
    const response = await api.post(`/coupons/assign`, data);
    return response.data.data;
  }

  async assignCouponToUsers(data: { couponId: string; userIds: string[]; assignedReason?: string }): Promise<any> {
    const response = await api.post(`/coupons/assign`, data);
    return response.data.data;
  }

  async revokeUserCoupon(userCouponId: string, reason?: string): Promise<void> {
    await api.post(`/coupons/user-coupons/${userCouponId}/revoke`, {
      reason
    });
  }

  // Admin analytics and reporting
  async getCouponStats(): Promise<CouponStatsResponse> {
    const response = await api.get(`/coupons/analytics/stats`);
    return response.data.data;
  }

  async getCouponAnalytics(
    page: number = 1,
    limit: number = 20,
    filters: {
      couponId?: string;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<any> {
    const response = await api.get(`/coupons/analytics/data`, {
      params: { page, limit, ...filters }
    });
    return response.data.data;
  }

  async getCouponRedemptions(
    couponId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const response = await api.get(`/coupons/${couponId}/redemptions`, {
      params: { page, limit }
    });
    return response.data.data;
  }

  async getCouponAssignments(
    couponId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    assignments: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      assignedCount: number;
      usedCount: number;
      availableCount: number;
      latestAssignment: Date;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const response = await api.get(`/coupons/${couponId}/assignments`, {
      params: { page, limit }
    });
    return response.data.data;
  }

  // Utility methods
  formatCouponValue(coupon: Coupon | UserActiveCoupon): string {
    switch (coupon.type) {
      case 'percentage':
        return `${coupon.value || 0}%`;
      case 'fixed_amount':
        return `฿${coupon.value || 0}`;
      case 'bogo':
        return 'Buy One Get One';
      case 'free_upgrade':
        return 'Free Upgrade';
      case 'free_service':
        return 'Free Service';
      default:
        return 'Special Offer';
    }
  }

  formatMinimumSpend(coupon: Coupon | UserActiveCoupon): string | null {
    if (!coupon.minimumSpend) return null;
    return `Min. spend ฿${coupon.minimumSpend}`;
  }

  formatMaximumDiscount(coupon: Coupon | UserActiveCoupon): string | null {
    if (!coupon.maximumDiscount) return null;
    return `Max. discount ฿${coupon.maximumDiscount}`;
  }

  calculateDiscount(
    coupon: Coupon | UserActiveCoupon,
    originalAmount: number
  ): {
    discountAmount: number;
    finalAmount: number;
    isValid: boolean;
    errorMessage?: string;
  } {
    // Check minimum spend
    if (coupon.minimumSpend && originalAmount < coupon.minimumSpend) {
      return {
        discountAmount: 0,
        finalAmount: originalAmount,
        isValid: false,
        errorMessage: `Minimum spend of ฿${coupon.minimumSpend} required`
      };
    }

    let discountAmount = 0;

    switch (coupon.type) {
      case 'percentage':
        discountAmount = originalAmount * ((coupon.value || 0) / 100);
        // Apply maximum discount if set
        if (coupon.maximumDiscount && discountAmount > coupon.maximumDiscount) {
          discountAmount = coupon.maximumDiscount;
        }
        break;
      case 'fixed_amount':
        discountAmount = Math.min(coupon.value || 0, originalAmount);
        break;
      case 'bogo':
        // Assume 50% discount for BOGO
        discountAmount = originalAmount * 0.5;
        break;
      default:
        // For other types, no automatic calculation
        discountAmount = 0;
    }

    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return {
      discountAmount,
      finalAmount,
      isValid: true
    };
  }

  isExpiringSoon(coupon: UserActiveCoupon): boolean {
    return coupon.expiringSoon;
  }

  getExpiryDate(coupon: UserActiveCoupon): Date | null {
    const expiryDate = coupon.effectiveExpiry || coupon.expiresAt;
    return expiryDate ? new Date(expiryDate) : null;
  }

  formatExpiryDate(coupon: UserActiveCoupon): string | null {
    const expiryDate = this.getExpiryDate(coupon);
    if (!expiryDate) return null;

    const now = new Date();
    const timeDiff = expiryDate.getTime() - now.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    if (daysDiff < 0) return 'Expired';
    if (daysDiff === 0) return 'Expires today';
    if (daysDiff === 1) return 'Expires tomorrow';
    if (daysDiff <= 7) return `Expires in ${daysDiff} days`;

    return expiryDate.toLocaleDateString();
  }
}

export const couponService = new CouponService();