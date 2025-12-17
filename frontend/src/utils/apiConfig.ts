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

import { logger } from './logger';

/**
 * Detect if running in browser context (as opposed to SSR or build time)
 */
const isBrowser = typeof window !== 'undefined';

/**
 * Get the API base URL with environment-aware fallback strategy
 *
 * @returns {string} The API base URL
 *
 * IMPORTANT: In browser context, we ALWAYS use relative URLs (/api) so that:
 * 1. Requests go through the proxy (Vite dev server or nginx)
 * 2. CORS is handled automatically (same-origin requests)
 * 3. SSL certificates work correctly
 *
 * The VITE_API_URL is used to configure the proxy target, not for direct requests.
 */
export const getApiUrl = (): string => {
  // In browser context, ALWAYS use relative URL to go through proxy
  // This ensures CORS is handled correctly by the proxy layer
  if (isBrowser) {
    return '/api';
  }

  // For non-browser contexts (SSR, build time), use environment variable if set
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    return envUrl;
  }

  // In development mode (build time), allow fallback with warning
  if (import.meta.env.MODE === 'development') {
    logger.warn(
      '⚠️ VITE_API_URL not set, using relative /api path. ' +
      'This will be proxied by nginx in browser context.'
    );
    return '/api';
  }

  // Default fallback - relative URL works in most cases
  return '/api';
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
