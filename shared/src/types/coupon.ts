import { z } from 'zod';

// Base Coupon Schema
export const CouponSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(['percentage', 'fixed_amount', 'free_item']),
  category: z.enum(['room', 'dining', 'spa', 'experience', 'general']),
  value: z.number().min(0),
  minSpend: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  validFrom: z.date(),
  validUntil: z.date(),
  usageLimit: z.number().int().min(1).optional(),
  usageCount: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  terms: z.string().optional(),
  imageUrl: z.string().url().optional(),
  qrCode: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Coupon = z.infer<typeof CouponSchema>;

// Customer Coupon Assignment Schema
export const CustomerCouponSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  couponId: z.string().uuid(),
  isUsed: z.boolean().default(false),
  usedAt: z.date().optional(),
  redeemedAt: z.date().optional(),
  redemptionLocation: z.string().optional(),
  redemptionAmount: z.number().min(0).optional(),
  createdAt: z.date(),
});

export type CustomerCoupon = z.infer<typeof CustomerCouponSchema>;

// Coupon with Customer Info
export const CouponWithCustomerInfoSchema = z.object({
  coupon: CouponSchema,
  customerCoupon: CustomerCouponSchema,
});

export type CouponWithCustomerInfo = z.infer<typeof CouponWithCustomerInfoSchema>;

// Redemption Result Schema
export const RedemptionResultSchema = z.object({
  success: z.boolean(),
  discountAmount: z.number().min(0),
  finalAmount: z.number().min(0),
  customerCoupon: CustomerCouponSchema,
});

export type RedemptionResult = z.infer<typeof RedemptionResultSchema>;

// Create Coupon Request Schema
export const CreateCouponSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(['percentage', 'fixed_amount', 'free_item']),
  category: z.enum(['room', 'dining', 'spa', 'experience', 'general']),
  value: z.number().min(0),
  minSpend: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  validFrom: z.date(),
  validUntil: z.date(),
  usageLimit: z.number().int().min(1).optional(),
  terms: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export type CreateCoupon = z.infer<typeof CreateCouponSchema>;

// Update Coupon Request Schema
export const UpdateCouponSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(['percentage', 'fixed_amount', 'free_item']).optional(),
  category: z.enum(['room', 'dining', 'spa', 'experience', 'general']).optional(),
  value: z.number().min(0).optional(),
  minSpend: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  validFrom: z.date().optional(),
  validUntil: z.date().optional(),
  usageLimit: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  terms: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export type UpdateCoupon = z.infer<typeof UpdateCouponSchema>;

// Coupon Redemption Request Schema
export const CouponRedemptionRequestSchema = z.object({
  code: z.string(),
  amount: z.number().min(0),
  location: z.string().optional(),
});

export type CouponRedemptionRequest = z.infer<typeof CouponRedemptionRequestSchema>;

// QR Code Validation Request Schema
export const QRCodeValidationRequestSchema = z.object({
  qrData: z.string(),
});

export type QRCodeValidationRequest = z.infer<typeof QRCodeValidationRequestSchema>;

// QR Code Validation Response Schema
export const QRCodeValidationResponseSchema = z.object({
  coupon: CouponSchema,
  valid: z.boolean(),
  code: z.string(),
});

export type QRCodeValidationResponse = z.infer<typeof QRCodeValidationResponseSchema>;

// Coupon Distribution Request Schema
export const CouponDistributionRequestSchema = z.object({
  couponId: z.string().uuid(),
  customerIds: z.array(z.string().uuid()).optional(),
  tierIds: z.array(z.string().uuid()).optional(),
  all: z.boolean().default(false),
  conditions: z.record(z.unknown()).default({}),
});

export type CouponDistributionRequest = z.infer<typeof CouponDistributionRequestSchema>;

// Coupon Search/Filter Schema
export const CouponSearchSchema = z.object({
  query: z.string().optional(),
  type: z.enum(['percentage', 'fixed_amount', 'free_item']).optional(),
  category: z.enum(['room', 'dining', 'spa', 'experience', 'general']).optional(),
  isActive: z.boolean().optional(),
  validNow: z.boolean().optional(),
  hasUsageLimit: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['title', 'code', 'value', 'validUntil', 'created']).default('created'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CouponSearch = z.infer<typeof CouponSearchSchema>;

// Coupon Analytics Schema
export const CouponAnalyticsSchema = z.object({
  totalCoupons: z.number().int(),
  activeCoupons: z.number().int(),
  totalRedemptions: z.number().int(),
  totalSavings: z.number(),
  averageDiscountPerRedemption: z.number(),
  redemptionsByType: z.record(z.string(), z.number()),
  redemptionsByCategory: z.record(z.string(), z.number()),
  topPerformingCoupons: z.array(z.object({
    coupon: CouponSchema,
    redemptionCount: z.number().int(),
    totalSavings: z.number(),
  })),
  expiringSoon: z.array(CouponSchema),
});

export type CouponAnalytics = z.infer<typeof CouponAnalyticsSchema>;

// Customer Coupon List Response Schema
export const CustomerCouponsResponseSchema = z.object({
  available: z.array(CouponWithCustomerInfoSchema),
  used: z.array(CouponWithCustomerInfoSchema),
  expired: z.array(CouponWithCustomerInfoSchema),
  total: z.number().int(),
});

export type CustomerCouponsResponse = z.infer<typeof CustomerCouponsResponseSchema>;

// Bulk Coupon Operation Schema
export const BulkCouponOperationSchema = z.object({
  operation: z.enum(['activate', 'deactivate', 'delete', 'extend']),
  couponIds: z.array(z.string().uuid()),
  params: z.record(z.unknown()).default({}),
});

export type BulkCouponOperation = z.infer<typeof BulkCouponOperationSchema>;