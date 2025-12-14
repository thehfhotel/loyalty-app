/* eslint-disable no-console -- Configuration utility uses console for environment debugging */
/**
 * API Configuration Utility
 *
 * Provides centralized API URL configuration with environment-aware fallback strategy.
 *
 * Best Practices:
 * - Uses relative URLs when served through nginx (browser context)
 * - Uses absolute URLs when needed for server-side or non-proxied requests
 * - Production: Requires VITE_API_URL to be explicitly set
 * - Development: Falls back to relative /api path (proxied by nginx)
 */

/**
 * Detect if running in browser context (as opposed to SSR or build time)
 */
const isBrowser = typeof window !== 'undefined';

/**
 * Get the API base URL with environment-aware fallback strategy
 *
 * @returns {string} The API base URL
 * @throws {Error} In production if VITE_API_URL is not configured
 */
export const getApiUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL;

  // If environment variable is set, use it (both dev and prod)
  if (envUrl) {
    return envUrl;
  }

  // In browser context, use relative URL (will be proxied by nginx)
  // This works when frontend is accessed through nginx at http://localhost:5001
  if (isBrowser) {
    return '/api';
  }

  // In development mode (build time), allow fallback with warning
  if (import.meta.env.MODE === 'development') {
    console.warn(
      '⚠️ VITE_API_URL not set, using relative /api path. ' +
      'This will be proxied by nginx in browser context.'
    );
    return '/api';
  }

  // In production, fail fast with clear error message
  throw new Error(
    'VITE_API_URL must be set in production environment. ' +
    'Check your .env.production file and docker-compose configuration. ' +
    'Expected format: https://yourdomain.com/api'
  );
};

/**
 * API base URL - Use this constant in all service files
 * Configured via VITE_API_URL environment variable with intelligent fallback
 */
export const API_BASE_URL = getApiUrl();

/**
 * Check if the application is running in development mode
 */
export const isDevelopment = import.meta.env.MODE === 'development';

/**
 * Check if the application is running in production mode
 */
export const isProduction = import.meta.env.MODE === 'production';
