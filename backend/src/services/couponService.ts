import { query, getClient } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import {
  Coupon,
  UserCoupon,
  CouponRedemption,
  CouponAnalytics,
  UserActiveCoupon,
  CreateCouponRequest,
  UpdateCouponRequest,
  AssignCouponRequest,
  RedeemCouponRequest,
  RedeemCouponResponse,
  CouponListResponse,
  UserCouponListResponse,
  CouponAnalyticsResponse,
  CouponStatsResponse,
  CouponType,
  CouponStatus
  // UserCouponStatus
} from '../types/coupon';

export class CouponService {
  // Create a new coupon
  async createCoupon(data: CreateCouponRequest, createdBy: string): Promise<Coupon> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Check if code already exists
      const [existingCoupon] = await query<{ id: string }>(
        'SELECT id FROM coupons WHERE code = $1',
        [data.code]
      );

      if (existingCoupon) {
        throw new AppError(409, 'Coupon code already exists');
      }

      // Create coupon
      const [coupon] = await client.query<Coupon>(
        `INSERT INTO coupons (
          code, name, description, terms_and_conditions, type, value, currency,
          minimum_spend, maximum_discount, valid_from, valid_until, usage_limit,
          usage_limit_per_user, tier_restrictions, customer_segment, created_by,
          original_language, available_languages
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING 
          id, code, name, description, 
          terms_and_conditions as "termsAndConditions",
          type, value, currency, minimum_spend as "minimumSpend",
          maximum_discount as "maximumDiscount", valid_from as "validFrom",
          valid_until as "validUntil", usage_limit as "usageLimit",
          usage_limit_per_user as "usageLimitPerUser", used_count as "usedCount",
          tier_restrictions as "tierRestrictions", customer_segment as "customerSegment",
          status, created_by as "createdBy", created_at as "createdAt", 
          updated_at as "updatedAt"`,
        [
          data.code,
          data.name,
          data.description ?? null,
          data.termsAndConditions ?? null,
          data.type,
          data.value ?? null,
          data.currency ?? 'THB',
          data.minimumSpend ?? null,
          data.maximumDiscount ?? null,
          data.validFrom ?? new Date(),
          data.validUntil ?? null,
          data.usageLimit ?? null,
          data.usageLimitPerUser ?? 1,
          JSON.stringify(data.tierRestrictions ?? []),
          JSON.stringify(data.customerSegment ?? {}),
          createdBy,
          (data as any).originalLanguage ?? 'th',
          JSON.stringify([(data as any).originalLanguage ?? 'th'])
        ]
      ).then(res => res.rows);

      await client.query('COMMIT');

      logger.info(`Coupon created: ${coupon.code} by user ${createdBy}`);
      return coupon;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Update coupon
  async updateCoupon(couponId: string, data: UpdateCouponRequest, updatedBy: string): Promise<Coupon> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Check if coupon exists
      const [existingCoupon] = await query<Coupon>(
        'SELECT * FROM coupons WHERE id = $1',
        [couponId]
      );

      if (!existingCoupon) {
        throw new AppError(404, 'Coupon not found');
      }

      // Check if code is being changed and already exists
      if (data.code && data.code !== existingCoupon.code) {
        const [codeExists] = await query<{ id: string }>(
          'SELECT id FROM coupons WHERE code = $1 AND id != $2',
          [data.code, couponId]
        );

        if (codeExists) {
          throw new AppError(409, 'Coupon code already exists');
        }
      }

      // Build update query dynamically
      const updateFields: string[] = [];
      const updateValues: any[] = [couponId];
      let paramIndex = 2;

      const fieldsMap = {
        code: 'code',
        name: 'name',
        description: 'description',
        termsAndConditions: 'terms_and_conditions',
        type: 'type',
        value: 'value',
        currency: 'currency',
        minimumSpend: 'minimum_spend',
        maximumDiscount: 'maximum_discount',
        validFrom: 'valid_from',
        validUntil: 'valid_until',
        usageLimit: 'usage_limit',
        usageLimitPerUser: 'usage_limit_per_user',
        status: 'status'
      };

