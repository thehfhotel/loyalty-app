import { test, expect } from '@playwright/test';
import { loginViaUI, getTestUserForWorker } from './helpers/auth';

test.describe('Navigation (browser)', () => {
  // Run tests serially to avoid session conflicts during parallel login
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Navigate dashboard -> profile', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.getByTestId('nav-profile').click();

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByTestId('profile-name')).toBeVisible();
  });

  test('Navigate profile -> dashboard', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-dashboard').click();

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('Deep link to profile works when authenticated', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('profile-email')).toContainText(user.email);
  });

  test('Deep link without auth redirects to login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
