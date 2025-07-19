import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { UserProfile } from '../types/auth';
import { ProfileUpdate } from '../types/user';

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
    const values: any[] = [];
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
    await query(
      'UPDATE user_profiles SET avatar_url = $1 WHERE user_id = $2',
      [avatarUrl, userId]
    );
  }

  async deleteAvatar(userId: string): Promise<void> {
    await query(
      'UPDATE user_profiles SET avatar_url = NULL WHERE user_id = $1',
      [userId]
    );
  }
}