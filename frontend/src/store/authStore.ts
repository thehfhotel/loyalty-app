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
          console.warn('No refresh token available for refresh');
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
            console.log('Token refresh successful');
          }
        } catch (error: unknown) {
          console.warn('Token refresh failed:', error instanceof Error ? error.message : String(error));
          
          // Only clear auth on explicit auth failures, not network issues
          if ((error as HttpError)?.response?.status === 401 || (error as HttpError)?.response?.status === 403 || 
              (error instanceof Error && error.message.includes('Invalid refresh token'))) {
            console.warn('Refresh token is invalid, clearing auth state');
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
          
          // Update user info if it has changed
          if (response.user.email !== state.user?.email || 
              response.user.avatarUrl !== state.user?.avatarUrl ||
              response.user.firstName !== state.user?.firstName ||
              response.user.lastName !== state.user?.lastName) {
            set({ user: response.user });
          }
          
          return true;
        } catch (error: unknown) {
          // Handle network errors differently from auth errors
          if ((error as HttpError)?.name === 'AbortError' || (error as HttpError)?.code === 'NETWORK_ERROR') {
            console.warn('Network error during auth check, assuming valid for now:', error instanceof Error ? error.message : String(error));
            // On network errors, don't clear auth - user might be offline
            return true;
          }
          
          // Handle rate limiting (429) - don't logout user for this
          if ((error as HttpError)?.response?.status === 429) {
            console.warn('Rate limit hit during auth check, assuming valid for now');
            // On rate limit, keep user logged in - this is temporary
            return true;
          }
          
          // Token is invalid or expired, try to refresh
          if (state.refreshToken) {
            try {
              await get().refreshAuth();
              return true;
            } catch (refreshError: unknown) {
              console.warn('Refresh token failed:', refreshError instanceof Error ? refreshError.message : String(refreshError));
              
              // Handle rate limiting on refresh - don't logout
              if ((refreshError as HttpError)?.response?.status === 429) {
                console.warn('Rate limit hit during token refresh, keeping auth state');
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
          console.warn('No refresh token available, clearing auth');
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