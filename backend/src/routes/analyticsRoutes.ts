import { Router } from 'express';
import { analyticsController } from '../controllers/analyticsController';
import { authenticate, authorize } from '../middleware/auth';
import { requestLogger } from '../middleware/requestLogger';

const router = Router();

// Apply request logging to all analytics routes
router.use(requestLogger);

// Apply authentication to all routes
router.use(authenticate);

// User analytics endpoints (authenticated users)
router.post('/coupon-usage', analyticsController.trackCouponUsage);
router.post('/profile-change', analyticsController.trackProfileChange);

// Admin-only analytics endpoints
router.get('/coupon-usage', authorize('admin', 'super_admin'), analyticsController.getCouponUsageAnalytics);
router.get('/profile-changes', authorize('admin', 'super_admin'), analyticsController.getProfileChangeAnalytics);
router.get('/user-engagement', authorize('admin', 'super_admin'), analyticsController.getUserEngagementMetrics);
router.get('/dashboard', authorize('admin', 'super_admin'), analyticsController.getAnalyticsDashboard);
router.post('/update-daily', authorize('admin', 'super_admin'), analyticsController.updateDailyAnalytics);

export default router;