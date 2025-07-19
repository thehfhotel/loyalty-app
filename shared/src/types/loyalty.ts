import { z } from 'zod';

// Points Rule Types
export const PointsRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum([
    'booking',
    'spending',
    'referral',
    'review',
    'survey',
    'birthday',
    'anniversary',
    'promotion',
    'manual'
  ]),
  pointsPerUnit: z.number().min(0),
  multiplier: z.number().min(0).default(1),
  conditions: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PointsRule = z.infer<typeof PointsRuleSchema>;

// Points Transaction Types
export const PointsTransactionSchema = z.object({
  id: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  type: z.enum(['earned', 'redeemed', 'expired', 'adjusted', 'bonus']),
  amount: z.number().int(),
  description: z.string(),
  referenceId: z.string().optional(),
  referenceType: z.string().optional(),
  expiresAt: z.date().optional(),
  createdAt: z.date(),
});

export type PointsTransaction = z.infer<typeof PointsTransactionSchema>;

// Points Earning Request
export const PointsEarningRequestSchema = z.object({
  customerProfileId: z.string().uuid(),
  ruleType: z.string(),
  amount: z.number().min(0),
  referenceId: z.string().optional(),
  referenceType: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type PointsEarningRequest = z.infer<typeof PointsEarningRequestSchema>;

// Redemption Option Types
export const RedemptionOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  category: z.enum([
    'room_upgrade',
    'dining',
    'spa',
    'activities',
    'merchandise',
    'cash_back',
    'experiences',
    'travel',
  ]),
  pointsCost: z.number().int().min(1),
  cashValue: z.number().min(0).default(0),
  availability: z.number().int().optional(),
  terms: z.string().optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type RedemptionOption = z.infer<typeof RedemptionOptionSchema>;

// Redemption Request Types
export const RedemptionRequestSchema = z.object({
  id: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  redemptionOptionId: z.string().uuid(),
  pointsUsed: z.number().int().min(1),
  status: z.enum(['pending', 'approved', 'fulfilled', 'cancelled']).default('pending'),
  notes: z.string().optional(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
  usedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type RedemptionRequest = z.infer<typeof RedemptionRequestSchema>;

// Create Redemption Request
export const CreateRedemptionRequestSchema = z.object({
  redemptionOptionId: z.string().uuid(),
  notes: z.string().optional(),
});

export type CreateRedemptionRequest = z.infer<typeof CreateRedemptionRequestSchema>;

// Loyalty Dashboard Data
export const LoyaltyDashboardSchema = z.object({
  currentTier: z.string(),
  pointsBalance: z.number().int(),
  lifetimePoints: z.number().int(),
  nextTier: z.string().optional(),
  pointsToNextTier: z.number().int().optional(),
  tierProgress: z.number().min(0).max(100),
  recentTransactions: z.array(PointsTransactionSchema),
  availableRedemptions: z.array(RedemptionOptionSchema),
  pendingRedemptions: z.array(RedemptionRequestSchema),
  tierBenefits: z.array(z.string()),
});

export type LoyaltyDashboard = z.infer<typeof LoyaltyDashboardSchema>;

// Points Balance Update
export const PointsBalanceUpdateSchema = z.object({
  amount: z.number().int(),
  description: z.string(),
  type: z.enum(['earned', 'redeemed', 'adjusted', 'bonus']),
  referenceId: z.string().optional(),
  referenceType: z.string().optional(),
});

export type PointsBalanceUpdate = z.infer<typeof PointsBalanceUpdateSchema>;

// Loyalty Analytics
export const LoyaltyAnalyticsSchema = z.object({
  totalPointsEarned: z.number().int(),
  totalPointsRedeemed: z.number().int(),
  activeRedemptions: z.number().int(),
  topRedemptionCategories: z.array(z.object({
    category: z.string(),
    count: z.number().int(),
    totalPoints: z.number().int(),
  })),
  tierDistribution: z.record(z.string(), z.number()),
  pointsExpiringThisMonth: z.number().int(),
  averagePointsPerCustomer: z.number(),
});

export type LoyaltyAnalytics = z.infer<typeof LoyaltyAnalyticsSchema>;

// Tier Management
export const TierUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  minPoints: z.number().int().min(0).optional(),
  maxPoints: z.number().int().optional(),
  benefits: z.array(z.string()).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type TierUpdate = z.infer<typeof TierUpdateSchema>;

export const CreateTierSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  minPoints: z.number().int().min(0),
  maxPoints: z.number().int().optional(),
  benefits: z.array(z.string()).default([]),
  color: z.string().default('#000000'),
  icon: z.string().optional(),
});

export type CreateTier = z.infer<typeof CreateTierSchema>;

// Points Rule Management
export const CreatePointsRuleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: PointsRuleSchema.shape.type,
  pointsPerUnit: z.number().min(0),
  multiplier: z.number().min(0).default(1),
  conditions: z.record(z.unknown()).default({}),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
});

export type CreatePointsRule = z.infer<typeof CreatePointsRuleSchema>;

export const UpdatePointsRuleSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  pointsPerUnit: z.number().min(0).optional(),
  multiplier: z.number().min(0).optional(),
  conditions: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
});

export type UpdatePointsRule = z.infer<typeof UpdatePointsRuleSchema>;