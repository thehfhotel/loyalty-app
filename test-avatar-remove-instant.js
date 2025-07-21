const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing instant avatar removal...');
    
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    // Go to profile
    await page.goto('http://localhost:3000/profile');
    await page.waitForSelector('h1:has-text("My Profile")', { timeout: 10000 });
    
    console.log('✅ Profile page loaded');
    
    // Check if there's an avatar to remove
    const profileImage = page.locator('img[alt="Profile"]');
    const hasAvatar = await profileImage.isVisible();
    
    if (!hasAvatar) {
      console.log('📷 No avatar present, test not applicable');
      return;
    }
    
    console.log('🖼️ Avatar present, testing removal...');
    
    // Find and click remove button
    const removeButton = page.locator('button:has-text("Remove Photo")');
    const isRemoveVisible = await removeButton.isVisible();
    
    if (!isRemoveVisible) {
      console.log('❌ Remove button not visible');
      return;
    }
    
    console.log('🗑️ Remove button found, clicking...');
    
    // Handle confirmation dialog and click remove
    page.on('dialog', async dialog => {
      console.log(`📋 Confirmation dialog: ${dialog.message()}`);
      await dialog.accept();
    });
    
    await removeButton.click();
    
    // Wait for success notification
    await page.waitForSelector('text=Profile photo removed successfully', { timeout: 10000 });
    console.log('✅ Remove success notification appeared');
    
    // Check if avatar is instantly removed
    await page.waitForTimeout(500);
    
    const isAvatarGone = !(await profileImage.isVisible());
    const userIcon = page.locator('svg').first();
    const isIconVisible = await userIcon.isVisible();
    
    console.log(`🚫 Avatar removed: ${isAvatarGone}`);
    console.log(`👤 Default icon visible: ${isIconVisible}`);
    
    if (isAvatarGone && isIconVisible) {
      console.log('\n🎉 SUCCESS: Avatar removed instantly!');
      console.log('✅ State updated immediately');
      console.log('✅ Default icon displayed');
    } else {
      console.log('❌ FAILED: Avatar removal not instant');
    }
    
    // Take screenshot
    await page.screenshot({ path: 'avatar-remove-test.png' });
    console.log('📸 Screenshot saved');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'avatar-remove-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 3 seconds...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();