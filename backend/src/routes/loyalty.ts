import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { loyaltyController } from '../controllers/loyaltyController.js';

const router = Router();

// Customer loyalty routes (authenticated users)
router.get('/dashboard', authenticate, loyaltyController.getMyLoyaltyDashboard);
router.get('/points/history', authenticate, loyaltyController.getMyPointsHistory);
router.get('/redemptions/options', authenticate, loyaltyController.getRedemptionOptions);
router.post('/redemptions', authenticate, loyaltyController.createRedemptionRequest);
router.get('/redemptions', authenticate, loyaltyController.getMyRedemptions);

// Public tier information
router.get('/tiers', loyaltyController.getTiers);

// Admin loyalty management routes
router.get('/analytics', authenticate, authorize(['admin']), loyaltyController.getLoyaltyAnalytics);

// Admin points management
router.post('/points/award', authenticate, authorize(['admin']), loyaltyController.awardPoints);
router.put('/points/:customerProfileId', authenticate, authorize(['admin']), loyaltyController.updatePointsBalance);

// Admin tier management
router.post('/tiers', authenticate, authorize(['admin']), loyaltyController.createTier);
router.get('/tiers/:id', authenticate, authorize(['admin']), loyaltyController.getTier);
router.put('/tiers/:id', authenticate, authorize(['admin']), loyaltyController.updateTier);

// Admin points rules management
router.get('/rules', authenticate, authorize(['admin']), loyaltyController.getPointsRules);
router.post('/rules', authenticate, authorize(['admin']), loyaltyController.createPointsRule);
router.put('/rules/:id', authenticate, authorize(['admin']), loyaltyController.updatePointsRule);

export default router;