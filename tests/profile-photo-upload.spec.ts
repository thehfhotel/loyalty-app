import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Profile Photo Upload', () => {
  test('should upload and display profile photo', async ({ page }) => {
    // Login first
    await login(page);
    
    // Navigate to profile page
    await page.goto('/profile');
    
    // Wait for profile page to load
    await expect(page.locator('h1', { hasText: 'My Profile' })).toBeVisible();
    
    // Check initial state - no profile photo
    const profileImage = page.locator('img[alt="Profile"]');
    const userIcon = page.locator('svg[class*="FiUser"]');
    
    // Should show user icon initially (no profile photo)
    await expect(userIcon).toBeVisible();
    
    // Click the camera button to upload photo
    const cameraButton = page.locator('button[title="Upload profile photo"]');
    await expect(cameraButton).toBeVisible();
    
    // Create a test image file (1x1 pixel PNG)
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU8qgAAAABJRU5ErkJggg==',
      'base64'
    );
    
    // Set up file chooser handler
    const fileChooserPromise = page.waitForEvent('filechooser');
    await cameraButton.click();
    const fileChooser = await fileChooserPromise;
    
    // Upload the test image
    await fileChooser.setFiles({
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: testImageBuffer,
    });
    
    // Wait for upload to complete (loading spinner should appear and disappear)
    await expect(page.locator('div.animate-spin')).toBeVisible();
    await expect(page.locator('div.animate-spin')).not.toBeVisible({ timeout: 10000 });
    
    // Check success notification
    await expect(page.locator('text=Profile photo updated successfully')).toBeVisible();
    
    // Verify profile image is now displayed
    await expect(profileImage).toBeVisible();
    await expect(userIcon).not.toBeVisible();
    
    // Verify the image src contains the correct path
    const imageSrc = await profileImage.getAttribute('src');
    expect(imageSrc).toContain('/uploads/avatars/');
    
    // Test "Change Photo" functionality
    const changePhotoButton = page.locator('button', { hasText: 'Change Photo' });
    await expect(changePhotoButton).toBeVisible();
    
    // Test "Remove Photo" functionality
    const removePhotoButton = page.locator('button', { hasText: 'Remove Photo' });
    await expect(removePhotoButton).toBeVisible();
    
    // Click remove photo
    await removePhotoButton.click();
    
    // Wait for removal to complete
    await expect(page.locator('div.animate-spin')).toBeVisible();
    await expect(page.locator('div.animate-spin')).not.toBeVisible({ timeout: 10000 });
    
    // Check success notification
    await expect(page.locator('text=Profile photo removed successfully')).toBeVisible();
    
    // Verify profile image is removed and user icon is back
    await expect(profileImage).not.toBeVisible();
    await expect(userIcon).toBeVisible();
    
    // Verify "Upload Photo" button is back
    await expect(page.locator('button', { hasText: 'Upload Photo' })).toBeVisible();
  });
  
  test('should validate file size and type', async ({ page }) => {
    // Login first
    await login(page);
    
    // Navigate to profile page
    await page.goto('/profile');
    
    // Wait for profile page to load
    await expect(page.locator('h1', { hasText: 'My Profile' })).toBeVisible();
    
    // Test large file validation (simulate 6MB file)
    const largeFileBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('button[title="Upload profile photo"]').click();
    const fileChooser = await fileChooserPromise;
    
    await fileChooser.setFiles({
      name: 'large-file.jpg',
      mimeType: 'image/jpeg',
      buffer: largeFileBuffer,
    });
    
    // Should show size validation error
    await expect(page.locator('text=File size must be less than 5MB')).toBeVisible();
    
    // Test invalid file type validation
    const fileChooserPromise2 = page.waitForEvent('filechooser');
    await page.locator('button[title="Upload profile photo"]').click();
    const fileChooser2 = await fileChooserPromise2;
    
    await fileChooser2.setFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content'),
    });
    
    // Should show file type validation error
    await expect(page.locator('text=Please upload a valid image file')).toBeVisible();
  });
  
  test('should handle upload errors gracefully', async ({ page }) => {
    // Login first
    await login(page);
    
    // Navigate to profile page
    await page.goto('/profile');
    
    // Wait for profile page to load
    await expect(page.locator('h1', { hasText: 'My Profile' })).toBeVisible();
    
    // Mock network error for upload
    await page.route('**/api/users/avatar', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Upload failed' })
      });
    });
    
    // Create a test image file
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU8qgAAAABJRU5ErkJggg==',
      'base64'
    );
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('button[title="Upload profile photo"]').click();
    const fileChooser = await fileChooserPromise;
    
    await fileChooser.setFiles({
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: testImageBuffer,
    });
    
    // Should show error notification
    await expect(page.locator('text=Upload failed')).toBeVisible();
    
    // Upload button should be re-enabled
    await expect(page.locator('button[title="Upload profile photo"]')).toBeEnabled();
  });
});