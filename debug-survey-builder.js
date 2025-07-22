const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Starting Survey Builder Debug...');
  
  try {
    // Step 1: Login
    console.log('Step 1: Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('Login completed, current URL:', page.url());
    
    // Step 2: Navigate to Survey Builder
    console.log('Step 2: Navigating to survey builder...');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log('Current URL:', page.url());
    await page.screenshot({ path: 'debug-survey-builder-page.png' });
    
    // Check what's actually on the page
    const pageTitle = await page.title();
    console.log('Page title:', pageTitle);
    
    const bodyContent = await page.locator('body').innerText();
    console.log('Page content preview:', bodyContent.substring(0, 500));
    
    // Check for common form elements
    const titleInputs = await page.locator('input').count();
    const textareas = await page.locator('textarea').count();
    const buttons = await page.locator('button').count();
    const selects = await page.locator('select').count();
    
    console.log(`Found: ${titleInputs} inputs, ${textareas} textareas, ${buttons} buttons, ${selects} selects`);
    
    // Check for specific elements we're looking for
    const titleInput = await page.locator('input[name="title"]').count();
    const descTextarea = await page.locator('textarea[name="description"]').count();
    const addQuestionBtn = await page.locator('button:has-text("Add Question")').count();
    
    console.log(`Specific elements: title input: ${titleInput}, desc textarea: ${descTextarea}, add question button: ${addQuestionBtn}`);
    
    // List all visible text on the page
    console.log('All button texts:');
    const allButtons = await page.locator('button').all();
    for (const button of allButtons) {
      const text = await button.innerText();
      console.log('  Button:', text);
    }
    
    // Check if there are any error messages
    const errorElements = await page.locator('.error, .alert-error, [class*="error"]').all();
    if (errorElements.length > 0) {
      console.log('Error messages found:');
      for (const error of errorElements) {
        const text = await error.innerText();
        console.log('  Error:', text);
      }
    }
    
    // Check if page is showing loading state
    const loadingElements = await page.locator('[class*="loading"], .spinner, .loader').count();
    console.log(`Loading elements: ${loadingElements}`);
    
    await page.waitForTimeout(5000); // Keep browser open for manual inspection
    
  } catch (error) {
    console.error('Error during debugging:', error);
    await page.screenshot({ path: 'debug-survey-builder-error.png' });
  }
  
  await browser.close();
})();