      for (const [key, dbField] of Object.entries(fieldsMap)) {
        if (data[key as keyof UpdateCouponRequest] !== undefined) {
          updateFields.push(`${dbField} = $${paramIndex}`);
          updateValues.push(data[key as keyof UpdateCouponRequest]);
          paramIndex++;
        }
      }

      // Handle JSON fields separately
      if (data.tierRestrictions !== undefined) {
        updateFields.push(`tier_restrictions = $${paramIndex}`);
        updateValues.push(JSON.stringify(data.tierRestrictions));
        paramIndex++;
      }

      if (data.customerSegment !== undefined) {
        updateFields.push(`customer_segment = $${paramIndex}`);
        updateValues.push(JSON.stringify(data.customerSegment));
        paramIndex++;
      }

      if (updateFields.length === 0) {
        throw new AppError(400, 'No fields to update');
      }

      updateFields.push('updated_at = NOW()');

      const [updatedCoupon] = await client.query<Coupon>(
        `UPDATE coupons SET ${updateFields.join(', ')} WHERE id = $1
         RETURNING 
           id, code, name, description, 
           terms_and_conditions as "termsAndConditions",
           type, value, currency, minimum_spend as "minimumSpend",
           maximum_discount as "maximumDiscount", valid_from as "validFrom",
           valid_until as "validUntil", usage_limit as "usageLimit",
           usage_limit_per_user as "usageLimitPerUser", used_count as "usedCount",
           tier_restrictions as "tierRestrictions", customer_segment as "customerSegment",
           status, created_by as "createdBy", created_at as "createdAt", 
           updated_at as "updatedAt"`,
        updateValues
      ).then(res => res.rows);

      await client.query('COMMIT');

      logger.info(`Coupon updated: ${updatedCoupon.code} by user ${updatedBy}`);
      return updatedCoupon;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get coupon by ID
  async getCouponById(couponId: string): Promise<Coupon | null> {
    const [coupon] = await query<Coupon>(
      `SELECT 
         id, code, name, description, 
         terms_and_conditions as "termsAndConditions",
         type, value, currency, minimum_spend as "minimumSpend",
         maximum_discount as "maximumDiscount", valid_from as "validFrom",
         valid_until as "validUntil", usage_limit as "usageLimit",
         usage_limit_per_user as "usageLimitPerUser", used_count as "usedCount",
         tier_restrictions as "tierRestrictions", customer_segment as "customerSegment",
         status, created_by as "createdBy", created_at as "createdAt", 
         updated_at as "updatedAt"
       FROM coupons WHERE id = $1`,
      [couponId]
    );

    return coupon ?? null;
  }

  // Get coupon with translations for a specific language
  async getCouponWithTranslations(couponId: string, language?: string): Promise<Coupon | null> {
    try {
      let coupon: any;
      
      if (language && language !== 'th') {
        // Try to get translated version first
        const [translatedCoupon] = await query<any>(
          `SELECT c.*, ct.name as translated_name, ct.description as translated_description, 
           ct.terms_and_conditions as translated_terms_and_conditions 
           FROM coupons c 
           LEFT JOIN coupon_translations ct ON c.id = ct.coupon_id AND ct.language = $2 
           WHERE c.id = $1`,
          [couponId, language]
        );
        
        if (translatedCoupon) {
          coupon = {
            ...translatedCoupon,
            name: translatedCoupon.translated_name || translatedCoupon.name,
            description: translatedCoupon.translated_description || translatedCoupon.description,
            termsAndConditions: translatedCoupon.translated_terms_and_conditions || translatedCoupon.terms_and_conditions
          };
        }
      }
      
      if (!coupon) {
        // Fallback to original coupon
        coupon = await this.getCouponById(couponId);
      }

      return coupon;
    } catch (error) {
      logger.error('Error getting coupon with translations:', error);
      return null;
    }
  }

