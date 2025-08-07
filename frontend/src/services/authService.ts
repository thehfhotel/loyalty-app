import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Use the unified auth token interceptor
addAuthTokenInterceptor(api);

export const authService = {
  async login(email: string, password: string, rememberMe?: boolean) {
    console.log('[Auth Debug] Login attempt', { email, rememberMe });
    const response = await api.post('/auth/login', { 
      email, 
      password,
      rememberMe: rememberMe ?? false
    });
    console.log('[Auth Debug] Login response', { 
      success: response.data.success,
      hasUser: !!response.data.user,
      hasTokens: !!response.data.tokens,
      rememberMe: rememberMe
    });
    return response.data;
  },

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    const response = await api.post('/auth/register', data);
    return response.data;
  },

  async logout(refreshToken: string) {
    await api.post('/auth/logout', { refreshToken });
  },

  async refreshToken(refreshToken: string) {
    console.log('[Auth Debug] Token refresh attempt');
    const response = await api.post('/auth/refresh', { refreshToken });
    console.log('[Auth Debug] Token refresh response', { 
      success: !!response.data.tokens,
      hasNewAccessToken: !!response.data.tokens?.accessToken
    });
    return response.data;
  },

  async resetPasswordRequest(email: string) {
    const response = await api.post('/auth/reset-password/request', { email });
    return response.data;
  },

  async resetPassword(token: string, password: string) {
    const response = await api.post('/auth/reset-password', { token, password });
    return response.data;
  },

  async getCurrentUser() {
    const response = await api.get('/auth/me');
    return response.data;
  },
  
  async getMe() {
    const response = await api.get('/auth/me');
    return response.data;
  },

  async apiCall(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data?: any) {
    try {
      let response;
      switch (method) {
        case 'GET':
          response = await api.get(url);
          break;
        case 'POST':
          response = await api.post(url, data);
          break;
        case 'PUT':
          response = await api.put(url, data);
          break;
        case 'DELETE':
          response = await api.delete(url);
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${method}`);
      }
      return response.data;
    } catch (error: any) {
      console.error(`[Auth Debug] API call failed: ${method} ${url}`, error);
      throw error;
    }
  },
};

export default api;