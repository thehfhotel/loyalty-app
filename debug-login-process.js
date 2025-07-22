const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Starting Login Process Debug...');
  
  try {
    // Step 1: Go to login page
    console.log('Step 1: Going to login page...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'debug-login-01-login-page.png' });
    
    console.log('Current URL:', page.url());
    
    // Check if login form is present
    const emailInputs = await page.locator('input[type="email"]').count();
    const passwordInputs = await page.locator('input[type="password"]').count();
    const submitButtons = await page.locator('button[type="submit"]').count();
    
    console.log(`Login form elements: ${emailInputs} email inputs, ${passwordInputs} password inputs, ${submitButtons} submit buttons`);
    
    if (emailInputs === 0 || passwordInputs === 0) {
      console.log('Login form not found, checking for alternative selectors...');
      
      const allInputs = await page.locator('input').all();
      console.log('All input fields:');
      for (const input of allInputs) {
        const type = await input.getAttribute('type');
        const name = await input.getAttribute('name');
        const placeholder = await input.getAttribute('placeholder');
        console.log(`  Input: type="${type}", name="${name}", placeholder="${placeholder}"`);
      }
    }
    
    // Step 2: Fill login form with correct selectors
    console.log('Step 2: Filling login form...');
    
    // Try different selectors
    let emailFilled = false;
    let passwordFilled = false;
    
    // Try email input
    if (await page.locator('input[type="email"]').count() > 0) {
      await page.fill('input[type="email"]', 'winut.hf@gmail.com');
      emailFilled = true;
    } else if (await page.locator('input[name="email"]').count() > 0) {
      await page.fill('input[name="email"]', 'winut.hf@gmail.com');
      emailFilled = true;
    }
    
    // Try password input
    if (await page.locator('input[type="password"]').count() > 0) {
      await page.fill('input[type="password"]', 'Kick2you@ss');
      passwordFilled = true;
    } else if (await page.locator('input[name="password"]').count() > 0) {
      await page.fill('input[name="password"]', 'Kick2you@ss');
      passwordFilled = true;
    }
    
    console.log(`Form filled: email=${emailFilled}, password=${passwordFilled}`);
    
    await page.screenshot({ path: 'debug-login-02-form-filled.png' });
    
    // Step 3: Submit form
    console.log('Step 3: Submitting form...');
    
    // Try different submit selectors
    if (await page.locator('button[type="submit"]').count() > 0) {
      await page.click('button[type="submit"]');
    } else {
      // Look for login button with text
      const loginButtons = await page.locator('button').all();
      for (const button of loginButtons) {
        const text = await button.innerText();
        if (text.includes('เข้าสู่ระบบ') || text.includes('Login')) {
          await button.click();
          break;
        }
      }
    }
    
    // Wait for navigation
    await page.waitForTimeout(3000);
    console.log('After submit - Current URL:', page.url());
    await page.screenshot({ path: 'debug-login-03-after-submit.png' });
    
    // Check if we're logged in
    const currentUrl = page.url();
    if (currentUrl.includes('/dashboard') || currentUrl.includes('/admin') || !currentUrl.includes('/login')) {
      console.log('✅ Login appears successful!');
      
      // Try to access admin area
      console.log('Step 4: Testing admin access...');
      await page.goto('http://localhost:3000/admin/surveys/create');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      console.log('Admin page URL:', page.url());
      await page.screenshot({ path: 'debug-login-04-admin-access.png' });
      
      // Check for survey builder elements
      const titleInputs = await page.locator('input').count();
      console.log(`Elements on admin page: ${titleInputs} inputs total`);
      
      // Check page content
      const pageContent = await page.locator('body').innerText();
      console.log('Admin page content preview:', pageContent.substring(0, 500));
      
    } else {
      console.log('❌ Login failed - still on login page');
      
      // Check for error messages
      const pageContent = await page.locator('body').innerText();
      console.log('Page content after failed login:', pageContent);
      
      // Check for validation errors
      const errorElements = await page.locator('.error, .alert-error, [class*="error"]').all();
      if (errorElements.length > 0) {
        console.log('Error messages:');
        for (const error of errorElements) {
          const text = await error.innerText();
          console.log('  Error:', text);
        }
      }
    }
    
    await page.waitForTimeout(5000); // Keep browser open for inspection
    
  } catch (error) {
    console.error('Error during login debug:', error);
    await page.screenshot({ path: 'debug-login-error.png' });
  }
  
  await browser.close();
})();