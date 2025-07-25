import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(
  (config) => {
    // Get token from Zustand persist storage
    const authStorage = localStorage.getItem('auth-storage');
    
    if (authStorage) {
      try {
        const parsedAuth = JSON.parse(authStorage);
        const token = parsedAuth.state?.accessToken;
        
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          console.log('[Auth Debug] Request interceptor adding token', {
            url: config.url,
            hasToken: true,
            method: config.method
          });
        } else {
          console.log('[Auth Debug] Request interceptor - no token found', {
            url: config.url,
            method: config.method
          });
        }
      } catch (error) {
        console.error('[Auth Debug] Error parsing auth storage:', error);
      }
    } else {
      console.log('[Auth Debug] Request interceptor - no auth storage', {
        url: config.url,
        method: config.method
      });
    }
    return config;
  },
  (error) => {
    console.error('[Auth Debug] Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Get refresh token from Zustand persist storage
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
          const parsedAuth = JSON.parse(authStorage);
          const refreshToken = parsedAuth.state?.refreshToken;
          
          if (refreshToken) {
            const response = await authService.refreshToken(refreshToken);
            
            // Update the Zustand storage with new tokens
            parsedAuth.state.accessToken = response.tokens.accessToken;
            parsedAuth.state.refreshToken = response.tokens.refreshToken;
            localStorage.setItem('auth-storage', JSON.stringify(parsedAuth));
            
            originalRequest.headers.Authorization = `Bearer ${response.tokens.accessToken}`;
            return api(originalRequest);
          }
        }
      } catch (refreshError) {
        // Refresh failed, clear auth and redirect to login
        localStorage.removeItem('auth-storage');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export const authService = {
  async login(email: string, password: string) {
    console.log('[Auth Debug] Login attempt', { email });
    const response = await api.post('/auth/login', { email, password });
    console.log('[Auth Debug] Login response', { 
      success: response.data.success,
      hasUser: !!response.data.user,
      hasTokens: !!response.data.tokens
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
};

export default api;