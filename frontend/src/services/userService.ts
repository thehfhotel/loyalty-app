import api from './authService';

export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  preferences: Record<string, any>;
  avatarUrl?: string;
  membershipId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  membershipId?: string;
}

export const userService = {
  async getProfile(): Promise<UserProfile> {
    const response = await api.get('/users/profile');
    return response.data.profile;
  },

  async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
    const response = await api.put('/users/profile', data);
    return response.data.profile;
  },

  async uploadAvatar(file: File): Promise<{ data: { avatarUrl: string } }> {
    const formData = new FormData();
    formData.append('avatar', file);
    
    const response = await api.post('/users/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  async updateEmojiAvatar(emoji: string): Promise<UserProfile> {
    const response = await api.put('/users/avatar/emoji', { emoji });
    return response.data.data.profile;
  },

  async updateEmail(email: string): Promise<void> {
    await api.put('/users/email', { email });
  },

  async deleteAvatar(): Promise<void> {
    await api.delete('/users/avatar');
  },

  async getMyMembershipId(): Promise<{ membershipId: string }> {
    const response = await api.get('/membership/my-id');
    return response.data.data;
  },

  // Admin functions
  async getAllUsers(page: number = 1, limit: number = 50, search: string = ''): Promise<{
    users: User[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(search && { search })
    });
    
    const response = await api.get(`/users/admin/users?${params}`);
    return {
      users: response.data.data,
      pagination: response.data.pagination
    };
  },
};