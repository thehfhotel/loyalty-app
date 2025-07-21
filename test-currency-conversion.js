const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing Thai Baht currency conversion...');
    
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
    
    // Check for Thai Baht symbols in the page
    const thbSymbolVisible = await page.locator('text=฿').first().isVisible().catch(() => false);
    console.log(`📊 Thai Baht symbol (฿) visible: ${thbSymbolVisible}`);
    
    // Check if USD symbols are still present (should not be)
    const usdSymbolVisible = await page.locator('text=$').first().isVisible().catch(() => false);
    console.log(`📊 USD symbol ($) still visible: ${usdSymbolVisible}`);
    
    // Test creating a new coupon to see currency handling
    const createButton = await page.locator('button:has-text("สร้างคูปอง")');
    if (await createButton.isVisible()) {
      await createButton.click();
      await page.waitForTimeout(500);
      
      console.log('✅ Create coupon modal opened');
      
      // Fill in basic coupon details
      await page.fill('input[placeholder*="รหัส"]', 'TEST-THB-001');
      await page.fill('input[placeholder*="ชื่อ"]', 'Test Thai Baht Coupon');
      
      // Select fixed amount type to test currency
      await page.selectOption('select', 'fixed_amount');
      await page.waitForTimeout(500);
      
      // Fill in value (this should use THB now)
      await page.fill('input[type="number"][placeholder*="มูลค่า"]', '100');
      
      console.log('✅ Filled coupon details with 100 THB value');
      
      // Close modal without saving
      await page.click('button:has-text("ยกเลิก")');
      await page.waitForTimeout(500);
    }
    
    // Test coupon scanner page for currency symbols
    console.log('🔄 Testing coupon scanner page...');
    await page.goto('http://localhost:3000/coupons/scanner');
    await page.waitForSelector('h1', { timeout: 5000 });
    
    // Look for amount input fields and check if they show THB
    const amountInput = await page.locator('input[placeholder*="Amount"]').isVisible();
    if (amountInput) {
      await page.fill('input[placeholder*="Amount"]', '200');
      console.log('✅ Filled amount field for testing currency display');
    }
    
    // Take screenshot
    await page.screenshot({ path: 'currency-conversion-test.png' });
    console.log('📸 Screenshot saved as currency-conversion-test.png');
    
    // Summary
    if (thbSymbolVisible && !usdSymbolVisible) {
      console.log('🎉 SUCCESS: Currency conversion to Thai Baht appears successful!');
      console.log('   - Thai Baht symbols (฿) are visible');
      console.log('   - USD symbols ($) are not present');
    } else if (thbSymbolVisible && usdSymbolVisible) {
      console.log('⚠️ PARTIAL SUCCESS: Both THB and USD symbols found');
      console.log('   - May need to check for remaining USD references');
    } else if (!thbSymbolVisible && !usdSymbolVisible) {
      console.log('ℹ️ NO CURRENCY SYMBOLS: No currency symbols detected');
      console.log('   - This might be normal if no financial data is displayed');
    } else {
      console.log('❌ ISSUE: Currency conversion may not be complete');
      console.log('   - USD symbols still present or THB symbols missing');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'currency-conversion-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();