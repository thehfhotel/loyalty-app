import { Pool } from 'pg';
import { 
  Customer, 
  CustomerProfile, 
  CustomerUpdateRequest, 
  CustomerSearch, 
  CustomerStats,
  CustomerActivity,
  CustomerAdminUpdate,
  CustomerAPI,
  Tier
} from '@hotel-loyalty/shared/types/customer';
import { db } from '../config/database.js';

export class CustomerService implements CustomerAPI {
  private pool: Pool;

  constructor(pool: Pool = db) {
    this.pool = pool;
  }

  /**
   * Get customer by ID with profile and tier information
   */
  async getCustomer(id: string): Promise<Customer> {
    const query = `
      SELECT 
        u.id,
        u.email,
        u.first_name as "firstName",
        u.last_name as "lastName",
        u.phone,
        u.date_of_birth as "dateOfBirth",
        u.is_active as "isActive",
        u.email_verified as "emailVerified",
        u.created_at as "createdAt",
        u.updated_at as "updatedAt",
        cp.id as "profileId",
        cp.tier_id as "tierId",
        cp.points_balance as "pointsBalance",
        cp.lifetime_points as "lifetimePoints",
        cp.total_spent as "totalSpent",
        cp.stay_count as "stayCount",
        cp.preferences,
        cp.created_at as "profileCreatedAt",
        cp.updated_at as "profileUpdatedAt",
        t.id as "tierDetailId",
        t.name as "tierName",
        t.description as "tierDescription",
        t.min_points as "tierMinPoints",
        t.max_points as "tierMaxPoints",
        t.benefits as "tierBenefits",
        t.color as "tierColor",
        t.icon as "tierIcon",
        t.is_active as "tierIsActive",
        t.created_at as "tierCreatedAt",
        t.updated_at as "tierUpdatedAt"
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN tiers t ON cp.tier_id = t.id
      WHERE u.id = $1
    `;

    const result = await this.pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      throw new Error('Customer not found');
    }

