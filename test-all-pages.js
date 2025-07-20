const { chromium } = require('playwright');

async function testAllPages() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const errors = [];
  const warnings = [];
  
  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console_error',
        message: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString()
      });
    } else if (msg.type() === 'warning') {
      warnings.push({
        type: 'console_warning',
        message: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Listen for page errors
  page.on('pageerror', error => {
    errors.push({
      type: 'page_error',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  });
  
  // Listen for failed requests
  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push({
        type: 'network_error',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        timestamp: new Date().toISOString()
      });
    }
  });

  const pages = [
    {
      name: 'Home Page',
      url: 'http://localhost:3000',
      requiresAuth: false
    },
    {
      name: 'Login Page',
      url: 'http://localhost:3000/login',
      requiresAuth: false
    },
    {
      name: 'Register Page', 
      url: 'http://localhost:3000/register',
      requiresAuth: false
    },
    {
      name: 'Dashboard',
      url: 'http://localhost:3000/dashboard',
      requiresAuth: true
    },
    {
      name: 'Profile Page',
      url: 'http://localhost:3000/profile',
      requiresAuth: true
    },
    {
      name: 'Loyalty Dashboard',
      url: 'http://localhost:3000/loyalty',
      requiresAuth: true
    },
    {
      name: 'Admin Dashboard',
      url: 'http://localhost:3000/admin',
      requiresAuth: true,
      adminOnly: true
    },
    {
      name: 'Account Linking',
      url: 'http://localhost:3000/account-linking',
      requiresAuth: true
    }
  ];

  console.log('🚀 Starting comprehensive page testing...\n');
  
  // Test public pages first
  console.log('📝 Testing public pages...');
  for (const pageInfo of pages.filter(p => !p.requiresAuth)) {
    try {
      console.log(`\n🔍 Testing: ${pageInfo.name} (${pageInfo.url})`);
      
      const startTime = Date.now();
      await page.goto(pageInfo.url, { waitUntil: 'networkidle' });
      const loadTime = Date.now() - startTime;
      
      console.log(`   ⏱️  Load time: ${loadTime}ms`);
      
      // Wait for React to render
      await page.waitForTimeout(2000);
      
      // Check for basic page elements
      const title = await page.title();
      console.log(`   📄 Page title: ${title}`);
      
      // Take screenshot for manual inspection
      await page.screenshot({ 
        path: `/tmp/${pageInfo.name.replace(/\s+/g, '_').toLowerCase()}.png`,
        fullPage: true 
      });
      
      console.log(`   ✅ Page loaded successfully`);
      
    } catch (error) {
      errors.push({
        type: 'navigation_error',
        page: pageInfo.name,
        url: pageInfo.url,
        message: error.message,
        timestamp: new Date().toISOString()
      });
      console.log(`   ❌ Failed to load: ${error.message}`);
    }
  }
  
  // Now test authenticated pages - first need to login
  console.log('\n🔐 Attempting to login for authenticated page testing...');
  
  try {
    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(2000);
    
    // Check if there's a demo login or test credentials
    const hasEmailField = await page.locator('input[type="email"]').count() > 0;
    const hasPasswordField = await page.locator('input[type="password"]').count() > 0;
    
    if (hasEmailField && hasPasswordField) {
      // Try demo credentials
      await page.fill('input[type="email"]', 'winut.hf@gmail.com');
      await page.fill('input[type="password"]', 'test123');
      
      const loginButton = page.locator('button[type="submit"]').first();
      if (await loginButton.count() > 0) {
        await loginButton.click();
        await page.waitForTimeout(3000);
        
        // Check if login was successful
        const currentUrl = page.url();
        const isLoggedIn = !currentUrl.includes('/login');
        
        if (isLoggedIn) {
          console.log('   ✅ Login successful');
          
          // Test authenticated pages
          console.log('\n📝 Testing authenticated pages...');
          for (const pageInfo of pages.filter(p => p.requiresAuth && !p.adminOnly)) {
            try {
              console.log(`\n🔍 Testing: ${pageInfo.name} (${pageInfo.url})`);
              
              const startTime = Date.now();
              await page.goto(pageInfo.url, { waitUntil: 'networkidle' });
              const loadTime = Date.now() - startTime;
              
              console.log(`   ⏱️  Load time: ${loadTime}ms`);
              
              await page.waitForTimeout(3000);
              
              const title = await page.title();
              console.log(`   📄 Page title: ${title}`);
              
              // Take screenshot
              await page.screenshot({ 
                path: `/tmp/${pageInfo.name.replace(/\s+/g, '_').toLowerCase()}_auth.png`,
                fullPage: true 
              });
              
              console.log(`   ✅ Page loaded successfully`);
              
            } catch (error) {
              errors.push({
                type: 'navigation_error',
                page: pageInfo.name,
                url: pageInfo.url,
                message: error.message,
                timestamp: new Date().toISOString()
              });
              console.log(`   ❌ Failed to load: ${error.message}`);
            }
          }
        } else {
          console.log('   ❌ Login failed - cannot test authenticated pages');
        }
      }
    } else {
      console.log('   ⚠️  Login form not found - testing authenticated pages as guest');
    }
    
  } catch (error) {
    console.log(`   ❌ Login process failed: ${error.message}`);
  }
  
  await browser.close();
  
  // Report results
  console.log('\n\n📊 TESTING RESULTS SUMMARY');
  console.log('=' * 50);
  
  if (errors.length === 0) {
    console.log('✅ No errors detected!');
  } else {
    console.log(`❌ Found ${errors.length} errors:`);
    errors.forEach((error, index) => {
      console.log(`\n${index + 1}. ${error.type.toUpperCase()}`);
      if (error.page) console.log(`   Page: ${error.page}`);
      if (error.url) console.log(`   URL: ${error.url}`);
      console.log(`   Message: ${error.message}`);
      if (error.stack) console.log(`   Stack: ${error.stack.split('\n')[0]}`);
      console.log(`   Time: ${error.timestamp}`);
    });
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  Found ${warnings.length} warnings:`);
    warnings.forEach((warning, index) => {
      console.log(`\n${index + 1}. ${warning.message}`);
    });
  }
  
  console.log('\n📷 Screenshots saved to /tmp/ directory');
  console.log('\n🎉 Testing complete!');
  
  return { errors, warnings };
}

// Run the test
testAllPages().catch(console.error);