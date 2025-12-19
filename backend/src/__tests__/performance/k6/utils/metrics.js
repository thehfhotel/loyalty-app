/**
 * Custom metrics for k6 load tests
 */

import { Rate, Trend, Counter } from 'k6/metrics';

// Error rate tracking
export const errorRate = new Rate('errors');

// Domain-specific latency metrics
export const healthLatency = new Trend('health_latency');
export const authLatency = new Trend('auth_latency');
export const userLatency = new Trend('user_latency');
export const loyaltyLatency = new Trend('loyalty_latency');
export const couponLatency = new Trend('coupon_latency');
export const surveyLatency = new Trend('survey_latency');
export const notificationLatency = new Trend('notification_latency');
export const oauthLatency = new Trend('oauth_latency');
export const analyticsLatency = new Trend('analytics_latency');
export const membershipLatency = new Trend('membership_latency');
export const translationLatency = new Trend('translation_latency');

// Request counters
export const successfulRequests = new Counter('successful_requests');
export const failedRequests = new Counter('failed_requests');

// Domain-specific request counters
export const authRequests = new Counter('auth_requests');
export const userRequests = new Counter('user_requests');
export const loyaltyRequests = new Counter('loyalty_requests');
export const couponRequests = new Counter('coupon_requests');
export const surveyRequests = new Counter('survey_requests');

/**
 * Record a request result
 * @param {boolean} success - Whether request was successful
 * @param {number} duration - Request duration in ms
 * @param {Trend} latencyMetric - The latency trend to record to
 */
export function recordRequest(success, duration, latencyMetric) {
  errorRate.add(!success);
  latencyMetric.add(duration);

  if (success) {
    successfulRequests.add(1);
  } else {
    failedRequests.add(1);
  }
}

/**
 * Check if response is successful (2xx status)
 * @param {Object} response - k6 http response
 * @returns {boolean}
 */
export function isSuccess(response) {
  return response.status >= 200 && response.status < 300;
}

/**
 * Check if response is client error (4xx) - expected in some cases
 * @param {Object} response - k6 http response
 * @returns {boolean}
 */
export function isClientError(response) {
  return response.status >= 400 && response.status < 500;
}

/**
 * Check if response is server error (5xx) - always bad
 * @param {Object} response - k6 http response
 * @returns {boolean}
 */
export function isServerError(response) {
  return response.status >= 500;
}
