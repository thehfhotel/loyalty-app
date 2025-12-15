import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { sanitizeLogValue, sanitizeUserId } from '../utils/logSanitizer';

export class MembershipIdService {
  private readonly MAX_ATTEMPTS = 100;
  private readonly BLOCK_SIZE = 100;
  private readonly ID_PREFIX = '269';
  private readonly MAX_FALLBACK_BLOCKS = 10; // Maximum blocks to search when auto-advancing

  /**
   * Generates a unique 8-digit numeric membership ID starting with 269
   * Uses sequential block system: Users 1-100 get random from 26900001-26900100, 
   * Users 101-200 get random from 26900101-26900200, etc.
   * Features auto-advance to next available blocks when current block is exhausted.
   * Now implemented entirely in TypeScript for better deployment consistency.
   * @returns Promise<string> - 8-digit numeric string in format 269XXXXX
   */
  async generateUniqueMembershipId(): Promise<string> {
    try {
      // Get and increment the current user count atomically
      const userCount = await this.incrementUserCountAtomically();
      
      // Calculate which block this user belongs to
      const blockNumber = Math.floor((userCount - 1) / this.BLOCK_SIZE);
      
      // Generate random ID within the block with auto-advance fallback
      const membershipId = await this.generateIdWithFallback(blockNumber, userCount);
      
      return membershipId;
    } catch (error: unknown) {
      logger.error('Error generating membership ID:', error);
      
      if (error instanceof Error && error.message?.includes('All available blocks exhausted')) {
        throw new AppError(500, 'Membership ID system approaching capacity. All nearby blocks are full. Please contact system administrator.');
      }
      
      if (error instanceof Error && error.message?.includes('Block may be full')) {
        throw new AppError(500, 'Current block is full. This indicates high registration volume in this block.');
      }
      
      throw new AppError(500, 'Failed to generate membership ID');
    }
  }

  /**
   * Atomically increments the user count and returns the new count
   * @returns Promise<number> - New user count
   * @private
   */
  private async incrementUserCountAtomically(): Promise<number> {
    const [result] = await query<{ current_user_count: number }>(
      `UPDATE membership_id_sequence 
       SET current_user_count = current_user_count + 1,
           updated_at = NOW()
       RETURNING current_user_count`,
      []
    );
    
    if (!result) {
      throw new Error('Failed to increment user count');
    }
    
    return result.current_user_count;
  }

