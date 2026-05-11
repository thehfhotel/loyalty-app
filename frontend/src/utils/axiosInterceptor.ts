import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { notify } from './notificationManager';
import { logger } from './logger';

// Track if we've already shown the session expired message
let sessionExpiredShown = false;

// Extend InternalAxiosRequestConfig to include retry tracking
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// Type for API error responses
interface ApiErrorResponse {
  error?: string;
  message?: string;
  code?: string;
}

// Custom error class to preserve error code from backend
export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Helper to create error with code preserved
function createApiError(error: AxiosError): Error {
  const data = error.response?.data as ApiErrorResponse | undefined;
  const message = data?.error ?? data?.message ?? error.message;
  const code = data?.code;
  return code ? new ApiError(message, code) : new Error(message);
}

export function setupAxiosInterceptors() {
  // Response interceptor to handle 401 errors globally
  axios.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (error.response?.status === 401) {
        const authStore = useAuthStore.getState();
        const currentPath = window.location.pathname;

        // Skip retry logic for refresh endpoint - it shouldn't retry itself
        // This prevents infinite loop when refresh token is invalid/expired
        if (error.config?.url?.includes('/auth/refresh')) {
          authStore.clearAuth();
          const returnUrl = currentPath + window.location.search;
          window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
          return Promise.reject(createApiError(error));
        }

        // Skip if we're already on auth pages
        const authPages = ['/login', '/register', '/reset-password', '/oauth/success'];
        if (authPages.some(page => currentPath.startsWith(page))) {
          // Extract backend error message from response body
          return Promise.reject(createApiError(error));
        }

        // Phase 2: always attempt the refresh — the refresh token is now
        // an HttpOnly cookie that JS cannot see. The browser sends it
        // automatically (axios `withCredentials: true` on the auth axios
        // instance). The backend returns 401 if the cookie is absent or
        // expired, which falls through to clearAuth + redirect below.
        try {
          await authStore.refreshAuth();

          // If refresh successful, retry the original request
          const originalRequest = error.config as RetryableRequestConfig;
          if (originalRequest && !originalRequest._retry) {
            originalRequest._retry = true; // Prevent infinite retry loops
            // Update the Authorization header with the new token
            const newToken = useAuthStore.getState().accessToken;
            if (newToken) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return axios.request(originalRequest);
            }
          }
        } catch (refreshError) {
          logger.error('Token refresh failed:', refreshError);
        }

        // Clear auth state and redirect (refresh failed, or no cookie)
        authStore.clearAuth();

        // Show session expired message only once
        if (!sessionExpiredShown) {
          sessionExpiredShown = true;
          notify.error('Your session has expired. Please log in again.', {
            id: 'session-expired'
          });

          // Reset the flag after 5 seconds
          setTimeout(() => {
            sessionExpiredShown = false;
          }, 5000);
        }

        // Force redirect to login with return URL - use window.location for immediate redirect
        const returnUrl = currentPath + window.location.search;
        window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;

        // Also return rejected promise to prevent further processing
        return new Promise(() => {}); // Never resolves, preventing continued execution
      }

      // For all other errors, extract backend error message and code if available
      return Promise.reject(createApiError(error));
    }
  );
}

// Helper function to add auth token to axios instances
export function addAuthTokenInterceptor(axiosInstance: AxiosInstance) {
  axiosInstance.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      // Try to get token from auth store first, then fallback to localStorage
      const authStore = useAuthStore.getState();
      let token = authStore.accessToken;

      // Fallback to localStorage if store doesn't have token
      if (!token) {
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
          try {
            const parsedAuth = JSON.parse(authStorage);
            token = parsedAuth.state?.accessToken;
          } catch (error) {
            logger.error('Error parsing auth storage:', error);
          }
        }
      }

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        // If no token is available and this isn't a public endpoint,
        // we should probably redirect to login immediately
        const isPublicEndpoint = (config.url?.includes('/auth/') ?? false) ||
                                (config.url?.includes('/register') ?? false) ||
                                (config.url?.includes('/forgot-password') ?? false);

        if (!isPublicEndpoint) {
          logger.warn('No auth token available for protected endpoint:', config.url);
          // Don't make the request if we know it will fail
          // Let the axios interceptor handle the redirect
        }
      }

      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    }
  );

  // Add response interceptor for 401 handling specific to this instance
  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as RetryableRequestConfig;

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        const authStore = useAuthStore.getState();
        const currentPath = window.location.pathname;

        // Skip retry logic for refresh endpoint - it shouldn't retry itself
        // This prevents infinite loop when refresh token is invalid/expired
        if (originalRequest.url?.includes('/auth/refresh')) {
          authStore.clearAuth();
          const returnUrl = currentPath + window.location.search;
          window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
          return Promise.reject(createApiError(error));
        }

        // Skip if we're already on auth pages
        const authPages = ['/login', '/register', '/reset-password', '/oauth/success'];
        if (authPages.some(page => currentPath.startsWith(page))) {
          // Extract backend error message from response body
          return Promise.reject(createApiError(error));
        }

        // Phase 2: always attempt the refresh — see the global interceptor
        // for the full rationale. The HttpOnly cookie is the source of
        // truth; we cannot read it from JS, so we just try.
        try {
          await authStore.refreshAuth();

          // If refresh successful, retry the original request
          const newToken = useAuthStore.getState().accessToken;
          if (newToken) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return axiosInstance.request(originalRequest);
          }
        } catch (refreshError) {
          logger.error('Token refresh failed:', refreshError);
        }

        // Clear auth state and redirect (refresh failed, or no cookie)
        authStore.clearAuth();

        // Show session expired message only once
        if (!sessionExpiredShown) {
          sessionExpiredShown = true;
          notify.error('Your session has expired. Please log in again.', {
            id: 'session-expired'
          });

          // Reset the flag after 5 seconds
          setTimeout(() => {
            sessionExpiredShown = false;
          }, 5000);
        }

        // Force redirect to login with return URL - use window.location for immediate redirect
        const returnUrl = currentPath + window.location.search;
        window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;

        // Also return rejected promise to prevent further processing
        return new Promise(() => {}); // Never resolves, preventing continued execution
      }

      // For all other errors, extract backend error message and code if available
      return Promise.reject(createApiError(error));
    }
  );
}
