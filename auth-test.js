const jwt = require('jsonwebtoken');

// Same JWT secret as mock backend
const JWT_SECRET = 'mock-jwt-secret-for-testing';

// Create a test token
const token = jwt.sign(
  { 
    id: 'test-user-id',
    email: 'winut.hf@gmail.com',
    role: 'user',
    name: 'Test User'
  },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Test JWT Token:', token);

// Test the API endpoints with authentication
async function testWithAuth() {
  const fetch = require('node-fetch');
  
  const endpoints = [
    '/api/surveys/public/user',
    '/api/surveys/invited/user', 
    '/api/surveys/available/user'
  ];
  
  console.log('\n🔐 Testing with Authentication:\n');
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`http://localhost:5001${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      console.log(`📍 ${endpoint}:`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      console.log(`   Response:`, JSON.stringify(data, null, 2));
      console.log('');
      
    } catch (error) {
      console.log(`❌ ${endpoint}: Error - ${error.message}`);
    }
  }
}

// Install node-fetch if needed
try {
  require('node-fetch');
  testWithAuth();
} catch (e) {
  console.log('\nTo run authentication test, install node-fetch:');
  console.log('npm install node-fetch@2');
}