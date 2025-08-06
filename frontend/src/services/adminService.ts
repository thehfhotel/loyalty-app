import api from './authService';

export interface NewMemberCouponSettings {
  id: string;
  isEnabled: boolean;
  selectedCouponId: string | null;
  pointsEnabled: boolean;
  pointsAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewMemberCouponUpdateData {
  isEnabled: boolean;
  selectedCouponId: string | null;
  pointsEnabled: boolean;
  pointsAmount: number | null;
}

export interface CouponStatusForAdmin {
  id: string;
  code: string;
  name: string;
  status: string;
  validFrom: string | null;
  validUntil: string | null;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  warningLevel: 'none' | 'warning' | 'danger';
}

export const adminService = {
  async getNewMemberCouponSettings(): Promise<NewMemberCouponSettings> {
    const response = await api.get('/users/admin/new-member-coupon-settings');
    return response.data.data;
  },

  async updateNewMemberCouponSettings(data: NewMemberCouponUpdateData): Promise<NewMemberCouponSettings> {
    const response = await api.put('/users/admin/new-member-coupon-settings', data);
    return response.data.data;
  },

  async getCouponStatusForAdmin(couponId: string): Promise<CouponStatusForAdmin> {
    const response = await api.get(`/users/admin/coupon-status/${couponId}`);
    return response.data.data;
  },
};