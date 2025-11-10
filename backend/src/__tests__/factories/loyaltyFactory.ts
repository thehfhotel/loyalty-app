import { faker } from '@faker-js/faker';

type PointsTransactionType =
  | 'earned_stay'
  | 'earned_bonus'
  | 'redeemed'
  | 'expired'
  | 'admin_adjustment'
  | 'admin_award'
  | 'admin_deduction';

/**
 * Loyalty Factory
 * Generates mock loyalty data for testing
 */

export interface MockTierInput {
  id?: string;
  name?: string;
  min_points?: number;
  benefits?: Record<string, unknown>;
  color?: string;
  sort_order?: number;
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface MockUserLoyaltyInput {
  user_id?: string;
  current_points?: number;
  tier_id?: string | null;
  tier_updated_at?: Date;
  points_updated_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export interface MockPointsTransactionInput {
  id?: string;
  user_id?: string;
  points?: number;
  type?: PointsTransactionType;
  description?: string | null;
  reference_id?: string | null;
  admin_user_id?: string | null;
  admin_reason?: string | null;
  expires_at?: Date | null;
  created_at?: Date;
  nights_stayed?: number;
}

export const tierFactory = {
  /**
   * Build a tier object
   */
  build: (overrides: MockTierInput = {}) => ({
    id: overrides.id ?? faker.string.uuid(),
    name: overrides.name ?? faker.helpers.arrayElement(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']),
    min_points: overrides.min_points ?? faker.number.int({ min: 0, max: 50000 }),
    benefits: overrides.benefits ?? {
      discount: faker.number.int({ min: 5, max: 30 }),
      priority_checkin: faker.datatype.boolean(),
      free_wifi: true,
    },
    color: overrides.color ?? faker.color.rgb(),
    sort_order: overrides.sort_order ?? faker.number.int({ min: 1, max: 10 }),
    is_active: overrides.is_active ?? true,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  }),

  /**
   * Build predefined tier levels
   */
  buildBronze: (overrides: MockTierInput = {}) =>
    tierFactory.build({ name: 'Bronze', min_points: 0, sort_order: 1, color: '#CD7F32', ...overrides }),

  buildSilver: (overrides: MockTierInput = {}) =>
    tierFactory.build({ name: 'Silver', min_points: 1000, sort_order: 2, color: '#C0C0C0', ...overrides }),

  buildGold: (overrides: MockTierInput = {}) =>
    tierFactory.build({ name: 'Gold', min_points: 5000, sort_order: 3, color: '#FFD700', ...overrides }),

  buildPlatinum: (overrides: MockTierInput = {}) =>
    tierFactory.build({ name: 'Platinum', min_points: 10000, sort_order: 4, color: '#E5E4E2', ...overrides }),

  buildDiamond: (overrides: MockTierInput = {}) =>
    tierFactory.build({ name: 'Diamond', min_points: 25000, sort_order: 5, color: '#B9F2FF', ...overrides }),

  /**
   * Build all tier levels
   */
  buildAllTiers: () => [
    tierFactory.buildBronze(),
    tierFactory.buildSilver(),
    tierFactory.buildGold(),
    tierFactory.buildPlatinum(),
    tierFactory.buildDiamond(),
  ],

  /**
   * Build multiple tiers
   */
  buildList: (count: number, overrides: MockTierInput = {}) =>
    Array.from({ length: count }, () => tierFactory.build(overrides)),
};

export const userLoyaltyFactory = {
  /**
   * Build a user loyalty record
   */
  build: (overrides: MockUserLoyaltyInput = {}) => ({
    user_id: overrides.user_id ?? faker.string.uuid(),
    current_points: overrides.current_points ?? faker.number.int({ min: 0, max: 30000 }),
    tier_id: overrides.tier_id ?? faker.string.uuid(),
    tier_updated_at: overrides.tier_updated_at ?? new Date(),
    points_updated_at: overrides.points_updated_at ?? new Date(),
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  }),

  /**
   * Build a new user with minimal points
   */
  buildNewUser: (overrides: MockUserLoyaltyInput = {}) =>
    userLoyaltyFactory.build({ current_points: 0, ...overrides }),

  /**
   * Build a user with specific tier level points
   */
  buildWithTierPoints: (tierName: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond', overrides: MockUserLoyaltyInput = {}) => {
    const pointsByTier = {
      Bronze: faker.number.int({ min: 0, max: 999 }),
      Silver: faker.number.int({ min: 1000, max: 4999 }),
      Gold: faker.number.int({ min: 5000, max: 9999 }),
      Platinum: faker.number.int({ min: 10000, max: 24999 }),
      Diamond: faker.number.int({ min: 25000, max: 50000 }),
    };
    return userLoyaltyFactory.build({ current_points: pointsByTier[tierName], ...overrides });
  },

  /**
   * Build multiple user loyalty records
   */
  buildList: (count: number, overrides: MockUserLoyaltyInput = {}) =>
    Array.from({ length: count }, () => userLoyaltyFactory.build(overrides)),
};

export const pointsTransactionFactory = {
  /**
   * Build a points transaction
   */
  build: (overrides: MockPointsTransactionInput = {}) => ({
    id: overrides.id ?? faker.string.uuid(),
    user_id: overrides.user_id ?? faker.string.uuid(),
    points: overrides.points ?? faker.number.int({ min: 1, max: 1000 }),
    type: overrides.type ?? 'earned_stay' as PointsTransactionType,
    description: overrides.description ?? faker.lorem.sentence(),
    reference_id: overrides.reference_id ?? faker.string.alphanumeric(10),
    admin_user_id: overrides.admin_user_id ?? null,
    admin_reason: overrides.admin_reason ?? null,
    expires_at: overrides.expires_at ?? null,
    created_at: overrides.created_at ?? new Date(),
    nights_stayed: overrides.nights_stayed ?? 0,
  }),

  /**
   * Build an earned stay transaction
   */
  buildEarnedStay: (nights: number, overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'earned_stay' as PointsTransactionType,
      points: nights * 100,
      nights_stayed: nights,
      description: `Earned ${nights * 100} points for ${nights} nights stay`,
      ...overrides,
    }),

  /**
   * Build an earned bonus transaction
   */
  buildEarnedBonus: (overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'earned_bonus' as PointsTransactionType,
      description: 'Bonus points earned',
      ...overrides,
    }),

  /**
   * Build a redeemed transaction
   */
  buildRedeemed: (overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'redeemed' as PointsTransactionType,
      points: -faker.number.int({ min: 100, max: 5000 }),
      description: 'Points redeemed for reward',
      ...overrides,
    }),

