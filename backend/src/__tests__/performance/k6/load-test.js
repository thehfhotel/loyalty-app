import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthLatency = new Trend('health_check_latency');
const authLatency = new Trend('auth_latency');
const loyaltyLatency = new Trend('loyalty_latency');

// Test configuration for 20-100 concurrent users (stress test up to 300)
export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { test_type: 'smoke' },
    },
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },   // Ramp up to minimum expected (20 users)
        { duration: '1m', target: 50 },    // Increase to average load (50 users)
        { duration: '1m', target: 100 },   // Peak load (100 users)
        { duration: '1m', target: 200 },   // Stress: 2x peak
        { duration: '1m', target: 300 },   // Stress: 3x peak (find breaking point)
        { duration: '30s', target: 100 },  // Scale back to peak
        { duration: '30s', target: 0 },    // Ramp down to 0
      ],
      tags: { test_type: 'load' },
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'errors': ['rate<0.1'], // Error rate should be less than 10%
    'health_check_latency': ['p(95)<200'],
    'auth_latency': ['p(95)<500'],
    'loyalty_latency': ['p(95)<500'],
  },
};

// Base URL from environment or default
const BASE_URL = __ENV.BACKEND_URL || 'http://localhost:4202';

// Test data
const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
};

export default function () {
  // Group 1: Health Check
  group('Health Check', function () {
    const healthRes = http.get(`${BASE_URL}/api/health`);

    const healthCheck = check(healthRes, {
      'health check status is 200': (r) => r.status === 200,
      'health check has status field': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.status !== undefined;
        } catch (e) {
          return false;
        }
      },
    });

    errorRate.add(!healthCheck);
    healthLatency.add(healthRes.timings.duration);
  });

  // Group 2: Authentication Flow
  group('Authentication Flow', function () {
    const loginPayload = JSON.stringify(TEST_USER);
    const loginParams = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      loginPayload,
      loginParams
    );

    const loginCheck = check(loginRes, {
      'login status is 200 or 401': (r) => r.status === 200 || r.status === 401,
      'login response has body': (r) => r.body.length > 0,
    });

    errorRate.add(!loginCheck);
    authLatency.add(loginRes.timings.duration);

    // If login successful, store token for subsequent requests
    let authToken = null;
    if (loginRes.status === 200) {
      try {
        const loginBody = JSON.parse(loginRes.body);
        authToken = loginBody.token || loginBody.accessToken;
      } catch (e) {
        // Token parsing failed, continue without token
      }
    }

    // Group 3: Loyalty Status (may require authentication)
    group('Loyalty Status', function () {
      const tiersParams = {
        headers: authToken
          ? {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            }
          : {
              'Content-Type': 'application/json',
            },
      };

      const tiersRes = http.get(`${BASE_URL}/api/loyalty/tiers`, tiersParams);

      const tiersCheck = check(tiersRes, {
        'loyalty tiers status is 200 or 401': (r) =>
          r.status === 200 || r.status === 401,
        'loyalty tiers response has body': (r) => r.body.length > 0,
      });

      errorRate.add(!tiersCheck);
      loyaltyLatency.add(tiersRes.timings.duration);
    });
  });

  // Sleep for 1 second between iterations
  sleep(1);
}
