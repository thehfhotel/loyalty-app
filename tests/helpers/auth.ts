import { Page, expect } from '@playwright/test';

export async function login(page: Page, email = 'test@example.com', password = 'password123') {
  await page.goto('/login');
  
  // Wait for login form to be visible
  await expect(page.locator('form')).toBeVisible();
  
  // Fill in credentials
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  
  // Submit form
  await page.click('button[type="submit"]');
  
  // Wait for successful login - should redirect to dashboard
  await expect(page).toHaveURL('/dashboard');
  
  return page;
}

export async function loginAsAdmin(page: Page) {
  return await login(page, 'winut.hf@gmail.com', 'Kick2you@ss');
}

export const authHelpers = {
  login,
  loginAsAdmin
};