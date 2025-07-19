import { z } from 'zod';

// Tier Types
export const TierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  minPoints: z.number().int().min(0),
  maxPoints: z.number().int().optional(),
  benefits: z.array(z.string()).default([]),
  color: z.string().default('#000000'),
  icon: z.string().optional(),
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
  pointsBalance: z.number().int().min(0).default(0),
  lifetimePoints: z.number().int().min(0).default(0),
  totalSpent: z.number().min(0).default(0),
  stayCount: z.number().int().min(0).default(0),
  preferences: z.record(z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

// Extended Customer with User and Tier info
export const CustomerSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().optional(),
  dateOfBirth: z.date().optional(),
  isActive: z.boolean(),
  emailVerified: z.boolean(),
  profile: CustomerProfileSchema,
  tier: TierSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Customer = z.infer<typeof CustomerSchema>;

// Customer Update Request
export const CustomerUpdateRequestSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  dateOfBirth: z.date().optional(),
  preferences: z.record(z.unknown()).optional(),
});

export type CustomerUpdateRequest = z.infer<typeof CustomerUpdateRequestSchema>;

// Customer Search/Filter Types
export const CustomerSearchSchema = z.object({
  query: z.string().optional(),
  tier: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  minPoints: z.number().int().min(0).optional(),
  maxPoints: z.number().int().min(0).optional(),
  minSpent: z.number().min(0).optional(),
  maxSpent: z.number().min(0).optional(),
  registeredAfter: z.date().optional(),
  registeredBefore: z.date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'email', 'points', 'spent', 'created']).default('created'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CustomerSearch = z.infer<typeof CustomerSearchSchema>;

// Customer Stats
export const CustomerStatsSchema = z.object({
  totalCustomers: z.number().int(),
  activeCustomers: z.number().int(),
  totalPoints: z.number().int(),
  totalSpent: z.number(),
  averageSpent: z.number(),
  tierDistribution: z.record(z.string(), z.number()),
  recentSignups: z.number().int(),
});

export type CustomerStats = z.infer<typeof CustomerStatsSchema>;

// Activity Types
export const ActivityTypeSchema = z.enum([
  'registration',
  'login',
  'profile_update',
  'points_earned',
  'points_redeemed',
  'tier_upgrade',
  'coupon_received',
  'coupon_redeemed',
  'survey_completed',
  'campaign_interaction',
]);

export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const CustomerActivitySchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  type: ActivityTypeSchema,
  description: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.date(),
});

export type CustomerActivity = z.infer<typeof CustomerActivitySchema>;

// Admin customer management
export const CustomerAdminUpdateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  dateOfBirth: z.date().optional(),
  isActive: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  pointsBalance: z.number().int().optional(),
  tierId: z.string().uuid().optional(),
  preferences: z.record(z.unknown()).optional(),
  adminNotes: z.string().optional(),
});

export type CustomerAdminUpdate = z.infer<typeof CustomerAdminUpdateSchema>;

// Customer API Interface for Stream B consumption
export interface CustomerAPI {
  getCustomer(id: string): Promise<Customer>;
  getCustomerProfile(userId: string): Promise<CustomerProfile>;
  updateCustomerPoints(id: string, points: number, description: string): Promise<void>;
  getCustomerTier(id: string): Promise<Tier>;
  isCustomerActive(id: string): Promise<boolean>;
  getCustomerByEmail(email: string): Promise<Customer | null>;
}