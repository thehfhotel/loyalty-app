const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Starting Survey Creation Debug...');
  
  // Listen to all network requests and responses
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log(`→ REQUEST: ${request.method()} ${request.url()}`);
      if (request.method() !== 'GET') {
        console.log('  Body:', request.postData());
      }
    }
  });
  
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`← RESPONSE: ${response.status()} ${response.url()}`);
    }
  });
  
  page.on('console', msg => {
    console.log(`🖥️  Console ${msg.type()}: ${msg.text()}`);
  });
  
  try {
    // Step 1: Login
    console.log('Step 1: Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('Login completed');
    
    // Step 2: Navigate to Survey Builder
    console.log('Step 2: Going to survey builder...');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log('Current URL:', page.url());
    
    // Step 3: Fill in basic information
    console.log('Step 3: Filling survey info...');
    
    await page.fill('input#title', 'Test Survey Debug');
    await page.fill('textarea#description', 'Debug test description');
    await page.selectOption('select#status', 'active');
    await page.selectOption('select#access_type', 'public');
    
    console.log('Basic info filled');
    
    // Step 4: Add a question
    console.log('Step 4: Adding question...');
    await page.click('button:has-text("Multiple Choice")');
    await page.waitForTimeout(1000);
    console.log('Question added');
    
    await page.screenshot({ path: 'debug-before-submit.png' });
    
    // Step 5: Try to create survey
    console.log('Step 5: Creating survey...');
    console.log('Looking for Create & Publish button...');
    
    const createButton = page.locator('button:has-text("Create & Publish")');
    const createButtonCount = await createButton.count();
    console.log(`Found ${createButtonCount} Create & Publish buttons`);
    
    if (createButtonCount > 0) {
      console.log('Clicking Create & Publish...');
      await createButton.click();
      
      // Wait and see what happens
      await page.waitForTimeout(3000);
      
      console.log('After create - Current URL:', page.url());
      await page.screenshot({ path: 'debug-after-submit.png' });
      
      // Check for any error messages or toasts
      const pageContent = await page.locator('body').innerText();
      console.log('Page content after submit (first 500 chars):', pageContent.substring(0, 500));
      
    } else {
      console.log('❌ Create & Publish button not found');
      
      // List all buttons
      const allButtons = await page.locator('button').all();
      console.log('All buttons on page:');
      for (const button of allButtons) {
        const text = await button.innerText();
        console.log(`  - "${text}"`);
      }
    }
    
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('Error during survey creation debug:', error);
    await page.screenshot({ path: 'debug-survey-creation-error.png' });
  }
  
  await browser.close();
})();