const { chromium } = require('playwright');

async function testNotificationDeduplication() {
  console.log('🔍 Testing Notification Deduplication...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 300
  });
  const page = await browser.newPage();
  
  // Enable console logging
  page.on('console', msg => {
    if (msg.text().includes('NotificationManager')) {
      console.log('🔔', msg.text());
    }
  });
  
  try {
    console.log('1️⃣ Navigating to login page...');
    await page.goto('http://localhost:3002/login');
    await page.waitForLoadState('networkidle');
    
    console.log('2️⃣ Logging in...');
    await page.fill('input[type="email"]', 'customer@hotel.com');
    await page.fill('input[type="password"]', 'customer123');
    
    // Take screenshot before login
    await page.screenshot({ path: 'before-login.png' });
    
    console.log('3️⃣ Clicking login button and monitoring notifications...');
    const loginPromise = page.click('button[type="submit"]');
    
    // Wait for navigation or timeout
    try {
      await Promise.race([
        page.waitForURL('**/dashboard', { timeout: 5000 }),
        page.waitForTimeout(5000)
      ]);
    } catch (e) {
      console.log('⚠️  Navigation timeout or error:', e.message);
    }
    
    // Take screenshot after login attempt
    await page.screenshot({ path: 'after-login.png' });
    
    // Check for notifications
    console.log('\n📊 Checking for notifications...');
    
    // Look for the toast container
    const toasterExists = await page.locator('[id*="toaster"]').count() > 0;
    if (toasterExists) {
      console.log('✅ Toast container found');
      
      // Count all toast notifications
      const toasts = await page.locator('[role="status"]').all();
      console.log(`📌 Found ${toasts.length} notification(s)`);
      
      for (let i = 0; i < toasts.length; i++) {
        const text = await toasts[i].textContent();
        console.log(`  ${i + 1}. "${text}"`);
      }
      
      // Check specifically for "Welcome back!" duplicates
      const welcomeToasts = await page.locator('[role="status"]:has-text("Welcome back")').all();
      console.log(`\n🎯 "Welcome back!" notifications: ${welcomeToasts.length}`);
      
      if (welcomeToasts.length === 1) {
        console.log('✅ SUCCESS: Only one "Welcome back!" notification');
      } else if (welcomeToasts.length === 0) {
        console.log('⚠️  No "Welcome back!" notification found');
      } else {
        console.log(`❌ FAIL: Found ${welcomeToasts.length} "Welcome back!" notifications`);
      }
    } else {
      console.log('❌ No toast container found');
    }
    
    // Wait to see if more notifications appear
    console.log('\n⏳ Waiting 3 seconds to check for delayed notifications...');
    await page.waitForTimeout(3000);
    
    const laterToasts = await page.locator('[role="status"]:has-text("Welcome")').all();
    console.log(`📌 Total welcome notifications after wait: ${laterToasts.length}`);
    
    // Test page refresh
    console.log('\n4️⃣ Testing page refresh...');
    await page.reload();
    await page.waitForTimeout(2000);
    
    const refreshToasts = await page.locator('[role="status"]:has-text("Welcome")').all();
    console.log(`📌 Welcome notifications after refresh: ${refreshToasts.length}`);
    
    if (refreshToasts.length === 0) {
      console.log('✅ SUCCESS: No duplicate notifications on refresh');
    } else {
      console.log(`❌ FAIL: Found ${refreshToasts.length} notifications after refresh`);
    }
    
    console.log('\n📸 Screenshots saved: before-login.png, after-login.png');
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
    await page.screenshot({ path: 'error-state.png' });
  } finally {
    console.log('\n🏁 Test complete. Browser will close in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

// Run the test
testNotificationDeduplication();