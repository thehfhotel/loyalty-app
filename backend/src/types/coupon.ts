export type CouponType = 'percentage' | 'fixed_amount' | 'bogo' | 'free_upgrade' | 'free_service';
export type CouponStatus = 'draft' | 'active' | 'paused' | 'expired' | 'exhausted';
export type UserCouponStatus = 'available' | 'used' | 'expired' | 'revoked';

export interface Coupon {
  id: string;
  code: string;
  name: string;
  description?: string;
  termsAndConditions?: string;
  type: CouponType;
  value?: number;
  currency: string;
  minimumSpend?: number;
  maximumDiscount?: number;
  
  // Availability
  validFrom: Date;
  validUntil?: Date;
  usageLimit?: number;
  usageLimitPerUser: number;
  usedCount: number;
  
  // Targeting
  tierRestrictions: string[];
  customerSegment: Record<string, any>;
  
  // Metadata
  status: CouponStatus;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCoupon {
  id: string;
  userId: string;
  couponId: string;
  
  // Status and tracking
  status: UserCouponStatus;
  qrCode: string;
  
  // Usage details
  usedAt?: Date;
  usedByAdmin?: string;
  redemptionLocation?: string;
  redemptionDetails: Record<string, any>;
  
  // Assignment metadata
  assignedBy?: string;
  assignedReason?: string;
  expiresAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface CouponRedemption {
  id: string;
  userCouponId: string;
  
  // Transaction details
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
  
  // Context
  transactionReference?: string;
  redemptionChannel: string;
  staffMemberId?: string;
  location?: string;
  
  // Metadata
  metadata: Record<string, any>;
  
  createdAt: Date;
}

export interface CouponAnalytics {
  id: string;
  couponId: string;
  analyticsDate: Date;
  
  // Usage metrics
  totalAssigned: number;
  totalUsed: number;
  totalExpired: number;
  totalRevenueImpact: number;
  
  // User engagement
  uniqueUsersAssigned: number;
  uniqueUsersRedeemed: number;
  averageTimeToRedemption?: string; // Interval as string
  
  // Performance
  conversionRate: number;
  
  createdAt: Date;
}

export interface UserActiveCoupon {
  userCouponId: string;
  userId: string;
  status: UserCouponStatus;
  qrCode: string;
  expiresAt?: Date;
  assignedAt: Date;
  
  // Coupon details
  couponId: string;
  code: string;
  name: string;
  description?: string;
  termsAndConditions?: string;
  type: CouponType;
  value?: number;
  currency: string;
  minimumSpend?: number;
  maximumDiscount?: number;
  couponExpiresAt?: Date;
  
  // Calculated fields
  effectiveExpiry?: Date;
  expiringSoon: boolean;
}

// API Request/Response types
export interface CreateCouponRequest {
  code: string;
  name: string;
  description?: string;
  termsAndConditions?: string;
  type: CouponType;
  value?: number;
  currency?: string;
  minimumSpend?: number;
  maximumDiscount?: number;
  validFrom?: Date;
  validUntil?: Date;
  usageLimit?: number;
  usageLimitPerUser?: number;
  tierRestrictions?: string[];
  customerSegment?: Record<string, any>;
}

export interface UpdateCouponRequest extends Partial<CreateCouponRequest> {
  status?: CouponStatus;
}

export interface AssignCouponRequest {
  couponId: string;
  userIds: string[];
  assignedReason?: string;
  customExpiry?: Date;
}

export interface RedeemCouponRequest {
  qrCode: string;
  originalAmount: number;
  transactionReference?: string;
  location?: string;
  metadata?: Record<string, any>;
}

export interface RedeemCouponResponse {
  success: boolean;
  message: string;
  discountAmount: number;
  finalAmount: number;
  userCouponId?: string;
}

export interface CouponListResponse {
  coupons: Coupon[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserCouponListResponse {
  coupons: UserActiveCoupon[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CouponAnalyticsResponse {
  analytics: CouponAnalytics[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CouponStatsResponse {
  totalCoupons: number;
  activeCoupons: number;
  totalAssigned: number;
  totalRedeemed: number;
  totalRevenueImpact: number;
  conversionRate: number;
  topCoupons: Array<{
    couponId: string;
    name: string;
    code: string;
    redemptionCount: number;
    conversionRate: number;
  }>;
}