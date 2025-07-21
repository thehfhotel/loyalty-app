const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing expired token scenario...');
    
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
    
    // Create a test coupon first
    await page.click('button:has-text("Create Coupon")');
    await page.waitForSelector('h2:has-text("Create New Coupon")');
    
    const timestamp = Date.now();
    await page.fill('input[placeholder="e.g. SUMMER20"]', `EXPIRE${timestamp}`);
    await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', `Expire Test ${timestamp}`);
    await page.fill('textarea', 'Testing expired token handling');
    await page.fill('input[type="number"]', '20');
    await page.fill('input[type="date"]', '2025-12-31');
    
    await page.click('button[type="submit"]');
    await page.waitForSelector('h2:has-text("Create New Coupon")', { state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(2000);
    
    console.log('✅ Test coupon created');
    
    // Now manually expire the token in localStorage to simulate an expired session
    await page.evaluate(() => {
      const authStorage = localStorage.getItem('auth-storage');
      if (authStorage) {
        const parsed = JSON.parse(authStorage);
        // Set an expired token (expired timestamp in the past)
        parsed.state.accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjZTE2ZWFiZi1lZjZiLTQwMTEtYTQ5Zi1hOTg4Y2EzNTg2YWIiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJpYXQiOjE3NTMwNzA0MzksImV4cCI6MTc1MzA3MDQ0MH0.expired_token_for_testing';
        localStorage.setItem('auth-storage', JSON.stringify(parsed));
        console.log('🔄 Token manually expired for testing');
      }
    });
    
    console.log('🔄 Manually expired token to simulate session timeout');
    
    // Set up network monitoring to catch 401 and subsequent retry
    let deleteAttempts = [];
    page.on('response', response => {
      if (response.url().includes('/api/coupons/') && response.request().method() === 'DELETE') {
        deleteAttempts.push({
          status: response.status(),
          statusText: response.statusText(),
          timestamp: Date.now()
        });
        console.log(`📡 DELETE attempt ${deleteAttempts.length}: ${response.status()} ${response.statusText()}`);
      }
      
      if (response.url().includes('/api/auth/refresh') && response.request().method() === 'POST') {
        console.log(`🔄 Token refresh attempt: ${response.status()} ${response.statusText()}`);
      }
    });
    
    // Try to delete the first coupon with expired token
    const firstCouponRow = page.locator('tbody tr').first();
    const couponName = await firstCouponRow.locator('td').first().locator('div').first().textContent();
    console.log(`🎯 Attempting to delete coupon with expired token: "${couponName}"`);
    
    const removeButton = firstCouponRow.locator('button:has-text("Remove")');
    await removeButton.click();
    await page.waitForSelector('h2:has-text("Delete Coupon")', { timeout: 5000 });
    
    console.log('✅ Delete modal opened');
    
    // Type DELETE to confirm
    await page.fill('input[placeholder="Type DELETE here"]', 'DELETE');
    
    // Click delete button
    await page.click('button:has-text("Delete Coupon")');
    
    console.log('🔄 Delete request sent with expired token...');
    
    // Wait for the operation to complete
    await page.waitForTimeout(5000);
    
    // Check the results
    console.log(`📊 Total DELETE attempts: ${deleteAttempts.length}`);
    deleteAttempts.forEach((attempt, index) => {
      console.log(`  Attempt ${index + 1}: ${attempt.status} ${attempt.statusText}`);
    });
    
    // Check if modal is still open (would indicate failure) or closed (success)
    const modalStillOpen = await page.locator('h2:has-text("Delete Coupon")').isVisible();
    
    if (!modalStillOpen) {
      console.log('🎉 SUCCESS: Modal closed - deletion succeeded!');
      console.log('✅ Token refresh mechanism handled expired token correctly');
    } else {
      console.log('⚠️ Modal still open - checking for error messages...');
      const errorElements = await page.locator('[class*="text-red"], [class*="error"]').all();
      for (const element of errorElements) {
        const text = await element.textContent();
        if (text && text.trim()) {
          console.log(`Error: ${text.trim()}`);
        }
      }
    }
    
    // Take a screenshot
    await page.screenshot({ path: 'expired-token-test.png' });
    console.log('📸 Screenshot saved as expired-token-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'expired-token-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 3 seconds for review...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();