const { chromium } = require('playwright');
const fs = require('fs');

async function testSurveyAPIs() {
  console.log('Testing Survey API Routes - Multi-approach validation\n');
  
  // First, let's test if the backend is running at all
  console.log('1. Testing backend availability...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Test basic backend connectivity
    const backendTest = await page.request.get('http://localhost:5001/api/health').catch(() => null);
    if (!backendTest) {
      console.log('   ❌ Backend not responding at http://localhost:5001');
      console.log('   Attempting to test API routes directly with basic auth...\n');
      
      // Test the survey routes directly without login
      await testRoutesDirectly(page);
      return;
    }
    
    console.log(`   ✅ Backend responding with status: ${backendTest.status()}`);
    
    // Check if frontend is available
    console.log('\n2. Testing frontend availability...');
    try {
      await page.goto('http://localhost:8080/mock-frontend.html', { timeout: 5000 });
      console.log('   ✅ Frontend available, attempting login flow...\n');
      
      // Proceed with login flow  
      await loginAndTestAPIs(page, context);
      
    } catch (error) {
      console.log('   ❌ Frontend not available, testing API routes directly...\n');
      await testRoutesDirectly(page);
    }
    
  } catch (error) {
    console.error('General test error:', error);
    await testRoutesDirectly(page);
  } finally {
    // Keep browser open for inspection
    console.log('\n\nTest complete. Press Ctrl+C to close the browser...');
    await new Promise(() => {}); // Keep the script running
  }
}

async function loginAndTestAPIs(page, context) {
  try {
    console.log('3. Using mock frontend for login...');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    console.log('4. Filling login form...');
    // Fill in the login form using the mock frontend IDs
    await page.fill('#email', 'winut.hf@gmail.com');
    await page.fill('#password', 'Kick2you@ss');
    
    // Submit the form
    console.log('5. Submitting login...');
    await page.click('#loginForm button[type="submit"]');
    
    // Wait for login success indication
    await page.waitForSelector('.success', { timeout: 10000 });
    console.log('6. Login successful, extracting token...');
    
    // Extract cookies from the browser context
    const cookies = await context.cookies();
    console.log('\n7. Extracted cookies:');
    cookies.forEach(cookie => {
      console.log(`   ${cookie.name}: ${cookie.value.substring(0, 20)}...`);
    });
    
    // Get auth token from localStorage (should be set by our mock frontend)
    const authToken = await page.evaluate(() => {
      return localStorage.getItem('token');
    });
    
    if (authToken) {
      console.log(`\n8. Found auth token in localStorage: ${authToken.substring(0, 30)}...`);
    } else {
      console.log('\n8. ⚠️  No auth token found in localStorage');
    }
    
    // Prepare headers for API requests
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    await testAPIEndpoints(page, headers, 'Authenticated');
    
  } catch (error) {
    console.error('Login flow failed:', error);
    console.log('Falling back to direct API testing...\n');
    await testRoutesDirectly(page);
  }
}

async function testRoutesDirectly(page) {
  console.log('Testing API routes directly (no authentication)...\n');
  
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  
  await testAPIEndpoints(page, headers, 'Direct');
}

async function testAPIEndpoints(page, headers, testType) {
  console.log(`\n=== ${testType} API Testing ===\n`);
  
  // Test each API endpoint
  const endpoints = [
    '/api/surveys/public/user',
    '/api/surveys/invited/user', 
    '/api/surveys/available/user'
  ];
  
  // Also test some basic endpoints for comparison
  const comparisonEndpoints = [
    '/api/health',
    '/api/user/profile',
    '/api/loyalty/points'
  ];
  
  console.log('Testing Survey API endpoints:');
  
  for (const endpoint of endpoints) {
    console.log(`\n📍 ${endpoint}:`);
    
    try {
      const response = await page.request.get(`http://localhost:5001${endpoint}`, {
        headers: headers
      });
      
      const status = response.status();
      const responseBody = await response.text();
      let jsonBody;
      
      try {
        jsonBody = JSON.parse(responseBody);
      } catch (e) {
        jsonBody = null;
      }
      
      console.log(`   Status: ${status}`);
      console.log(`   Response: ${jsonBody ? JSON.stringify(jsonBody, null, 2) : responseBody.substring(0, 300)}`);
      
      // Log response headers for debugging
      const responseHeaders = response.headers();
      if (responseHeaders['content-type']) {
        console.log(`   Content-Type: ${responseHeaders['content-type']}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n\nTesting comparison endpoints for context:');
  
  for (const endpoint of comparisonEndpoints) {
    console.log(`\n📍 ${endpoint}:`);
    
    try {
      const response = await page.request.get(`http://localhost:5001${endpoint}`, {
        headers: headers
      });
      
      const status = response.status();
      const responseBody = await response.text();
      let jsonBody;
      
      try {
        jsonBody = JSON.parse(responseBody);
      } catch (e) {
        jsonBody = null;
      }
      
      console.log(`   Status: ${status}`);
      console.log(`   Response: ${jsonBody ? JSON.stringify(jsonBody, null, 2) : responseBody.substring(0, 300)}`);
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  // Additional browser-based test
  console.log('\n\n=== Browser Direct Access Test ===\n');
  
  for (const endpoint of endpoints) {
    console.log(`\n🌐 Browser test for ${endpoint}:`);
    
    try {
      const apiUrl = `http://localhost:5001${endpoint}`;
      const response = await page.goto(apiUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 5000 
      });
      
      if (response) {
        console.log(`   Status: ${response.status()}`);
        
        // Get the response body
        const responseBody = await page.content();
        
        // Try to extract JSON from the page
        const preElement = await page.$('pre');
        if (preElement) {
          const jsonText = await preElement.textContent();
          try {
            const jsonData = JSON.parse(jsonText);
            console.log(`   Response: ${JSON.stringify(jsonData, null, 2)}`);
          } catch (e) {
            console.log(`   Response (raw): ${jsonText.substring(0, 300)}`);
          }
        } else {
          // Look for specific error patterns
          if (responseBody.includes('Cannot GET')) {
            console.log(`   ❌ Route not found - "Cannot GET ${endpoint}"`);
          } else if (responseBody.includes('404')) {
            console.log(`   ❌ 404 Not Found`);
          } else if (responseBody.includes('500')) {
            console.log(`   ❌ 500 Internal Server Error`);
          } else {
            console.log(`   Response (HTML): ${responseBody.substring(0, 300)}...`);
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Browser error: ${error.message}`);
    }
  }
  
  // Raw fetch test from browser context
  console.log('\n\n=== Raw Fetch Test ===\n');
  
  const rawResponse = await page.evaluate(async (testEndpoints) => {
    const results = [];
    
    for (const endpoint of testEndpoints) {
      try {
        const response = await fetch(`http://localhost:5001${endpoint}`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        
        const text = await response.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }
        
        results.push({
          endpoint,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: json || text.substring(0, 300)
        });
      } catch (error) {
        results.push({
          endpoint,
          error: error.message
        });
      }
    }
    
    return results;
  }, endpoints);
  
  console.log('Fetch API results:');
  rawResponse.forEach(result => {
    console.log(`\n🔧 ${result.endpoint}:`);
    if (result.error) {
      console.log(`   ❌ Error: ${result.error}`);
    } else {
      console.log(`   Status: ${result.status} ${result.statusText}`);
      console.log(`   Content-Type: ${result.headers['content-type'] || 'not specified'}`);
      console.log(`   Body: ${typeof result.body === 'object' ? JSON.stringify(result.body, null, 2) : result.body}`);
    }
  });
}

// Run the test
testSurveyAPIs().catch(console.error);