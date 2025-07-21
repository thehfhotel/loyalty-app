import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '../services/authService';
import { notify } from '../utils/notificationManager';

interface User {
  id: string;
  email: string;
  role: 'customer' | 'admin' | 'super_admin';
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  oauthProvider?: string;
  oauthProviderId?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  checkAuthStatus: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await authService.login(email, password);
          set({
            user: response.user,
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          notify.success('Welcome back!');
        } catch (error: any) {
          set({ isLoading: false });
          notify.error(error.message || 'Login failed');
          throw error;
        }
      },

      register: async (data) => {
        set({ isLoading: true });
        try {
          const response = await authService.register(data);
          set({
            user: response.user,
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          notify.success('Account created successfully!');
        } catch (error: any) {
          set({ isLoading: false });
          notify.error(error.message || 'Registration failed');
          throw error;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          if (refreshToken) {
            await authService.logout(refreshToken);
          }
        } catch (error) {
          console.error('Logout error:', error);
        } finally {
          get().clearAuth();
          notify.success('Logged out successfully');
        }
      },

      refreshAuth: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          get().clearAuth();
          return;
        }

        try {
          const response = await authService.refreshToken(refreshToken);
          set({
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
          });
        } catch (error) {
          get().clearAuth();
          throw error;
        }
      },

      setTokens: (accessToken: string, refreshToken: string) => {
        set({ accessToken, refreshToken });
      },

      clearAuth: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },

      checkAuthStatus: async () => {
        const state = get();
        
        // If no access token, not authenticated
        if (!state.accessToken) {
          if (state.isAuthenticated) {
            get().clearAuth();
          }
          return false;
        }

        try {
          // Try to verify the token by getting user info
          const response = await authService.getMe();
          
          // Update user info if it has changed
          if (response.user.email !== state.user?.email) {
            set({ user: response.user });
          }
          
          return true;
        } catch (error) {
          // Token is invalid or expired, try to refresh
          if (state.refreshToken) {
            try {
              await get().refreshAuth();
              return true;
            } catch (refreshError) {
              // Refresh failed, clear auth
              get().clearAuth();
              return false;
            }
          }
          
          // No refresh token, clear auth
          get().clearAuth();
          return false;
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);