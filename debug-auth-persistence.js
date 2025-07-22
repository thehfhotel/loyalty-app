const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Starting Auth Persistence Debug...');
  
  try {
    // Step 1: Login
    console.log('Step 1: Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    console.log('Current URL after login:', page.url());
    
    // Check localStorage after login
    const authStorage = await page.evaluate(() => {
      return localStorage.getItem('auth-storage');
    });
    console.log('Auth storage after login:', authStorage);
    
    // Check the auth state in the React app
    const authState = await page.evaluate(() => {
      // Try to get the current auth state from the store
      return window.localStorage.getItem('auth-storage');
    });
    console.log('Auth state from page:', authState);
    
    // Step 2: Wait for auth initialization
    console.log('Step 2: Waiting for auth initialization...');
    await page.waitForTimeout(3000);
    
    // Check auth state after initialization
    const authStateAfterInit = await page.evaluate(() => {
      return localStorage.getItem('auth-storage');
    });
    console.log('Auth state after initialization:', authStateAfterInit);
    
    // Step 3: Try direct navigation to admin page
    console.log('Step 3: Trying direct navigation to admin page...');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForTimeout(3000);
    
    console.log('URL after admin navigation:', page.url());
    
    // Check if we're still on login or got to admin page
    if (page.url().includes('/login')) {
      console.log('❌ Redirected back to login - auth not persisting');
      
      // Check if auth storage is still there
      const authStorageCheck = await page.evaluate(() => {
        return localStorage.getItem('auth-storage');
      });
      console.log('Auth storage still present:', !!authStorageCheck);
      
      if (authStorageCheck) {
        try {
          const parsed = JSON.parse(authStorageCheck);
          console.log('Auth storage contents:');
          console.log('  - isAuthenticated:', parsed.state?.isAuthenticated);
          console.log('  - accessToken present:', !!parsed.state?.accessToken);
          console.log('  - user present:', !!parsed.state?.user);
          console.log('  - user role:', parsed.state?.user?.role);
        } catch (e) {
          console.log('Error parsing auth storage:', e.message);
        }
      }
      
    } else {
      console.log('✅ Successfully accessed admin page');
    }
    
    // Step 4: Test the login process one more time but stay on the dashboard
    console.log('Step 4: Testing login again...');
    
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    // Wait on dashboard for a bit
    console.log('Staying on dashboard URL:', page.url());
    await page.waitForTimeout(2000);
    
    // Now try to navigate to admin from dashboard
    console.log('Now trying to navigate to admin from dashboard...');
    await page.goto('http://localhost:3000/admin/surveys/create', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    console.log('Final URL:', page.url());
    
    if (page.url().includes('/admin/surveys/create')) {
      console.log('✅ Admin page accessible!');
    } else {
      console.log('❌ Still having auth issues');
    }
    
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('Error during auth persistence debug:', error);
    await page.screenshot({ path: 'debug-auth-persistence-error.png' });
  }
  
  await browser.close();
})();