    const row = result.rows[0];
    
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone || undefined,
      dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : undefined,
      isActive: row.isActive,
      emailVerified: row.emailVerified,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      profile: {
        id: row.profileId,
        userId: row.id,
        tierId: row.tierId,
        pointsBalance: row.pointsBalance || 0,
        lifetimePoints: row.lifetimePoints || 0,
        totalSpent: parseFloat(row.totalSpent) || 0,
        stayCount: row.stayCount || 0,
        preferences: row.preferences || {},
        createdAt: new Date(row.profileCreatedAt),
        updatedAt: new Date(row.profileUpdatedAt),
      },
      tier: {
        id: row.tierDetailId,
        name: row.tierName,
        description: row.tierDescription,
        minPoints: row.tierMinPoints,
        maxPoints: row.tierMaxPoints,
        benefits: row.tierBenefits || [],
        color: row.tierColor,
        icon: row.tierIcon,
        isActive: row.tierIsActive,
        createdAt: new Date(row.tierCreatedAt),
        updatedAt: new Date(row.tierUpdatedAt),
      },
    };
  }

  /**
   * Get customer by email
   */
  async getCustomerByEmail(email: string): Promise<Customer | null> {
    try {
      const query = `
        SELECT u.id 
        FROM users u 
        WHERE u.email = $1
      `;
      
      const result = await this.pool.query(query, [email]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.getCustomer(result.rows[0].id);
    } catch (error) {
      if (error instanceof Error && error.message === 'Customer not found') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get customer profile by user ID
   */
  async getCustomerProfile(userId: string): Promise<CustomerProfile> {
    const query = `
      SELECT 
        id,
        user_id as "userId",
        tier_id as "tierId",
        points_balance as "pointsBalance",
        lifetime_points as "lifetimePoints",
        total_spent as "totalSpent",
        stay_count as "stayCount",
        preferences,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM customer_profiles
      WHERE user_id = $1
    `;

    const result = await this.pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      throw new Error('Customer profile not found');
    }

    const row = result.rows[0];
    
    return {
      id: row.id,
      userId: row.userId,
      tierId: row.tierId,
      pointsBalance: row.pointsBalance,
      lifetimePoints: row.lifetimePoints,
      totalSpent: parseFloat(row.totalSpent),
      stayCount: row.stayCount,
      preferences: row.preferences,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  /**
   * Get customer tier information
   */
  async getCustomerTier(id: string): Promise<Tier> {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.description,
        t.min_points as "minPoints",
        t.max_points as "maxPoints",
        t.benefits,
        t.color,
        t.icon,
        t.is_active as "isActive",
        t.created_at as "createdAt",
        t.updated_at as "updatedAt"
      FROM tiers t
      JOIN customer_profiles cp ON t.id = cp.tier_id
      JOIN users u ON cp.user_id = u.id
      WHERE u.id = $1
    `;

    const result = await this.pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      throw new Error('Customer tier not found');
    }

    const row = result.rows[0];
    
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      minPoints: row.minPoints,
      maxPoints: row.maxPoints,
      benefits: row.benefits || [],
      color: row.color,
      icon: row.icon,
      isActive: row.isActive,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  /**
   * Check if customer is active
   */
  async isCustomerActive(id: string): Promise<boolean> {
    const query = 'SELECT is_active FROM users WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      throw new Error('Customer not found');
    }
    
    return result.rows[0].is_active;
  }

  /**
   * Update customer profile information
   */
  async updateCustomer(id: string, updateData: CustomerUpdateRequest): Promise<Customer> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Update user table
      const userFields = [];
      const userValues = [];
      let userParamCount = 1;

      if (updateData.firstName !== undefined) {
        userFields.push(`first_name = $${userParamCount++}`);
        userValues.push(updateData.firstName);
      }
      if (updateData.lastName !== undefined) {
        userFields.push(`last_name = $${userParamCount++}`);
        userValues.push(updateData.lastName);
      }
      if (updateData.phone !== undefined) {
        userFields.push(`phone = $${userParamCount++}`);
        userValues.push(updateData.phone);
      }
      if (updateData.dateOfBirth !== undefined) {
        userFields.push(`date_of_birth = $${userParamCount++}`);
        userValues.push(updateData.dateOfBirth);
      }

      if (userFields.length > 0) {
        userFields.push(`updated_at = CURRENT_TIMESTAMP`);
        userValues.push(id);
        
        const userQuery = `
          UPDATE users 
          SET ${userFields.join(', ')} 
          WHERE id = $${userParamCount}
        `;
        
        await client.query(userQuery, userValues);
      }

      // Update customer profile if preferences provided
      if (updateData.preferences !== undefined) {
        const profileQuery = `
          UPDATE customer_profiles 
          SET preferences = $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2
        `;
        
        await client.query(profileQuery, [updateData.preferences, id]);
      }

      await client.query('COMMIT');
      
      return this.getCustomer(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update customer points balance
   */
  async updateCustomerPoints(id: string, points: number, description: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get customer profile ID
      const profileQuery = 'SELECT id FROM customer_profiles WHERE user_id = $1';
      const profileResult = await client.query(profileQuery, [id]);
      
      if (profileResult.rows.length === 0) {
        throw new Error('Customer profile not found');
      }
      
      const customerProfileId = profileResult.rows[0].id;

      // Insert points transaction
      const transactionQuery = `
        INSERT INTO points_transactions (
          customer_profile_id, 
          type, 
          amount, 
          description,
          reference_type
        ) VALUES ($1, $2, $3, $4, $5)
      `;
      
      const transactionType = points > 0 ? 'earned' : 'adjusted';
      
      await client.query(transactionQuery, [
        customerProfileId,
        transactionType,
        points,
        description,
        'manual'
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Search customers with filters and pagination
   */
  async searchCustomers(searchParams: CustomerSearch): Promise<{
    customers: Customer[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      query,
      tier,
      isActive,
      minPoints,
      maxPoints,
      minSpent,
      maxSpent,
      registeredAfter,
      registeredBefore,
      page,
      limit,
      sortBy,
      sortOrder
    } = searchParams;

    // Build WHERE conditions
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (query) {
      conditions.push(`(
        u.first_name ILIKE $${paramCount} OR 
        u.last_name ILIKE $${paramCount} OR 
        u.email ILIKE $${paramCount}
      )`);
      values.push(`%${query}%`);
      paramCount++;
    }

    if (tier) {
      conditions.push(`cp.tier_id = $${paramCount}`);
      values.push(tier);
      paramCount++;
    }

    if (isActive !== undefined) {
      conditions.push(`u.is_active = $${paramCount}`);
      values.push(isActive);
      paramCount++;
    }

    if (minPoints !== undefined) {
      conditions.push(`cp.points_balance >= $${paramCount}`);
      values.push(minPoints);
      paramCount++;
    }

    if (maxPoints !== undefined) {
      conditions.push(`cp.points_balance <= $${paramCount}`);
      values.push(maxPoints);
      paramCount++;
    }

    if (minSpent !== undefined) {
      conditions.push(`cp.total_spent >= $${paramCount}`);
      values.push(minSpent);
      paramCount++;
    }

    if (maxSpent !== undefined) {
      conditions.push(`cp.total_spent <= $${paramCount}`);
      values.push(maxSpent);
      paramCount++;
    }

    if (registeredAfter) {
      conditions.push(`u.created_at >= $${paramCount}`);
      values.push(registeredAfter);
      paramCount++;
    }

    if (registeredBefore) {
      conditions.push(`u.created_at <= $${paramCount}`);
      values.push(registeredBefore);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Build ORDER BY clause
    const sortMapping = {
      name: 'u.first_name',
      email: 'u.email',
      points: 'cp.points_balance',
      spent: 'cp.total_spent',
      created: 'u.created_at'
    };

    const orderByClause = `ORDER BY ${sortMapping[sortBy]} ${sortOrder.toUpperCase()}`;

    // Get total count
    const countQuery = `
      SELECT COUNT(*)
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN tiers t ON cp.tier_id = t.id
      ${whereClause}
    `;

    const countResult = await this.pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const offset = (page - 1) * limit;
    values.push(limit, offset);

    const dataQuery = `
      SELECT 
        u.id,
        u.email,
        u.first_name as "firstName",
        u.last_name as "lastName",
        u.phone,
        u.date_of_birth as "dateOfBirth",
        u.is_active as "isActive",
        u.email_verified as "emailVerified",
        u.created_at as "createdAt",
        u.updated_at as "updatedAt",
        cp.id as "profileId",
        cp.tier_id as "tierId",
        cp.points_balance as "pointsBalance",
        cp.lifetime_points as "lifetimePoints",
        cp.total_spent as "totalSpent",
        cp.stay_count as "stayCount",
        cp.preferences,
        cp.created_at as "profileCreatedAt",
        cp.updated_at as "profileUpdatedAt",
        t.id as "tierDetailId",
        t.name as "tierName",
        t.description as "tierDescription",
        t.min_points as "tierMinPoints",
        t.max_points as "tierMaxPoints",
        t.benefits as "tierBenefits",
        t.color as "tierColor",
        t.icon as "tierIcon",
        t.is_active as "tierIsActive",
        t.created_at as "tierCreatedAt",
        t.updated_at as "tierUpdatedAt"
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN tiers t ON cp.tier_id = t.id
      ${whereClause}
      ${orderByClause}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const dataResult = await this.pool.query(dataQuery, values);

    const customers = dataResult.rows.map(row => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone || undefined,
      dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : undefined,
      isActive: row.isActive,
      emailVerified: row.emailVerified,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      profile: {
        id: row.profileId,
        userId: row.id,
        tierId: row.tierId,
        pointsBalance: row.pointsBalance || 0,
        lifetimePoints: row.lifetimePoints || 0,
        totalSpent: parseFloat(row.totalSpent) || 0,
        stayCount: row.stayCount || 0,
        preferences: row.preferences || {},
        createdAt: new Date(row.profileCreatedAt),
        updatedAt: new Date(row.profileUpdatedAt),
      },
      tier: {
        id: row.tierDetailId,
        name: row.tierName,
        description: row.tierDescription,
        minPoints: row.tierMinPoints,
        maxPoints: row.tierMaxPoints,
        benefits: row.tierBenefits || [],
        color: row.tierColor,
        icon: row.tierIcon,
        isActive: row.tierIsActive,
        createdAt: new Date(row.tierCreatedAt),
        updatedAt: new Date(row.tierUpdatedAt),
      },
    }));

    return {
      customers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get customer statistics for admin dashboard
   */
  async getCustomerStats(): Promise<CustomerStats> {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE u.is_active = true) as active_customers,
        COALESCE(SUM(cp.points_balance), 0) as total_points,
        COALESCE(SUM(cp.total_spent), 0) as total_spent,
        COALESCE(AVG(cp.total_spent), 0) as average_spent,
        COUNT(*) FILTER (WHERE u.created_at >= CURRENT_DATE - INTERVAL '30 days') as recent_signups
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
    `;

    const statsResult = await this.pool.query(statsQuery);
    const stats = statsResult.rows[0];

    // Get tier distribution
    const tierQuery = `
      SELECT t.name, COUNT(cp.id) as count
      FROM tiers t
      LEFT JOIN customer_profiles cp ON t.id = cp.tier_id
      GROUP BY t.id, t.name
      ORDER BY t.min_points
    `;

    const tierResult = await this.pool.query(tierQuery);
    const tierDistribution = tierResult.rows.reduce((acc, row) => {
      acc[row.name] = parseInt(row.count);
      return acc;
    }, {} as Record<string, number>);

    return {
      totalCustomers: parseInt(stats.total_customers),
      activeCustomers: parseInt(stats.active_customers),
      totalPoints: parseInt(stats.total_points),
      totalSpent: parseFloat(stats.total_spent),
      averageSpent: parseFloat(stats.average_spent),
      tierDistribution,
      recentSignups: parseInt(stats.recent_signups),
    };
  }

  /**
   * Get customer activity history
   */
  async getCustomerActivity(customerId: string, limit: number = 50): Promise<CustomerActivity[]> {
    // For now, return recent points transactions as activities
    // This can be expanded to include other activities from different tables
    const query = `
      SELECT 
        pt.id,
        cp.user_id as "customerId",
        'points_' || pt.type as type,
        pt.description,
        jsonb_build_object(
          'amount', pt.amount,
          'reference_id', pt.reference_id,
          'reference_type', pt.reference_type
        ) as metadata,
        pt.created_at as "createdAt"
      FROM points_transactions pt
      JOIN customer_profiles cp ON pt.customer_profile_id = cp.id
      WHERE cp.user_id = $1
      ORDER BY pt.created_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [customerId, limit]);

    return result.rows.map(row => ({
      id: row.id,
      customerId: row.customerId,
      type: row.type as any,
      description: row.description,
      metadata: row.metadata,
      createdAt: new Date(row.createdAt),
    }));
  }

  /**
   * Admin: Update customer with additional admin fields
   */
  async adminUpdateCustomer(id: string, updateData: CustomerAdminUpdate): Promise<Customer> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Update user table
      const userFields = [];
      const userValues = [];
      let userParamCount = 1;

      if (updateData.firstName !== undefined) {
        userFields.push(`first_name = $${userParamCount++}`);
        userValues.push(updateData.firstName);
      }
      if (updateData.lastName !== undefined) {
        userFields.push(`last_name = $${userParamCount++}`);
        userValues.push(updateData.lastName);
      }
      if (updateData.phone !== undefined) {
        userFields.push(`phone = $${userParamCount++}`);
        userValues.push(updateData.phone);
      }
      if (updateData.dateOfBirth !== undefined) {
        userFields.push(`date_of_birth = $${userParamCount++}`);
        userValues.push(updateData.dateOfBirth);
      }
      if (updateData.isActive !== undefined) {
        userFields.push(`is_active = $${userParamCount++}`);
        userValues.push(updateData.isActive);
      }
      if (updateData.emailVerified !== undefined) {
        userFields.push(`email_verified = $${userParamCount++}`);
        userValues.push(updateData.emailVerified);
      }

      if (userFields.length > 0) {
        userFields.push(`updated_at = CURRENT_TIMESTAMP`);
        userValues.push(id);
        
        const userQuery = `
          UPDATE users 
          SET ${userFields.join(', ')} 
          WHERE id = $${userParamCount}
        `;
        
        await client.query(userQuery, userValues);
      }

      // Update customer profile
      const profileFields = [];
      const profileValues = [];
      let profileParamCount = 1;

      if (updateData.pointsBalance !== undefined) {
        profileFields.push(`points_balance = $${profileParamCount++}`);
        profileValues.push(updateData.pointsBalance);
      }
      if (updateData.tierId !== undefined) {
        profileFields.push(`tier_id = $${profileParamCount++}`);
        profileValues.push(updateData.tierId);
      }
      if (updateData.preferences !== undefined) {
        profileFields.push(`preferences = $${profileParamCount++}`);
        profileValues.push(updateData.preferences);
      }

      if (profileFields.length > 0) {
        profileFields.push(`updated_at = CURRENT_TIMESTAMP`);
        profileValues.push(id);
        
        const profileQuery = `
          UPDATE customer_profiles 
          SET ${profileFields.join(', ')} 
          WHERE user_id = $${profileParamCount}
        `;
        
        await client.query(profileQuery, profileValues);
      }

      await client.query('COMMIT');
      
      return this.getCustomer(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export const customerService = new CustomerService();