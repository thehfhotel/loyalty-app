const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function investigateSurveyIssues() {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  // Create screenshots directory
  const screenshotDir = './investigation-screenshots';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
  }
  
  // Capture console logs
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString()
    });
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Capture network requests
  const networkRequests = [];
  page.on('request', request => {
    networkRequests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      timestamp: new Date().toISOString()
    });
    console.log(`[REQUEST] ${request.method()} ${request.url()}`);
  });
  
  page.on('response', async response => {
    try {
      const contentType = response.headers()['content-type'] || '';
      let responseData = null;
      
      if (contentType.includes('application/json')) {
        responseData = await response.json();
        console.log(`[RESPONSE] ${response.status()} ${response.url()}`);
        if (response.url().includes('/api/surveys') || response.url().includes('/api/loyalty')) {
          console.log(`[API RESPONSE DATA]`, JSON.stringify(responseData, null, 2));
        }
      }
      
      networkRequests.push({
        url: response.url(),
        status: response.status(),
        headers: response.headers(),
        data: responseData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.log(`[RESPONSE ERROR] ${response.url()}: ${error.message}`);
    }
  });
  
  try {
    console.log('🔍 Starting survey investigation...');
    
    // Step 1: Navigate to login page
    console.log('📍 Step 1: Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${screenshotDir}/01-login-page.png`, fullPage: true });
    
    // Step 2: Login
    console.log('📍 Step 2: Logging in...');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${screenshotDir}/02-after-login.png`, fullPage: true });
    
    // Step 3: Navigate to surveys page
    console.log('📍 Step 3: Navigating to surveys page...');
    await page.goto('http://localhost:3000/surveys');
    await page.waitForLoadState('networkidle');
    
    // Wait a bit for React components to render
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: `${screenshotDir}/03-surveys-page-initial.png`, fullPage: true });
    
    // Check if surveys are being loaded
    console.log('🔍 Checking survey page content...');
    
    // Look for survey cards or list items
    const surveyElements = await page.locator('[data-testid*="survey"], .survey-card, .survey-item, [class*="survey"]').count();
    console.log(`Found ${surveyElements} survey-related elements`);
    
    // Check for loading states
    const loadingElements = await page.locator('[data-testid*="loading"], .loading, .spinner, [class*="loading"]').count();
    console.log(`Found ${loadingElements} loading elements`);
    
    // Check for empty states
    const emptyStates = await page.locator('[data-testid*="empty"], .empty-state, [class*="empty"]').count();
    console.log(`Found ${emptyStates} empty state elements`);
    
    // Check for tab navigation
    const tabs = await page.locator('button[role="tab"], .tab, [class*="tab"]').count();
    console.log(`Found ${tabs} tab elements`);
    
    if (tabs > 0) {
      console.log('📍 Testing tab switching...');
      const tabElements = await page.locator('button[role="tab"], .tab, [class*="tab"]').all();
      for (let i = 0; i < tabElements.length; i++) {
        console.log(`Clicking tab ${i + 1}`);
        await tabElements[i].click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${screenshotDir}/03-surveys-tab-${i + 1}.png`, fullPage: true });
      }
    }
    
    // Step 4: Inspect HTML content
    console.log('📍 Step 4: Inspecting HTML content...');
    const pageContent = await page.content();
    const bodyText = await page.locator('body').textContent();
    console.log('Page body text preview:', bodyText.substring(0, 500) + '...');
    
    // Check React component rendering
    const reactRoot = await page.locator('#root').innerHTML();
    console.log('React root content preview:', reactRoot.substring(0, 300) + '...');
    
    // Step 5: Navigate to admin survey builder
    console.log('📍 Step 5: Navigating to survey builder...');
    await page.goto('http://localhost:3000/admin/surveys/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: `${screenshotDir}/04-survey-builder.png`, fullPage: true });
    
    // Check survey builder content
    const builderContent = await page.locator('main, .main-content, [role="main"]').textContent();
    console.log('Survey builder content preview:', builderContent.substring(0, 500) + '...');
    
    // Check for form elements
    const formElements = await page.locator('form, input, textarea, button[type="submit"]').count();
    console.log(`Found ${formElements} form elements in survey builder`);
    
    // Step 6: Check developer tools network tab equivalent
    console.log('📍 Step 6: Analyzing network activity...');
    
    // Go back to surveys page and force refresh
    await page.goto('http://localhost:3000/surveys', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: `${screenshotDir}/05-surveys-after-refresh.png`, fullPage: true });
    
    // Step 7: Check local storage and session storage
    console.log('📍 Step 7: Checking browser storage...');
    const localStorage = await page.evaluate(() => JSON.stringify(localStorage));
    const sessionStorage = await page.evaluate(() => JSON.stringify(sessionStorage));
    
    console.log('Local Storage:', localStorage);
    console.log('Session Storage:', sessionStorage);
    
    // Step 8: Final comprehensive screenshot
    await page.screenshot({ path: `${screenshotDir}/06-final-state.png`, fullPage: true });
    
    // Save investigation report
    const report = {
      timestamp: new Date().toISOString(),
      consoleLogs,
      networkRequests: networkRequests.filter(req => 
        req.url.includes('/api/') || 
        req.url.includes('.js') || 
        req.url.includes('.css')
      ),
      localStorage: JSON.parse(localStorage),
      sessionStorage: JSON.parse(sessionStorage),
      surveyElements,
      loadingElements,
      emptyStates,
      tabs,
      formElements
    };
    
    fs.writeFileSync('./investigation-report.json', JSON.stringify(report, null, 2));
    
    console.log('✅ Investigation complete! Check investigation-report.json and screenshots.');
    
  } catch (error) {
    console.error('❌ Investigation failed:', error);
    await page.screenshot({ path: `${screenshotDir}/error-state.png`, fullPage: true });
  } finally {
    await browser.close();
  }
}

// Run the investigation
investigateSurveyIssues().catch(console.error);