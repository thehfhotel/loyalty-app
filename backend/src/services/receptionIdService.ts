import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export class ReceptionIdService {
  /**
   * Generates a unique 8-digit numeric reception ID starting with 269
   * Uses sequential block system: Users 1-100 get random from 26900001-26900100, 
   * Users 101-200 get random from 26900101-26900200, etc.
   * @returns Promise<string> - 8-digit numeric string in format 269XXXXX
   */
  async generateUniqueReceptionId(): Promise<string> {
    try {
      // Use the database function which handles the sequential block logic atomically
      const [result] = await query<{ generate_reception_id_sequential: string }>(
        'SELECT generate_reception_id_sequential() as generate_reception_id_sequential'
      );
      
      const receptionId = result.generate_reception_id_sequential;
      
      // Get current user count for logging
      const [countResult] = await query<{ current_user_count: number }>(
        'SELECT current_user_count FROM reception_id_sequence LIMIT 1'
      );
      
      const userCount = countResult.current_user_count;
      const blockNumber = Math.floor((userCount - 1) / 100);
      const blockStart = blockNumber * 100 + 1;
      const blockEnd = (blockNumber + 1) * 100;
      
      logger.info(`Generated reception ID: ${receptionId} for user #${userCount} (Block ${blockNumber}: ${blockStart}-${blockEnd})`);
      
      return receptionId;
    } catch (error: any) {
      logger.error('Error generating reception ID:', error);
      
      if (error.message && error.message.includes('Block may be full')) {
        throw new AppError(500, 'Current block is full. This indicates high registration volume in this block.');
      }
      
      throw new AppError(500, 'Failed to generate reception ID');
    }
  }

  /**
   * Validates a reception ID format
   * @param receptionId - The reception ID to validate
   * @returns boolean - true if valid, false otherwise
   */
  validateReceptionIdFormat(receptionId: string): boolean {
    // Must be exactly 8 digits starting with 269
    const pattern = /^269\d{5}$/;
    return pattern.test(receptionId);
  }

  /**
   * Gets user information by reception ID
   * @param receptionId - 8-digit reception ID in format 269XXXXX
   * @returns Promise<UserInfo> - User information for reception
   */
  async getUserByReceptionId(receptionId: string): Promise<{
    userId: string;
    receptionId: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    isActive: boolean;
  }> {
    if (!this.validateReceptionIdFormat(receptionId)) {
      throw new AppError(400, 'Invalid reception ID format. Must be 8 digits starting with 269.');
    }

    const [user] = await query<{
      userId: string;
      receptionId: string;
      firstName?: string;
      lastName?: string;
      email: string;
      phone?: string;
      isActive: boolean;
    }>(
      `SELECT 
        u.id AS "userId",
        up.reception_id AS "receptionId",
        up.first_name AS "firstName",
        up.last_name AS "lastName",
        u.email,
        up.phone,
        u.is_active AS "isActive"
      FROM users u
      JOIN user_profiles up ON u.id = up.user_id
      WHERE up.reception_id = $1`,
      [receptionId]
    );

    if (!user) {
      throw new AppError(404, 'User not found with this reception ID');
    }

    if (!user.isActive) {
      throw new AppError(403, 'User account is disabled');
    }

    return user;
  }

  /**
   * Gets reception ID for a user
   * @param userId - User UUID
   * @returns Promise<string> - Reception ID
   */
  async getReceptionIdByUserId(userId: string): Promise<string> {
    const [result] = await query<{ receptionId: string }>(
      'SELECT reception_id AS "receptionId" FROM user_profiles WHERE user_id = $1',
      [userId]
    );

    if (!result) {
      throw new AppError(404, 'User profile not found');
    }

    return result.receptionId;
  }

  /**
   * Regenerates reception ID for a user (admin function)
   * @param userId - User UUID
   * @returns Promise<string> - New reception ID
   */
  async regenerateReceptionId(userId: string): Promise<string> {
    const newReceptionId = await this.generateUniqueReceptionId();

    const result = await query(
      'UPDATE user_profiles SET reception_id = $1, updated_at = NOW() WHERE user_id = $2',
      [newReceptionId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(404, 'User profile not found');
    }

    logger.info(`Reception ID regenerated for user ${userId}: ${newReceptionId}`);
    return newReceptionId;
  }

  /**
   * Gets statistics about reception IDs including block information
   * @returns Promise<ReceptionIdStats>
   */
  async getReceptionIdStats(): Promise<{
    totalUsers: number;
    usersWithReceptionId: number;
    usersWithoutReceptionId: number;
    currentUserCount: number;
    currentBlock: number;
    currentBlockRange: string;
    blocksInUse: number;
  }> {
    const [stats] = await query<{
      totalUsers: string;
      usersWithReceptionId: string;
      usersWithoutReceptionId: string;
    }>(
      `SELECT 
        COUNT(*) as "totalUsers",
        COUNT(up.reception_id) as "usersWithReceptionId",
        COUNT(*) - COUNT(up.reception_id) as "usersWithoutReceptionId"
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id`
    );

    // Get sequential counter information
    const [sequenceInfo] = await query<{ current_user_count: number }>(
      'SELECT current_user_count FROM reception_id_sequence LIMIT 1'
    );

    const currentUserCount = sequenceInfo?.current_user_count || 0;
    const currentBlock = Math.floor((currentUserCount - 1) / 100);
    const blockStart = currentBlock * 100 + 1;
    const blockEnd = (currentBlock + 1) * 100;
    const blocksInUse = Math.floor((currentUserCount - 1) / 100) + 1;

    return {
      totalUsers: parseInt(stats.totalUsers),
      usersWithReceptionId: parseInt(stats.usersWithReceptionId),
      usersWithoutReceptionId: parseInt(stats.usersWithoutReceptionId),
      currentUserCount,
      currentBlock,
      currentBlockRange: `${blockStart}-${blockEnd}`,
      blocksInUse: Math.max(blocksInUse, 0)
    };
  }
}

export const receptionIdService = new ReceptionIdService();