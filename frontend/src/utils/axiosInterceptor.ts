import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { notify } from './notificationManager';

// Track if we've already shown the session expired message
let sessionExpiredShown = false;

export function setupAxiosInterceptors() {
  // Response interceptor to handle 401 errors globally
  axios.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (error.response?.status === 401) {
        const authStore = useAuthStore.getState();
        const currentPath = window.location.pathname;
        
        // Skip if we're already on auth pages
        const authPages = ['/login', '/register', '/reset-password', '/oauth/success'];
        if (authPages.some(page => currentPath.startsWith(page))) {
          return Promise.reject(error);
        }

        // Try to refresh token first - but only if we have a refresh token
        const refreshToken = authStore.refreshToken;
        if (refreshToken) {
          try {
            await authStore.refreshAuth();
            
            // If refresh successful, retry the original request
            const originalRequest = error.config as any;
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
            console.error('Token refresh failed:', refreshError);
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
      
      return Promise.reject(error);
    }
  );
}

// Helper function to add auth token to axios instances
export function addAuthTokenInterceptor(axiosInstance: AxiosInstance) {
  axiosInstance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
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
            console.error('Error parsing auth storage:', error);
          }
        }
      }
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        // If no token is available and this isn't a public endpoint,
        // we should probably redirect to login immediately
        const isPublicEndpoint = config.url?.includes('/auth/') || 
                                config.url?.includes('/register') ||
                                config.url?.includes('/forgot-password');
        
        if (!isPublicEndpoint) {
          console.warn('No auth token available for protected endpoint:', config.url);
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
}