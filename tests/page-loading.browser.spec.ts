import { test, expect } from '@playwright/test';
import { loginViaUI, getTestUserForWorker } from './helpers/auth';

test.describe('Page loading (browser)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Login page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('Dashboard page loads after login', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);

    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForLoadState('networkidle');

    // Dashboard should show loyalty data
    await expect(page.getByTestId('dashboard-points')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('dashboard-tier')).toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });

  test('Profile page loads', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('profile-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('profile-email')).toContainText(user.email);

    expect(errors).toHaveLength(0);
  });

  test('Bookings page loads', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    // Page should render without crashing (may show empty state)
    await expect(page.locator('main, [data-testid="bookings-page"], h1, h2').first()).toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });

  test('Coupons page loads', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/coupons');
    await page.waitForLoadState('networkidle');

    // Page should render without crashing
    await expect(page.locator('main, [data-testid="coupons-page"], h1, h2').first()).toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });

  test('No uncaught errors on authenticated navigation', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const failedRequests: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      const status = response.status();
      // Track 5xx server errors (not 4xx which may be expected)
      if (status >= 500 && !url.includes('/surveys/available') && !url.includes('/surveys/public') && !url.includes('/surveys/invited') && !url.includes('/surveys/responses/')) {
        failedRequests.push(`${status} ${url}`);
      }
    });

    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);

    // Visit each main page
    const pages = ['/dashboard', '/profile', '/bookings', '/coupons'];
    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    expect(errors).toHaveLength(0);
    expect(failedRequests).toHaveLength(0);
  });
});
