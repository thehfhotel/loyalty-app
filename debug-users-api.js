const fetch = require('node-fetch');

async function debugUsersAPI() {
  console.log('🔍 Debugging Users API Response...\n');
  
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
    
    if (!loginResponse.ok) {
      console.error('❌ Login failed:', loginResponse.status, loginResponse.statusText);
      return;
    }
    
    const loginData = await loginResponse.json();
    const token = loginData.data?.tokens?.accessToken || loginData.tokens?.accessToken || loginData.accessToken;
    console.log('✅ Got token:', token ? 'Yes' : 'No');
    console.log('Login response structure:', JSON.stringify(loginData, null, 2));
    
    // Now fetch users
    console.log('\n📋 Fetching users...');
    const usersResponse = await fetch('http://localhost:4000/api/loyalty/admin/users?limit=5', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Response status: ${usersResponse.status} ${usersResponse.statusText}`);
    
    if (usersResponse.ok) {
      const usersData = await usersResponse.json();
      console.log('\n📊 Response structure:');
      console.log(JSON.stringify(usersData, null, 2));
      
      if (usersData.data?.users) {
        console.log('\n👥 First 3 users:');
        usersData.data.users.slice(0, 3).forEach((user, index) => {
          console.log(`\nUser ${index + 1}:`);
          console.log(`  ID: ${user.id || 'MISSING'}`);
          console.log(`  Email: ${user.email}`);
          console.log(`  First Name: ${user.first_name}`);
          console.log(`  Last Name: ${user.last_name}`);
          console.log(`  Full object keys: ${Object.keys(user).join(', ')}`);
        });
      }
    } else {
      const text = await usersResponse.text();
      console.log('❌ Failed response body:', text);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

debugUsersAPI();