import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '../services/authService';
import { notify } from '../utils/notificationManager';
import { User } from '../types/api';
import { logger } from '../utils/logger';

interface HttpError {
  response?: {
    status?: number;
  };
  name?: string;
  code?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
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
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string, rememberMe?: boolean) => {
        set({ isLoading: true });
        try {
          const response = await authService.login(email, password, rememberMe);
          set({
            user: response.user,
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
          notify.success('Welcome back!');
        } catch (error: unknown) {
          set({ isLoading: false });
          notify.error(error instanceof Error ? error.message : 'Login failed');
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
        } catch (error: unknown) {
          set({ isLoading: false });
          notify.error(error instanceof Error ? error.message : 'Registration failed');
          throw error;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          if (refreshToken) {
            await authService.logout(refreshToken);
          }
        } catch (_error) {
          // Logout error - continue with local logout
        } finally {
          get().clearAuth();
          notify.success('Logged out successfully');
        }
      },

      refreshAuth: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          logger.warn('No refresh token available for refresh');
          get().clearAuth();
          return;
        }

        try {
          // Add timeout to refresh request
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
          
          const response = await authService.refreshToken(refreshToken);
          clearTimeout(timeoutId);
          
          set({
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
          });

          if (import.meta.env?.DEV) {
            logger.log('Token refresh successful');
          }
        } catch (error: unknown) {
          logger.warn('Token refresh failed:', error instanceof Error ? error.message : String(error));
          
          // Only clear auth on explicit auth failures, not network issues
          if ((error as HttpError)?.response?.status === 401 || (error as HttpError)?.response?.status === 403 ||
              (error instanceof Error && error.message.includes('Invalid refresh token'))) {
            logger.warn('Refresh token is invalid, clearing auth state');
            get().clearAuth();
          }
          
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
          // Try to verify the token by getting user info with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

          const response = await authService.getMe();
          clearTimeout(timeoutId);

          // Update user info and ensure isAuthenticated is true
          // This handles cases where tokens exist but isAuthenticated wasn't set
          // (e.g., OAuth flow interrupted, or state corruption)
          const updates: Partial<AuthState> = {};

          if (response.data) {
            if (response.data.email !== state.user?.email ||
                response.data.avatarUrl !== state.user?.avatarUrl ||
                response.data.firstName !== state.user?.firstName ||
                response.data.lastName !== state.user?.lastName) {
              updates.user = response.data;
            }
          }

          // Ensure isAuthenticated is true when tokens are valid
          if (!state.isAuthenticated) {
            updates.isAuthenticated = true;
            if (response.data && !state.user) {
              updates.user = response.data;
            }
          }

          if (Object.keys(updates).length > 0) {
            set(updates);
          }

          return true;
        } catch (error: unknown) {
          // Handle network errors differently from auth errors
          if ((error as HttpError)?.name === 'AbortError' || (error as HttpError)?.code === 'NETWORK_ERROR') {
            logger.warn('Network error during auth check, assuming valid for now:', error instanceof Error ? error.message : String(error));
            // On network errors, don't clear auth - user might be offline
            // Ensure isAuthenticated is set if we have tokens
            if (!state.isAuthenticated && state.accessToken) {
              set({ isAuthenticated: true });
            }
            return true;
          }

          // Handle rate limiting (429) - don't logout user for this
          if ((error as HttpError)?.response?.status === 429) {
            logger.warn('Rate limit hit during auth check, assuming valid for now');
            // On rate limit, keep user logged in - this is temporary
            // Ensure isAuthenticated is set if we have tokens
            if (!state.isAuthenticated && state.accessToken) {
              set({ isAuthenticated: true });
            }
            return true;
          }

          // Token is invalid or expired, try to refresh
          if (state.refreshToken) {
            try {
              await get().refreshAuth();
              // After successful refresh, ensure isAuthenticated is true
              if (!get().isAuthenticated) {
                set({ isAuthenticated: true });
              }
              return true;
            } catch (refreshError: unknown) {
              logger.warn('Refresh token failed:', refreshError instanceof Error ? refreshError.message : String(refreshError));

              // Handle rate limiting on refresh - don't logout
              if ((refreshError as HttpError)?.response?.status === 429) {
                logger.warn('Rate limit hit during token refresh, keeping auth state');
                // Ensure isAuthenticated is set if we have tokens
                if (!state.isAuthenticated && state.accessToken) {
                  set({ isAuthenticated: true });
                }
                return true;
              }

              // Only clear auth on explicit 401/403 errors, not network issues
              if ((refreshError as HttpError)?.response?.status === 401 || (refreshError as HttpError)?.response?.status === 403) {
                get().clearAuth();
                return false;
              }
              // For other errors (network, etc), keep auth state but return false
              return false;
            }
          }

          // No refresh token available
          logger.warn('No refresh token available, clearing auth');
          get().clearAuth();
          return false;
        }
      },

      updateUser: (updates: Partial<User>) => {
        const currentUser = get().user;
        if (currentUser) {
          set({
            user: {
              ...currentUser,
              ...updates
            }
          });
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