import express from 'express';
import { LoyaltyController } from '../controllers/loyaltyController';
import { authenticate } from '../middleware/auth';

const router = express.Router();
const loyaltyController = new LoyaltyController();

// Public routes (authenticated users)
router.use(authenticate);

/**
 * @swagger
 * /api/loyalty/tiers:
 *   get:
 *     summary: Get all loyalty tiers
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of loyalty tiers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tier'
 */
router.get('/tiers', loyaltyController.getTiers.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/status:
 *   get:
 *     summary: Get current user's loyalty status
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's loyalty status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserLoyaltyStatus'
 */
router.get('/status', loyaltyController.getUserLoyaltyStatus.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/points/calculation:
 *   get:
 *     summary: Get detailed points calculation
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Points calculation with expiration info
 */
router.get('/points/calculation', loyaltyController.getPointsCalculation.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/history:
 *   get:
 *     summary: Get user's points transaction history
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of transactions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of transactions to skip
 *     responses:
 *       200:
 *         description: Points transaction history
 */
router.get('/history', loyaltyController.getPointsHistory.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/simulate-stay:
 *   post:
 *     summary: Simulate earning points for a hotel stay
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountSpent
 *             properties:
 *               amountSpent:
 *                 type: number
 *                 description: Amount spent on the stay
 *               stayId:
 *                 type: string
 *                 description: Optional stay reference ID
 *     responses:
 *       200:
 *         description: Points earned successfully
 */
router.post('/simulate-stay', loyaltyController.simulateStayEarning.bind(loyaltyController));

// Admin routes - require admin role
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

/**
 * @swagger
 * /api/loyalty/admin/users:
 *   get:
 *     summary: Get all users' loyalty status (Admin only)
 *     tags: [Loyalty Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for email or name
 *     responses:
 *       200:
 *         description: All users' loyalty status
 *       403:
 *         description: Admin access required
 */
router.get('/admin/users', requireAdmin, loyaltyController.getAllUsersLoyaltyStatus.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/admin/award-points:
 *   post:
 *     summary: Award points to a user (Admin only)
 *     tags: [Loyalty Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - points
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *               points:
 *                 type: integer
 *                 minimum: 1
 *               description:
 *                 type: string
 *               referenceId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Points awarded successfully
 *       403:
 *         description: Admin access required
 */
router.post('/admin/award-points', requireAdmin, loyaltyController.awardPoints.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/admin/deduct-points:
 *   post:
 *     summary: Deduct points from a user (Admin only)
 *     tags: [Loyalty Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - points
 *               - reason
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *               points:
 *                 type: integer
 *                 minimum: 1
 *               reason:
 *                 type: string
 *                 description: Reason for deduction
 *     responses:
 *       200:
 *         description: Points deducted successfully
 *       403:
 *         description: Admin access required
 */
router.post('/admin/deduct-points', requireAdmin, loyaltyController.deductPoints.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/admin/user/{userId}/history:
 *   get:
 *     summary: Get specific user's points history (Admin only)
 *     tags: [Loyalty Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: User's points transaction history
 *       403:
 *         description: Admin access required
 */
router.get('/admin/user/:userId/history', requireAdmin, loyaltyController.getUserPointsHistoryAdmin.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/admin/earning-rules:
 *   get:
 *     summary: Get points earning rules (Admin only)
 *     tags: [Loyalty Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Points earning rules
 *       403:
 *         description: Admin access required
 */
router.get('/admin/earning-rules', requireAdmin, loyaltyController.getEarningRules.bind(loyaltyController));

/**
 * @swagger
 * /api/loyalty/admin/expire-points:
 *   post:
 *     summary: Manually trigger points expiration (Admin only)
 *     tags: [Loyalty Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Points expiration completed
 *       403:
 *         description: Admin access required
 */
router.post('/admin/expire-points', requireAdmin, loyaltyController.expirePoints.bind(loyaltyController));

export default router;