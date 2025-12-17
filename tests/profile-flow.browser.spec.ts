import { test, expect } from '@playwright/test';
import { loginViaUI, TEST_USER } from './helpers/auth';

test.describe('Profile flow (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/profile');
  });

  test('View profile page', async ({ page }) => {
    await expect(page.getByTestId('profile-name')).toBeVisible();
    await expect(page.getByTestId('profile-name')).toContainText(/E2E/i);
    await expect(page.getByTestId('profile-email')).toContainText(TEST_USER.email);
  });

  test('Update profile name', async ({ page }) => {
    await page.getByRole('button', { name: /edit settings/i }).click();

    const newFirstName = `E2E ${Date.now()}`;
    const newLastName = 'Browser';

    await page.getByLabel(/first name/i).fill(newFirstName);
    await page.getByLabel(/last name/i).fill(newLastName);
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(/profile updated successfully/i)).toBeVisible();
    await expect(page.getByTestId('profile-name')).toContainText(newFirstName);
  });

  test('Update profile phone number', async ({ page }) => {
    await page.getByRole('button', { name: /edit settings/i }).click();

    const newPhone = '+1 (555) 010-2020';
    await page.getByLabel(/phone number/i).fill(newPhone);
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(/profile updated successfully/i)).toBeVisible();
    await expect(page.getByText(newPhone)).toBeVisible();
  });

  test('Profile validation errors surface in modal', async ({ page }) => {
    await page.getByRole('button', { name: /edit settings/i }).click();

    await page.getByLabel(/first name/i).fill('');
    await page.getByLabel(/phone number/i).fill('abc');
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(/first name is required/i)).toBeVisible();
    await expect(page.getByText(/valid phone number/i)).toBeVisible();
  });

  test('Emoji avatar selection updates profile', async ({ page }) => {
    await page.getByRole('button', { name: /edit settings/i }).click();
    await page.getByRole('button', { name: /choose emoji/i }).click();

    const emojiButton = page.getByRole('button', { name: /select .* as profile picture/i }).first();
    await emojiButton.click();

    await expect(page.getByText(/profile picture updated/i)).toBeVisible();
  });
});
