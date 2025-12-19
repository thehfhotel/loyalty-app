/**
 * Base k6 test options and thresholds
 * Shared across all load test files
 */

// Standard load test scenarios
export const loadScenarios = {
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
      { duration: '30s', target: 20 },   // Ramp up to minimum expected
      { duration: '1m', target: 50 },    // Average load
      { duration: '1m', target: 100 },   // Peak load
      { duration: '1m', target: 200 },   // Stress: 2x peak
      { duration: '1m', target: 300 },   // Stress: 3x peak
      { duration: '30s', target: 100 },  // Scale back
      { duration: '30s', target: 0 },    // Ramp down
    ],
    tags: { test_type: 'load' },
  },
};

// Quick smoke test only (for CI/rapid testing)
export const smokeOnlyScenarios = {
  smoke: {
    executor: 'constant-vus',
    vus: 5,
    duration: '1m',
    tags: { test_type: 'smoke' },
  },
};

// Browser test scenarios (lower VUs due to resource intensity)
export const browserScenarios = {
  browser: {
    executor: 'constant-vus',
    vus: 3,
    duration: '2m',
    options: {
      browser: {
        type: 'chromium',
      },
    },
    tags: { test_type: 'browser' },
  },
};

// Browser smoke test (quick verification)
export const browserSmokeScenarios = {
  browser: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
    options: {
      browser: {
        type: 'chromium',
      },
    },
    tags: { test_type: 'browser-smoke' },
  },
};

// Standard API thresholds
export const apiThresholds = {
  'http_req_duration': ['p(95)<500', 'p(99)<1000'],
  'http_req_failed': ['rate<0.1'],
  'errors': ['rate<0.1'],
};

// Browser performance thresholds (Core Web Vitals)
export const browserThresholds = {
  'browser_web_vital_lcp': ['p(95)<2500'],  // Largest Contentful Paint < 2.5s
  'browser_web_vital_cls': ['p(95)<0.1'],   // Cumulative Layout Shift < 0.1
  'browser_web_vital_inp': ['p(95)<200'],   // Interaction to Next Paint < 200ms
};

// Combined options for full API load test
export const fullApiOptions = {
  scenarios: loadScenarios,
  thresholds: apiThresholds,
};

// Combined options for smoke test only
export const smokeOptions = {
  scenarios: smokeOnlyScenarios,
  thresholds: apiThresholds,
};

// Combined options for browser tests
export const browserOptions = {
  scenarios: browserScenarios,
  thresholds: browserThresholds,
};

// Combined options for browser smoke tests (quick verification)
export const browserSmokeOptions = {
  scenarios: browserSmokeScenarios,
  thresholds: browserThresholds,
};
