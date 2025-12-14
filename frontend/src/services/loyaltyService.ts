/* eslint-disable no-console -- Service layer uses console for API debugging */
import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import { API_BASE_URL } from '../utils/apiConfig';

// Create axios instance with unified auth interceptor
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Use the unified auth token interceptor
addAuthTokenInterceptor(api);

export interface Tier {
  id: string;
  name: string;
  min_points: number; // Not used - kept for legacy compatibility (always 0)
  min_nights: number; // ONLY requirement for tier - membership based on nights stayed
  benefits: {
    description: string;
    perks: string[];
  };
  color: string;
  sort_order: number;
}

export interface UserLoyaltyStatus {
  user_id: string;
  current_points: number; // Points for redemption only
  total_nights: number; // Total nights stayed - ONLY factor determining tier
  tier_name: string;
  tier_color: string;
  tier_benefits: {
    description: string;
    perks: string[];
  };
  tier_level: number;
  progress_percentage: number; // Progress to next tier based on nights only
  next_tier_nights: number | null; // Nights needed for next tier
  next_tier_name: string | null;
  nights_to_next_tier: number | null; // Remaining nights to next tier
}

export interface PointsTransaction {
  id: string;
  user_id: string;
  points: number;
  type: string;
  description: string | null;
  reference_id: string | null;
  admin_user_id: string | null;
  admin_reason: string | null;
  admin_email?: string;
  expires_at: string | null;
  created_at: string;
}

export interface AdminTransaction extends PointsTransaction {
  user_email?: string;
  user_membership_id?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
  admin_email?: string;
  admin_first_name?: string | null;
  admin_last_name?: string | null;
  admin_membership_id?: string | null;
  nights_stayed?: number | null;
}

export interface PointsCalculation {
  current_points: number;
  expiring_points: number;
  next_expiry_date: string | null;
}

export interface PointsHistoryResponse {
  transactions: PointsTransaction[];
  total: number;
}

export interface AdminUserLoyalty extends UserLoyaltyStatus {
  first_name: string | null;
  last_name: string | null;
  email: string;
  oauth_provider: string | null;
  oauth_provider_id: string | null;
  user_created_at: string;
  membership_id?: string | null;
}

export interface AdminUsersResponse {
  users: AdminUserLoyalty[];
  total: number;
}

export class LoyaltyService {
  /**
   * Get all available loyalty tiers
   */
  async getTiers(): Promise<Tier[]> {
    try {
      const response = await api.get('/loyalty/tiers');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching tiers:', error);
      throw new Error('Failed to fetch loyalty tiers');
    }
  }

  /**
   * Get current user's loyalty status
   */
  async getUserLoyaltyStatus(): Promise<UserLoyaltyStatus> {
    try {
      const response = await api.get('/loyalty/status');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching loyalty status:', error);
      throw new Error('Failed to fetch loyalty status');
    }
  }

  /**
   * Get detailed points calculation
   */
  async getPointsCalculation(): Promise<PointsCalculation> {
    try {
      const response = await api.get('/loyalty/points/calculation');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching points calculation:', error);
      throw new Error('Failed to fetch points calculation');
    }
  }

