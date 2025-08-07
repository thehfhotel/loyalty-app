import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { StorageService } from '../services/storageService';
import { logger } from '../utils/logger';

const router = Router();

// Get storage statistics (admin only)
router.get('/stats', authenticate, authorize('admin', 'super_admin'), async (_req: Request, res: Response) => {
  try {
    const report = await StorageService.getStorageReport();
    res.json(report);
  } catch (error: unknown) {
    logger.error('Failed to get storage stats:', error);
    res.status(500).json({ error: 'Failed to retrieve storage statistics' });
  }
});

// Trigger manual backup (admin only)
router.post('/backup', authenticate, authorize('admin', 'super_admin'), async (_req: Request, res: Response) => {
  try {
    // Run backup asynchronously
    StorageService.performBackup().catch(error => {
      logger.error('Manual backup failed:', error);
    });
    
    res.json({ message: 'Backup started successfully' });
  } catch (error: unknown) {
    logger.error('Failed to start backup:', error);
    res.status(500).json({ error: 'Failed to start backup' });
  }
});

export default router;