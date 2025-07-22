import { query, getClient } from '../config/database';
// import { v4 as uuidv4 } from 'uuid'; // Unused
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

export interface AccountLinkRequest {
  id: string;
  requesterUserId: string;
  targetEmail: string;
  targetUserId?: string;
  requestType: 'link_to_email' | 'link_to_existing';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  message?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface LinkedAccount {
  id: string;
  primaryUserId: string;
  linkedUserId: string;
  linkedAt: Date;
  linkedBy: string;
}

export interface LinkedUserInfo {
  linkedUserId: string;
  email: string;
  oauthProvider?: string;
  firstName?: string;
  lastName?: string;
}

export interface LinkRequestsResponse {
  sent: AccountLinkRequest[];
  received: AccountLinkRequest[];
}

export class AccountLinkingService {
  
  /**
   * Create a request to link accounts
   */
  async createLinkRequest(
    requesterUserId: string,
    targetEmail: string,
    message?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AccountLinkRequest> {
    const normalizedEmail = targetEmail.toLowerCase().trim();
    
    if (!this.isValidEmail(normalizedEmail)) {
      throw new AppError(400, 'Invalid email address');
    }

    // Check if user is trying to link to their own email
    const requesterUsers = await query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [requesterUserId]
    );
    
    if (!requesterUsers.length) {
      throw new AppError(404, 'User not found');
    }
    
    if (requesterUsers[0].email.toLowerCase() === normalizedEmail) {
      throw new AppError(400, 'Cannot link to your own email address');
    }

    // Check if target user exists
    const targetUsers = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    const targetUser = targetUsers[0];

    if (targetUser) {
      // Check if users are already linked
      const isLinked = await this.areUsersLinked(requesterUserId, targetUser.id);
      if (isLinked) {
        throw new AppError(400, 'Accounts are already linked');
      }
    }

    // Check for existing pending requests
    const existingRequests = await query<{ id: string }>(
      `SELECT id FROM account_link_requests 
       WHERE requester_user_id = $1 AND target_email = $2 AND status = 'pending'`,
      [requesterUserId, normalizedEmail]
    );

    if (existingRequests.length > 0) {
      throw new AppError(400, 'A pending link request already exists for this email');
    }

    // Determine request type
    const requestType = targetUser ? 'link_to_existing' : 'link_to_email';
    
    // Create link request
    const linkRequestResults = await query<AccountLinkRequest>(
      `INSERT INTO account_link_requests 
       (requester_user_id, target_email, target_user_id, request_type, message) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
                 target_user_id AS "targetUserId", request_type AS "requestType", 
                 status, message, created_at AS "createdAt", updated_at AS "updatedAt", 
                 expires_at AS "expiresAt"`,
      [requesterUserId, normalizedEmail, targetUser?.id || null, requestType, message || null]
    );
    
    const linkRequest = linkRequestResults[0];

    // Log the action
    await this.logLinkingAction(
      requesterUserId,
      'link_request_created',
      normalizedEmail,
      ipAddress,
      userAgent,
      { requestId: linkRequest.id, requestType }
    );

    logger.info(`Link request created: ${linkRequest.id} from ${requesterUserId} to ${normalizedEmail}`);
    
    return linkRequest;
  }

  /**
   * Get link requests for a user (both sent and received)
   */
  async getUserLinkRequests(userId: string): Promise<LinkRequestsResponse> {
    // Get user's email to find received requests
    const userResults = await query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userResults.length) {
      throw new AppError(404, 'User not found');
    }
    
    const userEmail = userResults[0].email;

    // Get sent requests
    const sentRequests = await query<AccountLinkRequest>(
      `SELECT id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
              target_user_id AS "targetUserId", request_type AS "requestType", 
              status, message, created_at AS "createdAt", updated_at AS "updatedAt", 
              expires_at AS "expiresAt"
       FROM account_link_requests 
       WHERE requester_user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [userId]
    );

    // Get received requests (where user is the target)
    const receivedRequests = await query<AccountLinkRequest>(
      `SELECT id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
              target_user_id AS "targetUserId", request_type AS "requestType", 
              status, message, created_at AS "createdAt", updated_at AS "updatedAt", 
              expires_at AS "expiresAt"
       FROM account_link_requests 
       WHERE target_email = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [userEmail]
    );

    return {
      sent: sentRequests,
      received: receivedRequests
    };
  }

