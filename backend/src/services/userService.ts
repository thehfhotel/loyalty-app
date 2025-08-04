import { query, queryWithMeta } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { UserProfile } from '../types/auth';
import { ProfileUpdate } from '../types/user';
import { validateEmojiAvatar, generateEmojiAvatarUrl } from '../utils/emojiUtils';
import { logger } from '../utils/logger';

interface UserWithProfile {
  userId: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  phone?: string;
  membershipId?: string;
  createdAt: string;
  lastLogin?: string;
}

export class UserService {
  async getProfile(userId: string): Promise<UserProfile> {
    const [profile] = await query<UserProfile>(
      `SELECT 
        user_id AS "userId",
        first_name AS "firstName",
        last_name AS "lastName",
        phone,
        date_of_birth AS "dateOfBirth",
        preferences,
        avatar_url AS "avatarUrl",
        membership_id AS "membershipId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM user_profiles
      WHERE user_id = $1`,
      [userId]
    );

    if (!profile) {
      throw new AppError(404, 'Profile not found');
    }

    return profile;
  }

  async updateProfile(
    userId: string,
    data: ProfileUpdate
  ): Promise<UserProfile> {
    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.firstName !== undefined) {
      updateFields.push(`first_name = $${paramCount++}`);
      values.push(data.firstName);
    }
    if (data.lastName !== undefined) {
      updateFields.push(`last_name = $${paramCount++}`);
      values.push(data.lastName);
    }
    if (data.phone !== undefined) {
      updateFields.push(`phone = $${paramCount++}`);
      values.push(data.phone);
    }
    if (data.dateOfBirth !== undefined) {
      updateFields.push(`date_of_birth = $${paramCount++}`);
      values.push(data.dateOfBirth);
    }
    if (data.preferences !== undefined) {
      updateFields.push(`preferences = $${paramCount++}`);
      values.push(data.preferences);
    }

    if (updateFields.length === 0) {
      return this.getProfile(userId);
    }

    values.push(userId);

    const [updatedProfile] = await query<UserProfile>(
      `UPDATE user_profiles 
      SET ${updateFields.join(', ')}
      WHERE user_id = $${paramCount}
      RETURNING 
        user_id AS "userId",
        first_name AS "firstName",
        last_name AS "lastName",
        phone,
        date_of_birth AS "dateOfBirth",
        preferences,
        avatar_url AS "avatarUrl",
        membership_id AS "membershipId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      values
    );

    if (!updatedProfile) {
      throw new AppError(404, 'Profile not found');
    }

    return updatedProfile;
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<void> {
    const result = await queryWithMeta(
      'UPDATE user_profiles SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2',
      [avatarUrl, userId]
    );
    
    if (result.rowCount === 0) {
      throw new AppError(404, 'User profile not found - cannot update avatar');
    }
    
    // Log successful avatar update
    logger.info(`Avatar updated for user ${userId}`, { avatarUrl, rowsAffected: result.rowCount });
  }

  async updateEmojiAvatar(userId: string, emoji: string): Promise<UserProfile> {
    // Validate emoji
    const validation = validateEmojiAvatar(emoji);
    if (!validation.isValid) {
      throw new AppError(400, validation.error ?? 'Invalid emoji');
    }

    // Generate emoji avatar URL
    const emojiAvatarUrl = generateEmojiAvatarUrl(emoji);
    
    // Update avatar
    await this.updateAvatar(userId, emojiAvatarUrl);
    
    // Return updated profile
    return this.getProfile(userId);
  }

  async deleteAvatar(userId: string): Promise<void> {
    await query(
      'UPDATE user_profiles SET avatar_url = NULL WHERE user_id = $1',
      [userId]
    );
  }

  async updateUserEmail(userId: string, email: string): Promise<void> {
    // Check if email is already in use by another user
    const [existingUser] = await query<{id: string}>(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );

    if (existingUser) {
      throw new AppError(409, 'Email is already in use by another account');
    }

    // Update user email
    const result = await queryWithMeta(
      'UPDATE users SET email = $1, email_verified = false, updated_at = NOW() WHERE id = $2',
      [email, userId]
    );
    
    if (result.rowCount === 0) {
      throw new AppError(404, 'User not found');
    }
    
    logger.info(`Email updated for user ${userId}`, { email, rowsAffected: result.rowCount });
  }

  // Admin-only methods
  async getAllUsers(page = 1, limit = 10, search = ''): Promise<{ users: UserWithProfile[], total: number }> {
    const offset = (page - 1) * limit;
    const searchCondition = search ? `WHERE u.email ILIKE $3 OR up.first_name ILIKE $3 OR up.last_name ILIKE $3 OR up.membership_id ILIKE $3` : '';
    const searchParam = search ? [`%${search}%`] : [];

    const [totalResult] = await query<{ count: string }>(
      `SELECT COUNT(*) FROM users u 
       LEFT JOIN user_profiles up ON u.id = up.user_id 
       ${searchCondition}`,
      searchParam
    );

    const users = await query<UserWithProfile>(
      `SELECT 
        u.id AS "userId",
        u.email,
        u.role,
        u.is_active AS "isActive",
        u.email_verified AS "emailVerified",
        u.created_at AS "createdAt",
        up.first_name AS "firstName",
        up.last_name AS "lastName",
        up.phone,
        up.membership_id AS "membershipId"
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      ${searchCondition}
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset, ...searchParam]
    );

    return {
      users,
      total: parseInt(totalResult.count)
    };
  }

  async getUserById(userId: string): Promise<UserWithProfile> {
    const [user] = await query<UserWithProfile>(
      `SELECT 
        u.id AS "userId",
        u.email,
        u.role,
        u.is_active AS "isActive",
        u.email_verified AS "emailVerified",
        u.created_at AS "createdAt",
        up.first_name AS "firstName",
        up.last_name AS "lastName",
        up.phone,
        up.avatar_url AS "avatarUrl",
        up.membership_id AS "membershipId"
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id = $1`,
      [userId]
    );

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    return user;
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<void> {
    await query(
      'UPDATE users SET is_active = $1 WHERE id = $2',
      [isActive, userId]
    );
  }

  async updateUserRole(userId: string, role: string): Promise<void> {
    const validRoles = ['customer', 'admin', 'super_admin'];
    if (!validRoles.includes(role)) {
      throw new AppError(400, 'Invalid role specified');
    }

    await query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, userId]
    );
  }

  async deleteUser(userId: string): Promise<void> {
    // Note: This will cascade delete user_profiles and other related data
    await query('DELETE FROM users WHERE id = $1', [userId]);
  }

  async getUserStats(): Promise<{ total: number, active: number, admins: number, recentlyJoined: number }> {
    const [stats] = await query<{
      total: string,
      active: string,
      admins: string,
      recentlyJoined: string
    }>(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active,
        COUNT(CASE WHEN role IN ('admin', 'super_admin') THEN 1 END) as admins,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as recently_joined
      FROM users`
    );

    return {
      total: parseInt(stats.total),
      active: parseInt(stats.active),
      admins: parseInt(stats.admins),
      recentlyJoined: parseInt(stats.recentlyJoined)
    };
  }
}