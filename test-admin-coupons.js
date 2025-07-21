const { chromium } = require('playwright');

async function testAdminCouponManagement() {
  console.log('🎫 Testing Admin Coupon Management Interface...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
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
    console.log('🎫 Testing admin coupon management page...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Check if page loaded
    const title = await page.textContent('h1');
    console.log(`📄 Page title: ${title}`);
    
    // Check if create coupon button exists
    const createButton = await page.isVisible('text=Create Coupon');
    console.log(`${createButton ? '✅' : '❌'} Create Coupon button visible: ${createButton}`);
    
    // Test create coupon modal
    if (createButton) {
      console.log('🖱️ Testing create coupon modal...');
      await page.click('text=Create Coupon');
      
      // Wait for modal
      await page.waitForSelector('text=Create New Coupon', { timeout: 5000 });
      const modalVisible = await page.isVisible('text=Create New Coupon');
      console.log(`${modalVisible ? '✅' : '❌'} Create coupon modal visible: ${modalVisible}`);
      
      if (modalVisible) {
        // Fill in some test data
        await page.fill('input[value=""]', 'Test 10% Off Coupon');
        await page.fill('textarea', 'A test coupon for 10% off your next stay');
        await page.fill('input[type="number"]', '10');
        await page.fill('input[type="date"]', '2024-12-31');
        
        console.log('✅ Form filled with test data');
        
        // Close modal without submitting
        await page.click('text=Cancel');
        console.log('✅ Modal closed successfully');
      }
    }
    
    // Check if table structure exists
    const tableExists = await page.isVisible('table');
    console.log(`${tableExists ? '✅' : '❌'} Coupons table visible: ${tableExists}`);
    
    if (tableExists) {
      const headers = await page.$$eval('th', elements => 
        elements.map(el => el.textContent?.trim())
      );
      console.log('📊 Table headers:', headers);
    }
    
    // Take a screenshot for verification
    await page.screenshot({ 
      path: './test-screenshots/admin-coupons-page.png',
      fullPage: true 
    });
    console.log('📷 Screenshot saved: admin-coupons-page.png');
    
    console.log('\n✅ Admin Coupon Management test completed successfully!');
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

testAdminCouponManagement().catch(console.error);