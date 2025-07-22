import { Router } from 'express';
import { z } from 'zod';
import { featureToggleService } from '../services/featureToggleService';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Validation schemas
const toggleFeatureSchema = z.object({
  featureKey: z.string().min(1, 'Feature key is required'),
  isEnabled: z.boolean(),
  reason: z.string().optional()
});

const createFeatureSchema = z.object({
  featureKey: z.string().min(1, 'Feature key is required').regex(/^[a-z0-9_]+$/, 'Feature key must contain only lowercase letters, numbers, and underscores'),
  featureName: z.string().min(1, 'Feature name is required'),
  description: z.string().min(1, 'Description is required'),
  isEnabled: z.boolean().optional().default(false)
});

/**
 * Middleware to check if user has super admin role
 */
function requireSuperAdmin(req: any, res: any, next: any) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: 'Super admin access required'
    });
  }
  next();
}

/**
 * GET /api/feature-toggles/public
 * Get public feature flags (for client-side feature checking)
 */
router.get('/public', async (req, res) => {
  try {
    const features = await featureToggleService.getPublicFeatures();
    
    res.json({
      success: true,
      data: features
    });
  } catch (error: any) {
    logger.error('Get public features error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get feature flags'
    });
  }
});

/**
 * GET /api/feature-toggles
 * Get all feature toggles (admin only)
 */
router.get('/', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const features = await featureToggleService.getAllFeatureToggles();
    
    res.json({
      success: true,
      data: features
    });
  } catch (error: any) {
    logger.error('Get feature toggles error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to get feature toggles'
    });
  }
});

/**
 * GET /api/feature-toggles/:featureKey
 * Get specific feature toggle by key (admin only)
 */
router.get('/:featureKey', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { featureKey } = req.params;
    const feature = await featureToggleService.getFeatureToggleByKey(featureKey);
    
    if (!feature) {
      return res.status(404).json({
        success: false,
        error: 'Feature toggle not found'
      });
    }
    
    res.json({
      success: true,
      data: feature
    });
  } catch (error: any) {
    logger.error('Get feature toggle error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to get feature toggle'
    });
  }
});

/**
 * POST /api/feature-toggles/toggle
 * Toggle a feature on/off (admin only)
 */
router.post('/toggle', authenticate, requireSuperAdmin, validateRequest(toggleFeatureSchema), async (req, res) => {
  try {
    const { featureKey, isEnabled, reason } = req.body;
    const userId = req.user.id;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    const updatedFeature = await featureToggleService.toggleFeature(
      featureKey,
      isEnabled,
      userId,
      reason,
      ipAddress,
      userAgent
    );
    
    res.json({
      success: true,
      data: updatedFeature,
      message: `Feature '${featureKey}' ${isEnabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error: any) {
    logger.error('Toggle feature error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to toggle feature'
    });
  }
});

/**
 * POST /api/feature-toggles
 * Create a new feature toggle (admin only)
 */
router.post('/', authenticate, requireSuperAdmin, validateRequest(createFeatureSchema), async (req, res) => {
  try {
    const { featureKey, featureName, description, isEnabled } = req.body;
    const userId = req.user.id;

    const newFeature = await featureToggleService.createFeatureToggle(
      featureKey,
      featureName,
      description,
      isEnabled,
      userId
    );
    
    res.status(201).json({
      success: true,
      data: newFeature,
      message: 'Feature toggle created successfully'
    });
  } catch (error: any) {
    logger.error('Create feature toggle error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to create feature toggle'
    });
  }
});

/**
 * GET /api/feature-toggles/:featureKey/audit
 * Get audit history for a feature toggle (admin only)
 */
router.get('/:featureKey/audit', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { featureKey } = req.params;
    const auditHistory = await featureToggleService.getFeatureToggleAudit(featureKey);
    
    res.json({
      success: true,
      data: auditHistory
    });
  } catch (error: any) {
    logger.error('Get feature toggle audit error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to get feature toggle audit history'
    });
  }
});

/**
 * GET /api/feature-toggles/check/:featureKey
 * Check if a specific feature is enabled (public endpoint for authenticated users)
 */
router.get('/check/:featureKey', authenticate, async (req, res) => {
  try {
    const { featureKey } = req.params;
    const isEnabled = await featureToggleService.isFeatureEnabled(featureKey);
    
    res.json({
      success: true,
      data: {
        featureKey,
        isEnabled
      }
    });
  } catch (error: any) {
    logger.error('Check feature error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check feature status'
    });
  }
});

export default router;