/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from '../config/prisma';
import { AppError } from '../middleware/errorHandler';
import { users, user_profiles, Prisma } from '../generated/prisma';

export type UserWithProfile = users & {
  user_profiles?: user_profiles | null;
};

export class PrismaUserService {
  /**
   * Get user by ID with profile information
   */
  async getUserById(userId: string): Promise<UserWithProfile | null> {
    try {
      const user = await db.users.findUnique({
        where: { id: userId },
        include: {
          user_profiles: true,
          user_loyalty: {
            include: {
              tiers: true,
            },
          },
        },
      });

      return user;
    } catch (error) {
      throw new AppError(500, `Failed to fetch user: ${error}`);
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<UserWithProfile | null> {
    try {
      const user = await db.users.findFirst({
        where: { email },
        include: {
          user_profiles: true,
        },
      });

      return user;
    } catch (error) {
      throw new AppError(500, `Failed to fetch user by email: ${error}`);
    }
  }

  /**
   * Create a new user with profile
   */
  async createUser(userData: {
    email: string;
    password_hash?: string;
    oauth_provider?: string;
    oauth_provider_id?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  }): Promise<UserWithProfile> {
    try {
      // Generate membership ID
      const membershipId = await this.generateMembershipId();

      const user = await db.users.create({
        data: {
          email: userData.email,
          password_hash: userData.password_hash,
          oauth_provider: userData.oauth_provider,
          oauth_provider_id: userData.oauth_provider_id,
          user_profiles: {
            create: {
              first_name: userData.first_name,
              last_name: userData.last_name,
              phone: userData.phone,
              membership_id: membershipId,
            },
          },
          user_loyalty: {
            create: {
              current_points: 0,
            },
          },
        },
        include: {
          user_profiles: true,
          user_loyalty: true,
        },
      });

      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new AppError(409, 'User with this email already exists');
        }
      }
      throw new AppError(500, `Failed to create user: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(
    userId: string,
    profileData: {
      first_name?: string;
      last_name?: string;
      phone?: string;
      date_of_birth?: Date;
      preferences?: Record<string, unknown>;
      avatar_url?: string;
    }
  ): Promise<user_profiles> {
    try {
      const profile = await db.user_profiles.upsert({
        where: { user_id: userId },
        update: {
          ...profileData,
          preferences: profileData.preferences as any, // Cast to satisfy Prisma JSON type
          updated_at: new Date(),
        },
        create: {
          user_id: userId,
          ...profileData,
          preferences: profileData.preferences as any, // Cast to satisfy Prisma JSON type
          membership_id: await this.generateMembershipId(),
        },
      });

      return profile;
    } catch (error) {
      throw new AppError(500, `Failed to update user profile: ${error}`);
    }
  }

  /**
   * Get users with pagination
   */
  async getUsers(options: {
    page?: number;
    limit?: number;
    search?: string;
    role?: 'customer' | 'admin' | 'super_admin';
  }): Promise<{
    users: UserWithProfile[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const page = options.page ?? 1;
      const limit = Math.min(options.limit ?? 10, 100); // Cap at 100
      const offset = (page - 1) * limit;

      const where: Prisma.usersWhereInput = {};

      if (options.search) {
        where.OR = [
          { email: { contains: options.search, mode: 'insensitive' } },
          {
            user_profiles: {
              OR: [
                { first_name: { contains: options.search, mode: 'insensitive' } },
                { last_name: { contains: options.search, mode: 'insensitive' } },
              ],
            },
          },
        ];
      }

      if (options.role) {
        where.role = options.role;
      }

      const [users, total] = await Promise.all([
        db.users.findMany({
          where,
          include: {
            user_profiles: true,
          },
          skip: offset,
          take: limit,
          orderBy: { created_at: 'desc' },
        }),
        db.users.count({ where }),
      ]);

      return {
        users,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw new AppError(500, `Failed to fetch users: ${error}`);
    }
  }

  /**
   * Generate unique membership ID
   */
  private async generateMembershipId(): Promise<string> {
    // Get current sequence counter
    const sequence = await db.membership_id_sequence.findFirst({
      orderBy: { id: 'desc' },
    });

    let userCount = sequence?.current_user_count ?? 0;
    userCount++;

    // Update the sequence
    await db.membership_id_sequence.upsert({
      where: { id: sequence?.id ?? 1 },
      update: { current_user_count: userCount },
      create: { current_user_count: userCount },
    });

    // Generate 8-digit ID with prefix 269
    const blockNumber = Math.floor((userCount - 1) / 100) + 1;
    const positionInBlock = ((userCount - 1) % 100) + 1;
    const membershipId = `269${blockNumber.toString().padStart(2, '0')}${positionInBlock.toString().padStart(3, '0')}`;

    return membershipId;
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await db.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }
}