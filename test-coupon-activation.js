const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing coupon activation fix...');
    
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
    await page.waitForTimeout(3000);
    
    // Look for draft coupons to activate
    const draftCoupons = await page.locator('text=Draft').count();
    console.log(`📊 Draft coupons found: ${draftCoupons}`);
    
    if (draftCoupons > 0) {
      // Find the first row with a Draft status
      const draftRow = page.locator('tbody tr').filter({ hasText: 'Draft' }).first();
      const couponName = await draftRow.locator('td').first().locator('div').first().textContent();
      console.log(`🎯 Testing activation on: "${couponName}"`);
      
      // Click the Activate button for a draft coupon
      const activateButton = draftRow.locator('button:has-text("Activate")');
      
      // Set up network monitoring
      let activationRequestMade = false;
      let activationSuccess = false;
      
      page.on('response', response => {
        if (response.url().includes('/api/coupons/') && response.request().method() === 'PUT') {
          activationRequestMade = true;
          console.log(`📡 PUT request to: ${response.url()}`);
          console.log(`📡 Response status: ${response.status()} ${response.statusText()}`);
          
          if (response.status() === 200) {
            activationSuccess = true;
            console.log('✅ Activation request successful!');
          } else if (response.status() === 404) {
            console.log('❌ Still getting 404 - fix may not be applied');
          } else {
            console.log(`⚠️ Unexpected status: ${response.status()}`);
          }
        }
      });
      
      // Click activate
      await activateButton.click();
      
      // Wait for the request to complete
      await page.waitForTimeout(2000);
      
      if (activationRequestMade) {
        if (activationSuccess) {
          console.log('🎉 SUCCESS: Coupon activation working!');
          
          // Verify the status changed in the UI
          await page.waitForTimeout(1000);
          const activeStatus = await draftRow.locator('text=Active').count();
          if (activeStatus > 0) {
            console.log('✅ UI updated to show Active status');
          } else {
            console.log('⚠️ UI may not have refreshed yet');
          }
        } else {
          console.log('❌ Activation request failed');
        }
      } else {
        console.log('⚠️ No PUT request detected - button may not be working');
      }
      
    } else {
      console.log('ℹ️ No draft coupons available for testing');
      
      // Show all available statuses for debugging
      const allStatuses = await page.locator('tbody tr .rounded-full').allTextContents();
      console.log('Available coupon statuses:', allStatuses);
    }
    
    // Take a screenshot
    await page.screenshot({ path: 'coupon-activation-test.png' });
    console.log('📸 Screenshot saved as coupon-activation-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'coupon-activation-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 3 seconds for review...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();