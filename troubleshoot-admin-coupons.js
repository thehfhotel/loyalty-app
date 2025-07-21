const { chromium } = require('playwright');

async function troubleshootAdminCoupons() {
  console.log('🔍 Troubleshooting Admin Coupon Functionality...\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Capture all console messages
  const consoleMessages = [];
  page.on('console', msg => {
    const log = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    };
    consoleMessages.push(log);
    
    if (msg.type() === 'error') {
      console.log(`❌ [CONSOLE ERROR]: ${msg.text()}`);
      if (msg.location()) {
        console.log(`   at ${msg.location().url}:${msg.location().lineNumber}`);
      }
    }
  });
  
  // Capture page errors
  page.on('pageerror', error => {
    console.log(`💥 [PAGE ERROR]: ${error.message}`);
    console.log(error.stack);
  });
  
  // Monitor network requests
  const failedRequests = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      const failure = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      };
      failedRequests.push(failure);
      console.log(`🌐 [NETWORK ${response.status()}]: ${response.url()}`);
    }
  });
  
  // Monitor specific API calls
  page.on('request', request => {
    if (request.url().includes('/api/coupons') && request.method() === 'POST') {
      console.log(`📤 [API CALL]: ${request.method()} ${request.url()}`);
      console.log(`   Body: ${request.postData()}`);
    }
  });
  
  try {
    // Step 1: Login as admin
    console.log('👤 Logging in as admin...');
    await page.goto('http://localhost:3000/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful\n');
    
    // Step 2: Navigate to admin coupons
    console.log('📋 Navigating to admin coupon management...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Wait for the page to fully load
    await page.waitForTimeout(3000);
    
    // Step 3: Check if page loaded correctly
    const pageTitle = await page.textContent('h1');
    console.log(`📄 Page title: ${pageTitle}\n`);
    
    // Step 4: Test create coupon functionality
    console.log('🎫 Testing coupon creation...');
    const createButton = await page.locator('button:has-text("Create Coupon")');
    
    if (await createButton.isVisible()) {
      await createButton.click();
      await page.waitForTimeout(1000);
      
      // Check if modal opened
      const modalTitle = await page.locator('h2:has-text("Create New Coupon")');
      if (await modalTitle.isVisible()) {
        console.log('✅ Create coupon modal opened successfully');
        
        // Fill in coupon details
        await page.fill('input[value=""]', 'TEST20OFF');
        await page.fill('textarea', 'Test coupon for 20% off');
        
        // Select percentage type if dropdown exists
        const typeSelect = await page.locator('select').first();
        if (await typeSelect.isVisible()) {
          await typeSelect.selectOption('percentage');
        }
        
        // Fill in value
        await page.fill('input[type="number"]', '20');
        
        // Set dates
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 30);
        
        await page.fill('input[type="date"]', today.toISOString().split('T')[0]);
        await page.locator('input[type="date"]').nth(1).fill(tomorrow.toISOString().split('T')[0]);
        
        // Close modal for now
        await page.click('button:has-text("Cancel")');
        console.log('✅ Coupon form filled successfully (cancelled for testing)\n');
      }
    } else {
      console.log('❌ Create Coupon button not found\n');
    }
    
    // Step 5: Check table content
    console.log('📊 Checking coupon table...');
    const tableExists = await page.locator('table').isVisible();
    
    if (tableExists) {
      const rows = await page.locator('tbody tr').count();
      console.log(`✅ Table found with ${rows} coupon(s)`);
      
      // Step 6: Test assign functionality if coupons exist
      if (rows > 0) {
        console.log('\n🔄 Testing coupon assignment...');
        
        // Click first assign button
        const assignButton = await page.locator('button:has-text("Assign")').first();
        if (await assignButton.isVisible()) {
          await assignButton.click();
          await page.waitForTimeout(1000);
          
          // Check if assign modal opened
          const assignModalTitle = await page.locator('h2:has-text("Assign Coupon")');
          if (await assignModalTitle.isVisible()) {
            console.log('✅ Assign modal opened');
            
            // Check if users are loaded
            const userCheckboxes = await page.locator('input[type="checkbox"]').count();
            console.log(`📋 Found ${userCheckboxes} user(s) to assign to`);
            
            if (userCheckboxes > 0) {
              // Select first user
              await page.locator('input[type="checkbox"]').first().check();
              console.log('✅ Selected first user');
              
              // Try to assign
              const assignSubmitButton = await page.locator('button:has-text("Assign to")');
              if (await assignSubmitButton.isVisible()) {
                const buttonText = await assignSubmitButton.textContent();
                console.log(`📤 Clicking: ${buttonText}`);
                
                // Monitor the response
                const responsePromise = page.waitForResponse(
                  response => response.url().includes('/api/coupons/assign'),
                  { timeout: 10000 }
                ).catch(() => null);
                
                await assignSubmitButton.click();
                
                const response = await responsePromise;
                if (response) {
                  console.log(`📥 Assignment response: ${response.status()} ${response.statusText()}`);
                  if (response.status() !== 200) {
                    const body = await response.text();
                    console.log(`   Response body: ${body}`);
                  }
                } else {
                  console.log('⚠️ No assignment API call detected');
                }
              }
            } else {
              console.log('❌ No users found to assign coupons to');
            }
            
            // Close modal
            await page.click('button:has-text("Cancel")').catch(() => {});
          } else {
            console.log('❌ Assign modal did not open');
          }
        } else {
          console.log('❌ No assign button found');
        }
      } else {
        console.log('ℹ️ No coupons in table to test assignment');
      }
    } else {
      console.log('❌ Coupon table not found');
    }
    
    // Step 7: Capture final screenshot
    await page.screenshot({ 
      path: './troubleshoot-admin-coupons.png',
      fullPage: true 
    });
    
    // Step 8: Summary report
    console.log('\n📊 TROUBLESHOOTING SUMMARY:');
    console.log('='.repeat(50));
    
    console.log(`\n🔴 Console Errors: ${consoleMessages.filter(m => m.type === 'error').length}`);
    consoleMessages.filter(m => m.type === 'error').forEach(err => {
      console.log(`   - ${err.text}`);
    });
    
    console.log(`\n🌐 Failed Network Requests: ${failedRequests.length}`);
    failedRequests.forEach(req => {
      console.log(`   - ${req.status} ${req.url}`);
    });
    
    console.log('\n💡 Recommendations:');
    if (failedRequests.some(r => r.url.includes('/assign'))) {
      console.log('   - Check backend /api/coupons/assign endpoint implementation');
      console.log('   - Verify request body format matches backend expectations');
    }
    if (consoleMessages.some(m => m.text.includes('TypeError'))) {
      console.log('   - Fix JavaScript type errors in frontend code');
    }
    if (failedRequests.some(r => r.status === 404)) {
      console.log('   - Verify API endpoints are correctly defined in backend routes');
    }
    
  } catch (error) {
    console.log(`\n❌ Troubleshooting failed: ${error.message}`);
    console.log(error.stack);
  } finally {
    await browser.close();
    console.log('\n✅ Troubleshooting completed');
  }
}

troubleshootAdminCoupons().catch(console.error);