import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { notify } from './notificationManager';
import { logger } from './logger';
import { API_BASE_URL } from './apiConfig';

// Track if we've already shown the session expired message
let sessionExpiredShown = false;

// CSRF token storage
let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

/**
 * Fetch CSRF token from the server
 * Uses singleton pattern to prevent multiple simultaneous fetches
 */
export async function fetchCsrfToken(): Promise<string> {
  // If we're already fetching, return the existing promise
  if (csrfTokenPromise) {
    return csrfTokenPromise;
  }

  csrfTokenPromise = (async () => {
    try {
      const response = await axios.get<{ csrfToken: string }>(`${API_BASE_URL}/csrf-token`, {
        withCredentials: true, // Important: include cookies
      });
      csrfToken = response.data.csrfToken;
      logger.log('[CSRF] Token fetched successfully');
      return csrfToken;
    } catch (error) {
      logger.error('[CSRF] Failed to fetch token:', error);
      throw error;
    } finally {
      csrfTokenPromise = null;
    }
  })();

  return csrfTokenPromise;
}

/**
 * Get the current CSRF token, fetching if necessary
 */
export async function getCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }
  return fetchCsrfToken();
}

/**
 * Clear the CSRF token (call on logout)
 */
export function clearCsrfToken(): void {
  csrfToken = null;
}

// Extend InternalAxiosRequestConfig to include retry tracking
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _csrfRetry?: boolean;
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

        // Try to refresh token first - but only if we have a refresh token
        const refreshToken = authStore.refreshToken;
        if (refreshToken) {
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
        }

        // Clear auth state and redirect (whether refresh failed or no refresh token)
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

// Helper function to add auth token and CSRF token to axios instances
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

      // Add CSRF token for non-GET requests (state-changing operations)
      const method = config.method?.toUpperCase();
      const requiresCsrf = method && !['GET', 'HEAD', 'OPTIONS'].includes(method);

      if (requiresCsrf) {
        try {
          const token = await getCsrfToken();
          config.headers['X-CSRF-Token'] = token;
        } catch (error) {
          logger.warn('[CSRF] Could not get token, proceeding without it:', error);
        }
      }

      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    }
  );

  // Add response interceptor for CSRF and 401 handling specific to this instance
  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as RetryableRequestConfig;
      const errorData = error.response?.data as ApiErrorResponse | undefined;

      // Handle CSRF token errors (403 with CSRF message)
      if (
        error.response?.status === 403 &&
        (errorData?.error?.includes('CSRF') || errorData?.message?.includes('CSRF')) &&
        !originalRequest._csrfRetry
      ) {
        originalRequest._csrfRetry = true;
        logger.log('[CSRF] Token rejected, fetching new token and retrying...');

        try {
          // Clear old token and fetch a new one
          clearCsrfToken();
          const newToken = await fetchCsrfToken();
          originalRequest.headers['X-CSRF-Token'] = newToken;
          return axiosInstance.request(originalRequest);
        } catch (csrfError) {
          logger.error('[CSRF] Failed to refresh token:', csrfError);
          return Promise.reject(createApiError(error));
        }
      }

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

        // Try to refresh token first - but only if we have a refresh token
        const refreshToken = authStore.refreshToken;
        if (refreshToken) {
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
        }

        // Clear auth state and redirect (whether refresh failed or no refresh token)
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