const fetch = require('node-fetch');

async function testAssignAPI() {
  console.log('🔍 Testing Coupon Assignment API...\n');
  
  try {
    // First, get a token by logging in
    console.log('🔐 Getting auth token...');
    const loginResponse = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@hotel.com',
        password: 'admin123'
      })
    });
    
    const loginData = await loginResponse.json();
    const token = loginData.tokens?.accessToken;
    console.log('✅ Got token:', token ? 'Yes' : 'No');
    
    // Test assignment
    const testData = {
      couponId: '341c57ab-9b96-4416-9dd6-d28da2b4db1d',
      userIds: ['35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb'],
      assignedReason: 'Admin assignment test'
    };
    
    console.log('\n📤 Sending assignment request:');
    console.log(JSON.stringify(testData, null, 2));
    
    const assignResponse = await fetch('http://localhost:4000/api/coupons/assign', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });
    
    console.log(`\n📥 Response status: ${assignResponse.status} ${assignResponse.statusText}`);
    
    const responseText = await assignResponse.text();
    console.log('Response body:');
    try {
      const responseJson = JSON.parse(responseText);
      console.log(JSON.stringify(responseJson, null, 2));
    } catch {
      console.log(responseText);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAssignAPI();