const { chromium } = require('playwright');

async function testCorrectSurveyRoute() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔍 Testing correct survey builder route...');
    
    // Login first
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    // Test correct route
    console.log('📍 Testing /admin/surveys/create (correct route)...');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Check if page loads
    const pageTitle = await page.textContent('h1, h2, [role="heading"]').catch(() => null);
    const pageContent = await page.locator('main, .main, [role="main"]').textContent().catch(() => null);
    
    console.log('Page Title:', pageTitle);
    console.log('Page Content Preview:', pageContent?.substring(0, 200) + '...');
    
    await page.screenshot({ path: './survey-builder-correct-route.png', fullPage: true });
    
    console.log('✅ Screenshot saved as survey-builder-correct-route.png');
    
    // Test wrong route for comparison
    console.log('📍 Testing /admin/surveys/new (wrong route)...');
    await page.goto('http://localhost:3000/admin/surveys/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: './survey-builder-wrong-route.png', fullPage: true });
    console.log('✅ Screenshot saved as survey-builder-wrong-route.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testCorrectSurveyRoute();