  // Get coupon by code
  async getCouponByCode(code: string): Promise<Coupon | null> {
    const [coupon] = await query<Coupon>(
      `SELECT 
         id, code, name, description, 
         terms_and_conditions as "termsAndConditions",
         type, value, currency, minimum_spend as "minimumSpend",
         maximum_discount as "maximumDiscount", valid_from as "validFrom",
         valid_until as "validUntil", usage_limit as "usageLimit",
         usage_limit_per_user as "usageLimitPerUser", used_count as "usedCount",
         tier_restrictions as "tierRestrictions", customer_segment as "customerSegment",
         status, created_by as "createdBy", created_at as "createdAt", 
         updated_at as "updatedAt"
       FROM coupons WHERE code = $1`,
      [code]
    );

    return coupon ?? null;
  }

  // List coupons with filtering and pagination
  async listCoupons(
    page: number = 1,
    limit: number = 20,
    filters: {
      status?: CouponStatus;
      type?: CouponType;
      search?: string;
      createdBy?: string;
    } = {}
  ): Promise<CouponListResponse> {
    const offset = (page - 1) * limit;
    
    // Build WHERE clause
    const whereConditions: string[] = [];
    const whereValues: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      whereConditions.push(`status = $${paramIndex}`);
      whereValues.push(filters.status);
      paramIndex++;
    }

    if (filters.type) {
      whereConditions.push(`type = $${paramIndex}`);
      whereValues.push(filters.type);
      paramIndex++;
    }

    if (filters.search) {
      whereConditions.push(`(code ILIKE $${paramIndex} OR name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
      whereValues.push(`%${filters.search}%`);
      paramIndex++;
    }

    if (filters.createdBy) {
      whereConditions.push(`created_by = $${paramIndex}`);
      whereValues.push(filters.createdBy);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const [countResult] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM coupons ${whereClause}`,
      whereValues
    );

    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);

    // Get coupons
    const coupons = await query<Coupon>(
      `SELECT 
         id, code, name, description, 
         terms_and_conditions as "termsAndConditions",
         type, value, currency, minimum_spend as "minimumSpend",
         maximum_discount as "maximumDiscount", valid_from as "validFrom",
         valid_until as "validUntil", usage_limit as "usageLimit",
         usage_limit_per_user as "usageLimitPerUser", used_count as "usedCount",
         tier_restrictions as "tierRestrictions", customer_segment as "customerSegment",
         status, created_by as "createdBy", created_at as "createdAt", 
         updated_at as "updatedAt"
       FROM coupons 
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...whereValues, limit, offset]
    );

    return {
      coupons,
      total,
      page,
      limit,
      totalPages
    };
  }

  // Assign coupon to users
  async assignCouponToUsers(data: AssignCouponRequest, assignedBy: string): Promise<UserCoupon[]> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      const userCoupons: UserCoupon[] = [];

      for (const userId of data.userIds) {
        try {
          const [userCouponId] = await client.query<{ assign_coupon_to_user: string }>(
            'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as assign_coupon_to_user',
            [data.couponId, userId, assignedBy, data.assignedReason, data.customExpiry]
          ).then(res => res.rows);

          // Get the created user coupon
          const [userCoupon] = await client.query<UserCoupon>(
            `SELECT 
               id, user_id as "userId", coupon_id as "couponId",
               status, qr_code as "qrCode", used_at as "usedAt",
               used_by_admin as "usedByAdmin", redemption_location as "redemptionLocation",
               redemption_details as "redemptionDetails", assigned_by as "assignedBy",
               assigned_reason as "assignedReason", expires_at as "expiresAt",
               created_at as "createdAt", updated_at as "updatedAt"
             FROM user_coupons WHERE id = $1`,
            [userCouponId.assign_coupon_to_user]
          ).then(res => res.rows);

          userCoupons.push(userCoupon);
        } catch (error: any) {
          logger.warn(`Failed to assign coupon ${data.couponId} to user ${userId}: ${error.message}`);
          // Continue with other users instead of failing the entire batch
        }
      }

      await client.query('COMMIT');

      logger.info(`Assigned coupon ${data.couponId} to ${userCoupons.length} users by ${assignedBy}`);
      return userCoupons;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Redeem coupon by QR code
  async redeemCoupon(data: RedeemCouponRequest, redeemedBy?: string): Promise<RedeemCouponResponse> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      const [result] = await client.query<RedeemCouponResponse>(
        `SELECT 
           success, message, discount_amount as "discountAmount",
           final_amount as "finalAmount", user_coupon_id as "userCouponId"
         FROM redeem_coupon($1, $2, $3, $4, $5, $6)`,
        [
          data.qrCode,
          data.originalAmount,
          redeemedBy,
          data.transactionReference,
          data.location,
          JSON.stringify(data.metadata ?? {})
        ]
      ).then(res => res.rows);

      await client.query('COMMIT');

      if (result.success) {
        logger.info(`Coupon redeemed successfully: QR ${data.qrCode} by ${redeemedBy || 'system'}`);
      } else {
        logger.warn(`Coupon redemption failed: QR ${data.qrCode} - ${result.message}`);
      }

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user coupon by QR code
  async getUserCouponByQR(qrCode: string): Promise<UserActiveCoupon | null> {
    const [userCoupon] = await query<UserActiveCoupon>(
      `SELECT 
         user_coupon_id as "userCouponId", user_id as "userId", status,
         qr_code as "qrCode", expires_at as "expiresAt", assigned_at as "assignedAt",
         coupon_id as "couponId", code, name, description,
         terms_and_conditions as "termsAndConditions", type, value, currency,
         minimum_spend as "minimumSpend", maximum_discount as "maximumDiscount",
         coupon_expires_at as "couponExpiresAt", effective_expiry as "effectiveExpiry",
         expiring_soon as "expiringSoon"
       FROM user_active_coupons 
       WHERE qr_code = $1`,
      [qrCode]
    );

    return userCoupon ?? null;
  }

  // Get user's active coupons
  async getUserActiveCoupons(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<UserCouponListResponse> {
    const offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM user_active_coupons WHERE user_id = $1',
      [userId]
    );

    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);

    // Get user coupons
    const coupons = await query<UserActiveCoupon>(
      `SELECT 
         user_coupon_id as "userCouponId", user_id as "userId", status,
         qr_code as "qrCode", expires_at as "expiresAt", assigned_at as "assignedAt",
         coupon_id as "couponId", code, name, description,
         terms_and_conditions as "termsAndConditions", type, value, currency,
         minimum_spend as "minimumSpend", maximum_discount as "maximumDiscount",
         coupon_expires_at as "couponExpiresAt", effective_expiry as "effectiveExpiry",
         expiring_soon as "expiringSoon"
       FROM user_active_coupons 
       WHERE user_id = $1
       ORDER BY assigned_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return {
      coupons,
      total,
      page,
      limit,
      totalPages
    };
  }

