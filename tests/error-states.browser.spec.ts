import { test, expect } from '@playwright/test';
import { loginViaUI, TEST_USER } from './helpers/auth';

test.describe('Error states (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.context().setOffline(false);
  });

  test('Network error handling shows feedback', async ({ page }) => {
    await page.context().setOffline(true);
    await page.goto('/login');

    await page.fill('[data-testid="login-email"]', TEST_USER.email);
    await page.fill('[data-testid="login-password"]', TEST_USER.password);
    await page.click('[data-testid="login-submit"]');

    await expect(page.getByText(/network error/i)).toBeVisible();
    await page.context().setOffline(false);
  });

  test('Session expiry redirects to login', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/dashboard');

    await page.evaluate(() => localStorage.removeItem('auth-storage'));
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });

  test('Profile save error is surfaced', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/profile');

    await page.route('**/trpc/user.updateProfile**', (route) => route.abort('failed'));

    await page.getByRole('button', { name: /edit settings/i }).click();
    await page.getByLabel(/first name/i).fill('E2E Error');
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(/error/i)).toBeVisible();
    await page.unroute('**/trpc/user.updateProfile**');
  });

  test('Retry loads data after transient failure', async ({ page }) => {
    let attempt = 0;
    await page.route('**/trpc/loyalty.getStatus**', (route) => {
      attempt += 1;
      if (attempt === 1) {
        return route.abort('failed');
      }
      return route.continue();
    });

    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/dashboard');

    await page.reload();
    await expect(page.getByTestId('loyalty-points')).toBeVisible();
  });
});
