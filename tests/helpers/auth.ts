import { Page, expect } from '@playwright/test';

// Two test users for parallel worker support (workers: 2)
export const TEST_USERS = [
  {
    email: 'e2e-browser@test.com',
    password: 'E2ETestPassword123!',
    firstName: 'E2E',
    lastName: 'Browser',
  },
  {
    email: 'e2e-browser-2@test.com',
    password: 'E2ETestPassword123!',
    firstName: 'E2E',
    lastName: 'Browser2',
  },
];

// Default test user (for backward compatibility)
export const TEST_USER = TEST_USERS[0];

// Get test user for specific worker index (for parallel test isolation)
export function getTestUserForWorker(workerIndex: number) {
  return TEST_USERS[workerIndex % TEST_USERS.length];
}

// Admin user for testing admin pages (configured in admins.e2e.json mounted in CI)
export const ADMIN_USER = {
  email: process.env.E2E_ADMIN_EMAIL || 'e2e-admin@test.local',
  password: process.env.E2E_ADMIN_PASSWORD || 'AdminPassword123!',
  firstName: 'E2E',
  lastName: 'Admin',
};

// Get admin user
export function getAdminUser() {
  return ADMIN_USER;
}

const AUTH_STORAGE_KEY = 'auth-storage';

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  const maxRetries = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Clear any existing session state before login attempt
      await page.context().clearCookies();
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Ensure we're on the login page
      await expect(page.locator('[data-testid="login-email"]')).toBeVisible({ timeout: 5000 });

      await page.fill('[data-testid="login-email"]', email);
      await page.fill('[data-testid="login-password"]', password);
      await page.click('[data-testid="login-submit"]');

      // Race: wait for either dashboard redirect OR error message
      // This provides visibility into WHY login fails instead of just timing out
      const result = await Promise.race([
        page.waitForURL(/\/dashboard/, { timeout: 10000 }).then(() => 'success' as const),
        page.locator('[role="alert"], .Toastify__toast--error, [data-testid*="error"]')
          .first()
          .waitFor({ timeout: 10000, state: 'visible' })
          .then(async (el) => {
            const text = await el.textContent();
            return `error: ${text}` as const;
          })
          .catch(() => null),
      ]);

      if (result === 'success') {
        return; // Success - exit the retry loop
      }

      if (result?.startsWith('error:')) {
        throw new Error(`Login failed with message: ${result.substring(7)}`);
      }

      // If neither succeeded, fall through to retry
      throw new Error('Login did not navigate to dashboard');
    } catch (error) {
      lastError = error as Error;
      // Only retry if page is still open
      if (attempt < maxRetries && !page.isClosed()) {
        await page.waitForTimeout(500);
      }
    }
  }

  throw lastError;
}

export async function loginViaLocalStorage(page: Page, authState: unknown): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    (state, storageKey) => {
      localStorage.setItem(storageKey, JSON.stringify(state));
    },
    authState,
    AUTH_STORAGE_KEY,
  );
}

export async function getAuthState<T = unknown>(page: Page): Promise<T | null> {
  return page.evaluate((storageKey) => {
    const state = localStorage.getItem(storageKey);
    return state ? JSON.parse(state) : null;
  }, AUTH_STORAGE_KEY);
}

export async function logout(page: Page): Promise<void> {
  // Logout button is now on the Profile page (moved from header)
  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  await page.click('[data-testid="logout-button"]');
  // Wait for navigation to login page (may include query params like ?returnUrl=...)
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await expect(page).toHaveURL(/\/login/);
}
