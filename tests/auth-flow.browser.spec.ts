import { test, expect } from '@playwright/test';
import { loginViaUI, logout, TEST_USER, getAuthState } from './helpers/auth';

test.describe('Auth flow (browser)', () => {
  test.beforeEach(async ({ page }) => {
    // Capture console logs for debugging
    page.on('console', msg => {
      if (msg.text().includes('apiConfig') || msg.text().includes('trpcProvider') || msg.text().includes('Auth Debug') || msg.text().includes('tRPC fetch')) {
        console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
      }
    });

    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Login via UI', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);

    await expect(page).toHaveURL(/\/dashboard/);

    // Wait for loading to finish (either data loads, error occurs, or timeout)
    // Check which state the dashboard is in for debugging
    const loadingVisible = await page.getByTestId('dashboard-loading').isVisible().catch(() => false);
    const errorVisible = await page.getByTestId('loyalty-error').isVisible().catch(() => false);
    const pointsVisible = await page.getByTestId('loyalty-points').isVisible().catch(() => false);

    console.log(`Dashboard state: loading=${loadingVisible}, error=${errorVisible}, points=${pointsVisible}`);

    // If stuck in loading or showing error, log the page content for debugging
    if (loadingVisible || errorVisible || !pointsVisible) {
      const html = await page.content();
      console.log('Page HTML (truncated):', html.substring(0, 2000));
    }

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
