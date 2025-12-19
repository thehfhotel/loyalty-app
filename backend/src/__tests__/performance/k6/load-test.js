import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthLatency = new Trend('health_check_latency');
const authLatency = new Trend('auth_latency');
const loyaltyLatency = new Trend('loyalty_latency');

// Test configuration
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
        { duration: '30s', target: 5 },  // Ramp up to 5 VUs
        { duration: '1m', target: 10 },  // Stay at 10 VUs
        { duration: '30s', target: 0 },  // Ramp down to 0
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

// Custom summary output
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

// Simple text summary helper
function textSummary(data, options = {}) {
  const indent = options.indent || '';
  const enableColors = options.enableColors !== false;

  let summary = '\n';

  if (data.metrics) {
    summary += `${indent}Metrics Summary:\n`;
    summary += `${indent}================\n\n`;

    // HTTP metrics
    if (data.metrics.http_req_duration) {
      const duration = data.metrics.http_req_duration;
      summary += `${indent}HTTP Request Duration:\n`;
      summary += `${indent}  avg: ${duration.values.avg?.toFixed(2)}ms\n`;
      summary += `${indent}  p95: ${duration.values['p(95)']?.toFixed(2)}ms\n`;
      summary += `${indent}  p99: ${duration.values['p(99)']?.toFixed(2)}ms\n\n`;
    }

    // Custom metrics
    if (data.metrics.errors) {
      const errors = data.metrics.errors;
      summary += `${indent}Error Rate: ${(errors.values.rate * 100).toFixed(2)}%\n`;
    }

    if (data.metrics.health_check_latency) {
      const health = data.metrics.health_check_latency;
      summary += `${indent}Health Check Latency (avg): ${health.values.avg?.toFixed(2)}ms\n`;
    }

    if (data.metrics.auth_latency) {
      const auth = data.metrics.auth_latency;
      summary += `${indent}Auth Latency (avg): ${auth.values.avg?.toFixed(2)}ms\n`;
    }

    if (data.metrics.loyalty_latency) {
      const loyalty = data.metrics.loyalty_latency;
      summary += `${indent}Loyalty Latency (avg): ${loyalty.values.avg?.toFixed(2)}ms\n`;
    }
  }

  summary += '\n';
  return summary;
}
