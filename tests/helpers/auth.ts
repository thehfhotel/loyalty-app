import { Page, expect } from '@playwright/test';

export const TEST_USER = {
  email: 'e2e-browser@test.com',
  password: 'E2ETestPassword123!',
  firstName: 'E2E',
  lastName: 'Browser',
};

const AUTH_STORAGE_KEY = 'auth-storage';

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  const maxRetries = 2;
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

      // Wait for successful navigation to dashboard
      await page.waitForURL(/\/dashboard/, { timeout: 20000 });
      return; // Success - exit the retry loop
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        // Wait before retry to allow any session conflicts to resolve
        await page.waitForTimeout(1000);
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
  await page.click('[data-testid="logout-button"]');
  // Wait for navigation to login page (may include query params like ?returnUrl=...)
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await expect(page).toHaveURL(/\/login/);
}
