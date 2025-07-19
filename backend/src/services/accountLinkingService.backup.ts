import { query, getClient } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
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

export class AccountLinkingService {
  /**
   * Create a request to link current user account to an email address
   */
  async createLinkRequest(
    requesterUserId: string,
    targetEmail: string,
    message?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AccountLinkRequest> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Normalize email
      const normalizedEmail = targetEmail.toLowerCase().trim();
      
      // Check if email is valid
      if (!this.isValidEmail(normalizedEmail)) {
        throw new AppError(400, 'Invalid email address');
      }

      // Check if user is trying to link to their own email
      const requesterUsers = await client.query(
        'SELECT email FROM users WHERE id = $1',
        [requesterUserId]
      );
      const requesterUser = requesterUsers.rows[0];
      
      if (requesterUser?.email.toLowerCase() === normalizedEmail) {
        throw new AppError(400, 'Cannot link to your own email address');
      }

      // Check if users are already linked
      const targetUsers = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [normalizedEmail]
      );
      const targetUser = targetUsers.rows[0];

      if (targetUser) {
        const isLinked = await this.areUsersLinked(requesterUserId, targetUser.id);
        if (isLinked) {
          throw new AppError(400, 'Accounts are already linked');
        }
      }

      // Check for existing pending requests
      const existingRequests = await client.query(
        `SELECT id FROM account_link_requests 
         WHERE requester_user_id = $1 AND target_email = $2 AND status = 'pending'`,
        [requesterUserId, normalizedEmail]
      );
      const existingRequest = existingRequests.rows[0];

      if (existingRequest) {
        throw new AppError(400, 'A pending link request already exists for this email');
      }

      // Determine request type
      const requestType = targetUser ? 'link_to_existing' : 'link_to_email';
      
      // Create link request
      const linkRequestResult = await client.query<AccountLinkRequest>(
        `INSERT INTO account_link_requests 
         (requester_user_id, target_email, target_user_id, request_type, message) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
                   target_user_id AS "targetUserId", request_type AS "requestType", 
                   status, message, created_at AS "createdAt", updated_at AS "updatedAt", 
                   expires_at AS "expiresAt"`,
        [requesterUserId, normalizedEmail, targetUser?.id || null, requestType, message || null]
      );
      const linkRequest = linkRequestResult.rows[0];

      // Log the action
      await this.logLinkingAction(
        requesterUserId,
        'link_request_created',
        normalizedEmail,
        targetUser?.id,
        linkRequest.id,
        { requestType, message },
        ipAddress,
        userAgent,
        client
      );

      await client.query('COMMIT');
      
