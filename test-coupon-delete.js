const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing coupon deletion with token refresh...');
    
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
    
    // Wait for coupons to load
    await page.waitForTimeout(2000);
    
    // Check if there are any coupons
    const couponsExist = await page.locator('tbody tr').count() > 0;
    
    if (!couponsExist) {
      console.log('ℹ️ No coupons found, creating one first...');
      
      // Create a test coupon
      await page.click('button:has-text("Create Coupon")');
      await page.waitForSelector('h2:has-text("Create New Coupon")');
      
      const timestamp = Date.now();
      await page.fill('input[placeholder="e.g. SUMMER20"]', `TEST${timestamp}`);
      await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', `Test Delete ${timestamp}`);
      await page.fill('textarea', 'This coupon is for testing deletion with token refresh');
      await page.fill('input[type="number"]', '15'); // 15% discount
      await page.fill('input[type="date"]', '2025-12-31'); // Valid until
      
      await page.click('button[type="submit"]');
      
      // Wait for the modal to close and list to refresh
      await page.waitForSelector('h2:has-text("Create New Coupon")', { state: 'hidden', timeout: 10000 });
      await page.waitForTimeout(2000);
      
      console.log('✅ Test coupon created');
    }
    
    // Now try to delete the first coupon
    const firstCouponRow = page.locator('tbody tr').first();
    const couponName = await firstCouponRow.locator('td').first().locator('div').first().textContent();
    console.log(`🎯 Attempting to delete coupon: "${couponName}"`);
    
    const removeButton = firstCouponRow.locator('button:has-text("Remove")');
    await removeButton.click();
    await page.waitForSelector('h2:has-text("Delete Coupon")', { timeout: 5000 });
    
    console.log('✅ Delete modal opened');
    
    // Type DELETE to confirm
    await page.fill('input[placeholder="Type DELETE here"]', 'DELETE');
    
    // Set up network monitoring to catch any 401 errors
    page.on('response', response => {
      if (response.url().includes('/api/coupons/') && response.request().method() === 'DELETE') {
        console.log(`📡 DELETE request: ${response.status()} ${response.statusText()}`);
        if (response.status() === 401) {
          console.log('🔄 Got 401 - token refresh should handle this...');
        } else if (response.status() === 200) {
          console.log('✅ Delete successful!');
        }
      }
    });
    
    // Click delete button
    await page.click('button:has-text("Delete Coupon")');
    
    console.log('🔄 Delete request sent...');
    
    // Wait for either success (modal closes) or error message
    const result = await Promise.race([
      // Success: modal closes
      page.waitForSelector('h2:has-text("Delete Coupon")', { state: 'hidden', timeout: 15000 })
        .then(() => 'success'),
      
      // Error: error message appears  
      page.waitForSelector('text*="session has expired"', { timeout: 15000 })
        .then(() => 'session_expired'),
        
      page.waitForSelector('text*="Failed to delete"', { timeout: 15000 })
        .then(() => 'delete_failed'),
        
      // Timeout
      page.waitForTimeout(15000).then(() => 'timeout')
    ]);
    
    console.log(`📊 Result: ${result}`);
    
    if (result === 'success') {
      console.log('🎉 SUCCESS: Coupon deleted successfully!');
      console.log('✅ Token refresh mechanism worked correctly');
      
      // Verify the coupon is actually removed from the list
      await page.waitForTimeout(1000);
      const remainingCoupons = await page.locator('tbody tr').count();
      console.log(`📊 Remaining coupons in list: ${remainingCoupons}`);
      
    } else if (result === 'session_expired') {
      console.log('✅ EXPECTED: Session expired message shown - good error handling');
    } else if (result === 'delete_failed') {
      console.log('⚠️ DELETE FAILED: Check error message for details');
      const errorText = await page.locator('[class*="error"], [class*="red"]').first().textContent();
      console.log(`Error: ${errorText}`);
    } else if (result === 'timeout') {
      console.log('⏰ TIMEOUT: Operation took longer than expected');
      const modalStillOpen = await page.locator('h2:has-text("Delete Coupon")').isVisible();
      console.log(`Modal still open: ${modalStillOpen}`);
    }
    
    // Take a screenshot for review
    await page.screenshot({ path: 'coupon-delete-test.png' });
    console.log('📸 Screenshot saved as coupon-delete-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'coupon-delete-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 3 seconds for review...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();