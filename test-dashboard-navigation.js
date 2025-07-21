const { chromium } = require('playwright');

async function testDashboardNavigation() {
  console.log('🧪 Testing Dashboard Button Navigation...\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const testPages = [
    { path: '/profile', name: 'Profile Page' },
    { path: '/loyalty', name: 'Loyalty Dashboard' },
    { path: '/coupons', name: 'Coupon Wallet' },
    { path: '/admin/loyalty', name: 'Admin Loyalty' },
    { path: '/admin/coupons', name: 'Admin Coupons' },
    { path: '/admin/feature-toggles', name: 'Feature Toggles' },
    { path: '/account-linking', name: 'Account Linking' }
  ];
  
  try {
    // Login as admin first
    console.log('🔐 Logging in as admin...');
    await page.goto('http://localhost:3000/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful\n');
    
    // Test each page
    for (const testPage of testPages) {
      console.log(`📄 Testing ${testPage.name} (${testPage.path})...`);
      
      try {
        // Navigate to the page
        await page.goto(`http://localhost:3000${testPage.path}`);
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        
        // Look for the dashboard button
        const dashboardButton = page.locator('button:has-text("Dashboard")');
        const isVisible = await dashboardButton.isVisible();
        
        if (isVisible) {
          console.log('  ✅ Dashboard button found');
          
          // Test clicking the button
          await dashboardButton.click();
          await page.waitForURL('http://localhost:3000/dashboard', { timeout: 5000 });
          console.log('  ✅ Navigation to dashboard successful');
          
          // Navigate back for next test
          await page.goto(`http://localhost:3000${testPage.path}`);
          await page.waitForLoadState('networkidle');
          
        } else {
          console.log('  ❌ Dashboard button not found');
        }
        
      } catch (error) {
        console.log(`  ❌ Error testing ${testPage.name}: ${error.message}`);
      }
      
      console.log('');
    }
    
    // Test regular user pages (non-admin)
    console.log('🔄 Testing as regular user...');
    
    // Logout and login as regular user
    await page.goto('http://localhost:3000/dashboard');
    
    // Look for logout button and click it
    try {
      await page.click('button:has-text("Logout")');
      await page.waitForURL('http://localhost:3000/login', { timeout: 5000 });
    } catch (e) {
      await page.goto('http://localhost:3000/login');
    }
    
    // Login as regular user
    await page.fill('input[type="email"]', 'user@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ User login successful\n');
    
    // Test non-admin pages
    const userPages = [
      { path: '/profile', name: 'Profile Page' },
      { path: '/loyalty', name: 'Loyalty Dashboard' },
      { path: '/coupons', name: 'Coupon Wallet' }
    ];
    
    for (const testPage of userPages) {
      console.log(`📄 Testing ${testPage.name} as user...`);
      
      try {
        await page.goto(`http://localhost:3000${testPage.path}`);
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        
        const dashboardButton = page.locator('button:has-text("Dashboard")');
        const isVisible = await dashboardButton.isVisible();
        
        if (isVisible) {
          console.log('  ✅ Dashboard button found and working');
          
          await dashboardButton.click();
          await page.waitForURL('http://localhost:3000/dashboard', { timeout: 5000 });
          console.log('  ✅ Navigation successful');
          
        } else {
          console.log('  ❌ Dashboard button not found');
        }
        
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
      }
      
      console.log('');
    }
    
    console.log('🎉 Dashboard navigation testing completed!');
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

testDashboardNavigation().catch(console.error);