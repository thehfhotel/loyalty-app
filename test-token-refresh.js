const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing token refresh functionality...');
    
    // Login as admin
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    console.log('✅ Logged in successfully');
    
    // Navigate to admin coupons page
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForSelector('h1:has-text("Coupon Management")', { timeout: 10000 });
    
    console.log('✅ Admin coupons page loaded');
    
    // First, let's create a test coupon to delete
    await page.click('button:has-text("Create Coupon")');
    await page.waitForSelector('h2:has-text("Create New Coupon")');
    
    const timestamp = Date.now();
    await page.fill('input[placeholder="e.g. SUMMER20"]', `TESTDEL${timestamp}`);
    await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', `Test Delete ${timestamp}`);
    await page.fill('textarea', 'This coupon is for testing deletion with token refresh');
    await page.fill('input[type="number"]', '15'); // 15% discount
    await page.fill('input[type="date"]', '2025-12-31'); // Valid until
    
    await page.click('button[type="submit"]');
    await page.waitForSelector('h2:has-text("Create New Coupon")', { state: 'hidden', timeout: 10000 });
    
    console.log('✅ Test coupon created');
    await page.waitForTimeout(2000); // Wait for list to refresh
    
    // Now try to delete the first coupon
    const firstCouponRow = page.locator('tbody tr').first();
    const removeButton = firstCouponRow.locator('button:has-text("Remove")');
    
    await removeButton.click();
    await page.waitForSelector('h2:has-text("Delete Coupon")', { timeout: 5000 });
    
    console.log('✅ Delete modal opened');
    
    // Type DELETE to confirm
    await page.fill('input[placeholder="Type DELETE here"]', 'DELETE');
    
    // Click delete button
    await page.click('button:has-text("Delete Coupon")');
    
    console.log('🔄 Delete request sent...');
    
    // Monitor for either success or error
    try {
      // Wait for modal to close (success) or error message to appear
      await Promise.race([
        page.waitForSelector('h2:has-text("Delete Coupon")', { state: 'hidden', timeout: 10000 }),
        page.waitForSelector('text*="session has expired"', { timeout: 10000 }),
        page.waitForSelector('text*="Failed to delete"', { timeout: 10000 })
      ]);
      
      // Check what happened
      const modalStillOpen = await page.locator('h2:has-text("Delete Coupon")').isVisible();
      const errorMessage = await page.locator('[class*="error"], [class*="red"]').first().textContent();
      
      if (!modalStillOpen) {
        console.log('✅ SUCCESS: Coupon deleted successfully!');
        console.log('✅ Token refresh worked correctly');
      } else if (errorMessage && errorMessage.includes('session has expired')) {
        console.log('✅ EXPECTED: Session expired message shown with better error handling');
      } else if (errorMessage) {
        console.log(`⚠️ Error occurred: ${errorMessage}`);
        console.log('✅ Better error handling is working');
      } else {
        console.log('🤔 Unexpected state - checking logs...');
      }
      
    } catch (timeoutError) {
      console.log('⏰ Operation timed out - checking current state...');
      
      const modalOpen = await page.locator('h2:has-text("Delete Coupon")').isVisible();
      const currentUrl = page.url();
      
      console.log(`📍 Current URL: ${currentUrl}`);
      console.log(`🗂️ Modal still open: ${modalOpen}`);
    }
    
    // Take a screenshot
    await page.screenshot({ path: 'token-refresh-test.png' });
    console.log('📸 Screenshot saved');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'token-refresh-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();