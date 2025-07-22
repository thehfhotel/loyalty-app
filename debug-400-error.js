// Debug script to capture exact 400 error payload
import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  console.log('🔍 Starting 400 Error Debug Session...\n');

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 // Slow down for visibility
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  
  // Capture all network requests
  const requests = [];
  const responses = [];
  
  page.on('request', request => {
    if (request.url().includes('/api/surveys') && request.method() === 'POST') {
      console.log('🚀 Captured POST request to /api/surveys');
      requests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData()
      });
    }
  });
  
  page.on('response', response => {
    if (response.url().includes('/api/surveys') && response.request().method() === 'POST') {
      console.log('📥 Captured response from /api/surveys');
      responses.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers()
      });
    }
  });

  try {
    console.log('1️⃣ Navigating to localhost:3000...');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    console.log('2️⃣ Logging in...');
    await page.fill('input[name="email"]', 'winut.hf@gmail.com');
    await page.fill('input[name="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Successfully logged in');

    console.log('3️⃣ Navigating to survey creation...');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForLoadState('networkidle');
    console.log('✅ Survey creation page loaded');

    console.log('4️⃣ Filling out minimal survey...');
    await page.fill('input[id="title"]', 'Debug Test Survey');
    await page.fill('textarea[id="description"]', 'This is a test survey to debug the 400 error');
    
    // Add a simple text question
    await page.click('button:has-text("Text Input")');
    await page.waitForTimeout(2000); // Wait for question to be added
    
    // Find and fill the question text textarea
    const questionTextArea = page.locator('textarea[placeholder="Enter your question..."]');
    await questionTextArea.fill('What is your name?');
    
    console.log('5️⃣ Submitting survey (this should trigger 400 error)...');
    
    // Listen for the response to capture error details
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/surveys') && response.request().method() === 'POST'
    );
    
    await page.click('button:has-text("Save Draft")');
    
    // Wait for and capture the response
    const response = await responsePromise;
    const responseBody = await response.text();
    
    console.log('\n🚨 ERROR RESPONSE CAPTURED:');
    console.log('Status:', response.status());
    console.log('Status Text:', response.statusText());
    console.log('Response Body:', responseBody);
    
    // Get the request payload that was sent
    if (requests.length > 0) {
      const request = requests[0];
      console.log('\n📤 REQUEST PAYLOAD SENT:');
      console.log('URL:', request.url);
      console.log('Method:', request.method);
      console.log('Headers:', JSON.stringify(request.headers, null, 2));
      console.log('Post Data:', request.postData);
      
      // Parse and format the JSON payload
      try {
        const payload = JSON.parse(request.postData);
        console.log('\n📋 FORMATTED PAYLOAD:');
        console.log(JSON.stringify(payload, null, 2));
      } catch (e) {
        console.log('Could not parse payload as JSON');
      }
    }
    
    // Save debug info to file
    const debugInfo = {
      timestamp: new Date().toISOString(),
      request: requests[0] || null,
      response: {
        status: response.status(),
        statusText: response.statusText(),
        body: responseBody
      },
      requests: requests,
      responses: responses
    };
    
    fs.writeFileSync('debug-400-error-capture.json', JSON.stringify(debugInfo, null, 2));
    console.log('\n💾 Debug info saved to debug-400-error-capture.json');

  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    console.log('\n🔍 Debug session completed');
    await browser.close();
  }
})();