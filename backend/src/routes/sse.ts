import { Router, Request, Response } from 'express';
import { sseService } from '../services/sseService';
import { AuthService } from '../services/authService';
import { query } from '../config/database';
import { UserRole } from '../types/auth';
import { logger } from '../utils/logger';
import { sanitizeLogValue } from '../utils/logSanitizer';

const router = Router();
const authService = new AuthService();

interface SlipUploadedEvent {
  bookingId: string;
  slipId: string;
  timestamp: number;
}

/**
 * SSE endpoint for admin booking updates
 * Authentication via query parameter (EventSource doesn't support headers)
 *
 * Usage: new EventSource('/api/sse/admin/bookings?token=<JWT>')
 */
router.get('/admin/bookings', async (req: Request, res: Response) => {
  try {
    // Get token from query parameter (EventSource can't set headers)
    const token = req.query.token as string;

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify token
    let payload;
    try {
      payload = await authService.verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Verify admin role from database (not just JWT)
    const [user] = await query<{ role: UserRole }>(
      'SELECT role FROM users WHERE id = $1 AND is_active = true',
      [payload.id]
    );

    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    logger.info(`SSE connection established for admin ${sanitizeLogValue(payload.id)}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to admin booking updates' })}\n\n`);

    // Event handler for slip uploads
    const onSlipUploaded = (data: SlipUploadedEvent) => {
      res.write(`event: slip-uploaded\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Subscribe to events
    sseService.on('slip-uploaded', onSlipUploaded);

    // Heartbeat to keep connection alive (every 30 seconds)
    const heartbeatInterval = setInterval(() => {
      res.write(`:heartbeat\n\n`);
    }, 30000);

    // Cleanup on client disconnect
    req.on('close', () => {
      logger.info(`SSE connection closed for admin ${sanitizeLogValue(payload.id)}`);
      sseService.off('slip-uploaded', onSlipUploaded);
      clearInterval(heartbeatInterval);
    });

  } catch (error) {
    logger.error('SSE endpoint error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