  /**
   * Approve a link request
   */
  async approveLinkRequest(
    requestId: string,
    approvingUserId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Get the link request
      const linkRequestResults = await client.query(
        `SELECT id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
                target_user_id AS "targetUserId", request_type AS "requestType", 
                status, expires_at AS "expiresAt"
         FROM account_link_requests 
         WHERE id = $1`,
        [requestId]
      );
      
      if (linkRequestResults.rows.length === 0) {
        throw new AppError(404, 'Link request not found');
      }
      
      const linkRequest = linkRequestResults.rows[0] as any;

      if (linkRequest.status !== 'pending') {
        throw new AppError(400, 'Link request is not pending');
      }

      if (new Date(linkRequest.expiresAt) < new Date()) {
        throw new AppError(400, 'Link request has expired');
      }

      // Verify approving user is the target
      const userResults = await client.query('SELECT email FROM users WHERE id = $1', [approvingUserId]);
      const user = userResults.rows[0] as any;
      
      if (!user || user.email.toLowerCase() !== linkRequest.targetEmail.toLowerCase()) {
        throw new AppError(403, 'You can only approve requests sent to your email address');
      }

      let targetUserId = linkRequest.targetUserId;

      // If no target user exists, create one
      if (!targetUserId) {
        const newUserResults = await client.query(
          `INSERT INTO users (email, password_hash, email_verified) 
           VALUES ($1, '', false) 
           RETURNING id`,
          [linkRequest.targetEmail]
        );
        targetUserId = newUserResults.rows[0].id;
        
        // Create empty profile for new user
        await client.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name) 
           VALUES ($1, '', '')`,
          [targetUserId]
        );
      }

      // Create the link between accounts (bidirectional)
      await client.query(
        `INSERT INTO linked_accounts (primary_user_id, linked_user_id, linked_by)
         VALUES ($1, $2, $3), ($2, $1, $3)`,
        [linkRequest.requesterUserId, targetUserId, approvingUserId]
      );

      // Update request status
      await client.query(
        `UPDATE account_link_requests 
         SET status = 'approved', updated_at = NOW()
         WHERE id = $1`,
        [requestId]
      );

      // Log the action
      await this.logLinkingAction(
        linkRequest.requesterUserId,
        'link_request_approved',
        linkRequest.targetEmail,
        ipAddress,
        userAgent,
        { requestId, approvedBy: approvingUserId }
      );

      await client.query('COMMIT');
      
      logger.info(`Link request approved: ${requestId} by ${approvingUserId}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Reject a link request
   */
  async rejectLinkRequest(
    requestId: string,
    rejectingUserId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // Get the link request
    const linkRequestResults = await query<any>(
      `SELECT id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
              status, expires_at AS "expiresAt"
       FROM account_link_requests 
       WHERE id = $1`,
      [requestId]
    );
    
    if (linkRequestResults.length === 0) {
      throw new AppError(404, 'Link request not found');
    }
    
    const linkRequest = linkRequestResults[0];

    if (linkRequest.status !== 'pending') {
      throw new AppError(400, 'Link request is not pending');
    }

    // Verify rejecting user is the target
    const userResults = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [rejectingUserId]);
    
    if (!userResults.length || userResults[0].email.toLowerCase() !== linkRequest.targetEmail.toLowerCase()) {
      throw new AppError(403, 'You can only reject requests sent to your email address');
    }

    // Update request status
    await query(
      `UPDATE account_link_requests 
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    // Log the action
    await this.logLinkingAction(
      linkRequest.requesterUserId,
      'link_request_rejected',
      linkRequest.targetEmail,
      ipAddress,
      userAgent,
      { requestId, rejectedBy: rejectingUserId }
    );

    logger.info(`Link request rejected: ${requestId} by ${rejectingUserId}`);
  }

  /**
   * Get linked accounts for a user
   */
  async getLinkedAccounts(userId: string): Promise<LinkedUserInfo[]> {
    const linkedAccounts = await query<any>(
      `SELECT u.id AS "linkedUserId", u.email, u.oauth_provider AS "oauthProvider",
              p.first_name AS "firstName", p.last_name AS "lastName"
       FROM linked_accounts la
       JOIN users u ON la.linked_user_id = u.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE la.primary_user_id = $1`,
      [userId]
    );

    return linkedAccounts;
  }

  /**
   * Unlink accounts
   */
  async unlinkAccounts(
    userId: string,
    targetUserId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // Verify accounts are linked
    const isLinked = await this.areUsersLinked(userId, targetUserId);
    if (!isLinked) {
      throw new AppError(400, 'Accounts are not linked');
    }

    // Remove bidirectional links
    await query(
      `DELETE FROM linked_accounts 
       WHERE (primary_user_id = $1 AND linked_user_id = $2) 
          OR (primary_user_id = $2 AND linked_user_id = $1)`,
      [userId, targetUserId]
    );

    // Log the action
    await this.logLinkingAction(
      userId,
      'accounts_unlinked',
      '',
      ipAddress,
      userAgent,
      { unlinkedUserId: targetUserId }
    );

    logger.info(`Accounts unlinked: ${userId} and ${targetUserId}`);
  }

  /**
   * Check if two users are linked
   */
  async areUsersLinked(userId1: string, userId2: string): Promise<boolean> {
    const results = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM linked_accounts
       WHERE (primary_user_id = $1 AND linked_user_id = $2)`,
      [userId1, userId2]
    );

    return parseInt(results[0].count) > 0;
  }

  /**
   * Auto-link OAuth account to existing email account
   */
  async autoLinkOAuthToEmail(
    oauthUserId: string,
    email: string,
    provider: string
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find existing email-based user
    const emailUserResults = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND oauth_provider IS NULL',
      [normalizedEmail]
    );
    
    if (emailUserResults.length === 0) {
      return; // No email user to link to
    }
    
    const emailUser = emailUserResults[0];

    // Check if already linked
    const isLinked = await this.areUsersLinked(oauthUserId, emailUser.id);
    if (isLinked) {
      return; // Already linked
    }

    // Create the link (bidirectional)
    await query(
      `INSERT INTO linked_accounts (primary_user_id, linked_user_id, linked_by)
       VALUES ($1, $2, $1), ($2, $1, $1)`,
      [oauthUserId, emailUser.id]
    );

    // Log the action
    await this.logLinkingAction(
      oauthUserId,
      'auto_linked_oauth_to_email',
      normalizedEmail,
      undefined,
      undefined,
      { provider, emailUserId: emailUser.id }
    );

    logger.info(`Auto-linked ${provider} OAuth account ${oauthUserId} to email account ${emailUser.id}`);
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Log linking actions for audit trail
   */
  private async logLinkingAction(
    userId: string,
    action: string,
    targetEmail: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: any
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO account_linking_audit 
         (user_id, action, target_email, ip_address, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, action, targetEmail, ipAddress || null, userAgent || null, JSON.stringify(metadata || {})]
      );
    } catch (error) {
      logger.error('Failed to log linking action:', error);
      // Don't throw - this is just for auditing
    }
  }
}

export const accountLinkingService = new AccountLinkingService();