  /**
   * Build an expired transaction
   */
  buildExpired: (overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'expired' as PointsTransactionType,
      points: -faker.number.int({ min: 100, max: 1000 }),
      description: 'Points expired',
      expires_at: faker.date.past(),
      ...overrides,
    }),

  /**
   * Build an admin adjustment transaction
   */
  buildAdminAdjustment: (overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'admin_adjustment' as PointsTransactionType,
      admin_user_id: faker.string.uuid(),
      admin_reason: faker.lorem.sentence(),
      description: 'Admin adjustment',
      ...overrides,
    }),

  /**
   * Build an admin award transaction
   */
  buildAdminAward: (overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'admin_award' as PointsTransactionType,
      admin_user_id: faker.string.uuid(),
      admin_reason: faker.lorem.sentence(),
      description: 'Admin award',
      ...overrides,
    }),

  /**
   * Build an admin deduction transaction
   */
  buildAdminDeduction: (overrides: MockPointsTransactionInput = {}) =>
    pointsTransactionFactory.build({
      type: 'admin_deduction' as PointsTransactionType,
      points: -faker.number.int({ min: 100, max: 5000 }),
      admin_user_id: faker.string.uuid(),
      admin_reason: faker.lorem.sentence(),
      description: 'Admin deduction',
      ...overrides,
    }),

  /**
   * Build multiple transactions
   */
  buildList: (count: number, overrides: MockPointsTransactionInput = {}) =>
    Array.from({ length: count }, () => pointsTransactionFactory.build(overrides)),

  /**
   * Build transaction history for a user
   */
  buildHistory: (userId: string, count: number) => {
    const transactions: ReturnType<typeof pointsTransactionFactory.build>[] = [];
    const types: PointsTransactionType[] = ['earned_stay', 'earned_bonus', 'redeemed', 'admin_adjustment'];

    for (let i = 0; i < count; i++) {
      const type = faker.helpers.arrayElement(types);
      const isDeduction = type === 'redeemed' || type === 'admin_deduction';

      transactions.push(
        pointsTransactionFactory.build({
          user_id: userId,
          type,
          points: isDeduction
            ? -faker.number.int({ min: 100, max: 1000 })
            : faker.number.int({ min: 100, max: 1000 }),
          created_at: faker.date.recent({ days: 90 }),
        })
      );
    }

    return transactions.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  },
};
