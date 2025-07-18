import { z } from 'zod';

// Loyalty Tier Types
export const TierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  minPoints: z.number().min(0),
  maxPoints: z.number().optional(),
  benefits: z.array(z.string()),
  color: z.string(),
  icon: z.string(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Tier = z.infer<typeof TierSchema>;

// Customer Profile Types
export const CustomerProfileSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  tierId: z.string().uuid(),
  pointsBalance: z.number().min(0).default(0),
  lifetimePoints: z.number().min(0).default(0),
  totalSpent: z.number().min(0).default(0),
  stayCount: z.number().min(0).default(0),
  preferences: z.object({
    roomType: z.string().optional(),
    bedType: z.string().optional(),
    smokingPreference: z.boolean().optional(),
    specialRequests: z.array(z.string()).default([]),
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

// Points Transaction Types
export const PointsTransactionSchema = z.object({
  id: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  type: z.enum(['earned', 'redeemed', 'expired', 'bonus']),
  amount: z.number(),
  description: z.string(),
  referenceId: z.string().optional(),
  referenceType: z.enum(['stay', 'purchase', 'survey', 'social', 'promotion']).optional(),
  expiresAt: z.date().optional(),
  createdAt: z.date(),
});

export type PointsTransaction = z.infer<typeof PointsTransactionSchema>;

// Points Earning Rules
export const PointsRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['spend', 'stay', 'activity']),
  pointsPerUnit: z.number().min(0),
  multiplier: z.number().min(1).default(1),
  conditions: z.object({
    minAmount: z.number().optional(),
    maxAmount: z.number().optional(),
    tierIds: z.array(z.string().uuid()).optional(),
    categories: z.array(z.string()).optional(),
  }).optional(),
  isActive: z.boolean().default(true),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PointsRule = z.infer<typeof PointsRuleSchema>;

// Redemption Options
export const RedemptionOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['room', 'dining', 'spa', 'experience', 'merchandise']),
  pointsCost: z.number().min(1),
  cashValue: z.number().min(0),
  availability: z.number().optional(),
  terms: z.string().optional(),
  imageUrl: z.string().optional(),
  isActive: z.boolean().default(true),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type RedemptionOption = z.infer<typeof RedemptionOptionSchema>;

// Redemption Request
export const RedemptionRequestSchema = z.object({
  id: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  redemptionOptionId: z.string().uuid(),
  pointsUsed: z.number().min(1),
  status: z.enum(['pending', 'approved', 'rejected', 'used']),
  notes: z.string().optional(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
  usedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type RedemptionRequest = z.infer<typeof RedemptionRequestSchema>;