import { Router } from 'express';
import { z } from 'zod';
import { accountLinkingService } from '../services/accountLinkingService';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { logger } from '../utils/logger';
import { query } from '../config/database';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createLinkRequestSchema = z.object({
  targetEmail: z.string().email('Invalid email address'),
  message: z.string().optional()
});

const approveLinkRequestSchema = z.object({
  requestId: z.string().uuid('Invalid request ID')
});

const rejectLinkRequestSchema = z.object({
  requestId: z.string().uuid('Invalid request ID')
});

const unlinkAccountSchema = z.object({
  targetUserId: z.string().uuid('Invalid user ID')
});

/**
 * POST /api/account-linking/request
 * Create a request to link current account to an email address
 */
router.post('/request', validateRequest(createLinkRequestSchema), async (req, res) => {
  try {
    const { targetEmail, message } = req.body;
    const userId = (req as any).user.userId;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    const linkRequest = await accountLinkingService.createLinkRequest(
      userId,
      targetEmail,
      message,
      ipAddress,
      userAgent
    );

    res.status(201).json({
      success: true,
      data: linkRequest,
      message: 'Link request created successfully'
    });

  } catch (error: any) {
    logger.error('Create link request error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to create link request'
    });
  }
});

/**
 * GET /api/account-linking/requests
 * Get all pending link requests for the current user (sent and received)
 */
router.get('/requests', async (req, res) => {
  try {
    const userId = (req as any).user.userId;

    const requests = await accountLinkingService.getUserLinkRequests(userId);

    res.json({
      success: true,
      data: requests
    });

  } catch (error: any) {
    logger.error('Get link requests error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get link requests'
    });
  }
});

/**
 * POST /api/account-linking/approve
 * Approve a link request
 */
router.post('/approve', validateRequest(approveLinkRequestSchema), async (req, res) => {
  try {
    const { requestId } = req.body;
    const userId = (req as any).user.userId;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    await accountLinkingService.approveLinkRequest(
      requestId,
      userId,
      ipAddress,
      userAgent
    );

    res.json({
      success: true,
      message: 'Link request approved successfully'
    });

  } catch (error: any) {
    logger.error('Approve link request error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to approve link request'
    });
  }
});

/**
 * POST /api/account-linking/reject
 * Reject a link request
 */
router.post('/reject', validateRequest(rejectLinkRequestSchema), async (req, res) => {
  try {
    const { requestId } = req.body;
    const userId = (req as any).user.userId;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    await accountLinkingService.rejectLinkRequest(
      requestId,
      userId,
      ipAddress,
      userAgent
    );

    res.json({
      success: true,
      message: 'Link request rejected successfully'
    });

  } catch (error: any) {
    logger.error('Reject link request error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to reject link request'
    });
  }
});

/**
 * GET /api/account-linking/linked-accounts
 * Get all accounts linked to the current user
 */
router.get('/linked-accounts', async (req, res) => {
  try {
    const userId = (req as any).user.userId;

    const linkedAccounts = await accountLinkingService.getLinkedAccounts(userId);

    res.json({
      success: true,
      data: linkedAccounts
    });

  } catch (error: any) {
    logger.error('Get linked accounts error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get linked accounts'
    });
  }
});

/**
 * POST /api/account-linking/unlink
 * Unlink an account from the current user
 */
router.post('/unlink', validateRequest(unlinkAccountSchema), async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const userId = (req as any).user.userId;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    await accountLinkingService.unlinkAccounts(
      userId,
      targetUserId,
      ipAddress,
      userAgent
    );

    res.json({
      success: true,
      message: 'Account unlinked successfully'
    });

  } catch (error: any) {
    logger.error('Unlink account error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to unlink account'
    });
  }
});

/**
 * GET /api/account-linking/status/:email
 * Check if an email can be linked (for validation)
 */
router.get('/status/:email', async (req, res) => {
  try {
    const targetEmail = req.params.email.toLowerCase();
    const userId = (req as any).user.userId;

    // Get current user email
    const currentUserResults = await query('SELECT email FROM users WHERE id = $1', [userId]);
    
    if (currentUserResults.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const currentUser = currentUserResults[0] as any;
    
    if (currentUser.email.toLowerCase() === targetEmail) {
      return res.json({
        success: true,
        data: {
          canLink: false,
          reason: 'Cannot link to your own email address'
        }
      });
    }

    // Check if target user exists
    const targetUserResults = await query('SELECT id, oauth_provider FROM users WHERE email = $1', [targetEmail]);
    
    if (targetUserResults.length > 0) {
      const targetUser = targetUserResults[0] as any;
      
      // Check if already linked
      const isLinked = await accountLinkingService.areUsersLinked(userId, targetUser.id);
      if (isLinked) {
        return res.json({
          success: true,
          data: {
            canLink: false,
            reason: 'Accounts are already linked'
          }
        });
      }

      return res.json({
        success: true,
        data: {
          canLink: true,
          targetExists: true,
          targetOAuthProvider: targetUser.oauth_provider
        }
      });
    } else {
      return res.json({
        success: true,
        data: {
          canLink: true,
          targetExists: false
        }
      });
    }

  } catch (error: any) {
    logger.error('Check link status error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check link status'
    });
  }
});

export default router;