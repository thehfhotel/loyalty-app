const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing React hooks fix...');
    
    // Navigate to the app
    await page.goto('http://localhost:3003');
    
    // Wait for the page to load and check for React errors
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    // Check for console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    // Wait a bit to catch any hooks errors
    await page.waitForTimeout(3000);
    
    // Check if login page loads properly
    const loginPageLoaded = await page.locator('h1:has-text("Welcome")').isVisible().catch(() => false);
    const hasReactErrors = consoleErrors.some(error => 
      error.includes('Invalid hook call') || 
      error.includes('useRef') || 
      error.includes('Hooks can only be called')
    );
    
    console.log(`📊 Login page loaded: ${loginPageLoaded}`);
    console.log(`📊 React hook errors found: ${hasReactErrors}`);
    console.log(`📊 Total console errors: ${consoleErrors.length}`);
    
    if (consoleErrors.length > 0) {
      console.log('Console errors:');
      consoleErrors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    // Take screenshot
    await page.screenshot({ path: 'hooks-fix-test.png' });
    console.log('📸 Screenshot saved as hooks-fix-test.png');
    
    // Summary
    if (loginPageLoaded && !hasReactErrors) {
      console.log('🎉 SUCCESS: React hooks issue appears to be fixed!');
      console.log('   - Login page loads properly');
      console.log('   - No React hook errors detected');
    } else if (hasReactErrors) {
      console.log('❌ HOOKS ISSUE PERSISTS: React hook errors still present');
    } else if (!loginPageLoaded) {
      console.log('⚠️ PAGE LOADING ISSUE: Login page did not load properly');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'hooks-fix-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();