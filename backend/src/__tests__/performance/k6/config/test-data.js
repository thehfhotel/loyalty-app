/**
 * Test data and fixtures for k6 load tests
 * Uses existing E2E test users seeded by seedDatabase.ts
 */

// Test users (seeded by backend/src/utils/seedDatabase.ts)
export const TEST_USERS = {
  primary: {
    email: 'e2e-browser@test.com',
    password: 'E2ETestPassword123!',
  },
  secondary: {
    email: 'e2e-browser-2@test.com',
    password: 'E2ETestPassword123!',
  },
};

// Test data IDs (from seed data)
export const TEST_DATA = {
  surveys: {
    // Public Test Survey ID from seedDatabase.ts
    publicSurveyId: 'b5cbde95-7faf-4268-b3e3-7047a1e4e17b',
  },
  coupons: {
    // Sample coupon QR code for validation testing
    sampleQrCode: 'TEST-QR-CODE-123',
  },
  loyalty: {
    // Simulate stay amount in THB
    simulateStayAmount: 1000,
    simulateNights: 1,
  },
};

// Registration data generator (unique per VU)
export function generateRegistrationData(vuId, iteration) {
  const timestamp = Date.now();
  return {
    email: `loadtest-${vuId}-${iteration}-${timestamp}@test.com`,
    password: 'LoadTest123!',
    firstName: `LoadTest${vuId}`,
    lastName: `User${iteration}`,
    phone: `08${String(vuId).padStart(2, '0')}${String(iteration).padStart(6, '0')}`,
  };
}

// Profile update data
export const PROFILE_UPDATE_DATA = {
  firstName: 'Updated',
  lastName: 'LoadTest',
  phone: '0812345678',
  dateOfBirth: '1990-01-15',
};

// Survey response data
export function generateSurveyResponse(surveyId, questionId) {
  return {
    surveyId,
    answers: [
      {
        questionId,
        answer: 'Load test response',
        selectedOptions: [],
      },
    ],
  };
}

// Push notification subscription data (mock)
export const PUSH_SUBSCRIPTION_DATA = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
  keys: {
    p256dh: 'test-p256dh-key',
    auth: 'test-auth-key',
  },
};
