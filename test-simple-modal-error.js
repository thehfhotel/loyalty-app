const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing modal error feedback with simple validation error...');
    
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
    
    // Try to create a coupon with invalid data (empty required fields)
    await page.fill('input[placeholder="e.g. SUMMER20"]', ''); // Empty code
    await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', ''); // Empty name
    
    console.log('🎯 Left required fields empty to trigger validation error');
    
    // Set up response monitoring
    let errorResponseReceived = false;
    page.on('response', response => {
      if (response.url().includes('/api/coupons') && response.request().method() === 'POST') {
        console.log(`📡 POST request status: ${response.status()}`);
        if (response.status() >= 400) {
          errorResponseReceived = true;
          console.log(`📡 Error response received: ${response.status()}`);
        }
      }
    });
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    console.log('🔄 Form submitted...');
    
    // Wait a bit for any response
    await page.waitForTimeout(2000);
    
    // Check if modal error is visible
    const modalErrorVisible = await page.locator('.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-4').isVisible();
    
    if (modalErrorVisible) {
      console.log('🎉 SUCCESS: Modal error is visible!');
      
      // Get the error text
      const errorText = await page.locator('.bg-red-50 .text-red-700').textContent();
      console.log(`📝 Error text: "${errorText}"`);
      
      // Test dismiss functionality
      const dismissButton = page.locator('button:has-text("Dismiss")');
      if (await dismissButton.isVisible()) {
        console.log('✅ Dismiss button is visible');
        await dismissButton.click();
        
        // Check if error disappears
        await page.waitForTimeout(500);
        const errorStillVisible = await page.locator('.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-4').isVisible();
        console.log(`📊 Error still visible after dismiss: ${errorStillVisible}`);
      }
      
    } else {
      console.log('❌ Modal error not visible');
      
      // Check if there are any errors outside the modal
      const anyErrors = await page.locator('[class*="red"]').count();
      console.log(`📊 Total elements with red styling: ${anyErrors}`);
      
      // Check form validation
      const requiredInputs = await page.locator('input[required]').count();
      console.log(`📊 Required inputs: ${requiredInputs}`);
    }
    
    // Check if the form submission was actually attempted
    if (errorResponseReceived) {
      console.log('✅ Backend request was made and returned error');
    } else {
      console.log('ℹ️ No backend request made (likely form validation prevented it)');
    }
    
    // Take a screenshot of the current state
    await page.screenshot({ path: 'simple-modal-error-test.png' });
    console.log('📸 Screenshot saved as simple-modal-error-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'simple-modal-error-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();