  /**
   * Generates a membership ID with automatic fallback to next available blocks
   * @param primaryBlockNumber - Primary block number based on user count
   * @param userCount - Current user count for logging
   * @returns Promise<string> - Generated membership ID
   * @private
   */
  private async generateIdWithFallback(primaryBlockNumber: number, userCount: number): Promise<string> {
    // Try primary block first
    try {
      const membershipId = await this.generateIdInBlock(primaryBlockNumber);
      const blockStart = primaryBlockNumber * this.BLOCK_SIZE + 1;
      const blockEnd = (primaryBlockNumber + 1) * this.BLOCK_SIZE;

      logger.info(`Generated membership ID: ${sanitizeLogValue(membershipId)} for user #${userCount} (Primary Block ${primaryBlockNumber}: ${blockStart}-${blockEnd})`);
      return membershipId;
    } catch {
      logger.warn(`Primary block ${primaryBlockNumber} exhausted for user #${userCount}, searching for available blocks`);
    }
    
    // Search for available blocks in ascending order (future blocks first for better distribution)
    for (let blockOffset = 1; blockOffset <= this.MAX_FALLBACK_BLOCKS; blockOffset++) {
      const fallbackBlock = primaryBlockNumber + blockOffset;
      const maxBlock = Math.floor(99999 / this.BLOCK_SIZE); // Maximum possible block (26999999)
      
      if (fallbackBlock > maxBlock) {
        break; // Reached maximum possible block
      }
      
      try {
        const membershipId = await this.generateIdInBlock(fallbackBlock);
        const blockStart = fallbackBlock * this.BLOCK_SIZE + 1;
        const blockEnd = (fallbackBlock + 1) * this.BLOCK_SIZE;

        logger.info(`Generated membership ID: ${sanitizeLogValue(membershipId)} for user #${userCount} (Fallback Block ${fallbackBlock}: ${blockStart}-${blockEnd}) - Advanced ${blockOffset} blocks due to exhaustion`);
        return membershipId;
      } catch {
        logger.debug(`Fallback block ${fallbackBlock} also exhausted, trying next block`);
        continue;
      }
    }
    
    // If all fallback blocks are exhausted, search backwards from primary block
    logger.warn(`Forward blocks exhausted, searching backwards from block ${primaryBlockNumber}`);
    
    for (let blockOffset = 1; blockOffset <= this.MAX_FALLBACK_BLOCKS; blockOffset++) {
      const fallbackBlock = primaryBlockNumber - blockOffset;
      
      if (fallbackBlock < 0) {
        break; // Reached minimum block
      }
      
      try {
        const membershipId = await this.generateIdInBlock(fallbackBlock);
        const blockStart = fallbackBlock * this.BLOCK_SIZE + 1;
        const blockEnd = (fallbackBlock + 1) * this.BLOCK_SIZE;

        logger.info(`Generated membership ID: ${sanitizeLogValue(membershipId)} for user #${userCount} (Backward Fallback Block ${fallbackBlock}: ${blockStart}-${blockEnd}) - Retreated ${blockOffset} blocks due to exhaustion`);
        return membershipId;
      } catch {
        logger.debug(`Backward fallback block ${fallbackBlock} also exhausted, trying previous block`);
        continue;
      }
    }
    
    // All blocks exhausted - this should be extremely rare
    throw new Error(`All available blocks exhausted after searching ${this.MAX_FALLBACK_BLOCKS} blocks forward and backward from block ${primaryBlockNumber}. System may be approaching capacity.`);
  }

  /**
   * Generates a membership ID within a specific block with collision detection
   * @param blockNumber - Block number (0, 1, 2, etc.)
   * @returns Promise<string> - Generated membership ID
   * @private
   */
  private async generateIdInBlock(blockNumber: number): Promise<string> {
    let attempts = 0;
    const blockStart = blockNumber * this.BLOCK_SIZE + 1;
    
    while (attempts < this.MAX_ATTEMPTS) {
      // Generate random number within the block range
      const randomWithinBlock = blockStart + Math.floor(Math.random() * this.BLOCK_SIZE);
      
      // Format as 8-digit ID: 269 + 5-digit padded number
      const candidateId = this.ID_PREFIX + randomWithinBlock.toString().padStart(5, '0');
      
      // Check if this ID already exists
      const exists = await this.checkIdExists(candidateId);
      
      if (!exists) {
        return candidateId;
      }
      
      attempts++;
    }
    
    throw new Error(`Unable to generate unique membership ID in block ${blockNumber} after ${this.MAX_ATTEMPTS} attempts. Block may be full.`);
  }

