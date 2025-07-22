import { test, expect } from '@playwright/test';
import { authHelpers } from './helpers/auth';

test('Debug Survey Creation 400 Error', async ({ page }) => {
  console.log('=== SURVEY CREATION 400 ERROR DEBUG ===');
  
  // Enable detailed network logging
  const networkRequests: any[] = [];
  const networkResponses: any[] = [];
  
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      networkRequests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
        headers: request.headers()
      });
    }
  });

  page.on('response', async response => {
    if (response.url().includes('/api/')) {
      let responseBody = 'Could not read body';
      try {
        responseBody = await response.text();
      } catch (e) {
        responseBody = `Error reading body: ${e}`;
      }
      
      networkResponses.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        body: responseBody
      });
    }
  });

  // Login first
  await authHelpers.loginAsAdmin(page);
  
  // Navigate to survey creation
  console.log('Navigating to survey creation page...');
  await page.goto('/admin/surveys/create', { waitUntil: 'networkidle' });
  
  // Take screenshot of the survey builder
  await page.screenshot({ 
    path: 'debug-survey-builder-loaded.png',
    fullPage: true 
  });

  // Check if access_type field is present in the DOM
  console.log('Checking if access_type field is present...');
  const accessTypeField = page.locator('#access_type');
  await expect(accessTypeField).toBeVisible();
  console.log('✅ access_type field is visible');

  // Get current value of access_type
  const currentAccessType = await accessTypeField.inputValue();
  console.log(`Current access_type value: ${currentAccessType}`);

  // Inspect the frontend source code to see if our fix is active
  console.log('Inspecting frontend source for access_type fix...');
  
  // Check if the source contains the access_type default
  const pageSource = await page.content();
  const hasAccessTypeDefault = pageSource.includes('access_type') || pageSource.includes('public');
  console.log(`Frontend source includes access_type references: ${hasAccessTypeDefault}`);

  // Fill out the survey form
  console.log('Filling survey form...');
  
  await page.fill('#title', 'Test Survey Debug');
  await page.fill('#description', 'Testing 400 error debug');
  
  // Ensure access_type is set to public
  await page.selectOption('#access_type', 'public');
  
  // Add a simple question
  console.log('Adding a question...');
  await page.click('text=Single Choice');
  
  // Wait for question to be added
  await page.waitForSelector('[data-testid="question-editor"], .question-editor, [class*="question"]', { 
    timeout: 5000 
  }).catch(() => {
    console.log('Question editor selector not found with testid, trying alternative selectors...');
  });
  
  // Take screenshot after adding question
  await page.screenshot({ 
    path: 'debug-survey-after-question.png',
    fullPage: true 
  });

  // Fill the question text
  const questionInputs = page.locator('input[placeholder*="Enter question"], textarea[placeholder*="Enter question"], input[placeholder*="question"], textarea[placeholder*="question"]');
  const questionInputCount = await questionInputs.count();
  console.log(`Found ${questionInputCount} potential question inputs`);
  
  if (questionInputCount > 0) {
    await questionInputs.first().fill('How satisfied are you?');
    console.log('✅ Question text filled');
  }

  // Try to find and fill option inputs
  const optionInputs = page.locator('input[placeholder*="Option"], input[placeholder*="option"]');
  const optionCount = await optionInputs.count();
  console.log(`Found ${optionCount} option inputs`);
  
  if (optionCount >= 2) {
    await optionInputs.nth(0).fill('Good');
    await optionInputs.nth(1).fill('Bad');
    console.log('✅ Options filled');
  }

  // Take final screenshot before submission
  await page.screenshot({ 
    path: 'debug-survey-before-submit.png',
    fullPage: true 
  });

  // Clear previous network logs
  networkRequests.length = 0;
  networkResponses.length = 0;

  // Click Create & Publish
  console.log('Attempting to create survey...');
  await page.click('text=Create & Publish');

  // Wait for network request to complete
  await page.waitForTimeout(3000);

  // Log all network activity
  console.log('\n=== NETWORK REQUESTS ===');
  networkRequests.forEach((req, i) => {
    console.log(`Request ${i + 1}:`);
    console.log(`  URL: ${req.url}`);
    console.log(`  Method: ${req.method}`);
    console.log(`  Post Data: ${req.postData}`);
    console.log(`  Headers: ${JSON.stringify(req.headers, null, 2)}`);
    console.log('');
  });

  console.log('\n=== NETWORK RESPONSES ===');
  networkResponses.forEach((res, i) => {
    console.log(`Response ${i + 1}:`);
    console.log(`  URL: ${res.url}`);
    console.log(`  Status: ${res.status} ${res.statusText}`);
    console.log(`  Headers: ${JSON.stringify(res.headers, null, 2)}`);
    console.log(`  Body: ${res.body}`);
    console.log('');
  });

  // Look specifically for the survey creation request
  const surveyCreateRequest = networkRequests.find(req => 
    req.url.includes('/api/surveys') && req.method === 'POST'
  );

  const surveyCreateResponse = networkResponses.find(res => 
    res.url.includes('/api/surveys') && res.status >= 400
  );

  if (surveyCreateRequest) {
    console.log('\n=== SURVEY CREATION REQUEST ANALYSIS ===');
    console.log('Request found:', surveyCreateRequest.url);
    
    if (surveyCreateRequest.postData) {
      console.log('POST Data:', surveyCreateRequest.postData);
      
      try {
        const parsedData = JSON.parse(surveyCreateRequest.postData);
        console.log('Parsed POST Data:', JSON.stringify(parsedData, null, 2));
        
        // Check if access_type is included
        if (parsedData.access_type) {
          console.log(`✅ access_type is present: ${parsedData.access_type}`);
        } else {
          console.log('❌ access_type is MISSING from request');
        }

        // Check all required fields
        const requiredFields = ['title', 'description', 'questions', 'access_type'];
        requiredFields.forEach(field => {
          if (parsedData[field] !== undefined) {
            console.log(`✅ ${field}: ${typeof parsedData[field]} ${Array.isArray(parsedData[field]) ? `(array with ${parsedData[field].length} items)` : ''}`);
          } else {
            console.log(`❌ ${field}: MISSING`);
          }
        });

      } catch (e) {
        console.log('Could not parse POST data as JSON:', e);
      }
    } else {
      console.log('❌ No POST data found in request');
    }
  } else {
    console.log('❌ No survey creation request found');
  }

  if (surveyCreateResponse) {
    console.log('\n=== SURVEY CREATION ERROR RESPONSE ===');
    console.log(`Status: ${surveyCreateResponse.status} ${surveyCreateResponse.statusText}`);
    console.log('Response Body:', surveyCreateResponse.body);
    
    try {
      const parsedError = JSON.parse(surveyCreateResponse.body);
      console.log('Parsed Error:', JSON.stringify(parsedError, null, 2));
    } catch (e) {
      console.log('Could not parse error response as JSON');
    }
  } else {
    console.log('❌ No error response found');
  }

  // Take final screenshot
  await page.screenshot({ 
    path: 'debug-survey-after-submit.png',
    fullPage: true 
  });

  // Check current page state
  const currentUrl = page.url();
  const hasErrorMessage = await page.locator('.error, [role="alert"], .toast').count() > 0;
  
  console.log('\n=== FINAL STATE ===');
  console.log(`Current URL: ${currentUrl}`);
  console.log(`Has error message: ${hasErrorMessage}`);
  
  if (hasErrorMessage) {
    const errorMessages = await page.locator('.error, [role="alert"], .toast').allTextContents();
    console.log('Error messages:', errorMessages);
  }

  console.log('\n=== DEBUG SUMMARY ===');
  console.log(`1. Survey builder loaded: ✅`);
  console.log(`2. Access type field visible: ✅`);
  console.log(`3. Survey creation request made: ${surveyCreateRequest ? '✅' : '❌'}`);
  console.log(`4. Request includes access_type: ${surveyCreateRequest && surveyCreateRequest.postData && surveyCreateRequest.postData.includes('access_type') ? '✅' : '❌'}`);
  console.log(`5. Got 400 error response: ${surveyCreateResponse ? '✅' : '❌'}`);
});