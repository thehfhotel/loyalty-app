import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { customerController } from '../controllers/customerController.js';

const router = Router();

// Customer profile routes (authenticated users)
router.get('/profile', authenticate, customerController.getMyProfile);
router.put('/profile', authenticate, customerController.updateMyProfile);
router.get('/activity', authenticate, customerController.getMyActivity);

// Admin customer management routes
router.get('/search', authenticate, authorize(['admin']), customerController.searchCustomers);
router.get('/stats', authenticate, authorize(['admin']), customerController.getCustomerStats);
router.get('/:id', authenticate, authorize(['admin']), customerController.getCustomer);
router.put('/:id', authenticate, authorize(['admin']), customerController.updateCustomer);
router.put('/:id/points', authenticate, authorize(['admin']), customerController.updateCustomerPoints);
router.get('/:id/activity', authenticate, authorize(['admin']), customerController.getCustomerActivity);

export default router;