  /**
   * Get user's points transaction history
   */
  async getPointsHistory(limit: number = 50, offset: number = 0): Promise<PointsHistoryResponse> {
    try {
      const response = await api.get('/loyalty/history', {
        params: { limit, offset }
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching points history:', error);
      throw new Error('Failed to fetch points history');
    }
  }

  /**
   * Simulate earning points for a hotel stay
   */
  async simulateStayEarning(amountSpent: number, stayId?: string): Promise<{
    transactionId: string;
    loyaltyStatus: UserLoyaltyStatus;
  }> {
    try {
      const response = await api.post('/loyalty/simulate-stay', {
        amountSpent,
        stayId
      });
      return response.data.data;
    } catch (error) {
      console.error('Error simulating stay earning:', error);
      throw new Error('Failed to simulate stay earning');
    }
  }

  // Admin methods

  /**
   * Get all users' loyalty status (admin only)
   */
  async getAllUsersLoyaltyStatus(
    limit: number = 50,
    offset: number = 0,
    searchTerm?: string
  ): Promise<AdminUsersResponse> {
    try {
      const params: Record<string, number | string> = { limit, offset };
      if (searchTerm) {
        params.search = searchTerm;
      }

      const response = await api.get('/loyalty/admin/users', { params });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching all users loyalty status:', error);
      throw new Error('Failed to fetch users loyalty status');
    }
  }

  /**
   * Get users for coupon assignment (admin only) - Alias for getAllUsersLoyaltyStatus
   */
  async getUsers(
    limit: number = 50,
    offset: number = 0,
    searchTerm?: string
  ): Promise<AdminUsersResponse> {
    return this.getAllUsersLoyaltyStatus(limit, offset, searchTerm);
  }

  /**
   * Award points to a user (admin only)
   */
  async awardPoints(
    userId: string,
    points: number,
    description?: string,
    referenceId?: string
  ): Promise<{
    transactionId: string;
    loyaltyStatus: UserLoyaltyStatus;
  }> {
    try {
      const response = await api.post('/loyalty/admin/award-points', {
        userId,
        points,
        description,
        referenceId
      });
      return response.data.data;
    } catch (error) {
      console.error('Error awarding points:', error);
      throw new Error('Failed to award points');
    }
  }

  /**
   * Deduct points from a user (admin only)
   */
  async deductPoints(
    userId: string,
    points: number,
    reason: string
  ): Promise<{
    transactionId: string;
    loyaltyStatus: UserLoyaltyStatus;
  }> {
    try {
      const response = await api.post('/loyalty/admin/deduct-points', {
        userId,
        points,
        reason
      });
      return response.data.data;
    } catch (error) {
      console.error('Error deducting points:', error);
      throw new Error('Failed to deduct points');
    }
  }

  /**
   * Get all admin transactions (admin only)
   */
  async getAdminTransactions(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ transactions: AdminTransaction[]; total: number }> {
    try {
      const response = await api.get('/loyalty/admin/transactions', {
        params: { limit, offset }
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching admin transactions:', error);
      throw new Error('Failed to fetch admin transactions');
    }
  }

  /**
   * Get specific user's points history (admin only)
   */
  async getUserPointsHistoryAdmin(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<PointsHistoryResponse> {
    try {
      const response = await api.get(`/loyalty/admin/user/${userId}/history`, {
        params: { limit, offset }
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching user points history (admin):', error);
      throw new Error('Failed to fetch user points history');
    }
  }

  /**
   * Get points earning rules (admin only)
   */
  async getEarningRules(): Promise<Array<Record<string, unknown>>> {
    try {
      const response = await api.get('/loyalty/admin/earning-rules');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching earning rules:', error);
      throw new Error('Failed to fetch earning rules');
    }
  }

  /**
   * Manually trigger points expiration (admin only)
   */
  async expirePoints(): Promise<{ expiredCount: number }> {
    try {
      const response = await api.post('/loyalty/admin/expire-points');
      return response.data.data;
    } catch (error) {
      console.error('Error expiring points:', error);
      throw new Error('Failed to expire points');
    }
  }

  /**
   * Award spending points with optional nights stayed (admin only)
   */
  async awardSpendingWithNights(
    userId: string,
    amountSpent: number,
    nightsStayed: number,
    referenceId?: string,
    description?: string
  ): Promise<{
    transactionId: string;
    pointsEarned: number;
    newTotalNights: number;
    newTierName: string;
    loyaltyStatus: UserLoyaltyStatus;
  }> {
    try {
      const response = await api.post('/loyalty/admin/award-spending-with-nights', {
        userId,
        amountSpent,
        nightsStayed,
        referenceId,
        description
      });
      return response.data.data;
    } catch (error) {
      console.error('Error awarding spending with nights:', error);
      throw new Error('Failed to award spending with nights');
    }
  }
}

// Export singleton instance
export const loyaltyService = new LoyaltyService();