import { Pool } from 'pg';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { addDays, isAfter, isBefore } from 'date-fns';
import { logger } from '../utils/logger.js';
import { 
  COUPON_TYPES, 
  COUPON_CATEGORIES, 
  ERROR_CODES 
} from '@hotel-loyalty/shared';

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string;
  type: keyof typeof COUPON_TYPES;
  category: keyof typeof COUPON_CATEGORIES;
  value: number;
  minSpend?: number;
  maxDiscount?: number;
  validFrom: Date;
  validUntil: Date;
  usageLimit?: number;
  usageCount: number;
  isActive: boolean;
  terms?: string;
  imageUrl?: string;
  qrCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerCoupon {
  id: string;
  customerId: string;
  couponId: string;
  isUsed: boolean;
  usedAt?: Date;
  redeemedAt?: Date;
  redemptionLocation?: string;
  redemptionAmount?: number;
  createdAt: Date;
}

export interface CouponCreationData {
  title: string;
  description: string;
  type: keyof typeof COUPON_TYPES;
  category: keyof typeof COUPON_CATEGORIES;
  value: number;
  minSpend?: number;
  maxDiscount?: number;
  validFrom: Date;
  validUntil: Date;
  usageLimit?: number;
  terms?: string;
  imageUrl?: string;
}

export interface CouponDistributionRule {
  id: string;
  couponId: string;
  targetType: 'all' | 'tier' | 'segment' | 'individual';
  targetValue?: string;
  maxDistributions?: number;
  distributionCount: number;
  isActive: boolean;
  createdAt: Date;
}

export class CouponService {
  constructor(private db: Pool) {}

  /**
   * Create a new coupon
   */
  async createCoupon(data: CouponCreationData): Promise<Coupon> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      const id = uuidv4();
      const code = this.generateCouponCode();
      
      // Generate QR code
      const qrCodeData = JSON.stringify({
        couponId: id,
        code: code,
        type: 'coupon_redemption'
      });
      
      const qrCodeUrl = await QRCode.toDataURL(qrCodeData, {
        errorCorrectionLevel: 'M',
        margin: 2,
        scale: 8
      });
      
