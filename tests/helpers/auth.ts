import { Page, expect } from '@playwright/test';

export const TEST_USER = {
  email: 'e2e-browser@test.com',
  password: 'E2ETestPassword123!',
  firstName: 'E2E',
  lastName: 'Browser',
};

const AUTH_STORAGE_KEY = 'auth-storage';

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.fill('[data-testid="login-email"]', email);
  await page.fill('[data-testid="login-password"]', password);
  await page.click('[data-testid="login-submit"]');
  // Use regex pattern with extended timeout for more reliable matching
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
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
  await page.click('[data-testid="logout-button"]');
  // Wait for navigation to login page (may include query params like ?returnUrl=...)
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await expect(page).toHaveURL(/\/login/);
}
