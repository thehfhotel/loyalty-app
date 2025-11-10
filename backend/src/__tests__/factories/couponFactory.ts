import { faker } from '@faker-js/faker';

type CouponType = 'percentage' | 'fixed_amount' | 'bogo' | 'free_upgrade' | 'free_service';
type CouponStatus = 'draft' | 'active' | 'paused' | 'expired' | 'exhausted';
type UserCouponStatus = 'available' | 'used' | 'expired' | 'revoked';

/**
 * Coupon Factory
 * Generates mock coupon data for testing
 */

export interface MockCouponInput {
  id?: string;
  code?: string;
  name?: string;
  description?: string | null;
  terms_and_conditions?: string | null;
  type?: CouponType;
  value?: number;
  currency?: string;
  minimum_spend?: number | null;
  maximum_discount?: number | null;
  valid_from?: Date;
  valid_until?: Date | null;
  usage_limit?: number | null;
  usage_limit_per_user?: number;
  used_count?: number;
  tier_restrictions?: unknown[];
  customer_segment?: Record<string, unknown>;
  status?: CouponStatus;
  created_by?: string | null;
  created_at?: Date;
  updated_at?: Date;
  original_language?: string;
  available_languages?: string[];
}

export interface MockUserCouponInput {
  id?: string;
  user_id?: string;
  coupon_id?: string;
  status?: UserCouponStatus;
  qr_code?: string;
  used_at?: Date | null;
  used_by_admin?: string | null;
  redemption_location?: string | null;
  redemption_details?: Record<string, unknown>;
  assigned_by?: string | null;
  assigned_reason?: string | null;
  expires_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export const couponFactory = {
  /**
   * Build a complete coupon object
   */
  build: (overrides: MockCouponInput = {}) => ({
    id: overrides.id ?? faker.string.uuid(),
    code: overrides.code ?? faker.string.alphanumeric(10).toUpperCase(),
    name: overrides.name ?? faker.commerce.productName(),
    description: overrides.description ?? faker.commerce.productDescription(),
    terms_and_conditions: overrides.terms_and_conditions ?? faker.lorem.paragraph(),
    type: overrides.type ?? 'percentage' as CouponType,
    value: overrides.value ?? faker.number.float({ min: 5, max: 50, fractionDigits: 2 }),
    currency: overrides.currency ?? 'USD',
    minimum_spend: overrides.minimum_spend ?? null,
    maximum_discount: overrides.maximum_discount ?? null,
    valid_from: overrides.valid_from ?? new Date(),
    valid_until: overrides.valid_until ?? faker.date.future(),
    usage_limit: overrides.usage_limit ?? null,
    usage_limit_per_user: overrides.usage_limit_per_user ?? 1,
    used_count: overrides.used_count ?? 0,
    tier_restrictions: overrides.tier_restrictions ?? [],
    customer_segment: overrides.customer_segment ?? {},
    status: overrides.status ?? 'active' as CouponStatus,
    created_by: overrides.created_by ?? null,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
    original_language: overrides.original_language ?? 'th',
    available_languages: overrides.available_languages ?? ['th'],
  }),

  /**
   * Build a percentage discount coupon
   */
  buildPercentage: (percentage: number, overrides: MockCouponInput = {}) =>
    couponFactory.build({
      type: 'percentage' as CouponType,
      value: percentage,
      name: `${percentage}% Discount`,
      ...overrides,
    }),

  /**
   * Build a fixed amount discount coupon
   */
  buildFixedAmount: (amount: number, overrides: MockCouponInput = {}) =>
    couponFactory.build({
      type: 'fixed_amount' as CouponType,
      value: amount,
      name: `$${amount} Off`,
      ...overrides,
    }),

  /**
   * Build a BOGO coupon
   */
  buildBogo: (overrides: MockCouponInput = {}) =>
    couponFactory.build({
      type: 'bogo' as CouponType,
      name: 'Buy One Get One Free',
      value: 0,
      ...overrides,
    }),

  /**
   * Build a free upgrade coupon
   */
  buildFreeUpgrade: (overrides: MockCouponInput = {}) =>
    couponFactory.build({
      type: 'free_upgrade' as CouponType,
      name: 'Free Room Upgrade',
      value: 0,
      ...overrides,
    }),

  /**
   * Build a free service coupon
   */
  buildFreeService: (serviceName: string, overrides: MockCouponInput = {}) =>
    couponFactory.build({
      type: 'free_service' as CouponType,
      name: `Free ${serviceName}`,
      value: 0,
      ...overrides,
    }),

  /**
   * Build a draft coupon
   */
  buildDraft: (overrides: MockCouponInput = {}) =>
    couponFactory.build({ status: 'draft' as CouponStatus, ...overrides }),

  /**
   * Build an active coupon
   */
  buildActive: (overrides: MockCouponInput = {}) =>
    couponFactory.build({ status: 'active' as CouponStatus, ...overrides }),

  /**
   * Build a paused coupon
   */
  buildPaused: (overrides: MockCouponInput = {}) =>
    couponFactory.build({ status: 'paused' as CouponStatus, ...overrides }),

  /**
   * Build an expired coupon
   */
  buildExpired: (overrides: MockCouponInput = {}) =>
    couponFactory.build({
      status: 'expired' as CouponStatus,
      valid_until: faker.date.past(),
      ...overrides,
    }),

  /**
   * Build an exhausted coupon
   */
  buildExhausted: (overrides: MockCouponInput = {}) =>
    couponFactory.build({
      status: 'exhausted' as CouponStatus,
      usage_limit: 100,
      used_count: 100,
      ...overrides,
    }),

  /**
   * Build a coupon with tier restrictions
   */
  buildWithTierRestrictions: (tiers: string[], overrides: MockCouponInput = {}) =>
    couponFactory.build({ tier_restrictions: tiers, ...overrides }),

  /**
   * Build a coupon with minimum spend
   */
  buildWithMinSpend: (minSpend: number, overrides: MockCouponInput = {}) =>
    couponFactory.build({ minimum_spend: minSpend, ...overrides }),

  /**
   * Build a coupon with max discount cap
   */
  buildWithMaxDiscount: (maxDiscount: number, overrides: MockCouponInput = {}) =>
    couponFactory.build({ maximum_discount: maxDiscount, ...overrides }),

  /**
   * Build multiple coupons
   */
  buildList: (count: number, overrides: MockCouponInput = {}) =>
    Array.from({ length: count }, () => couponFactory.build(overrides)),

  /**
   * Build a new member welcome coupon
   */
  buildNewMemberCoupon: (overrides: MockCouponInput = {}) =>
    couponFactory.build({
      code: 'WELCOME',
      name: 'Welcome Bonus',
      type: 'percentage' as CouponType,
      value: 20,
      usage_limit_per_user: 1,
      status: 'active' as CouponStatus,
      ...overrides,
    }),
};

export const userCouponFactory = {
  /**
   * Build a user coupon assignment
   */
  build: (overrides: MockUserCouponInput = {}) => ({
    id: overrides.id ?? faker.string.uuid(),
    user_id: overrides.user_id ?? faker.string.uuid(),
    coupon_id: overrides.coupon_id ?? faker.string.uuid(),
    status: overrides.status ?? 'available' as UserCouponStatus,
    qr_code: overrides.qr_code ?? faker.string.alphanumeric(20),
    used_at: overrides.used_at ?? null,
    used_by_admin: overrides.used_by_admin ?? null,
    redemption_location: overrides.redemption_location ?? null,
    redemption_details: overrides.redemption_details ?? {},
    assigned_by: overrides.assigned_by ?? null,
    assigned_reason: overrides.assigned_reason ?? null,
    expires_at: overrides.expires_at ?? null,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  }),

  /**
   * Build an available user coupon
   */
  buildAvailable: (overrides: MockUserCouponInput = {}) =>
    userCouponFactory.build({
      status: 'available' as UserCouponStatus,
      ...overrides,
    }),

  /**
   * Build a used user coupon
   */
  buildUsed: (overrides: MockUserCouponInput = {}) =>
    userCouponFactory.build({
      status: 'used' as UserCouponStatus,
      used_at: faker.date.recent(),
      redemption_location: faker.location.city(),
      ...overrides,
    }),

  /**
   * Build an expired user coupon
   */
  buildExpired: (overrides: MockUserCouponInput = {}) =>
    userCouponFactory.build({
      status: 'expired' as UserCouponStatus,
      expires_at: faker.date.past(),
      ...overrides,
    }),

  /**
   * Build a revoked user coupon
   */
  buildRevoked: (overrides: MockUserCouponInput = {}) =>
    userCouponFactory.build({
      status: 'revoked' as UserCouponStatus,
      ...overrides,
    }),

  /**
   * Build multiple user coupons
   */
  buildList: (count: number, overrides: MockUserCouponInput = {}) =>
    Array.from({ length: count }, () => userCouponFactory.build(overrides)),

  /**
   * Build user coupon with full coupon details
   */
  buildWithCoupon: (overrides: MockUserCouponInput = {}) => {
    const userCoupon = userCouponFactory.build(overrides);
    const coupon = couponFactory.build({ id: userCoupon.coupon_id });

    return {
      ...userCoupon,
      coupons: coupon,
    };
  },

  /**
   * Build user's coupon collection
   */
  buildUserCollection: (userId: string, count: number) => {
    const statuses: user_coupon_status[] = ['available', 'used', 'expired'];
    return Array.from({ length: count }, () => {
      const status = faker.helpers.arrayElement(statuses);
      return userCouponFactory.build({
        user_id: userId,
        status,
        used_at: status === 'used' ? faker.date.recent() : null,
        expires_at: status === 'expired' ? faker.date.past() : faker.date.future(),
      });
    });
  },
};

export interface MockCouponRedemptionInput {
  id?: string;
  user_coupon_id?: string;
  original_amount?: number;
  discount_amount?: number;
  final_amount?: number;
  currency?: string;
  transaction_reference?: string | null;
  redemption_channel?: string;
  staff_member_id?: string | null;
  location?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
}

export const couponRedemptionFactory = {
  /**
   * Build a coupon redemption record
   */
  build: (overrides: MockCouponRedemptionInput = {}) => ({
    id: overrides.id ?? faker.string.uuid(),
    user_coupon_id: overrides.user_coupon_id ?? faker.string.uuid(),
    original_amount: overrides.original_amount ?? faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
    discount_amount: overrides.discount_amount ?? faker.number.float({ min: 5, max: 100, fractionDigits: 2 }),
    final_amount: overrides.final_amount ?? faker.number.float({ min: 40, max: 450, fractionDigits: 2 }),
    currency: overrides.currency ?? 'USD',
    transaction_reference: overrides.transaction_reference ?? faker.string.alphanumeric(15),
    redemption_channel: overrides.redemption_channel ?? 'mobile_app',
    staff_member_id: overrides.staff_member_id ?? null,
    location: overrides.location ?? faker.location.city(),
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? new Date(),
  }),

  /**
   * Build redemption with calculated amounts
   */
  buildCalculated: (originalAmount: number, discountPercent: number, overrides: MockCouponRedemptionInput = {}) => {
    const discountAmount = (originalAmount * discountPercent) / 100;
    const finalAmount = originalAmount - discountAmount;

    return couponRedemptionFactory.build({
      original_amount: originalAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      ...overrides,
    });
  },

  /**
   * Build multiple redemptions
   */
  buildList: (count: number, overrides: MockCouponRedemptionInput = {}) =>
    Array.from({ length: count }, () => couponRedemptionFactory.build(overrides)),
};
