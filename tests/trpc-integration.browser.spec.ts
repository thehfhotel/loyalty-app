import { test, expect } from '@playwright/test';
import { loginViaUI, TEST_USER } from './helpers/auth';

test.describe('tRPC integration (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Dashboard loads loyalty data', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);

    await expect(page.getByTestId('loyalty-points')).toBeVisible();
    await expect(page.getByTestId('loyalty-tier')).toBeVisible();
  });

  test('Profile loads user data', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/profile');

    await expect(page.getByTestId('profile-name')).toContainText(/E2E/i);
    await expect(page.getByTestId('profile-email')).toContainText(TEST_USER.email);
  });

  test('No 401 errors on tRPC calls', async ({ page }) => {
    const trpcStatuses: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/trpc/')) {
        trpcStatuses.push(response.status());
      }
    });

    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/dashboard');
    await expect(page.getByTestId('loyalty-points')).toBeVisible();
    await page.waitForTimeout(1000);

    expect(trpcStatuses.length).toBeGreaterThan(0);
    expect(trpcStatuses).not.toContain(401);
  });

  test('Data persists after reload', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/dashboard');

    const pointsText = (await page.getByTestId('loyalty-points').innerText()).trim();
    const tierText = (await page.getByTestId('loyalty-tier').innerText()).trim();

    await page.reload();
    await expect(page.getByTestId('loyalty-points')).toHaveText(pointsText);
    await expect(page.getByTestId('loyalty-tier')).toHaveText(tierText);
  });
});