      logger.info(`Account link request created: ${linkRequest.id} by user ${requesterUserId} to ${normalizedEmail}`);
      return linkRequest;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get pending link requests for a user (both sent and received)
   */
  async getUserLinkRequests(userId: string): Promise<{
    sent: AccountLinkRequest[];
    received: AccountLinkRequest[];
  }> {
    // Get user's email for checking received requests
    const [user] = await query('SELECT email FROM users WHERE id = $1', [userId]);
    
    const [sentRequests, receivedRequests] = await Promise.all([
      // Sent requests
      query<AccountLinkRequest>(
        `SELECT id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
                target_user_id AS "targetUserId", request_type AS "requestType", 
                status, message, created_at AS "createdAt", updated_at AS "updatedAt", 
                expires_at AS "expiresAt"
         FROM account_link_requests 
         WHERE requester_user_id = $1 AND status = 'pending' AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId]
      ),
      // Received requests
      query<AccountLinkRequest>(
        `SELECT alr.id, alr.requester_user_id AS "requesterUserId", alr.target_email AS "targetEmail", 
                alr.target_user_id AS "targetUserId", alr.request_type AS "requestType", 
                alr.status, alr.message, alr.created_at AS "createdAt", alr.updated_at AS "updatedAt", 
                alr.expires_at AS "expiresAt"
         FROM account_link_requests alr
         WHERE (alr.target_user_id = $1 OR alr.target_email = $2) 
           AND alr.status = 'pending' AND alr.expires_at > NOW()
         ORDER BY alr.created_at DESC`,
        [userId, user?.email || '']
      )
    ]);

    return { sent: sentRequests, received: receivedRequests };
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
      const [linkRequest] = await client.query<AccountLinkRequest>(
        `SELECT id, requester_user_id AS "requesterUserId", target_email AS "targetEmail", 
                target_user_id AS "targetUserId", request_type AS "requestType", 
                status, expires_at AS "expiresAt"
         FROM account_link_requests 
         WHERE id = $1`,
        [requestId]
      );

      if (!linkRequest) {
        throw new AppError(404, 'Link request not found');
      }

      if (linkRequest.status !== 'pending') {
        throw new AppError(400, 'Link request is no longer pending');
      }

      if (new Date() > linkRequest.expiresAt) {
        throw new AppError(400, 'Link request has expired');
      }

      // Verify the approving user has permission
      const [user] = await client.query('SELECT email FROM users WHERE id = $1', [approvingUserId]);
      const canApprove = linkRequest.targetUserId === approvingUserId || 
                        user?.email.toLowerCase() === linkRequest.targetEmail.toLowerCase();
      
      if (!canApprove) {
        throw new AppError(403, 'Not authorized to approve this link request');
      }

      // If linking to email that doesn't have an account, create a placeholder
      let targetUserId = linkRequest.targetUserId;
      if (!targetUserId && linkRequest.requestType === 'link_to_email') {
        const [newUser] = await client.query(
          `INSERT INTO users (email, password_hash, email_verified) 
           VALUES ($1, '', false) 
           RETURNING id`,
          [linkRequest.targetEmail]
        );
        targetUserId = newUser.id;
        
        // Create empty profile
        await client.query(
          'INSERT INTO user_profiles (user_id) VALUES ($1)',
          [targetUserId]
        );
      }

      // Create the link (use requester as primary for consistency)
      await client.query(
        `INSERT INTO linked_accounts (primary_user_id, linked_user_id, linked_by) 
         VALUES ($1, $2, $3)`,
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
        approvingUserId,
        'link_request_approved',
        linkRequest.targetEmail,
        targetUserId,
        requestId,
        { requesterUserId: linkRequest.requesterUserId },
        ipAddress,
        userAgent,
        client
      );

      await client.query('COMMIT');
      
      logger.info(`Account link approved: ${requestId} by user ${approvingUserId}`);

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
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Get the link request
      const [linkRequest] = await client.query(
        `SELECT requester_user_id, target_email, target_user_id, status 
         FROM account_link_requests 
         WHERE id = $1`,
        [requestId]
      );

      if (!linkRequest) {
        throw new AppError(404, 'Link request not found');
      }

      if (linkRequest.status !== 'pending') {
        throw new AppError(400, 'Link request is no longer pending');
      }

      // Verify the rejecting user has permission
      const [user] = await query('SELECT email FROM users WHERE id = $1', [rejectingUserId]);
      const canReject = linkRequest.target_user_id === rejectingUserId || 
                       user?.email.toLowerCase() === linkRequest.target_email.toLowerCase();
      
      if (!canReject) {
        throw new AppError(403, 'Not authorized to reject this link request');
      }

      // Update request status
      await client.query(
        `UPDATE account_link_requests 
         SET status = 'rejected', updated_at = NOW() 
         WHERE id = $1`,
        [requestId]
      );

      // Log the action
      await this.logLinkingAction(
        rejectingUserId,
        'link_request_rejected',
        linkRequest.target_email,
        linkRequest.target_user_id,
        requestId,
        { requesterUserId: linkRequest.requester_user_id },
        ipAddress,
        userAgent,
        client
      );

      await client.query('COMMIT');
      
      logger.info(`Account link rejected: ${requestId} by user ${rejectingUserId}`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all linked accounts for a user
   */
  async getLinkedAccounts(userId: string): Promise<LinkedUserInfo[]> {
    const linkedAccounts = await query<LinkedUserInfo>(
      'SELECT * FROM get_linked_accounts($1)',
      [userId]
    );

    return linkedAccounts;
  }

  /**
   * Check if two users are linked
   */
  async areUsersLinked(userId1: string, userId2: string): Promise<boolean> {
    const [result] = await query<{ are_users_linked: boolean }>(
      'SELECT are_users_linked($1, $2)',
      [userId1, userId2]
    );

    return result?.are_users_linked || false;
  }

  /**
   * Unlink two accounts
   */
  async unlinkAccounts(
    userId: string,
    targetUserId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Verify the accounts are linked
      const isLinked = await this.areUsersLinked(userId, targetUserId);
      if (!isLinked) {
        throw new AppError(400, 'Accounts are not linked');
      }

      // Remove the link
      await client.query(
        `DELETE FROM linked_accounts 
         WHERE (primary_user_id = $1 AND linked_user_id = $2) 
            OR (primary_user_id = $2 AND linked_user_id = $1)`,
        [userId, targetUserId]
      );

      // Log the action
      await this.logLinkingAction(
        userId,
        'accounts_unlinked',
        null,
        targetUserId,
        null,
        { targetUserId },
        ipAddress,
        userAgent,
        client
      );

      await client.query('COMMIT');
      
      logger.info(`Accounts unlinked: ${userId} and ${targetUserId}`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Auto-link OAuth login to existing email account
   */
  async autoLinkOAuthToEmail(
    oauthUserId: string,
    targetEmail: string,
    oauthProvider: string
  ): Promise<boolean> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Find existing email account
      const [emailUser] = await client.query(
        'SELECT id FROM users WHERE email = $1 AND oauth_provider IS NULL',
        [targetEmail.toLowerCase()]
      );

      if (!emailUser) {
        return false; // No existing email account to link to
      }

      // Check if already linked
      const isLinked = await this.areUsersLinked(oauthUserId, emailUser.id);
      if (isLinked) {
        return true; // Already linked
      }

      // Create the link (email account as primary)
      await client.query(
        `INSERT INTO linked_accounts (primary_user_id, linked_user_id, linked_by) 
         VALUES ($1, $2, $3)`,
        [emailUser.id, oauthUserId, oauthUserId]
      );

      // Log the action
      await this.logLinkingAction(
        oauthUserId,
        'auto_linked_oauth_to_email',
        targetEmail,
        emailUser.id,
        null,
        { oauthProvider, autoLinked: true },
        null,
        null,
        client
      );

      await client.query('COMMIT');
      
      logger.info(`Auto-linked OAuth user ${oauthUserId} (${oauthProvider}) to email account ${emailUser.id}`);
      return true;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Auto-link OAuth to email failed:', error);
      return false;
    } finally {
      client.release();
    }
  }

  private async logLinkingAction(
    userId: string,
    action: string,
    targetEmail?: string | null,
    targetUserId?: string | null,
    requestId?: string | null,
    details: Record<string, any> = {},
    ipAddress?: string | null,
    userAgent?: string | null,
    client?: any
  ): Promise<void> {
    const queryClient = client || await getClient();
    
    try {
      await queryClient.query(
        `INSERT INTO account_linking_audit 
         (user_id, action, target_email, target_user_id, request_id, details, ip_address, user_agent) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, action, targetEmail, targetUserId, requestId, JSON.stringify(details), ipAddress, userAgent]
      );
    } finally {
      if (!client) {
        queryClient.release();
      }
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

export const accountLinkingService = new AccountLinkingService();