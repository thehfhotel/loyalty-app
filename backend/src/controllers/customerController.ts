import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { customerService } from '../services/customerService.js';
import { 
  CustomerUpdateRequestSchema, 
  CustomerSearchSchema,
  CustomerAdminUpdateSchema 
} from '@hotel-loyalty/shared/types/customer';
import { JWTPayload } from '@hotel-loyalty/shared/types/auth';

// Extend Express Request to include user from auth middleware
interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export class CustomerController {
  /**
   * Get current user's profile
   */
  async getMyProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      const customer = await customerService.getCustomer(req.user.userId);
      
      res.json({
        success: true,
        data: customer
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current user's profile
   */
  async updateMyProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
        return;
      }

      // Validate request body
      const validationResult = CustomerUpdateRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const customer = await customerService.updateCustomer(
        req.user.userId, 
        validationResult.data
      );
      
      res.json({
        success: true,
        data: customer,
        message: 'Profile updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user's activity history
   */
  async getMyActivity(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
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

      const activities = await customerService.getCustomerActivity(req.user.userId, limit);
      
      res.json({
        success: true,
        data: activities
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get customer by ID
   */
  async getCustomer(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
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
          message: 'Invalid customer ID format'
        });
        return;
      }

      const customer = await customerService.getCustomer(id);
      
      res.json({
        success: true,
        data: customer
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Customer not found') {
        res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Admin: Search customers with filters
   */
  async searchCustomers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      // Parse and validate query parameters
      const searchParams = {
        ...req.query,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
        minPoints: req.query.minPoints ? parseInt(req.query.minPoints as string) : undefined,
        maxPoints: req.query.maxPoints ? parseInt(req.query.maxPoints as string) : undefined,
        minSpent: req.query.minSpent ? parseFloat(req.query.minSpent as string) : undefined,
        maxSpent: req.query.maxSpent ? parseFloat(req.query.maxSpent as string) : undefined,
        registeredAfter: req.query.registeredAfter ? new Date(req.query.registeredAfter as string) : undefined,
        registeredBefore: req.query.registeredBefore ? new Date(req.query.registeredBefore as string) : undefined,
        isActive: req.query.isActive ? req.query.isActive === 'true' : undefined,
      };

      const validationResult = CustomerSearchSchema.safeParse(searchParams);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid search parameters',
          errors: validationResult.error.errors
        });
        return;
      }

      const result = await customerService.searchCustomers(validationResult.data);
      
      res.json({
        success: true,
        data: result.customers,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Update customer
   */
  async updateCustomer(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
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
          message: 'Invalid customer ID format'
        });
        return;
      }

      // Validate request body
      const validationResult = CustomerAdminUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      const customer = await customerService.adminUpdateCustomer(id, validationResult.data);
      
      res.json({
        success: true,
        data: customer,
        message: 'Customer updated successfully'
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Customer not found') {
        res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Admin: Update customer points
   */
  async updateCustomerPoints(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
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
          message: 'Invalid customer ID format'
        });
        return;
      }

      // Validate request body
      const pointsUpdateSchema = z.object({
        points: z.number().int(),
        description: z.string().min(1, 'Description is required')
      });

      const validationResult = pointsUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request data',
          errors: validationResult.error.errors
        });
        return;
      }

      await customerService.updateCustomerPoints(
        id, 
        validationResult.data.points, 
        validationResult.data.description
      );
      
      res.json({
        success: true,
        message: 'Customer points updated successfully'
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Customer profile not found') {
        res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Admin: Get customer statistics
   */
  async getCustomerStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ 
          success: false, 
          message: 'Admin access required' 
        });
        return;
      }

      const stats = await customerService.getCustomerStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get customer activity
   */
  async getCustomerActivity(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
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
          message: 'Invalid customer ID format'
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

      const activities = await customerService.getCustomerActivity(id, limit);
      
      res.json({
        success: true,
        data: activities
      });
    } catch (error) {
      next(error);
    }
  }
}

export const customerController = new CustomerController();