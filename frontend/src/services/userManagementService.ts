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

export interface User {
  userId: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  phone?: string;
  createdAt: string;
  avatarUrl?: string;
  membershipId?: string;
}

export interface UserStats {
  total: number;
  active: number;
  admins: number;
  recentlyJoined: number;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface UsersResponse {
  success: boolean;
  data: User[];
  pagination: PaginationInfo;
}

export interface StatsResponse {
  success: boolean;
  data: UserStats;
}

export interface UserResponse {
  success: boolean;
  data: User;
}

export const userManagementService = {
  async getUsers(page = 1, limit = 10, search = ''): Promise<UsersResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    
    if (search) {
      params.append('search', search);
    }

    const response = await api.get(`/users/admin/users?${params}`);
    return response.data;
  },

  async getUserStats(): Promise<StatsResponse> {
    const response = await api.get('/users/admin/stats');
    return response.data;
  },

  async getUserById(userId: string): Promise<UserResponse> {
    const response = await api.get(`/users/admin/users/${userId}`);
    return response.data;
  },

  async updateUserStatus(userId: string, isActive: boolean): Promise<{ success: boolean; message: string }> {
    const response = await api.patch(`/users/admin/users/${userId}/status`, {
      isActive
    });
    return response.data;
  },

  async updateUserRole(userId: string, role: string): Promise<{ success: boolean; message: string }> {
    const response = await api.patch(`/users/admin/users/${userId}/role`, {
      role
    });
    return response.data;
  },

  async deleteUser(userId: string): Promise<{ success: boolean; message: string }> {
    const response = await api.delete(`/users/admin/users/${userId}`);
    return response.data;
  }
};