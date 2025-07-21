const { chromium } = require('playwright');

async function testSpecificIssues() {
  console.log('🔧 Testing specific issues found...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Test 1: Check if coupon page handles auth properly when not logged in
    console.log('📄 Testing coupon page without authentication...');
    await page.goto('http://localhost:3000/coupons');
    
    // Should redirect to login
    await page.waitForURL(/.*login.*/, { timeout: 5000 });
    console.log('✅ Unauthenticated users properly redirected to login');
    
    // Test 2: Test admin login
    console.log('🔐 Testing admin login...');
    await page.goto('http://localhost:3000/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful');
    
    // Test 3: Navigate to admin loyalty page
    console.log('👑 Testing admin loyalty page...');
    await page.goto('http://localhost:3000/admin/loyalty');
    await page.waitForLoadState('networkidle');
    
    const title = await page.title();
    console.log(`✅ Admin loyalty page loaded: ${title}`);
    
    // Test 4: Check for logout functionality
    console.log('🚪 Testing logout...');
    
    // Look for logout in various places
    const logoutFound = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements.some(el => 
        el.textContent?.toLowerCase().includes('logout') ||
        el.textContent?.toLowerCase().includes('sign out')
      );
    });
    
    console.log(`${logoutFound ? '✅' : '⚠️'} Logout functionality ${logoutFound ? 'found' : 'not clearly visible'}`);
    
    // Test 5: Check coupon page when authenticated
    console.log('🎫 Testing coupon page when authenticated...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    
    // Check if page loaded without errors
    const pageText = await page.textContent('body');
    const hasErrorContent = pageText.includes('Error') || pageText.includes('Failed');
    
    console.log(`${hasErrorContent ? '⚠️' : '✅'} Coupon page ${hasErrorContent ? 'has error content' : 'loaded successfully'}`);
    
    console.log('\n✅ All specific issue tests completed');
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

testSpecificIssues().catch(console.error);