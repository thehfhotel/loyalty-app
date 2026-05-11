import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '../services/authService';
import { notify } from '../utils/notificationManager';
import { User } from '../types/api';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/axiosInterceptor';
import i18next from 'i18next';

interface HttpError {
  response?: {
    status?: number;
  };
  name?: string;
  code?: string;
}

// Helper function to get error message with translation support
function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code) {
    // Map error codes to translation keys
    const errorCodeMap: Record<string, string> = {
      'EMAIL_ALREADY_REGISTERED': 'errors.emailAlreadyRegistered',
      'EMAIL_ALREADY_IN_USE': 'errors.emailAlreadyInUse',
    };

    const translationKey = errorCodeMap[error.code];
    if (translationKey) {
      return i18next.t(translationKey);
    }
  }

  // Fallback to error message
  return error instanceof Error ? error.message : 'An error occurred';
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
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
  // Phase 2: only the access token lives in the store; the refresh token
  // is held by the browser as an HttpOnly cookie (`refresh_token`) set by
  // the backend (Phase 1, PR #194) and never readable from JavaScript.
  setTokens: (accessToken: string) => void;
  clearAuth: () => void;
  checkAuthStatus: () => Promise<boolean>;
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string, rememberMe?: boolean) => {
        set({ isLoading: true });
        try {
          const response = await authService.login(email, password, rememberMe);
          // Phase 2: ignore `response.tokens.refreshToken` — the backend has
          // also set it as an HttpOnly cookie (Phase 1, PR #194). The cookie
          // is the source of truth; we never store the refresh token in JS.
          set({
            user: response.user,
            accessToken: response.tokens.accessToken,
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
          // Phase 2: same rationale as login — refresh token is in the
          // HttpOnly cookie set by the backend; we keep only the access
          // token in JS.
          set({
            user: response.user,
            accessToken: response.tokens.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
          notify.success('Account created successfully!');
        } catch (error: unknown) {
          set({ isLoading: false });
          notify.error(getErrorMessage(error));
          throw error;
        }
      },

      logout: async () => {
        try {
          // Phase 2: no body argument — `authService.logout()` posts an
          // empty body and the browser sends the `refresh_token` cookie
          // automatically (axios `withCredentials: true`). The backend
          // both deletes the row and clears the cookie via Set-Cookie.
          await authService.logout();
        } catch (_error) {
          // Logout error - continue with local logout
        } finally {
          get().clearAuth();
          notify.success('Logged out successfully');
        }
      },

      refreshAuth: async () => {
        try {
          // Add timeout to refresh request
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

          // Phase 2: no token argument — the refresh token rides as an
          // HttpOnly cookie. The backend reads `refresh_token` from the
          // cookie and rotates it (sets a new one in the response).
          const response = await authService.refreshToken();
          clearTimeout(timeoutId);

          // Phase 2: only the access token enters the store. The new
          // refresh token in the JSON body is ignored — the cookie that
          // the backend set on this same response is now authoritative.
          set({
            accessToken: response.tokens.accessToken,
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

      setTokens: (accessToken: string) => {
        // Phase 2: only the access token is settable from JS. The refresh
        // token arrives as an HttpOnly cookie that the browser stores
        // automatically; we don't (and can't) touch it.
        set({ accessToken });
      },

      clearAuth: () => {
        set({
          user: null,
          accessToken: null,
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

          // Note: Backend returns { user: ... } not { data: ... }
          const userData = (response as { user?: User }).user;

          if (userData) {
            if (userData.email !== state.user?.email ||
                userData.avatarUrl !== state.user?.avatarUrl ||
                userData.firstName !== state.user?.firstName ||
                userData.lastName !== state.user?.lastName ||
                userData.emailVerified !== state.user?.emailVerified) {
              updates.user = userData;
            }
          }

          // Ensure isAuthenticated is true when tokens are valid
          if (!state.isAuthenticated) {
            updates.isAuthenticated = true;
            if (userData && !state.user) {
              updates.user = userData;
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

          // Token is invalid or expired — try to refresh. We can no longer
          // gate on a JS-visible refresh token (Phase 2: it lives in the
          // HttpOnly cookie). We just attempt the refresh; the backend
          // returns 401 if the cookie is missing/expired and we fall
          // through to clearAuth() below.
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
      // Phase 2: `refreshToken` is intentionally absent. It lives in the
      // browser's HttpOnly cookie jar (`refresh_token`) so JavaScript —
      // including any XSS payload — cannot read it. The one-time cleanup
      // of any stale `refreshToken` left over from Phase 1 happens on
      // app startup via `migrateAuthStorageForCookieRefreshToken()`.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);