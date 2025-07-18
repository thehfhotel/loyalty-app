#!/usr/bin/env node

/**
 * Simple Node.js test script to validate the registration flow
 * without requiring browser dependencies
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Test configuration
const BASE_URL = 'http://192.168.100.228:3010';
const API_URL = 'http://192.168.100.228:3011';

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// Test functions
async function testAppAvailability() {
  console.log('🔍 Testing app availability...');
  
  try {
    const response = await makeRequest(BASE_URL);
    if (response.statusCode === 200) {
      console.log('✅ Frontend app is running and accessible');
      return true;
    } else {
      console.log(`❌ Frontend app returned status ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Frontend app is not accessible: ${error.message}`);
    return false;
  }
}

async function testUserServiceAPI() {
  console.log('🔍 Testing user service API...');
  
  try {
    const response = await makeRequest(`${API_URL}/health`);
    if (response.statusCode === 200) {
      console.log('✅ User service API is running');
      return true;
    } else {
      console.log(`❌ User service API returned status ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ User service API is not accessible: ${error.message}`);
    return false;
  }
}

async function testRegistrationAPI() {
  console.log('🔍 Testing registration API endpoint...');
  
  const testUser = {
    firstName: 'Test',
    lastName: 'User',
    email: `test.${Date.now()}@example.com`,
    password: 'TestPassword123@',
    phoneNumber: '+1234567890',
    dateOfBirth: '1990-01-01'
  };
  
  try {
    const response = await makeRequest(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testUser)
    });
    
    if (response.statusCode === 201) {
      console.log('✅ Registration API working correctly');
      
      // Parse response to check structure
      const data = JSON.parse(response.body);
      if (data.success && data.data && data.data.user && data.data.accessToken) {
        console.log('✅ Registration API returns correct response structure');
        console.log(`   - User ID: ${data.data.user.id}`);
        console.log(`   - Email: ${data.data.user.email}`);
        console.log(`   - Loyalty Tier: ${data.data.user.loyalty_tier}`);
        console.log(`   - Total Points: ${data.data.user.total_points}`);
        return true;
      } else {
        console.log('❌ Registration API response structure is incorrect');
        return false;
      }
    } else {
      console.log(`❌ Registration API returned status ${response.statusCode}`);
      console.log(`   Response: ${response.body}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Registration API test failed: ${error.message}`);
    return false;
  }
}

async function testDuplicateEmailHandling() {
  console.log('🔍 Testing duplicate email handling...');
  
  const existingEmail = 'demo.user.final@example.com';
  const duplicateUser = {
    firstName: 'Test',
    lastName: 'User',
    email: existingEmail,
    password: 'TestPassword123@'
  };
  
  try {
    const response = await makeRequest(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(duplicateUser)
    });
    
    if (response.statusCode === 409) {
      console.log('✅ Duplicate email handling working correctly');
      return true;
    } else {
      console.log(`❌ Expected 409 for duplicate email, got ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Duplicate email test failed: ${error.message}`);
    return false;
  }
}

async function testPasswordValidation() {
  console.log('🔍 Testing password validation...');
  
  const weakPasswordUser = {
    firstName: 'Test',
    lastName: 'User',
    email: `test.weak.${Date.now()}@example.com`,
    password: 'weak'
  };
  
  try {
    const response = await makeRequest(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(weakPasswordUser)
    });
    
    if (response.statusCode === 400) {
      console.log('✅ Password validation working correctly');
      return true;
    } else {
      console.log(`❌ Expected 400 for weak password, got ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Password validation test failed: ${error.message}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Hotel Loyalty App Registration Tests');
  console.log('=================================================\\n');
  
  const tests = [
    testAppAvailability,
    testUserServiceAPI,
    testRegistrationAPI,
    testDuplicateEmailHandling,
    testPasswordValidation
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.log(`❌ Test failed with error: ${error.message}`);
      failed++;
    }
    console.log(''); // Empty line for readability
  }
  
  console.log('📊 Test Results:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\\n🎉 All tests passed! Registration flow is working correctly.');
    process.exit(0);
  } else {
    console.log('\\n⚠️  Some tests failed. Please check the issues above.');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error(`❌ Test runner failed: ${error.message}`);
  process.exit(1);
});