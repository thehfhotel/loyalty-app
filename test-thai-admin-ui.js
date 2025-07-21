const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing Thai language in admin UI...');
    
    // Login as admin
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    console.log('✅ Logged in successfully');
    
    // Switch to Thai language
    const languageSwitcher = await page.locator('button[aria-label="Change language"]').isVisible();
    if (languageSwitcher) {
      await page.click('button[aria-label="Change language"]');
      await page.waitForTimeout(500);
      
      const thaiOption = await page.locator('button:has-text("ไทย")').isVisible();
      if (thaiOption) {
        await page.click('button:has-text("ไทย")');
        await page.waitForTimeout(1000);
        console.log('✅ Switched to Thai language');
      }
    }
    
    // Navigate to admin coupons page
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForSelector('h1', { timeout: 10000 });
    
    console.log('✅ Admin coupons page loaded');
    
    // Check if main admin UI elements are in Thai
    const titleInThai = await page.locator('h1:has-text("จัดการคูปอง")').isVisible();
    console.log(`📊 Title in Thai: ${titleInThai}`);
    
    const subtitleInThai = await page.locator('p:has-text("สร้างและจัดการคูปองดิจิทัล")').isVisible();
    console.log(`📊 Subtitle in Thai: ${subtitleInThai}`);
    
    const createButtonInThai = await page.locator('button:has-text("สร้างคูปอง")').isVisible();
    console.log(`📊 Create button in Thai: ${createButtonInThai}`);
    
    // Check table headers
    const couponHeaderInThai = await page.locator('th:has-text("คูปอง")').isVisible();
    console.log(`📊 Table header in Thai: ${couponHeaderInThai}`);
    
    const typeValueHeaderInThai = await page.locator('th:has-text("ประเภทและมูลค่า")').isVisible();
    console.log(`📊 Type & Value header in Thai: ${typeValueHeaderInThai}`);
    
    const usageHeaderInThai = await page.locator('th:has-text("การใช้งาน")').isVisible();
    console.log(`📊 Usage header in Thai: ${usageHeaderInThai}`);
    
    const validityHeaderInThai = await page.locator('th:has-text("ระยะเวลาใช้งาน")').isVisible();
    console.log(`📊 Validity header in Thai: ${validityHeaderInThai}`);
    
    const statusHeaderInThai = await page.locator('th:has-text("สถานะ")').isVisible();
    console.log(`📊 Status header in Thai: ${statusHeaderInThai}`);
    
    const actionsHeaderInThai = await page.locator('th:has-text("การดำเนินการ")').isVisible();
    console.log(`📊 Actions header in Thai: ${actionsHeaderInThai}`);
    
    // Test create coupon modal
    const createButton = await page.locator('button:has-text("สร้างคูปอง")');
    if (await createButton.isVisible()) {
      await createButton.click();
      await page.waitForTimeout(500);
      
      // Check modal title in Thai
      const modalTitleInThai = await page.locator('h2:has-text("สร้างคูปองใหม่")').isVisible();
      console.log(`📊 Modal title in Thai: ${modalTitleInThai}`);
      
      // Check form labels in Thai
      const codeLabel = await page.locator('label:has-text("รหัส")').isVisible();
      const nameLabel = await page.locator('label:has-text("ชื่อ")').isVisible();
      const typeLabel = await page.locator('label:has-text("ประเภท")').isVisible();
      
      console.log(`📊 Form labels in Thai - Code: ${codeLabel}, Name: ${nameLabel}, Type: ${typeLabel}`);
      
      // Check dropdown options in Thai
      const percentageOption = await page.locator('option:has-text("ส่วนลดเปอร์เซ็นต์")').isVisible();
      const fixedAmountOption = await page.locator('option:has-text("ส่วนลดจำนวนคงที่")').isVisible();
      
      console.log(`📊 Dropdown options in Thai - Percentage: ${percentageOption}, Fixed: ${fixedAmountOption}`);
      
      // Check buttons in Thai
      const cancelButtonInThai = await page.locator('button:has-text("ยกเลิก")').isVisible();
      const createButtonInModal = await page.locator('button:has-text("สร้างคูปอง")').isVisible();
      
      console.log(`📊 Modal buttons in Thai - Cancel: ${cancelButtonInThai}, Create: ${createButtonInModal}`);
      
      // Close modal
      await page.click('button:has-text("ยกเลิก")');
      await page.waitForTimeout(500);
    }
    
    // Take screenshot
    await page.screenshot({ path: 'thai-admin-ui-test.png' });
    console.log('📸 Screenshot saved as thai-admin-ui-test.png');
    
    // Summary
    const allElementsInThai = titleInThai && subtitleInThai && createButtonInThai && 
                             couponHeaderInThai && typeValueHeaderInThai && usageHeaderInThai && 
                             validityHeaderInThai && statusHeaderInThai && actionsHeaderInThai;
    
    if (allElementsInThai) {
      console.log('🎉 SUCCESS: Admin UI is properly localized in Thai!');
    } else {
      console.log('⚠️ Some admin UI elements may not be properly translated to Thai');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'thai-admin-ui-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();