import { test, expect } from '@playwright/test';
import { loginViaUI, logout, TEST_USER, getAuthState } from './helpers/auth';

test.describe('Auth flow (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Login via UI', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('loyalty-points')).toBeVisible();
    await expect(page.getByTestId('logout-button')).toBeVisible();
  });

  test('Login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"]', TEST_USER.email);
    await page.fill('[data-testid="login-password"]', 'WrongPassword!');
    await page.click('[data-testid="login-submit"]');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test('Logout from dashboard', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await logout(page);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });

  test('Session persists across reloads', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('loyalty-points')).toBeVisible();

    const initialAuthState = await getAuthState<{ state?: { isAuthenticated?: boolean; user?: { email?: string } } }>(page);
    expect(initialAuthState?.state?.isAuthenticated).toBeTruthy();

    await page.reload();

    await expect(page).toHaveURL(/\/dashboard/);
    const rehydratedState = await getAuthState<{ state?: { isAuthenticated?: boolean; user?: { email?: string } } }>(page);
    expect(rehydratedState?.state?.isAuthenticated).toBeTruthy();
    expect(rehydratedState?.state?.user?.email).toBe(TEST_USER.email);
  });

  test('Protected route redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
