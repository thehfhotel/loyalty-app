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
  validFrom: string;
  validUntil?: string;
  usageLimit?: number;
  usageLimitPerUser: number;
  usedCount: number;
  
  // Targeting
  tierRestrictions: string[];
  customerSegment: Record<string, any>;
  
  // Metadata
  status: CouponStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  
  // Multilingual support
  originalLanguage?: import('./multilingual').SupportedLanguage;
  availableLanguages?: import('./multilingual').SupportedLanguage[];
}

export interface UserCoupon {
  id: string;
  userId: string;
  couponId: string;
  
  // Status and tracking
  status: UserCouponStatus;
  qrCode: string;
  
  // Usage details
  usedAt?: string;
  usedByAdmin?: string;
  redemptionLocation?: string;
  redemptionDetails: Record<string, any>;
  
  // Assignment metadata
  assignedBy?: string;
  assignedReason?: string;
  expiresAt?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface UserActiveCoupon {
  userCouponId: string;
  userId: string;
  status: UserCouponStatus;
  qrCode: string;
  expiresAt?: string;
  assignedAt: string;
  
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
  couponExpiresAt?: string;
  
  // Calculated fields
  effectiveExpiry?: string;
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
  validFrom?: string;
  validUntil?: string;
  usageLimit?: number;
  usageLimitPerUser?: number;
  tierRestrictions?: string[];
  customerSegment?: Record<string, any>;
  // Multilingual support
  originalLanguage?: import('./multilingual').SupportedLanguage;
}

export interface UpdateCouponRequest extends Partial<CreateCouponRequest> {
  status?: CouponStatus;
}

export interface AssignCouponRequest {
  couponId: string;
  userIds: string[];
  assignedReason?: string;
  customExpiry?: string;
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