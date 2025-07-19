import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loyaltyService } from '../services/loyaltyService.js';
import { customerService } from '../services/customerService.js';
import { 
  PointsEarningRequestSchema,
  PointsBalanceUpdateSchema,
  CreateRedemptionRequestSchema,
  CreateTierSchema,
  TierUpdateSchema,
  CreatePointsRuleSchema,
  UpdatePointsRuleSchema
} from '@hotel-loyalty/shared/types/loyalty';
import { JWTPayload } from '@hotel-loyalty/shared/types/auth';

// Extend Express Request to include user from auth middleware
interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export class LoyaltyController {
  // ============ Customer Dashboard ============

  /**
   * Get current user's loyalty dashboard
   */
  async getMyLoyaltyDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      // Get customer profile ID
      const customerProfile = await customerService.getCustomerProfile(req.user.userId);
      const dashboard = await loyaltyService.getLoyaltyDashboard(customerProfile.id);
      
      res.json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user's points history
   */
  async getMyPointsHistory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      const limitParam = req.query.limit as string;
      const limit = limitParam ? parseInt(limitParam) : 50;

      if (limit > 100) {
        res.status(400).json({
          success: false,
          message: 'Limit cannot exceed 100'
        });
        return;
      }

      const customerProfile = await customerService.getCustomerProfile(req.user.userId);
      const history = await loyaltyService.getPointsHistory(customerProfile.id, limit);
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get available redemption options
   */
  async getRedemptionOptions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      const options = await loyaltyService.getRedemptionOptions();
      
      res.json({
        success: true,
        data: options
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create redemption request
   */
  async createRedemptionRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      // Validate request body
      const validationResult = CreateRedemptionRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const customerProfile = await customerService.getCustomerProfile(req.user.userId);
      const redemptionRequest = await loyaltyService.createRedemptionRequest(
        customerProfile.id,
        validationResult.data
      );
      
      res.status(201).json({
        success: true,
        data: redemptionRequest,
        message: 'Redemption request created successfully'
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Insufficient points') || 
            error.message.includes('not found') ||
            error.message.includes('inactive')) {
          res.status(400).json({
            success: false,
            message: error.message
          });
          return;
        }
      }
      next(error);
    }
  }

  /**
   * Get current user's redemption requests
   */
  async getMyRedemptions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      const customerProfile = await customerService.getCustomerProfile(req.user.userId);
      const redemptions = await loyaltyService.getCustomerRedemptions(customerProfile.id);
      
      res.json({
        success: true,
        data: redemptions
      });
    } catch (error) {
      next(error);
    }
  }

  // ============ Tier Management (Customer) ============

  /**
   * Get all tiers (public endpoint)
   */
  async getTiers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tiers = await loyaltyService.getAllTiers();
      
      res.json({
        success: true,
        data: tiers
      });
    } catch (error) {
      next(error);
    }
  }

  // ============ Admin Endpoints ============

  /**
   * Admin: Award points to customer
   */
  async awardPoints(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      // Validate request body
      const validationResult = PointsEarningRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const transaction = await loyaltyService.awardPoints(validationResult.data);
      
      res.status(201).json({
        success: true,
        data: transaction,
        message: 'Points awarded successfully'
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('No active points rule')) {
        res.status(400).json({
          success: false,
          message: error.message
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Admin: Update customer points balance
   */
  async updatePointsBalance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const { customerProfileId } = req.params;
      
      if (!z.string().uuid().safeParse(customerProfileId).success) {
        res.status(400).json({
          success: false,
          message: 'Invalid customer profile ID format'
        });
        return;
      }

      // Validate request body
      const validationResult = PointsBalanceUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const transaction = await loyaltyService.updatePointsBalance(
        customerProfileId,
        validationResult.data
      );
      
      res.json({
        success: true,
        data: transaction,
        message: 'Points balance updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get loyalty analytics
   */
  async getLoyaltyAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const analytics = await loyaltyService.getLoyaltyAnalytics();
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      next(error);
    }
  }

  // ============ Tier Management (Admin) ============

  /**
   * Admin: Create tier
   */
  async createTier(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      // Validate request body
      const validationResult = CreateTierSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const tier = await loyaltyService.createTier(validationResult.data);
      
      res.status(201).json({
        success: true,
        data: tier,
        message: 'Tier created successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Update tier
   */
  async updateTier(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const { id } = req.params;
      
      if (!z.string().uuid().safeParse(id).success) {
        res.status(400).json({
          success: false,
          message: 'Invalid tier ID format'
        });
        return;
      }

      // Validate request body
      const validationResult = TierUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const tier = await loyaltyService.updateTier(id, validationResult.data);
      
      res.json({
        success: true,
        data: tier,
        message: 'Tier updated successfully'
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Tier not found') {
        res.status(404).json({
          success: false,
          message: 'Tier not found'
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Admin: Get tier details
   */
  async getTier(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const { id } = req.params;
      
      if (!z.string().uuid().safeParse(id).success) {
        res.status(400).json({
          success: false,
          message: 'Invalid tier ID format'
        });
        return;
      }

      const tier = await loyaltyService.getTier(id);
      
      res.json({
        success: true,
        data: tier
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Tier not found') {
        res.status(404).json({
          success: false,
          message: 'Tier not found'
        });
        return;
      }
      next(error);
    }
  }

  // ============ Points Rules Management (Admin) ============

  /**
   * Admin: Get all points rules
   */
  async getPointsRules(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const rules = await loyaltyService.getPointsRules();
      
      res.json({
        success: true,
        data: rules
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Create points rule
   */
  async createPointsRule(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      // Validate request body
      const validationResult = CreatePointsRuleSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const rule = await loyaltyService.createPointsRule(validationResult.data);
      
      res.status(201).json({
        success: true,
        data: rule,
        message: 'Points rule created successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Update points rule
   */
  async updatePointsRule(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const { id } = req.params;
      
      if (!z.string().uuid().safeParse(id).success) {
        res.status(400).json({
          success: false,
          message: 'Invalid points rule ID format'
        });
        return;
      }

      // Validate request body
      const validationResult = UpdatePointsRuleSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const rule = await loyaltyService.updatePointsRule(id, validationResult.data);
      
      res.json({
        success: true,
        data: rule,
        message: 'Points rule updated successfully'
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Points rule not found') {
        res.status(404).json({
          success: false,
          message: 'Points rule not found'
        });
        return;
      }
      next(error);
    }
  }
}

export const loyaltyController = new LoyaltyController();