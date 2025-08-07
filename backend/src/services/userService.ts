import { query, queryWithMeta } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { UserProfile } from '../types/auth';
import { ProfileUpdate } from '../types/user';
import { validateEmojiAvatar, generateEmojiAvatarUrl } from '../utils/emojiUtils';
import { logger } from '../utils/logger';
import { NotificationService } from './notificationService';
import { formatDateToDDMMYYYY } from '../utils/dateFormatter';

interface CouponData {
  id: string;
  code: string;
  title: string;
  description?: string;
  discountType: string;
  discountValue: number;
  isActive: boolean;
}

interface NewMemberRewardResult {
  success: boolean;
  coupon?: CouponData | null;
  pointsAwarded?: number;
}

interface ProfileUpdateResult {
  profile: UserProfile;
  couponAwarded: boolean;
  coupon?: CouponData | null;
  pointsAwarded?: number;
}

interface NewMemberCouponSettings {
  id: number;
  isEnabled: boolean;
  selectedCouponId: string | null;
  pointsEnabled: boolean;
  pointsAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

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
  private notificationService = new NotificationService();
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
        gender,
        occupation,
        interests,
        profile_completed AS "profileCompleted",
        profile_completed_at AS "profileCompletedAt",
        new_member_coupon_awarded AS "newMemberCouponAwarded",
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

  async getProfileCompletionStatus(userId: string): Promise<{
    isComplete: boolean;
    missingFields: string[];
    newMemberCouponAvailable: boolean;
  }> {
    const profile = await this.getProfile(userId);
    
    const missingFields: string[] = [];

    // Check each required field
    if (!profile.firstName) missingFields.push('firstName');
    if (!profile.dateOfBirth) missingFields.push('date_of_birth');
    if (!profile.gender) missingFields.push('gender');
    if (!profile.occupation) missingFields.push('occupation');
    if (!profile.interests || profile.interests.length === 0) missingFields.push('interests');

    const isComplete = missingFields.length === 0;
    
    // Check if new member rewards are available
    // Available if profile is not complete AND rewards haven't been awarded yet AND admin has enabled rewards
    let newMemberCouponAvailable = false;
    
    if (!isComplete && !profile.newMemberCouponAwarded) {
      // Check if admin has enabled new member rewards (either coupons or points)
      const [rewardSettings] = await query<{
        isEnabled: boolean;
        selectedCouponId: string | null;
        pointsEnabled: boolean;
        pointsAmount: number | null;
      }>(
        `SELECT 
          is_enabled AS "isEnabled",
          selected_coupon_id AS "selectedCouponId",
          points_enabled AS "pointsEnabled",
          points_amount AS "pointsAmount"
        FROM new_member_coupon_settings 
        ORDER BY created_at DESC 
        LIMIT 1`
      );

      if (rewardSettings) {
        // Available if either coupons are enabled with a selected coupon OR points are enabled with an amount
        const couponRewardsEnabled = !!(rewardSettings.isEnabled && rewardSettings.selectedCouponId);
        const pointsRewardsEnabled = !!(rewardSettings.pointsEnabled && rewardSettings.pointsAmount && rewardSettings.pointsAmount > 0);
        
        newMemberCouponAvailable = couponRewardsEnabled || pointsRewardsEnabled;
      }
    }

    return {
      isComplete,
      missingFields,
      newMemberCouponAvailable
    };
  }

