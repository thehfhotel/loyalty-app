/**
 * Authentication helpers for k6 load tests
 */

import http from 'k6/http';
import { AUTH } from '../config/endpoints.js';

/**
 * Login and return tokens
 * @param {string} email
 * @param {string} password
 * @returns {Object|null} { accessToken, refreshToken, user } or null on failure
 */
export function login(email, password) {
  const res = http.post(
    AUTH.login,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      return {
        accessToken: body.tokens?.accessToken || body.accessToken,
        refreshToken: body.tokens?.refreshToken || body.refreshToken,
        user: body.user,
      };
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Refresh access token
 * @param {string} refreshToken
 * @returns {Object|null} { accessToken, refreshToken } or null on failure
 */
export function refreshToken(refreshToken) {
  const res = http.post(
    AUTH.refresh,
    JSON.stringify({ refreshToken }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      return {
        accessToken: body.tokens?.accessToken || body.accessToken,
        refreshToken: body.tokens?.refreshToken || body.refreshToken,
      };
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Get authorization headers with Bearer token
 * @param {string} token - Access token
 * @returns {Object} Headers object
 */
export function getAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

/**
 * Get JSON headers without auth
 * @returns {Object} Headers object
 */
export function getJsonHeaders() {
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * Logout
 * @param {string} accessToken
 * @returns {boolean} Success status
 */
export function logout(accessToken) {
  const res = http.post(
    AUTH.logout,
    null,
    { headers: getAuthHeaders(accessToken) }
  );
  return res.status === 200 || res.status === 204;
}

/**
 * Get current user info
 * @param {string} accessToken
 * @returns {Object|null} User object or null
 */
export function getCurrentUser(accessToken) {
  const res = http.get(AUTH.me, {
    headers: getAuthHeaders(accessToken),
  });

  if (res.status === 200) {
    try {
      return JSON.parse(res.body);
    } catch (e) {
      return null;
    }
  }
  return null;
}