      const coupon = await client.query(
        `INSERT INTO coupons (
          id, code, title, description, type, category, value, 
          min_spend, max_discount, valid_from, valid_until, 
          usage_limit, terms, image_url, qr_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          id, code, data.title, data.description, data.type, data.category,
          data.value, data.minSpend, data.maxDiscount, data.validFrom,
          data.validUntil, data.usageLimit, data.terms, data.imageUrl, qrCodeUrl
        ]
      );
      
      await client.query('COMMIT');
      
      logger.info(`Coupon created: ${id}`);
      return this.mapCouponRow(coupon.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating coupon:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Get coupon by ID
   */
  async getCouponById(id: string): Promise<Coupon | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM coupons WHERE id = $1',
        [id]
      );
      
      return result.rows.length > 0 ? this.mapCouponRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting coupon by ID:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get coupon by code
   */
  async getCouponByCode(code: string): Promise<Coupon | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM coupons WHERE code = $1 AND is_active = true',
        [code]
      );
      
      return result.rows.length > 0 ? this.mapCouponRow(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error getting coupon by code:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get available coupons for customer
   */
  async getAvailableCoupons(customerId: string): Promise<Coupon[]> {
    try {
      const result = await this.db.query(
        `SELECT DISTINCT c.* FROM coupons c
         LEFT JOIN customer_coupons cc ON c.id = cc.coupon_id AND cc.customer_id = $1
         WHERE c.is_active = true 
         AND c.valid_from <= NOW() 
         AND c.valid_until >= NOW()
         AND (c.usage_limit IS NULL OR c.usage_count < c.usage_limit)
         AND (cc.id IS NULL OR cc.is_used = false)
         ORDER BY c.created_at DESC`,
        [customerId]
      );
      
      return result.rows.map(row => this.mapCouponRow(row));
    } catch (error) {
      logger.error('Error getting available coupons:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get customer's coupons
   */
  async getCustomerCoupons(customerId: string): Promise<{
    coupon: Coupon;
    customerCoupon: CustomerCoupon;
  }[]> {
    try {
      const result = await this.db.query(
        `SELECT c.*, cc.* FROM customer_coupons cc
         JOIN coupons c ON cc.coupon_id = c.id
         WHERE cc.customer_id = $1
         ORDER BY cc.created_at DESC`,
        [customerId]
      );
      
      return result.rows.map(row => ({
        coupon: this.mapCouponRow(row),
        customerCoupon: this.mapCustomerCouponRow(row)
      }));
    } catch (error) {
      logger.error('Error getting customer coupons:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Distribute coupon to customer
   */
  async distributeCoupon(couponId: string, customerId: string): Promise<CustomerCoupon> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if coupon exists and is valid
      const coupon = await this.getCouponById(couponId);
      if (!coupon) {
        throw new Error(ERROR_CODES.RESOURCE_NOT_FOUND);
      }
      
      if (!coupon.isActive) {
        throw new Error('Coupon is not active');
      }
      
      // Check if customer already has this coupon
      const existing = await client.query(
        'SELECT id FROM customer_coupons WHERE coupon_id = $1 AND customer_id = $2',
        [couponId, customerId]
      );
      
      if (existing.rows.length > 0) {
        throw new Error(ERROR_CODES.RESOURCE_ALREADY_EXISTS);
      }
      
      // Create customer coupon
      const customerCouponId = uuidv4();
      const customerCoupon = await client.query(
        `INSERT INTO customer_coupons (id, customer_id, coupon_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [customerCouponId, customerId, couponId]
      );
      
      await client.query('COMMIT');
      
      logger.info(`Coupon distributed: ${couponId} to customer ${customerId}`);
      return this.mapCustomerCouponRow(customerCoupon.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error distributing coupon:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate and redeem coupon
   */
  async redeemCoupon(
    code: string, 
    customerId: string, 
    redemptionAmount: number,
    location?: string
  ): Promise<{
    success: boolean;
    discountAmount: number;
    finalAmount: number;
    customerCoupon: CustomerCoupon;
  }> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get coupon by code
      const coupon = await this.getCouponByCode(code);
      if (!coupon) {
        throw new Error(ERROR_CODES.RESOURCE_NOT_FOUND);
      }
      
      // Validate coupon dates
      const now = new Date();
      if (isBefore(now, coupon.validFrom) || isAfter(now, coupon.validUntil)) {
        throw new Error('Coupon has expired or is not yet valid');
      }
      
      // Check minimum spend requirement
      if (coupon.minSpend && redemptionAmount < coupon.minSpend) {
        throw new Error(`Minimum spend of $${coupon.minSpend} required`);
      }
      
      // Get customer coupon
      const customerCouponResult = await client.query(
        `SELECT * FROM customer_coupons 
         WHERE coupon_id = $1 AND customer_id = $2 AND is_used = false`,
        [coupon.id, customerId]
      );
      
      if (customerCouponResult.rows.length === 0) {
        throw new Error('Coupon not available for this customer');
      }
      
      const customerCoupon = customerCouponResult.rows[0];
      
      // Calculate discount
      let discountAmount = 0;
      
      switch (coupon.type) {
        case COUPON_TYPES.PERCENTAGE:
          discountAmount = (redemptionAmount * coupon.value) / 100;
          if (coupon.maxDiscount) {
            discountAmount = Math.min(discountAmount, coupon.maxDiscount);
          }
          break;
        case COUPON_TYPES.FIXED_AMOUNT:
          discountAmount = Math.min(coupon.value, redemptionAmount);
          break;
        case COUPON_TYPES.FREE_ITEM:
          discountAmount = coupon.value;
          break;
      }
      
      const finalAmount = Math.max(0, redemptionAmount - discountAmount);
      
      // Mark coupon as used
      await client.query(
        `UPDATE customer_coupons 
         SET is_used = true, used_at = NOW(), redeemed_at = NOW(),
             redemption_location = $1, redemption_amount = $2
         WHERE id = $3`,
        [location, redemptionAmount, customerCoupon.id]
      );
      
      // Update coupon usage count
      await client.query(
        'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = $1',
        [coupon.id]
      );
      
      await client.query('COMMIT');
      
      logger.info(`Coupon redeemed: ${code} by customer ${customerId}`);
      
      return {
        success: true,
        discountAmount,
        finalAmount,
        customerCoupon: this.mapCustomerCouponRow({
          ...customerCoupon,
          is_used: true,
          used_at: new Date(),
          redeemed_at: new Date(),
          redemption_location: location,
          redemption_amount: redemptionAmount
        })
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error redeeming coupon:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create distribution rule
   */
  async createDistributionRule(data: {
    couponId: string;
    targetType: 'all' | 'tier' | 'segment' | 'individual';
    targetValue?: string;
    maxDistributions?: number;
  }): Promise<CouponDistributionRule> {
    try {
      const id = uuidv4();
      
      const result = await this.db.query(
        `INSERT INTO coupon_distribution_rules 
         (id, coupon_id, target_type, target_value, max_distributions)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, data.couponId, data.targetType, data.targetValue, data.maxDistributions]
      );
      
      return this.mapDistributionRuleRow(result.rows[0]);
    } catch (error) {
      logger.error('Error creating distribution rule:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get coupon analytics
   */
  async getCouponAnalytics(couponId: string): Promise<{
    totalDistributed: number;
    totalRedeemed: number;
    redemptionRate: number;
    totalDiscountGiven: number;
    recentRedemptions: Array<{
      customerId: string;
      redeemedAt: Date;
      amount: number;
      location?: string;
    }>;
  }> {
    try {
      const distributedResult = await this.db.query(
        'SELECT COUNT(*) as count FROM customer_coupons WHERE coupon_id = $1',
        [couponId]
      );
      
      const redeemedResult = await this.db.query(
        `SELECT COUNT(*) as count, SUM(redemption_amount) as total_amount
         FROM customer_coupons 
         WHERE coupon_id = $1 AND is_used = true`,
        [couponId]
      );
      
      const recentResult = await this.db.query(
        `SELECT customer_id, redeemed_at, redemption_amount, redemption_location
         FROM customer_coupons 
         WHERE coupon_id = $1 AND is_used = true
         ORDER BY redeemed_at DESC LIMIT 10`,
        [couponId]
      );
      
      const totalDistributed = parseInt(distributedResult.rows[0].count);
      const totalRedeemed = parseInt(redeemedResult.rows[0].count);
      const redemptionRate = totalDistributed > 0 ? (totalRedeemed / totalDistributed) * 100 : 0;
      
      return {
        totalDistributed,
        totalRedeemed,
        redemptionRate,
        totalDiscountGiven: parseFloat(redeemedResult.rows[0].total_amount || '0'),
        recentRedemptions: recentResult.rows.map(row => ({
          customerId: row.customer_id,
          redeemedAt: row.redeemed_at,
          amount: parseFloat(row.redemption_amount),
          location: row.redemption_location
        }))
      };
    } catch (error) {
      logger.error('Error getting coupon analytics:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Batch distribute coupons
   */
  async batchDistributeCoupons(
    couponId: string,
    targetType: 'all' | 'tier' | 'segment',
    targetValue?: string
  ): Promise<{ distributed: number; errors: string[] }> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      let customersQuery = 'SELECT id FROM customer_profiles WHERE 1=1';
      const queryParams: string[] = [];
      
      if (targetType === 'tier' && targetValue) {
        customersQuery += ' AND tier = $1';
        queryParams.push(targetValue);
      }
      
      const customersResult = await client.query(customersQuery, queryParams);
      
      let distributed = 0;
      const errors: string[] = [];
      
      for (const customer of customersResult.rows) {
        try {
          await this.distributeCoupon(couponId, customer.id);
          distributed++;
        } catch (error) {
          errors.push(`Customer ${customer.id}: ${error.message}`);
        }
      }
      
      await client.query('COMMIT');
      
      logger.info(`Batch distribution completed: ${distributed} coupons distributed`);
      return { distributed, errors };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error in batch distribution:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Generate unique coupon code
   */
  private generateCouponCode(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  /**
   * Map database row to Coupon object
   */
  private mapCouponRow(row: any): Coupon {
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      type: row.type,
      category: row.category,
      value: parseFloat(row.value),
      minSpend: row.min_spend ? parseFloat(row.min_spend) : undefined,
      maxDiscount: row.max_discount ? parseFloat(row.max_discount) : undefined,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      usageLimit: row.usage_limit,
      usageCount: row.usage_count || 0,
      isActive: row.is_active,
      terms: row.terms,
      imageUrl: row.image_url,
      qrCode: row.qr_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Map database row to CustomerCoupon object
   */
  private mapCustomerCouponRow(row: any): CustomerCoupon {
    return {
      id: row.id,
      customerId: row.customer_id,
      couponId: row.coupon_id,
      isUsed: row.is_used,
      usedAt: row.used_at,
      redeemedAt: row.redeemed_at,
      redemptionLocation: row.redemption_location,
      redemptionAmount: row.redemption_amount ? parseFloat(row.redemption_amount) : undefined,
      createdAt: row.created_at
    };
  }

  /**
   * Map database row to CouponDistributionRule object
   */
  private mapDistributionRuleRow(row: any): CouponDistributionRule {
    return {
      id: row.id,
      couponId: row.coupon_id,
      targetType: row.target_type,
      targetValue: row.target_value,
      maxDistributions: row.max_distributions,
      distributionCount: row.distribution_count || 0,
      isActive: row.is_active,
      createdAt: row.created_at
    };
  }
}