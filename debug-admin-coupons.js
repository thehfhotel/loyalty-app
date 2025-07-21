const { chromium } = require('playwright');

async function debugAdminCouponPage() {
  console.log('🔍 Debugging Admin Coupon Management Page...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Listen to console messages
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
  });
  
  // Listen to page errors
  page.on('pageerror', error => {
    console.log(`[PAGE ERROR]: ${error.message}`);
    console.log(error.stack);
  });
  
  // Listen to network responses
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[NETWORK ERROR]: ${response.url()} - ${response.status()} ${response.statusText()}`);
    }
  });
  
  try {
    // Login as admin
    console.log('🔐 Logging in as admin...');
    await page.goto('http://localhost:3000/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful');
    
    // Navigate to admin coupon management
    console.log('🎫 Navigating to admin coupon management...');
    await page.goto('http://localhost:3000/admin/coupons');
    
    // Wait a bit for the page to load and show any errors
    await page.waitForTimeout(5000);
    
    // Take a screenshot
    await page.screenshot({ 
      path: './debug-admin-coupons.png',
      fullPage: true 
    });
    console.log('📷 Screenshot saved: debug-admin-coupons.png');
    
    // Try to get page content
    try {
      const bodyText = await page.textContent('body');
      console.log('📄 Page body contains "Error":', bodyText.includes('Error'));
      if (bodyText.includes('Error')) {
        console.log('First 500 chars of page content:');
        console.log(bodyText.substring(0, 500));
      }
    } catch (e) {
      console.log('❌ Could not get page content:', e.message);
    }
    
    console.log('✅ Debug completed');
    
  } catch (error) {
    console.log(`❌ Debug failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

debugAdminCouponPage().catch(console.error);