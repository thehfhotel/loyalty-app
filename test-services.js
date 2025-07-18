const axios = require('axios');

// Service endpoints
const services = {
  'User Service': 'http://localhost:3011/health',
  'Loyalty Service': 'http://localhost:3012/health',
  'Campaign Service': 'http://localhost:3013/health',
  'Survey Service': 'http://localhost:3014/health',
  'Coupon Service': 'http://localhost:3015/health',
  'Notification Service': 'http://localhost:3016/health',
  'Analytics Service': 'http://localhost:3017/health',
  'Integration Service': 'http://localhost:3018/health'
};

async function testServices() {
  console.log('🔍 Testing all microservices health endpoints...\n');
  
  const results = [];
  
  for (const [serviceName, endpoint] of Object.entries(services)) {
    try {
      const response = await axios.get(endpoint, { timeout: 5000 });
      
      if (response.status === 200) {
        console.log(`✅ ${serviceName}: HEALTHY`);
        results.push({ service: serviceName, status: 'HEALTHY', response: response.data });
      } else {
        console.log(`⚠️  ${serviceName}: UNHEALTHY (Status: ${response.status})`);
        results.push({ service: serviceName, status: 'UNHEALTHY', error: `HTTP ${response.status}` });
      }
    } catch (error) {
      console.log(`❌ ${serviceName}: ERROR`);
      console.log(`   Error: ${error.message}`);
      results.push({ service: serviceName, status: 'ERROR', error: error.message });
    }
  }
  
  console.log('\n📊 Service Health Summary:');
  console.log('=' .repeat(50));
  
  const healthy = results.filter(r => r.status === 'HEALTHY').length;
  const unhealthy = results.filter(r => r.status === 'UNHEALTHY').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  
  console.log(`✅ Healthy: ${healthy}`);
  console.log(`⚠️  Unhealthy: ${unhealthy}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📈 Total: ${results.length}`);
  
  if (healthy === results.length) {
    console.log('\n🎉 All services are healthy! Phase 2 implementation is complete.');
  } else {
    console.log('\n⚠️  Some services need attention. Check the errors above.');
  }
  
  return results;
}

// API Integration Tests
async function testAPIIntegration() {
  console.log('\n🔄 Testing API Integration...\n');
  
  const baseURL = 'http://localhost:3011/api/v1';
  let authToken = null;
  
  try {
    // Test user registration
    console.log('📝 Testing user registration...');
    const registerResponse = await axios.post(`${baseURL}/auth/register`, {
      email: 'test@example.com',
      password: 'password123',
      first_name: 'Test',
      last_name: 'User'
    });
    
    if (registerResponse.status === 201) {
      console.log('✅ User registration successful');
      authToken = registerResponse.data.data.accessToken;
    }
    
    // Test user login
    console.log('🔐 Testing user login...');
    const loginResponse = await axios.post(`${baseURL}/auth/login`, {
      email: 'test@example.com',
      password: 'password123'
    });
    
    if (loginResponse.status === 200) {
      console.log('✅ User login successful');
      authToken = loginResponse.data.data.accessToken;
    }
    
    // Test protected endpoint
    console.log('🛡️  Testing protected endpoint...');
    const profileResponse = await axios.get(`${baseURL}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (profileResponse.status === 200) {
      console.log('✅ Protected endpoint working');
    }
    
    console.log('\n🎉 API Integration tests passed!');
    
  } catch (error) {
    console.log(`❌ API Integration test failed: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data:`, error.response.data);
    }
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Hotel Loyalty App - Phase 2 Testing\n');
  
  await testServices();
  await testAPIIntegration();
  
  console.log('\n🏁 Testing complete!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testServices, testAPIIntegration, runTests };