const { chromium } = require('playwright');

async function quickTest() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const errors = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console_error',
        message: msg.text(),
        timestamp: new Date().toISOString()
      });
    }
  });
  
  page.on('pageerror', error => {
    errors.push({
      type: 'page_error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  });
  
  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push({
        type: 'network_error',
        url: response.url(),
        status: response.status(),
        timestamp: new Date().toISOString()
      });
    }
  });

  console.log('🔍 Testing Home Page...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  console.log('🔍 Testing Login Page...');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  await browser.close();
  
  console.log(`\n📊 Results: ${errors.length} errors found`);
  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach((error, i) => {
      console.log(`${i+1}. ${error.type}: ${error.message}`);
      if (error.url) console.log(`   URL: ${error.url}`);
    });
  } else {
    console.log('✅ No errors detected!');
  }
}

quickTest().catch(console.error);