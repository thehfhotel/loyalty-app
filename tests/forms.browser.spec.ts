import { test, expect } from '@playwright/test';
import { loginViaUI, TEST_USER } from './helpers/auth';

test.describe('Form validations (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Login - empty email shows validation', async ({ page }) => {
    await page.click('[data-testid="login-submit"]');
    await expect(page.getByText(/invalid email address/i)).toBeVisible();
  });

  test('Login - invalid email format', async ({ page }) => {
    await page.fill('[data-testid="login-email"]', 'not-an-email');
    await page.fill('[data-testid="login-password"]', 'password');
    await page.click('[data-testid="login-submit"]');

    await expect(page.getByText(/invalid email address/i)).toBeVisible();
  });

  test('Login - empty password', async ({ page }) => {
    await page.fill('[data-testid="login-email"]', TEST_USER.email);
    await page.click('[data-testid="login-submit"]');

    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  test('Registration - password requirements enforced', async ({ page }) => {
    await page.goto('/register');

    await page.fill('#firstName', 'Test');
    await page.fill('#lastName', 'User');
    await page.fill('#email', 'reg@test.com');
    await page.fill('#password', '123');
    await page.fill('#confirmPassword', '123');
    await page.click('button[type="submit"]');

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('Profile - phone format validation', async ({ page }) => {
    await loginViaUI(page, TEST_USER.email, TEST_USER.password);
    await page.goto('/profile');
    await page.getByRole('button', { name: /edit settings/i }).click();

    await page.getByLabel(/phone number/i).fill('abc');
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(/valid phone number/i)).toBeVisible();
  });
});
