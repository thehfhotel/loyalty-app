const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing Thai language implementation...');
    
    // Navigate to the app
    await page.goto('http://localhost:3000');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    console.log('✅ Page loaded successfully');
    
    // Check if language switcher is visible
    const languageSwitcher = await page.locator('button[aria-label="Change language"]').isVisible();
    console.log(`📊 Language switcher visible: ${languageSwitcher}`);
    
    if (languageSwitcher) {
      // Click the language switcher
      await page.click('button[aria-label="Change language"]');
      await page.waitForTimeout(500);
      
      // Look for Thai option
      const thaiOption = await page.locator('button:has-text("ไทย")').isVisible();
      console.log(`📊 Thai option visible: ${thaiOption}`);
      
      if (thaiOption) {
        // Click on Thai language
        await page.click('button:has-text("ไทย")');
        await page.waitForTimeout(1000);
        
        console.log('✅ Switched to Thai language');
        
        // Check if content is in Thai
        const thaiContent = await page.locator('text=เข้าสู่ระบบ').isVisible();
        console.log(`📊 Thai content visible: ${thaiContent}`);
        
        // Check HTML lang attribute
        const htmlLang = await page.getAttribute('html', 'lang');
        console.log(`📊 HTML lang attribute: ${htmlLang}`);
        
        // Check if Thai font is applied
        const bodyFontFamily = await page.evaluate(() => {
          return window.getComputedStyle(document.body).fontFamily;
        });
        console.log(`📊 Body font family: ${bodyFontFamily}`);
        
        // Take screenshot
        await page.screenshot({ path: 'thai-language-test.png' });
        console.log('📸 Screenshot saved as thai-language-test.png');
        
        if (thaiContent && htmlLang === 'th') {
          console.log('🎉 SUCCESS: Thai language implementation is working!');
        } else {
          console.log('⚠️ Some issues detected with Thai language implementation');
        }
      } else {
        console.log('❌ Thai option not found in language switcher');
      }
    } else {
      console.log('❌ Language switcher not found');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'thai-language-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();