const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing coupon visibility on /coupons page...');
    console.log('📊 Looking for coupon ID: 1FREE1');
    console.log('📊 Assigned to: winut.hf@gmail.com');
    
    // Login as the user
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'password123'); // Assuming default password
    
    // Try to login
    await page.click('button[type="submit"]');
    
    // Wait for navigation
    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✅ Login successful');
    } catch (error) {
      console.log('❌ Login failed - checking error message');
      const errorMessage = await page.locator('.text-red-600').textContent().catch(() => null);
      console.log(`📊 Error message: ${errorMessage}`);
      
      // Try with different password
      console.log('🔄 Trying with different password...');
      await page.fill('input[type="password"]', 'Password123!');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 10000 });
    }
    
    // Navigate to coupons page
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    console.log('✅ Navigated to /coupons page');
    
    // Wait for coupons to load
    await page.waitForTimeout(2000);
    
    // Check page title
    const pageTitle = await page.locator('h1').textContent();
    console.log(`📊 Page title: "${pageTitle}"`);
    
    // Check if there's a loading indicator
    const isLoading = await page.locator('text=Loading').isVisible().catch(() => false);
    console.log(`📊 Loading indicator visible: ${isLoading}`);
    
    // Check for empty state
    const emptyState = await page.locator('text=No coupons available').isVisible().catch(() => false);
    console.log(`📊 Empty state visible: ${emptyState}`);
    
    // Look for coupon cards
    const couponCards = await page.locator('.bg-white.shadow.rounded-lg').count();
    console.log(`📊 Number of coupon cards found: ${couponCards}`);
    
    // Look specifically for 1FREE1 coupon
    const coupon1FREE1 = await page.locator('text=1FREE1').isVisible().catch(() => false);
    console.log(`📊 Coupon 1FREE1 visible: ${coupon1FREE1}`);
    
    // Get all visible coupon codes
    const couponCodes = await page.locator('.font-mono').allTextContents().catch(() => []);
    console.log(`📊 Visible coupon codes: ${couponCodes.join(', ') || 'None'}`);
    
    // Check console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Check network requests to API
    console.log('\n🔍 Checking API calls...');
    
    // Intercept API calls
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('/api/coupons')) {
        console.log(`📊 API call: ${url}`);
        console.log(`📊 Status: ${response.status()}`);
        if (response.status() === 200) {
          try {
            const data = await response.json();
            console.log(`📊 Response data:`, JSON.stringify(data, null, 2));
          } catch (e) {
            console.log('📊 Could not parse response as JSON');
          }
        }
      }
    });
    
    // Refresh the page to capture API calls
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Take screenshot
    await page.screenshot({ path: 'coupon-visibility-test.png', fullPage: true });
    console.log('📸 Screenshot saved as coupon-visibility-test.png');
    
    // Summary
    console.log('\n📊 ANALYSIS SUMMARY:');
    if (coupon1FREE1) {
      console.log('✅ SUCCESS: Coupon 1FREE1 is visible on the page');
    } else {
      console.log('❌ ISSUE: Coupon 1FREE1 is NOT visible on the page');
      console.log('\nPossible reasons:');
      console.log('1. The coupon was not properly assigned to the user');
      console.log('2. The API is not returning assigned coupons');
      console.log('3. The coupon might be expired or inactive');
      console.log('4. There might be a filtering issue on the frontend');
      console.log('5. The user email might not match exactly');
    }
    
    if (consoleErrors.length > 0) {
      console.log('\n⚠️ Console errors detected:');
      consoleErrors.forEach(error => console.log(`   - ${error}`));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'coupon-visibility-error.png' });
  } finally {
    console.log('\n🔄 Keeping browser open for 10 seconds for review...');
    await page.waitForTimeout(10000);
    await browser.close();
  }
})();