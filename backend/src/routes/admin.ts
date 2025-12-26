import { Router, Request, Response, NextFunction } from 'express';
import { emailService } from '../services/emailService';
import { logger } from '../utils/logger';
import { requireSuperAdmin } from '../middleware/auth';

const router = Router();

/**
 * GET /api/admin/email/status
 * Get email service health status (super admin only)
 */
router.get('/email/status', requireSuperAdmin(), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await emailService.getHealthStatus();

    return res.json({
      success: true,
      email: status,
    });
  } catch (error) {
    logger.error('Failed to get email status:', error);
    return next(error);
  }
});

/**
 * POST /api/admin/email/test
 * Test email delivery end-to-end (super admin only)
 * Sends a test email and verifies it's received via IMAP
 */
router.post('/email/test', requireSuperAdmin(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const timeoutMs = parseInt(req.query.timeout as string) || 30000;

    // Limit timeout to 60 seconds max
    const effectiveTimeout = Math.min(timeoutMs, 60000);

    logger.info('Starting email delivery test', { timeoutMs: effectiveTimeout });

    const result = await emailService.testEmailDelivery(effectiveTimeout);

    if (result.success) {
      return res.json({
        success: true,
        message: 'Email delivery test passed',
        result,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Email delivery test failed',
        result,
      });
    }
  } catch (error) {
    logger.error('Email delivery test failed:', error);
    return next(error);
  }
});

/**
 * GET /api/admin/email/config
 * Get email configuration status (super admin only, no secrets)
 */
router.get('/email/config', requireSuperAdmin(), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = {
      smtp: {
        host: process.env.SMTP_HOST ?? 'smtp.privateemail.com',
        port: parseInt(process.env.SMTP_PORT ?? '465'),
        secure: true,
        userConfigured: !!process.env.SMTP_USER,
        passConfigured: !!process.env.SMTP_PASS,
        from: process.env.SMTP_FROM ?? '(not set)',
      },
      imap: {
        host: process.env.IMAP_HOST ?? '(not set)',
        port: parseInt(process.env.IMAP_PORT ?? '993'),
        secure: true,
        userConfigured: !!process.env.IMAP_USER,
        passConfigured: !!process.env.IMAP_PASS,
      },
      isFullyConfigured: !!(
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.IMAP_HOST &&
        process.env.IMAP_USER &&
        process.env.IMAP_PASS
      ),
    };

    return res.json({
      success: true,
      config,
    });
  } catch (error) {
    logger.error('Failed to get email config:', error);
    return next(error);
  }
});

export default router;
