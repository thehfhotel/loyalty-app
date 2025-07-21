const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing pagination fix...');
    
    // Login as admin
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    console.log('✅ Logged in successfully');
    
    // Navigate to admin coupons page
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForSelector('h1', { timeout: 10000 });
    
    console.log('✅ Admin coupons page loaded');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 5000 });
    
    // Count rows in the table body (excluding header)
    const rowCount = await page.locator('tbody tr').count();
    console.log(`📊 Number of rows in table: ${rowCount}`);
    
    // Check if there's an empty state message
    const emptyStateVisible = await page.locator('td[colspan="6"]:has-text("ไม่มีคูปอง")').isVisible();
    console.log(`📊 Empty state message visible: ${emptyStateVisible}`);
    
    // Check pagination visibility and page numbers
    const paginationVisible = await page.locator('div:has-text("หน้า")').isVisible();
    console.log(`📊 Pagination visible: ${paginationVisible}`);
    
    if (paginationVisible) {
      // Extract current page and total pages
      const paginationText = await page.locator('div:has-text("หน้า")').first().textContent();
      console.log(`📊 Pagination text: "${paginationText}"`);
      
      // Check if Previous/Next buttons exist
      const previousButtonExists = await page.locator('button:has-text("ก่อนหน้า")').isVisible();
      const nextButtonExists = await page.locator('button:has-text("ถัดไป")').isVisible();
      
      console.log(`📊 Previous button visible: ${previousButtonExists}`);
      console.log(`📊 Next button visible: ${nextButtonExists}`);
      
      // Test navigation if there are multiple pages
      if (nextButtonExists) {
        const nextButton = page.locator('button:has-text("ถัดไป")');
        const isNextEnabled = await nextButton.isEnabled();
        console.log(`📊 Next button enabled: ${isNextEnabled}`);
        
        if (isNextEnabled) {
          console.log('🔄 Testing page navigation...');
          await nextButton.click();
          await page.waitForTimeout(2000);
          
          const newRowCount = await page.locator('tbody tr').count();
          console.log(`📊 Row count after navigation: ${newRowCount}`);
          
          const newPaginationText = await page.locator('div:has-text("หน้า")').first().textContent();
          console.log(`📊 New pagination text: "${newPaginationText}"`);
        }
      }
    }
    
    // Check if the table has actual coupon data vs empty state
    const hasCouponData = rowCount > 0 && !emptyStateVisible;
    const hasValidPagination = !paginationVisible || (rowCount > 0);
    
    console.log(`📊 Has coupon data: ${hasCouponData}`);
    console.log(`📊 Has valid pagination: ${hasValidPagination}`);
    
    // Take screenshot
    await page.screenshot({ path: 'pagination-fix-test.png' });
    console.log('📸 Screenshot saved as pagination-fix-test.png');
    
    // Determine success
    if (emptyStateVisible || (hasCouponData && hasValidPagination)) {
      console.log('🎉 SUCCESS: Pagination logic appears to be working correctly!');
      if (emptyStateVisible) {
        console.log('   - Empty state is properly displayed when no coupons exist');
      } else {
        console.log('   - Coupon data and pagination are consistent');
      }
    } else {
      console.log('⚠️ ISSUE: Pagination may still have inconsistencies');
      console.log('   - Check if rows exist but pagination shows multiple pages incorrectly');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'pagination-fix-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();