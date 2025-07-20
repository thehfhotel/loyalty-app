import axios from 'axios';

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:4000/api';

export interface Tier {
  id: string;
  name: string;
  min_points: number;
  benefits: {
    description: string;
    perks: string[];
  };
  color: string;
  sort_order: number;
}

export interface UserLoyaltyStatus {
  user_id: string;
  current_points: number;
  lifetime_points: number;
  tier_name: string;
  tier_color: string;
  tier_benefits: {
    description: string;
    perks: string[];
  };
  tier_level: number;
  progress_percentage: number;
  next_tier_points: number | null;
  next_tier_name: string | null;
  points_to_next_tier: number | null;
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
  user_created_at: string;
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
      const response = await axios.get(`${API_URL}/loyalty/tiers`);
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
      const response = await axios.get(`${API_URL}/loyalty/status`);
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
      const response = await axios.get(`${API_URL}/loyalty/points/calculation`);
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
      const response = await axios.get(`${API_URL}/loyalty/history`, {
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
      const response = await axios.post(`${API_URL}/loyalty/simulate-stay`, {
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
      const params: any = { limit, offset };
      if (searchTerm) {
        params.search = searchTerm;
      }

      const response = await axios.get(`${API_URL}/loyalty/admin/users`, { params });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching all users loyalty status:', error);
      throw new Error('Failed to fetch users loyalty status');
    }
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
      const response = await axios.post(`${API_URL}/loyalty/admin/award-points`, {
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
      const response = await axios.post(`${API_URL}/loyalty/admin/deduct-points`, {
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
   * Get specific user's points history (admin only)
   */
  async getUserPointsHistoryAdmin(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<PointsHistoryResponse> {
    try {
      const response = await axios.get(`${API_URL}/loyalty/admin/user/${userId}/history`, {
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
  async getEarningRules(): Promise<any[]> {
    try {
      const response = await axios.get(`${API_URL}/loyalty/admin/earning-rules`);
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
      const response = await axios.post(`${API_URL}/loyalty/admin/expire-points`);
      return response.data.data;
    } catch (error) {
      console.error('Error expiring points:', error);
      throw new Error('Failed to expire points');
    }
  }
}

// Export singleton instance
export const loyaltyService = new LoyaltyService();