  /**
   * Checks if a membership ID already exists in the database
   * @param membershipId - Membership ID to check
   * @returns Promise<boolean> - True if exists, false otherwise
   * @private
   */
  private async checkIdExists(membershipId: string): Promise<boolean> {
    const [result] = await query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM user_profiles WHERE membership_id = $1) as exists',
      [membershipId]
    );
    
    return result?.exists ?? false;
  }

  /**
   * Validates a membership ID format
   * @param membershipId - The membership ID to validate
   * @returns boolean - true if valid, false otherwise
   */
  validateMembershipIdFormat(membershipId: string): boolean {
    // Must be exactly 8 digits starting with 269
    const pattern = /^269\d{5}$/;
    return pattern.test(membershipId);
  }

  /**
   * Gets user information by membership ID
   * @param membershipId - 8-digit membership ID in format 269XXXXX
   * @returns Promise<UserInfo> - User information for membership
   */
  async getUserByMembershipId(membershipId: string): Promise<{
    userId: string;
    membershipId: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    isActive: boolean;
  }> {
    if (!this.validateMembershipIdFormat(membershipId)) {
      throw new AppError(400, 'Invalid membership ID format. Must be 8 digits starting with 269.');
    }

    const [user] = await query<{
      userId: string;
      membershipId: string;
      firstName?: string;
      lastName?: string;
      email: string;
      phone?: string;
      isActive: boolean;
    }>(
      `SELECT 
        u.id AS "userId",
        up.membership_id AS "membershipId",
        up.first_name AS "firstName",
        up.last_name AS "lastName",
        u.email,
        up.phone,
        u.is_active AS "isActive"
      FROM users u
      JOIN user_profiles up ON u.id = up.user_id
      WHERE up.membership_id = $1`,
      [membershipId]
    );

    if (!user) {
      throw new AppError(404, 'User not found with this membership ID');
    }

    if (!user.isActive) {
      throw new AppError(403, 'User account is disabled');
    }

    return user;
  }

  /**
   * Gets membership ID for a user
   * @param userId - User UUID
   * @returns Promise<string> - Membership ID
   */
  async getMembershipIdByUserId(userId: string): Promise<string> {
    const [result] = await query<{ membershipId: string }>(
      'SELECT membership_id AS "membershipId" FROM user_profiles WHERE user_id = $1',
      [userId]
    );

    if (!result) {
      throw new AppError(404, 'User profile not found');
    }

    return result.membershipId;
  }

  /**
   * Regenerates membership ID for a user (admin function)
   * @param userId - User UUID
   * @returns Promise<string> - New membership ID
   */
  async regenerateMembershipId(userId: string): Promise<string> {
    const newMembershipId = await this.generateUniqueMembershipId();

    const result = await query(
      'UPDATE user_profiles SET membership_id = $1, updated_at = NOW() WHERE user_id = $2',
      [newMembershipId, userId]
    );

    if (!result || result.length === 0) {
      throw new AppError(404, 'User profile not found');
    }

    // codeql[js/log-injection] - Values sanitized via sanitizeUserId/sanitizeLogValue (removes newlines/control chars)
    logger.info(`Membership ID regenerated for user ${sanitizeUserId(userId)}: ${sanitizeLogValue(newMembershipId)}`);
    return newMembershipId;
  }

  /**
   * Gets statistics about membership IDs including block information
   * @returns Promise<MembershipIdStats>
   */
  async getMembershipIdStats(): Promise<{
    totalUsers: number;
    usersWithMembershipId: number;
    usersWithoutMembershipId: number;
    currentUserCount: number;
    currentBlock: number;
    currentBlockRange: string;
    blocksInUse: number;
  }> {
    const [stats] = await query<{
      totalUsers: string;
      usersWithMembershipId: string;
      usersWithoutMembershipId: string;
    }>(
      `SELECT 
        COUNT(*) as "totalUsers",
        COUNT(up.membership_id) as "usersWithMembershipId",
        COUNT(*) - COUNT(up.membership_id) as "usersWithoutMembershipId"
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id`
    );

    // Get sequential counter information
    const [sequenceInfo] = await query<{ current_user_count: number }>(
      'SELECT current_user_count FROM membership_id_sequence LIMIT 1'
    );

    const currentUserCount = sequenceInfo?.current_user_count ?? 0;
    const currentBlock = Math.floor((currentUserCount - 1) / 100);
    const blockStart = currentBlock * 100 + 1;
    const blockEnd = (currentBlock + 1) * 100;
    const blocksInUse = Math.floor((currentUserCount - 1) / 100) + 1;

    // Provide default values if stats is undefined
    const totalUsers = stats?.totalUsers ? parseInt(stats.totalUsers) : 0;
    const usersWithMembershipId = stats?.usersWithMembershipId ? parseInt(stats.usersWithMembershipId) : 0;
    const usersWithoutMembershipId = stats?.usersWithoutMembershipId ? parseInt(stats.usersWithoutMembershipId) : 0;

    return {
      totalUsers,
      usersWithMembershipId,
      usersWithoutMembershipId,
      currentUserCount,
      currentBlock,
      currentBlockRange: `${blockStart}-${blockEnd}`,
      blocksInUse: Math.max(blocksInUse, 0)
    };
  }
}

export const membershipIdService = new MembershipIdService();