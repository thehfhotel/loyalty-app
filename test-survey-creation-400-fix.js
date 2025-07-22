const { chromium } = require('playwright');

async function testSurveyCreation() {
  console.log('🧪 Starting Survey Creation Test - 400 Error Fix Verification');
  console.log('=====================================');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 // Add delay to see what's happening
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable request/response logging
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log(`📤 API Request: ${request.method()} ${request.url()}`);
      if (request.method() === 'POST') {
        console.log(`📝 Request Body: ${request.postData()}`);
      }
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log(`📥 API Response: ${response.status()} ${response.url()}`);
    }
  });

  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ Console Error:', msg.text());
    }
  });

  // Listen for page errors
  page.on('pageerror', error => {
    console.log('💥 Page Error:', error.message);
  });

  try {
    console.log('🌐 Step 1: Navigate to login page');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/01-login-page.png' });

    console.log('🔐 Step 2: Login with test credentials');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    
    // Take screenshot before login
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/02-before-login-submit.png' });
    
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    // Wait for successful login (check for dashboard or redirect)
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/03-after-login.png' });

    console.log('📝 Step 3: Navigate to survey creation page');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/04-survey-builder-page.png' });

    console.log('✍️  Step 4: Fill out survey form');
    
    // Fill in survey title
    await page.fill('#title', 'Customer Satisfaction Survey');
    
    // Add a single choice question
    await page.click('button:has-text("Single Choice")');
    await page.waitForTimeout(1000);
    
    // Fill question text
    await page.fill('textarea[placeholder*="Enter your question"]', 'How satisfied are you?');
    
    // Fill in the options (they should already exist - just need to change their text)
    const optionInputs = page.locator('input[placeholder*="Option text"]');
    const options = ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied'];
    
    // First, add more options if needed
    const existingOptionsCount = await optionInputs.count();
    for (let i = existingOptionsCount; i < options.length; i++) {
      await page.click('button:has-text("Add Option")');
      await page.waitForTimeout(500);
    }
    
    // Now fill in all options
    const updatedOptionInputs = page.locator('input[placeholder*="Option text"]');
    for (let i = 0; i < options.length; i++) {
      await updatedOptionInputs.nth(i).fill(options[i]);
    }
    
    // Set Access Type to Public (should already be default)
    await page.selectOption('#access_type', 'public');
    
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/05-form-filled.png' });

    console.log('🚀 Step 5: Submit survey creation');
    
    // Set up response monitoring for the critical request
    let surveyCreationResponse = null;
    let surveyCreationRequest = null;
    
    page.on('request', request => {
      if (request.url().includes('/api/surveys') && request.method() === 'POST') {
        surveyCreationRequest = {
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          body: request.postData()
        };
        console.log('🎯 CRITICAL REQUEST CAPTURED:');
        console.log(`   URL: ${request.url()}`);
        console.log(`   Method: ${request.method()}`);
        console.log(`   Body: ${request.postData()}`);
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/surveys') && response.request().method() === 'POST') {
        surveyCreationResponse = {
          status: response.status(),
          statusText: response.statusText(),
          url: response.url()
        };
        console.log('🎯 CRITICAL RESPONSE CAPTURED:');
        console.log(`   Status: ${response.status()} ${response.statusText()}`);
        console.log(`   URL: ${response.url()}`);
      }
    });
    
    // Click create & publish button
    const createButton = page.locator('button:has-text("Create & Publish")');
    await createButton.click();
    
    // Wait for the request to complete
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/06-after-submit.png' });

    console.log('\n🎯 TEST RESULTS:');
    console.log('================');
    
    if (surveyCreationRequest) {
      console.log('✅ Request was sent:');
      console.log(`   URL: ${surveyCreationRequest.url}`);
      console.log(`   Method: ${surveyCreationRequest.method}`);
      console.log(`   Body: ${surveyCreationRequest.body}`);
    } else {
      console.log('❌ No survey creation request detected');
    }
    
    if (surveyCreationResponse) {
      console.log(`\n📊 Response received:`);
      console.log(`   Status: ${surveyCreationResponse.status} ${surveyCreationResponse.statusText}`);
      
      if (surveyCreationResponse.status === 400) {
        console.log('❌ 400 BAD REQUEST ERROR STILL OCCURS!');
        console.log('   The fix may not be working or not loaded properly.');
      } else if (surveyCreationResponse.status >= 200 && surveyCreationResponse.status < 300) {
        console.log('✅ SUCCESS! Survey creation worked without 400 error');
        console.log('   The fix appears to be working correctly.');
      } else {
        console.log(`⚠️  Unexpected status code: ${surveyCreationResponse.status}`);
      }
    } else {
      console.log('❌ No survey creation response detected');
    }
    
    // Check for success/error messages on the page
    await page.waitForTimeout(2000);
    const successMessage = await page.locator('.toast, .success, .alert-success, [class*="success"]').count();
    const errorMessage = await page.locator('.error, .alert-error, [class*="error"]').count();
    
    console.log(`\n🔍 UI Feedback:`);
    console.log(`   Success messages: ${successMessage}`);
    console.log(`   Error messages: ${errorMessage}`);
    
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/07-final-state.png' });

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/Users/nut/loyalty-app/test-screenshots/error-state.png' });
  } finally {
    await browser.close();
  }
}

// Run the test
testSurveyCreation().catch(console.error);