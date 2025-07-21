const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing backend error feedback in modal...');
    
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
    
    // Fill form with known duplicate code
    await page.fill('input[placeholder="e.g. SUMMER20"]', 'ACTIVATE123');
    await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', 'Test Backend Error');
    await page.fill('textarea', 'This should trigger backend error');
    await page.fill('input[type="number"]', '15');
    
    // Fill date fields
    const validFromInput = page.locator('input[type="date"]').first();
    const validUntilInput = page.locator('input[type="date"]').last();
    
    await validFromInput.fill('2025-01-01');
    await validUntilInput.fill('2025-12-31');
    
    console.log('🎯 Filled form with duplicate code ACTIVATE123');
    
    // Set up response monitoring
    let backendErrorReceived = false;
    let errorMessage = '';
    
    page.on('response', async response => {
      if (response.url().includes('/api/coupons') && response.request().method() === 'POST') {
        console.log(`📡 POST /api/coupons status: ${response.status()}`);
        
        if (response.status() >= 400) {
          backendErrorReceived = true;
          try {
            const responseBody = await response.json();
            errorMessage = responseBody.message || 'Unknown error';
            console.log(`📡 Backend error: "${errorMessage}"`);
          } catch (e) {
            console.log('📡 Could not parse error response');
          }
        }
      }
    });
    
    // Submit the form
    await page.click('button[type="submit"]:has-text("Create Coupon")');
    
    console.log('🔄 Form submitted, waiting for response...');
    
    // Wait for backend response
    await page.waitForTimeout(3000);
    
    if (backendErrorReceived) {
      console.log(`✅ Backend error received: "${errorMessage}"`);
      
      // Check if error is displayed in modal
      const modalError = await page.locator('.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-4');
      const isModalErrorVisible = await modalError.isVisible();
      
      if (isModalErrorVisible) {
        console.log('🎉 SUCCESS: Error displayed within modal!');
        
        const displayedErrorText = await modalError.locator('.text-red-700').textContent();
        console.log(`📝 Displayed error: "${displayedErrorText}"`);
        
        // Verify the modal is still open
        const modalStillOpen = await page.locator('h2:has-text("Create New Coupon")').isVisible();
        console.log(`📊 Modal still open: ${modalStillOpen}`);
        
        // Test dismiss button
        const dismissBtn = modalError.locator('button:has-text("Dismiss")');
        if (await dismissBtn.isVisible()) {
          console.log('✅ Dismiss button is visible');
          await dismissBtn.click();
          
          await page.waitForTimeout(500);
          const errorAfterDismiss = await modalError.isVisible();
          console.log(`📊 Error visible after dismiss: ${errorAfterDismiss}`);
        }
        
      } else {
        console.log('❌ ISSUE: Backend error not displayed in modal');
        
        // Check if error appears elsewhere
        const allRedElements = await page.locator('[class*="red"]').count();
        console.log(`📊 Total red elements on page: ${allRedElements}`);
        
        // Check main page error area
        const mainPageError = await page.locator('div.bg-red-50.border.border-red-200.rounded-lg.p-4.mb-6').isVisible();
        console.log(`📊 Main page error visible: ${mainPageError}`);
      }
      
    } else {
      console.log('⚠️ No backend error received - check network tab');
    }
    
    // Take screenshot
    await page.screenshot({ path: 'backend-error-test.png' });
    console.log('📸 Screenshot saved as backend-error-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'backend-error-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();