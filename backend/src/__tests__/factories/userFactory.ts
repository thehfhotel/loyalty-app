import { faker } from '@faker-js/faker';

/**
 * User Factory
 * Generates mock user data for testing
 */

type UserRole = 'customer' | 'admin' | 'super_admin';

export interface MockUserInput {
  id?: string;
  email?: string;
  password_hash?: string | null;
  role?: UserRole;
  is_active?: boolean;
  email_verified?: boolean;
  oauth_provider?: string | null;
  oauth_provider_id?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export const userFactory = {
  /**
   * Build a complete user object with all fields
   */
  build: (overrides: MockUserInput = {}) => ({
    id: overrides.id ?? faker.string.uuid(),
    email: overrides.email ?? faker.internet.email(),
    password_hash: overrides.password_hash ?? faker.string.alphanumeric(60),
    role: overrides.role ?? ('customer' as UserRole),
    is_active: overrides.is_active ?? true,
    email_verified: overrides.email_verified ?? false,
    oauth_provider: overrides.oauth_provider ?? null,
    oauth_provider_id: overrides.oauth_provider_id ?? null,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  }),

  /**
   * Build a customer user
   */
  buildCustomer: (overrides: MockUserInput = {}) =>
    userFactory.build({ role: 'customer' as UserRole, ...overrides }),

  /**
   * Build an admin user
   */
  buildAdmin: (overrides: MockUserInput = {}) =>
    userFactory.build({
      role: 'admin' as UserRole,
      email_verified: true,
      ...overrides
    }),

  /**
   * Build a super admin user
   */
  buildSuperAdmin: (overrides: MockUserInput = {}) =>
    userFactory.build({
      role: 'super_admin' as UserRole,
      email_verified: true,
      ...overrides
    }),

  /**
   * Build an OAuth user
   */
  buildOAuthUser: (provider: string, overrides: MockUserInput = {}) =>
    userFactory.build({
      oauth_provider: provider,
      oauth_provider_id: faker.string.alphanumeric(20),
      password_hash: null,
      email_verified: true,
      ...overrides,
    }),

  /**
   * Build a Google OAuth user
   */
  buildGoogleUser: (overrides: MockUserInput = {}) =>
    userFactory.buildOAuthUser('google', overrides),

  /**
   * Build a Line OAuth user
   */
  buildLineUser: (overrides: MockUserInput = {}) =>
    userFactory.buildOAuthUser('line', overrides),

  /**
   * Build multiple users
   */
  buildList: (count: number, overrides: MockUserInput = {}) =>
    Array.from({ length: count }, () => userFactory.build(overrides)),

  /**
   * Build a user with profile
   */
  buildWithProfile: (overrides: MockUserInput = {}) => {
    const user = userFactory.build(overrides);
    return {
      ...user,
      user_profiles: {
        user_id: user.id,
        first_name: faker.person.firstName(),
        last_name: faker.person.lastName(),
        phone: faker.phone.number(),
        date_of_birth: faker.date.birthdate({ min: 18, max: 80, mode: 'age' }),
        preferences: {},
        avatar_url: faker.image.avatar(),
        created_at: new Date(),
        updated_at: new Date(),
        membership_id: faker.string.alphanumeric(8).toUpperCase(),
      },
    };
  },

  /**
   * Build a user with loyalty data
   */
  buildWithLoyalty: (overrides: MockUserInput = {}) => {
    const user = userFactory.build(overrides);
    return {
      ...user,
      user_loyalty: {
        user_id: user.id,
        current_points: faker.number.int({ min: 0, max: 10000 }),
        tier_id: faker.string.uuid(),
        tier_updated_at: new Date(),
        points_updated_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    };
  },

  /**
   * Build a complete user with profile and loyalty
   */
  buildComplete: (overrides: MockUserInput = {}) => {
    const user = userFactory.build(overrides);
    const withProfile = userFactory.buildWithProfile(overrides);
    const withLoyalty = userFactory.buildWithLoyalty(overrides);

    return {
      ...user,
      user_profiles: withProfile.user_profiles,
      user_loyalty: withLoyalty.user_loyalty,
    };
  },
};
