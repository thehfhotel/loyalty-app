const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing improved error feedback in create coupon modal...');
    
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
    
    // Open create coupon modal
    await page.click('button:has-text("Create Coupon")');
    await page.waitForSelector('h2:has-text("Create New Coupon")', { timeout: 5000 });
    
    console.log('✅ Create coupon modal opened');
    
    // Try to create a coupon that will cause an error (duplicate code)
    await page.fill('input[placeholder="e.g. SUMMER20"]', 'ACTIVATE123'); // Use existing code
    await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', 'Test Error Feedback');
    await page.fill('textarea', 'This should trigger an error');
    await page.fill('input[type="number"]', '10');
    await page.fill('input[type="date"]', '2025-12-31');
    
    console.log('🎯 Filled form with duplicate coupon code to trigger error');
    
    // Monitor for error display
    let errorDetected = false;
    page.on('response', response => {
      if (response.url().includes('/api/coupons') && response.request().method() === 'POST') {
        console.log(`📡 Create coupon request: ${response.status()} ${response.statusText()}`);
        if (response.status() === 409) {
          console.log('✅ Expected 409 conflict error (duplicate code)');
          errorDetected = true;
        }
      }
    });
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    console.log('🔄 Form submitted, waiting for error response...');
    
    // Wait for error to appear
    await page.waitForTimeout(3000);
    
    // Check if error is displayed within the modal
    const modalError = await page.locator('.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-4').count();
    
    if (modalError > 0) {
      console.log('🎉 SUCCESS: Error displayed within the modal!');
      
      // Get error text
      const errorText = await page.locator('.bg-red-50 .text-red-700').textContent();
      console.log(`📝 Error message: "${errorText}"`);
      
      // Check if modal is still open (user can see the error)
      const modalOpen = await page.locator('h2:has-text("Create New Coupon")').isVisible();
      if (modalOpen) {
        console.log('✅ Modal remains open so user can see the error');
      } else {
        console.log('❌ Modal closed unexpectedly');
      }
      
      // Test error dismissal
      const dismissButton = page.locator('button:has-text("Dismiss")');
      if (await dismissButton.isVisible()) {
        await dismissButton.click();
        await page.waitForTimeout(500);
        
        const errorStillVisible = await page.locator('.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-4').count();
        if (errorStillVisible === 0) {
          console.log('✅ Error can be dismissed successfully');
        } else {
          console.log('⚠️ Error dismissal may not be working');
        }
      }
      
    } else {
      console.log('❌ ISSUE: Error not displayed within modal');
      
      // Check if error appears outside modal (old behavior)
      const outsideError = await page.locator('div.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-6').count();
      if (outsideError > 0) {
        console.log('⚠️ Error appears outside modal (old behavior)');
      } else {
        console.log('🤔 No error detected anywhere');
      }
    }
    
    // Close modal
    await page.click('button:has-text("Cancel")');
    await page.waitForSelector('h2:has-text("Create New Coupon")', { state: 'hidden', timeout: 5000 });
    console.log('✅ Modal closed');
    
    // Take a screenshot
    await page.screenshot({ path: 'modal-error-feedback-test.png' });
    console.log('📸 Screenshot saved as modal-error-feedback-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'modal-error-feedback-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 3 seconds for review...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();