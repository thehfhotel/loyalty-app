import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

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

        // Clear auth state
        authStore.clearAuth();
        
        // Show session expired message only once
        if (!sessionExpiredShown) {
          sessionExpiredShown = true;
          toast.error('Your session has expired. Please log in again.');
          
          // Reset the flag after 5 seconds
          setTimeout(() => {
            sessionExpiredShown = false;
          }, 5000);
        }
        
        // Redirect to login with return URL
        const returnUrl = currentPath + window.location.search;
        window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
      }
      
      return Promise.reject(error);
    }
  );
}

// Helper function to add auth token to axios instances
export function addAuthTokenInterceptor(axiosInstance: any) {
  axiosInstance.interceptors.request.use(
    (config: any) => {
      const authStorage = localStorage.getItem('auth-storage');
      
      if (authStorage) {
        try {
          const parsedAuth = JSON.parse(authStorage);
          const token = parsedAuth.state?.accessToken;
          
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        } catch (error) {
          console.error('Error parsing auth storage:', error);
        }
      }
      return config;
    },
    (error: any) => {
      return Promise.reject(error);
    }
  );
}