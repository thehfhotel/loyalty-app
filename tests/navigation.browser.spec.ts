import { test, expect } from '@playwright/test';
import { loginViaUI, TEST_USER } from './helpers/auth';

test.describe('Navigation (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Navigate dashboard -> profile', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.getByTestId('nav-profile').click();

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByTestId('profile-name')).toBeVisible();
  });

  test('Navigate profile -> dashboard', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/profile');
    await page.getByTestId('nav-dashboard').click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('loyalty-points')).toBeVisible();
  });

  test('Deep link to profile works when authenticated', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/profile');

    await expect(page.getByTestId('profile-email')).toContainText(TEST_USER.email);
  });

  test('Deep link without auth redirects to login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
