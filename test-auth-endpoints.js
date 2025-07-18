#!/usr/bin/env node

/**
 * Test script to verify authentication endpoints are working
 */

const http = require('http');
const { URL } = require('url');

const API_URL = 'http://192.168.100.228:3011';

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = http.request(url, options, (res) => {
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

async function testLoginEndpoint() {
  console.log('🔍 Testing login endpoint...');
  
  try {
    const response = await makeRequest(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'demo.user.final@example.com',
        password: 'TestPassword123@'
      })
    });
    
    console.log(`Status: ${response.statusCode}`);
    console.log(`Response: ${response.body}`);
    
    if (response.statusCode === 200) {
      console.log('✅ Login endpoint working');
      return true;
    } else {
      console.log(`❌ Login endpoint failed with status ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Login endpoint error: ${error.message}`);
    return false;
  }
}

async function testRegisterEndpoint() {
  console.log('🔍 Testing register endpoint...');
  
  try {
    const response = await makeRequest(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'User',
        email: `test.${Date.now()}@example.com`,
        password: 'TestPassword123@'
      })
    });
    
    console.log(`Status: ${response.statusCode}`);
    console.log(`Response: ${response.body}`);
    
    if (response.statusCode === 201) {
      console.log('✅ Register endpoint working');
      return true;
    } else {
      console.log(`❌ Register endpoint failed with status ${response.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Register endpoint error: ${error.message}`);
    return false;
  }
}

async function testAuthMeEndpoint() {
  console.log('🔍 Testing /auth/me endpoint...');
  
  // First, get a token by logging in
  try {
    const loginResponse = await makeRequest(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'demo.user.final@example.com',
        password: 'TestPassword123@'
      })
    });
    
    if (loginResponse.statusCode !== 200) {
      console.log('❌ Cannot test /auth/me - login failed');
      return false;
    }
    
    const loginData = JSON.parse(loginResponse.body);
    const token = loginData.data.accessToken;
    
    // Now test the /auth/me endpoint
    const meResponse = await makeRequest(`${API_URL}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log(`Status: ${meResponse.statusCode}`);
    console.log(`Response: ${meResponse.body}`);
    
    if (meResponse.statusCode === 200) {
      console.log('✅ /auth/me endpoint working');
      return true;
    } else {
      console.log(`❌ /auth/me endpoint failed with status ${meResponse.statusCode}`);
      return false;
    }
    
  } catch (error) {
    console.log(`❌ /auth/me endpoint error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing Authentication Endpoints');
  console.log('====================================\n');
  
  const tests = [
    testRegisterEndpoint,
    testLoginEndpoint,
    testAuthMeEndpoint
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
    console.log(''); // Empty line for readability
  }
  
  console.log('📊 Test Results:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All authentication endpoints are working!');
  } else {
    console.log('\n⚠️  Some authentication endpoints have issues.');
  }
}

main().catch(console.error);