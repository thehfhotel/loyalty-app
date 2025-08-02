const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Starting Playwright browser automation...');
  
  // Launch browser with debugging options
  const browser = await chromium.launch({
    headless: false,
    devtools: true,
    slowMo: 1000, // Slow down by 1s for better observation
    args: ['--start-maximized']
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  // Comprehensive error monitoring setup
  const errors = [];
  const networkIssues = [];
  const warnings = [];
  
  // Console message monitoring
  page.on('console', (msg) => {
    const timestamp = new Date().toISOString();
    const type = msg.type();
    const text = msg.text();
    const location = msg.location();
    
    const logEntry = {
      timestamp,
      type,
      text,
      location: {
        url: location.url,
        lineNumber: location.lineNumber,
        columnNumber: location.columnNumber
      }
    };
    
    if (type === 'error') {
      errors.push(logEntry);
      console.log('❌ CONSOLE ERROR:', JSON.stringify(logEntry, null, 2));
    } else if (type === 'warning') {
      warnings.push(logEntry);
      console.log('⚠️ CONSOLE WARNING:', JSON.stringify(logEntry, null, 2));
    } else {
      console.log('📝 CONSOLE LOG:', type, '|', text);
    }
  });
  
  // Page error monitoring
  page.on('pageerror', (error) => {
    const timestamp = new Date().toISOString();
    const errorData = {
      timestamp,
      type: 'pageerror',
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    errors.push(errorData);
    console.log('🚨 PAGE ERROR:', JSON.stringify(errorData, null, 2));
  });
  
  // Network request/response monitoring
  page.on('requestfailed', (request) => {
    const timestamp = new Date().toISOString();
    const networkError = {
      timestamp,
      type: 'request_failed',
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'Unknown failure',
      headers: request.headers()
    };
    networkIssues.push(networkError);
    console.log('🌐 NETWORK FAILURE:', JSON.stringify(networkError, null, 2));
  });
  
  page.on('response', (response) => {
    if (!response.ok()) {
      const timestamp = new Date().toISOString();
      const networkError = {
        timestamp,
        type: 'response_error',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers()
      };
      networkIssues.push(networkError);
      console.log('🌐 NETWORK ERROR:', JSON.stringify(networkError, null, 2));
    }
  });
  
  try {
    console.log('🔗 Navigating to https://loyalty.saichon.com/login...');
    
    // Navigate to the login page
    await page.goto('https://loyalty.saichon.com/login', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('📸 Taking initial screenshot...');
    await page.screenshot({ 
      path: '/home/nut/loyalty-app/login-page-initial.png', 
      fullPage: true 
    });
    
    // Wait a moment for any delayed scripts/errors
    await page.waitForTimeout(3000);
    
    console.log('🔍 Looking for LINE login button or link...');
    
    // Look for LINE login elements with various selectors
    const lineSelectors = [
      'button:has-text("LINE")',
      'a:has-text("LINE")',
      '[data-testid*="line"]',
      '[id*="line"]',
      '[class*="line"]',
      'button[type="submit"]',
      '.login-button',
      '.oauth-button',
      'button:has-text("ログイン")',
      'a[href*="line.me"]',
      'a[href*="oauth"]'
    ];
    
    let lineElement = null;
    let usedSelector = null;
    
    for (const selector of lineSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.count() > 0) {
          lineElement = element;
          usedSelector = selector;
          console.log('✅ Found LINE login element with selector:', selector);
          break;
        }
      } catch (e) {
        // Continue trying other selectors
      }
    }
    
    if (!lineElement) {
      console.log('🔍 No LINE login button found with standard selectors. Checking page content...');
      
      // Take screenshot to see what's available
      await page.screenshot({ 
        path: '/home/nut/loyalty-app/login-page-no-line-button.png', 
        fullPage: true 
      });
      
      // Get page content for analysis
      const pageContent = await page.content();
      console.log('📄 Page title:', await page.title());
      console.log('📄 Page URL:', page.url());
      
      // Look for any buttons or links
      const allButtons = await page.locator('button, a, input[type="submit"]').all();
      console.log('🔘 Found', allButtons.length, 'interactive elements');
      
      for (let i = 0; i < allButtons.length; i++) {
        try {
          const text = await allButtons[i].textContent();
          const tagName = await allButtons[i].evaluate(el => el.tagName);
          const className = await allButtons[i].getAttribute('class');
          const id = await allButtons[i].getAttribute('id');
          
          console.log(`🔘 Element ${i}: ${tagName} | Text: "${text}" | Class: ${className} | ID: ${id}`);
        } catch (e) {
          console.log(`🔘 Element ${i}: Error getting details - ${e.message}`);
        }
      }
    }
    
    if (lineElement) {
      console.log('🎯 Clicking LINE login element...');
      
      // Take screenshot before clicking
      await page.screenshot({ 
        path: '/home/nut/loyalty-app/before-line-click.png', 
        fullPage: true 
      });
      
      // Click the LINE login element
      await lineElement.click();
      
      console.log('⏳ Waiting for navigation or errors after click...');
      
      // Wait for potential navigation or errors
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (e) {
        console.log('⚠️ Network idle timeout (expected for redirects)');
      }
      
      // Take screenshot after clicking
      await page.screenshot({ 
        path: '/home/nut/loyalty-app/after-line-click.png', 
        fullPage: true 
      });
      
      console.log('📍 Current URL after click:', page.url());
    }
    
    // Wait a bit more to capture any delayed errors
    await page.waitForTimeout(5000);
    
    // Final error summary
    console.log('\n📊 ERROR SUMMARY:');
    console.log('❌ Console Errors:', errors.length);
    console.log('⚠️ Console Warnings:', warnings.length);
    console.log('🌐 Network Issues:', networkIssues.length);
    
    if (errors.length > 0) {
      console.log('\n🚨 DETAILED ERROR REPORT:');
      errors.forEach((error, index) => {
        console.log(`\nError ${index + 1}:`, JSON.stringify(error, null, 2));
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️ DETAILED WARNING REPORT:');
      warnings.forEach((warning, index) => {
        console.log(`\nWarning ${index + 1}:`, JSON.stringify(warning, null, 2));
      });
    }
    
    if (networkIssues.length > 0) {
      console.log('\n🌐 DETAILED NETWORK ISSUE REPORT:');
      networkIssues.forEach((issue, index) => {
        console.log(`\nNetwork Issue ${index + 1}:`, JSON.stringify(issue, null, 2));
      });
    }
    
    // Save detailed error report to file
    const errorReport = {
      timestamp: new Date().toISOString(),
      url: page.url(),
      title: await page.title(),
      errors,
      warnings,
      networkIssues,
      lineElementFound: !!lineElement,
      selectorUsed: usedSelector
    };
    
    require('fs').writeFileSync('/home/nut/loyalty-app/line-oauth-error-report.json', JSON.stringify(errorReport, null, 2));
    console.log('💾 Detailed error report saved to line-oauth-error-report.json');
    
  } catch (error) {
    console.error('💥 CRITICAL ERROR:', error.message);
    console.error('Stack:', error.stack);
    
    // Take error screenshot
    await page.screenshot({ 
      path: '/home/nut/loyalty-app/critical-error.png', 
      fullPage: true 
    });
  }
  
  console.log('⏳ Keeping browser open for 30 seconds for manual inspection...');
  await page.waitForTimeout(30000);
  
  await browser.close();
  console.log('✅ Browser automation completed');
})();