  // Get coupon redemption history
  async getCouponRedemptions(
    couponId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ redemptions: CouponRedemption[]; total: number; page: number; limit: number; totalPages: number }> {
    const offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await query<{ count: number }>(
      `SELECT COUNT(*) as count 
       FROM coupon_redemptions cr
       JOIN user_coupons uc ON cr.user_coupon_id = uc.id
       WHERE uc.coupon_id = $1`,
      [couponId]
    );

    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);

    // Get redemptions
    const redemptions = await query<CouponRedemption>(
      `SELECT 
         cr.id, cr.user_coupon_id as "userCouponId",
         cr.original_amount as "originalAmount", cr.discount_amount as "discountAmount",
         cr.final_amount as "finalAmount", cr.currency,
         cr.transaction_reference as "transactionReference",
         cr.redemption_channel as "redemptionChannel",
         cr.staff_member_id as "staffMemberId", cr.location,
         cr.metadata, cr.created_at as "createdAt"
       FROM coupon_redemptions cr
       JOIN user_coupons uc ON cr.user_coupon_id = uc.id
       WHERE uc.coupon_id = $1
       ORDER BY cr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [couponId, limit, offset]
    );

    return {
      redemptions,
      total,
      page,
      limit,
      totalPages
    };
  }

  // Get coupon analytics
  async getCouponAnalytics(
    couponId?: string,
    startDate?: Date,
    endDate?: Date,
    page: number = 1,
    limit: number = 20
  ): Promise<CouponAnalyticsResponse> {
    const offset = (page - 1) * limit;
    
    // Build WHERE clause
    const whereConditions: string[] = [];
    const whereValues: any[] = [];
    let paramIndex = 1;

    if (couponId) {
      whereConditions.push(`coupon_id = $${paramIndex}`);
      whereValues.push(couponId);
      paramIndex++;
    }

    if (startDate) {
      whereConditions.push(`analytics_date >= $${paramIndex}`);
      whereValues.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`analytics_date <= $${paramIndex}`);
      whereValues.push(endDate);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const [countResult] = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM coupon_analytics ${whereClause}`,
      whereValues
    );

    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);

    // Get analytics
    const analytics = await query<CouponAnalytics>(
      `SELECT 
         id, coupon_id as "couponId", analytics_date as "analyticsDate",
         total_assigned as "totalAssigned", total_used as "totalUsed",
         total_expired as "totalExpired", total_revenue_impact as "totalRevenueImpact",
         unique_users_assigned as "uniqueUsersAssigned",
         unique_users_redeemed as "uniqueUsersRedeemed",
         average_time_to_redemption as "averageTimeToRedemption",
         conversion_rate as "conversionRate", created_at as "createdAt"
       FROM coupon_analytics 
       ${whereClause}
       ORDER BY analytics_date DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...whereValues, limit, offset]
    );

    return {
      analytics,
      total,
      page,
      limit,
      totalPages
    };
  }

  // Get coupon statistics dashboard
  async getCouponStats(): Promise<CouponStatsResponse> {
    // Get overall stats
    const [overallStats] = await query<{
      totalCoupons: number;
      activeCoupons: number;
      totalAssigned: number;
      totalRedeemed: number;
    }>(
      `SELECT 
         COUNT(*) as "totalCoupons",
         COUNT(*) FILTER (WHERE status = 'active') as "activeCoupons",
         COALESCE(SUM(used_count), 0) as "totalRedeemed",
         (SELECT COUNT(*) FROM user_coupons) as "totalAssigned"
       FROM coupons`
    );

    // Calculate conversion rate
    const conversionRate = overallStats.totalAssigned > 0 
      ? Number(((overallStats.totalRedeemed / overallStats.totalAssigned) * 100).toFixed(2))
      : 0;

    // Get total revenue impact
    const [revenueResult] = await query<{ totalRevenueImpact: number }>(
      `SELECT COALESCE(SUM(discount_amount), 0) as "totalRevenueImpact"
       FROM coupon_redemptions`
    );

    // Get top performing coupons
    const topCoupons = await query<{
      couponId: string;
      name: string;
      code: string;
      redemptionCount: number;
      conversionRate: number;
    }>(
      `SELECT 
         c.id as "couponId", c.name, c.code,
         c.used_count as "redemptionCount",
         CASE 
           WHEN (SELECT COUNT(*) FROM user_coupons WHERE coupon_id = c.id) > 0 THEN
             ROUND((c.used_count::DECIMAL / (SELECT COUNT(*) FROM user_coupons WHERE coupon_id = c.id) * 100), 2)
           ELSE 0
         END as "conversionRate"
       FROM coupons c
       WHERE c.status = 'active' AND c.used_count > 0
       ORDER BY c.used_count DESC
       LIMIT 5`
    );

    return {
      totalCoupons: overallStats.totalCoupons,
      activeCoupons: overallStats.activeCoupons,
      totalAssigned: overallStats.totalAssigned,
      totalRedeemed: overallStats.totalRedeemed,
      totalRevenueImpact: revenueResult.totalRevenueImpact,
      conversionRate,
      topCoupons
    };
  }

  // Update daily analytics (typically run as a scheduled job)
  async updateDailyAnalytics(date?: Date): Promise<number> {
    const analyticsDate = date ?? new Date();
    
    const [result] = await query<{ update_coupon_analytics: number }>(
      'SELECT update_coupon_analytics($1) as update_coupon_analytics',
      [analyticsDate]
    );

    logger.info(`Updated coupon analytics for ${analyticsDate.toISOString().split('T')[0]}: ${result.update_coupon_analytics} coupons processed`);
    
    return result.update_coupon_analytics;
  }

  // Delete coupon (soft delete by changing status)
  async deleteCoupon(couponId: string, deletedBy: string): Promise<boolean> {
    const [result] = await query<{ updated: boolean }>(
      `UPDATE coupons 
       SET status = 'expired', updated_at = NOW() 
       WHERE id = $1 AND status != 'expired'
       RETURNING true as updated`,
      [couponId]
    );

    if (result) {
      logger.info(`Coupon ${couponId} deleted by ${deletedBy}`);
      return true;
    }

    return false;
  }

  // Get coupon assignments (admin only)
  async getCouponAssignments(
    couponId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    assignments: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      assignedCount: number;
      usedCount: number;
      availableCount: number;
      latestAssignment: Date;
    }>;
    summary: {
      totalUsers: number;
      totalAssigned: number;
      totalUsed: number;
      totalAvailable: number;
    };
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const offset = (page - 1) * limit;

    // Get total count of unique users assigned this coupon
    const [countResult] = await query<{ count: number }>(
      `SELECT COUNT(DISTINCT uc.user_id) as count 
       FROM user_coupons uc
       WHERE uc.coupon_id = $1`,
      [couponId]
    );

    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);

    // Get overall summary statistics
    const [summaryResult] = await query<{
      totalUsers: number;
      totalAssigned: number;
      totalUsed: number;
      totalAvailable: number;
    }>(
      `SELECT 
         COUNT(DISTINCT uc.user_id) as "totalUsers",
         COUNT(*) as "totalAssigned",
         COUNT(*) FILTER (WHERE uc.status = 'used') as "totalUsed",
         COUNT(*) FILTER (WHERE uc.status = 'available') as "totalAvailable"
       FROM user_coupons uc
       WHERE uc.coupon_id = $1`,
      [couponId]
    );

    // Get user assignments with aggregated statistics
    const assignments = await query<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      assignedCount: number;
      usedCount: number;
      availableCount: number;
      latestAssignment: Date;
    }>(
      `SELECT 
         u.id as "userId",
         COALESCE(up.first_name, '') as "firstName", 
         COALESCE(up.last_name, '') as "lastName",
         u.email,
         COUNT(*) as "assignedCount",
         COUNT(*) FILTER (WHERE uc.status = 'used') as "usedCount",
         COUNT(*) FILTER (WHERE uc.status = 'available') as "availableCount",
         MAX(uc.created_at) as "latestAssignment"
       FROM user_coupons uc
       JOIN users u ON uc.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE uc.coupon_id = $1
       GROUP BY u.id, up.first_name, up.last_name, u.email
       ORDER BY MAX(uc.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [couponId, limit, offset]
    );

    return {
      assignments,
      summary: summaryResult,
      total,
      page,
      limit,
      totalPages
    };
  }

  // Revoke all available coupons for a user and coupon
  async revokeUserCouponsForCoupon(userId: string, couponId: string, revokedBy: string, reason?: string): Promise<number> {
    const result = await query<{ id: string }>(
      `UPDATE user_coupons 
       SET status = 'revoked', 
           redemption_details = COALESCE(redemption_details, '{}') || $3,
           updated_at = NOW()
       WHERE user_id = $1 AND coupon_id = $2 AND status = 'available'
       RETURNING id`,
      [userId, couponId, JSON.stringify({ revokedBy, reason, revokedAt: new Date() })]
    );

    const revokedCount = result.length;
    
    if (revokedCount > 0) {
      logger.info(`Revoked ${revokedCount} coupons for user ${userId} and coupon ${couponId} by ${revokedBy}: ${reason || 'No reason provided'}`);
    }
    
    return revokedCount;
  }

  // Revoke user coupon
  async revokeUserCoupon(userCouponId: string, revokedBy: string, reason?: string): Promise<boolean> {
    const [result] = await query<{ updated: boolean }>(
      `UPDATE user_coupons 
       SET status = 'revoked', 
           redemption_details = COALESCE(redemption_details, '{}') || $3,
           updated_at = NOW()
       WHERE id = $1 AND status = 'available'
       RETURNING true as updated`,
      [userCouponId, revokedBy, JSON.stringify({ revokedBy, reason, revokedAt: new Date() })]
    );

    if (result) {
      logger.info(`User coupon ${userCouponId} revoked by ${revokedBy}: ${reason || 'No reason provided'}`);
      return true;
    }

    return false;
  }
}

export const couponService = new CouponService();