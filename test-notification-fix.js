const { chromium } = require('playwright');

async function testNotificationFix() {
  console.log('🔍 Testing Notification Deduplication Fix...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 // Slow down to observe notifications
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Test 1: Regular Login - Should show only ONE "Welcome back!" notification
    console.log('📋 Test 1: Regular Login Flow');
    await page.goto('http://localhost:3002/login');
    
    // Fill in login form
    await page.fill('input[type="email"]', 'customer@hotel.com');
    await page.fill('input[type="password"]', 'customer123');
    
    // Set up notification monitoring
    const notifications = [];
    
    // Monitor for toast notifications
    page.on('framenavigated', async () => {
      try {
        // Wait a bit for toasts to appear
        await page.waitForTimeout(500);
        
        // Check for toaster container
        const toasterExists = await page.locator('#__rht_toaster').count() > 0;
        if (toasterExists) {
          // Count notifications
          const toastElements = await page.locator('#__rht_toaster > div').all();
          for (const toast of toastElements) {
            const text = await toast.textContent().catch(() => '');
            if (text) {
              notifications.push({
                time: new Date().toISOString(),
                text: text.trim()
              });
            }
          }
        }
      } catch (e) {
        // Ignore errors from checking notifications
      }
    });
    
    // Click login button
    await page.click('button[type="submit"]');
    
    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful, navigated to dashboard');
    
    // Wait a bit more to catch any delayed notifications
    await page.waitForTimeout(2000);
    
    // Check notification count
    console.log(`\n📊 Notifications captured: ${notifications.length}`);
    notifications.forEach((notif, index) => {
      console.log(`  ${index + 1}. "${notif.text}"`);
    });
    
    // Count "Welcome back!" messages
    const welcomeBackCount = notifications.filter(n => 
      n.text.toLowerCase().includes('welcome back')
    ).length;
    
    console.log(`\n🎯 "Welcome back!" notifications: ${welcomeBackCount}`);
    
    if (welcomeBackCount === 1) {
      console.log('✅ SUCCESS: Only one "Welcome back!" notification shown');
    } else if (welcomeBackCount === 0) {
      console.log('⚠️  WARNING: No "Welcome back!" notification shown');
    } else {
      console.log(`❌ FAIL: Multiple (${welcomeBackCount}) "Welcome back!" notifications shown`);
    }
    
    // Test 2: Logout and Login again
    console.log('\n📋 Test 2: Logout and Re-login');
    
    // Find and click logout (adjust selector as needed)
    const logoutButton = await page.locator('button:has-text("Logout")').first();
    if (await logoutButton.count() > 0) {
      notifications.length = 0; // Clear notifications
      
      await logoutButton.click();
      await page.waitForURL('**/login', { timeout: 5000 });
      console.log('✅ Logged out successfully');
      
      // Login again
      await page.fill('input[type="email"]', 'customer@hotel.com');
      await page.fill('input[type="password"]', 'customer123');
      await page.click('button[type="submit"]');
      
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      await page.waitForTimeout(2000);
      
      // Count notifications again
      const reLoginWelcomeCount = notifications.filter(n => 
        n.text.toLowerCase().includes('welcome back')
      ).length;
      
      console.log(`\n🎯 Re-login "Welcome back!" notifications: ${reLoginWelcomeCount}`);
      
      if (reLoginWelcomeCount === 1) {
        console.log('✅ SUCCESS: Only one notification on re-login');
      } else {
        console.log(`❌ FAIL: ${reLoginWelcomeCount} notifications on re-login`);
      }
    }
    
    // Test 3: Page Refresh - Should NOT show additional notifications
    console.log('\n📋 Test 3: Page Refresh Test');
    notifications.length = 0;
    
    await page.reload();
    await page.waitForTimeout(3000);
    
    const refreshNotificationCount = notifications.filter(n => 
      n.text.toLowerCase().includes('welcome')
    ).length;
    
    console.log(`\n🎯 Notifications after refresh: ${refreshNotificationCount}`);
    
    if (refreshNotificationCount === 0) {
      console.log('✅ SUCCESS: No duplicate notifications on refresh');
    } else {
      console.log(`❌ FAIL: ${refreshNotificationCount} notifications shown after refresh`);
    }
    
    // Final Summary
    console.log('\n=====================================');
    console.log('📊 TEST SUMMARY:');
    console.log('=====================================');
    console.log(`✅ Initial login: ${welcomeBackCount === 1 ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Re-login: ${reLoginWelcomeCount === 1 ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Page refresh: ${refreshNotificationCount === 0 ? 'PASS' : 'FAIL'}`);
    
    if (welcomeBackCount === 1 && refreshNotificationCount === 0) {
      console.log('\n🎉 NOTIFICATION DEDUPLICATION IS WORKING!');
    } else {
      console.log('\n⚠️  Some tests failed - check implementation');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

// Alternative test using direct observation
async function testNotificationVisually() {
  console.log('\n🔍 Visual Notification Test...\n');
  console.log('This test will open a browser window.');
  console.log('Please observe the notifications manually.\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 // Very slow for visual observation
  });
  const page = await browser.newPage();
  
  try {
    console.log('1️⃣ Opening login page...');
    await page.goto('http://localhost:3002/login');
    
    console.log('2️⃣ Filling in credentials...');
    await page.fill('input[type="email"]', 'customer@hotel.com');
    await page.fill('input[type="password"]', 'customer123');
    
    console.log('3️⃣ Clicking login button...');
    console.log('   👀 WATCH FOR NOTIFICATIONS!');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    console.log('\n✅ Login successful!');
    console.log('📊 Count the number of "Welcome back!" notifications you saw.');
    console.log('   - Should be exactly 1 notification');
    console.log('   - No duplicates should appear');
    
    await page.waitForTimeout(5000); // Keep browser open for observation
    
    console.log('\n4️⃣ Refreshing page...');
    console.log('   👀 WATCH FOR NOTIFICATIONS!');
    await page.reload();
    
    await page.waitForTimeout(5000);
    
    console.log('\n📊 After refresh:');
    console.log('   - Should be NO new welcome notifications');
    console.log('   - Only notifications from user actions');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    console.log('\n🏁 Test complete. Closing browser...');
    await browser.close();
  }
}

// Run the automated test
testNotificationFix().then(() => {
  console.log('\n\n🔍 Running visual test for manual verification...');
  return testNotificationVisually();
});