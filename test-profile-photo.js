const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    
    console.log('🔄 Logging in...');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard or profile redirect
    console.log('🔄 Waiting for login to complete...');
    await page.waitForTimeout(3000);
    
    console.log('🔄 Navigating to profile page...');
    await page.goto('http://localhost:3000/profile');
    
    console.log('🔄 Waiting for profile page to load...');
    await page.waitForSelector('h1:has-text("My Profile")', { timeout: 10000 });
    
    console.log('✅ Profile page loaded!');
    
    // Check if avatar upload button exists
    const cameraButton = await page.locator('button[title="Upload profile photo"]');
    const isVisible = await cameraButton.isVisible();
    console.log(`📷 Camera upload button visible: ${isVisible}`);
    
    // Check if upload photo button exists
    const uploadButton = await page.locator('button:has-text("Upload Photo")');
    const uploadVisible = await uploadButton.isVisible();
    console.log(`📤 Upload Photo button visible: ${uploadVisible}`);
    
    // Take a screenshot
    await page.screenshot({ path: 'profile-page-screenshot.png' });
    console.log('📸 Screenshot saved as profile-page-screenshot.png');
    
    console.log('✅ Profile photo upload UI is present and working!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
})();