  async completeProfile(userId: string, data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: string;
    occupation?: string;
    interests?: string[];
  }): Promise<ProfileUpdateResult> {
    const currentProfile = await this.getProfile(userId);
    
    // Check if profile was already completed
    const wasAlreadyCompleted = currentProfile.profileCompleted;
    
    // Update profile with new data
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
    if (data.gender !== undefined) {
      updateFields.push(`gender = $${paramCount++}`);
      values.push(data.gender);
    }
    if (data.occupation !== undefined) {
      updateFields.push(`occupation = $${paramCount++}`);
      values.push(data.occupation);
    }
    if (data.interests !== undefined) {
      updateFields.push(`interests = $${paramCount++}`);
      values.push(JSON.stringify(data.interests));
    }

    values.push(userId);

    // Get updated profile to check completion status
    const [updatedProfile] = await query<UserProfile>(
      `UPDATE user_profiles 
      SET ${updateFields.join(', ')}, updated_at = NOW()
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
        gender,
        occupation,
        interests,
        profile_completed AS "profileCompleted",
        profile_completed_at AS "profileCompletedAt",
        new_member_coupon_awarded AS "newMemberCouponAwarded",
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      values
    );

    if (!updatedProfile) {
      throw new AppError(404, 'Profile not found');
    }

    // Check if profile is now complete
    const status = await this.getProfileCompletionStatus(userId);
    let rewardsAwarded = false;
    let coupon = null;
    let pointsAwarded = 0;

    if (status.isComplete && !wasAlreadyCompleted && !currentProfile.newMemberCouponAwarded) {
      // Profile is now complete for the first time - award new member rewards
      const rewardResult = await this.awardNewMemberRewards(userId);
      rewardsAwarded = rewardResult.success;
      coupon = rewardResult.coupon;
      pointsAwarded = rewardResult.pointsAwarded ?? 0;

      // Mark profile as completed
      await query(
        'UPDATE user_profiles SET profile_completed = true, profile_completed_at = NOW() WHERE user_id = $1',
        [userId]
      );

      // Get final updated profile
      const finalProfile = await this.getProfile(userId);

      // Create notification for profile completion with rewards
      try {
        // Convert CouponData to Coupon format for notification service
        const couponForNotification = coupon ? {
          id: coupon.id,
          code: coupon.code,
          name: coupon.title,
          description: coupon.description,
          termsAndConditions: undefined,
          type: 'fixed_amount' as const,
          value: coupon.discountValue,
          currency: 'THB',
          minimumSpend: undefined,
          maximumDiscount: undefined,
          validFrom: new Date(),
          validUntil: undefined,
          usageLimit: undefined,
          usageLimitPerUser: 1,
          usedCount: 0,
          tierRestrictions: [],
          customerSegment: {},
          status: 'active' as const,
          createdBy: undefined,
          createdAt: new Date(),
          updatedAt: new Date()
        } : undefined;

        await this.notificationService.createProfileCompletionNotification(
          userId,
          rewardsAwarded && coupon !== null,
          couponForNotification,
          pointsAwarded
        );
      } catch (error) {
        logger.warn('Failed to create profile completion notification', {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return {
        profile: finalProfile,
        couponAwarded: rewardsAwarded && coupon !== null,
        coupon,
        pointsAwarded
      };
    }

    return {
      profile: updatedProfile,
      couponAwarded: false,
      coupon: null as CouponData | null,
      pointsAwarded: 0
    };
  }

  private async awardNewMemberRewards(userId: string): Promise<NewMemberRewardResult> {
    try {
      // Get active new member reward settings
      const [rewardSettings] = await query<{
        id: string;
        isEnabled: boolean;
        selectedCouponId: string | null;
        pointsEnabled: boolean;
        pointsAmount: number | null;
      }>(
        `SELECT 
          id,
          is_enabled AS "isEnabled",
          selected_coupon_id AS "selectedCouponId",
          points_enabled AS "pointsEnabled",
          points_amount AS "pointsAmount"
        FROM new_member_coupon_settings 
        WHERE (is_enabled = true AND selected_coupon_id IS NOT NULL) 
           OR (points_enabled = true AND points_amount IS NOT NULL)
        ORDER BY created_at DESC 
        LIMIT 1`
      );

      if (!rewardSettings || (!rewardSettings.isEnabled && !rewardSettings.pointsEnabled)) {
        logger.warn(`No active new member reward settings found for user ${userId}`);
        return { success: false };
      }

      let coupon: CouponData | null = null;
      let pointsAwarded = 0;

      // Award coupon if configured
      if (rewardSettings.isEnabled && rewardSettings.selectedCouponId) {
        const couponId = rewardSettings.selectedCouponId;

        // Verify the coupon exists, is active, and hasn't expired
        const [couponData] = await query<{
          id: string;
          code: string;
          name: string;
          description: string;
          validUntil: string;
        }>(
          `SELECT 
            id, code, name, description,
            valid_until AS "validUntil"
          FROM coupons 
          WHERE id = $1 AND status = 'active' AND valid_until > NOW()`,
          [couponId]
        );

        if (!couponData) {
          logger.warn(`Selected coupon not found, inactive, or expired for user ${userId}`, {
            selectedCouponId: couponId
          });
        } else {
          // Generate QR code for the user coupon
          const qrCode = `NM${userId.substring(0, 8).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;

          // Award the coupon to the user
          await query(
            `INSERT INTO user_coupons (
              user_id, coupon_id, status, qr_code, assigned_reason, 
              expires_at, assigned_by
            ) VALUES ($1, $2, 'available', $3, 'New member profile completion reward', 
              $4, $1)`,
            [userId, couponId, qrCode, couponData.validUntil]
          );

          coupon = {
            id: couponData.id,
            code: couponData.code,
            title: couponData.name,
            description: couponData.description,
            discountType: 'unknown',
            discountValue: 0,
            isActive: true
          };

          logger.info(`New member coupon awarded to user ${userId}`, {
            couponId: couponData.id,
            couponCode: couponData.code,
            couponName: couponData.name,
            qrCode
          });
        }
      }

      // Award points if configured
      if (rewardSettings.pointsEnabled && rewardSettings.pointsAmount && rewardSettings.pointsAmount > 0) {
        // Add points to user's loyalty account
        await query(
          `INSERT INTO points_transactions (
            user_id, points, type, description, reference_id
          ) VALUES ($1, $2, 'earned_bonus', $3, $4)`,
          [
            userId, 
            rewardSettings.pointsAmount, 
            `New member profile completion bonus: ${rewardSettings.pointsAmount} points`,
            rewardSettings.id
          ]
        );

        pointsAwarded = rewardSettings.pointsAmount;

        logger.info(`New member points awarded to user ${userId}`, {
          pointsAwarded: rewardSettings.pointsAmount
        });
      }

      // Mark the new member rewards as awarded (if any rewards were given)
      if (coupon !== null || pointsAwarded > 0) {
        await query(
          'UPDATE user_profiles SET new_member_coupon_awarded = true, new_member_coupon_awarded_at = NOW() WHERE user_id = $1',
          [userId]
        );
      }

      return {
        success: coupon !== null || pointsAwarded > 0,
        coupon: coupon,
        pointsAwarded: pointsAwarded > 0 ? pointsAwarded : undefined
      };
    } catch (error) {
      logger.error(`Failed to award new member rewards to user ${userId}`, error);
      return { success: false };
    }
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

  async getNewMemberCouponSettings(): Promise<NewMemberCouponSettings> {
    const [settings] = await query<NewMemberCouponSettings>(
      `SELECT 
        id,
        is_enabled AS "isEnabled",
        selected_coupon_id AS "selectedCouponId",
        points_enabled AS "pointsEnabled",
        points_amount AS "pointsAmount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM new_member_coupon_settings 
      ORDER BY created_at DESC 
      LIMIT 1`
    );

    // If no settings exist, create default ones
    if (!settings) {
      const [defaultSettings] = await query<NewMemberCouponSettings>(
        `INSERT INTO new_member_coupon_settings (is_enabled, selected_coupon_id, points_enabled, points_amount)
        VALUES ($1, $2, $3, $4)
        RETURNING 
          id,
          is_enabled AS "isEnabled",
          selected_coupon_id AS "selectedCouponId",
          points_enabled AS "pointsEnabled",
          points_amount AS "pointsAmount",
          created_at AS "createdAt",
          updated_at AS "updatedAt"`,
        [false, null, false, null]
      );
      return defaultSettings;
    }

    return settings;
  }

  async updateNewMemberCouponSettings(data: {
    isEnabled: boolean;
    selectedCouponId: string | null;
    pointsEnabled: boolean;
    pointsAmount: number | null;
  }): Promise<NewMemberCouponSettings> {
    // Get current settings or create if none exist
    const currentSettings = await this.getNewMemberCouponSettings();
    
    // Validate selected coupon if provided and enabled
    if (data.isEnabled && data.selectedCouponId) {
      const [coupon] = await query<{
        id: string;
        code: string;
        name: string;
        status: string;
        validUntil: string | null;
      }>(
        `SELECT 
          id, code, name, status,
          valid_until AS "validUntil"
        FROM coupons 
        WHERE id = $1`,
        [data.selectedCouponId]
      );

      if (!coupon) {
        throw new AppError(400, 'Selected coupon not found');
      }

      if (coupon.status !== 'active') {
        throw new AppError(400, `Selected coupon is ${coupon.status}. Only active coupons can be used for new member rewards.`);
      }

      if (coupon.validUntil && new Date(coupon.validUntil) <= new Date()) {
        throw new AppError(400, `Selected coupon "${coupon.name}" has expired on ${formatDateToDDMMYYYY(coupon.validUntil)}. Please select a valid coupon.`);
      }

      // Warn if coupon expires within 7 days
      if (coupon.validUntil && new Date(coupon.validUntil) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) {
        logger.warn('New member coupon expires within 7 days', {
          couponId: coupon.id,
          couponName: coupon.name,
          expiresAt: coupon.validUntil
        });
      }
    }

    // Validate points settings
    if (data.pointsEnabled) {
      if (!data.pointsAmount || data.pointsAmount <= 0) {
        throw new AppError(400, 'Points amount must be a positive number when points are enabled');
      }
      if (data.pointsAmount > 10000) {
        throw new AppError(400, 'Points amount cannot exceed 10,000 points');
      }
    }
    
    const [updatedSettings] = await query<NewMemberCouponSettings>(
      `UPDATE new_member_coupon_settings 
      SET 
        is_enabled = $1,
        selected_coupon_id = $2,
        points_enabled = $3,
        points_amount = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING 
        id,
        is_enabled AS "isEnabled",
        selected_coupon_id AS "selectedCouponId",
        points_enabled AS "pointsEnabled",
        points_amount AS "pointsAmount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        data.isEnabled,
        data.selectedCouponId,
        data.pointsEnabled,
        data.pointsAmount,
        currentSettings.id
      ]
    );

    if (!updatedSettings) {
      throw new AppError(404, 'Failed to update new member coupon settings');
    }

    logger.info('New member rewards settings updated', {
      settingsId: updatedSettings.id,
      isEnabled: data.isEnabled,
      selectedCouponId: data.selectedCouponId,
      pointsEnabled: data.pointsEnabled,
      pointsAmount: data.pointsAmount
    });

    return updatedSettings;
  }

  async getCouponStatusForAdmin(couponId: string): Promise<{
    id: string;
    code: string;
    name: string;
    status: string;
    validFrom: string | null;
    validUntil: string | null;
    isExpired: boolean;
    daysUntilExpiry: number | null;
    warningLevel: 'none' | 'warning' | 'danger';
  }> {
    const [coupon] = await query<{
      id: string;
      code: string;
      name: string;
      status: string;
      validFrom: string | null;
      validUntil: string | null;
    }>(
      `SELECT 
        id, code, name, status,
        valid_from AS "validFrom",
        valid_until AS "validUntil"
      FROM coupons 
      WHERE id = $1`,
      [couponId]
    );

    if (!coupon) {
      throw new AppError(404, 'Coupon not found');
    }

    const now = new Date();
    const isExpired = coupon.validUntil ? new Date(coupon.validUntil) <= now : false;
    const daysUntilExpiry = coupon.validUntil 
      ? Math.ceil((new Date(coupon.validUntil).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) 
      : null;

    let warningLevel: 'none' | 'warning' | 'danger' = 'none';
    if (isExpired) {
      warningLevel = 'danger';
    } else if (daysUntilExpiry !== null && daysUntilExpiry <= 7) {
      warningLevel = 'warning';
    }

    return {
      id: coupon.id,
      code: coupon.code,
      name: coupon.name,
      status: coupon.status,
      validFrom: coupon.validFrom,
      validUntil: coupon.validUntil,
      isExpired,
      daysUntilExpiry,
      warningLevel
    };
  }
}