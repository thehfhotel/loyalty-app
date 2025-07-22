#!/usr/bin/env node

/**
 * Thai Language Survey Error Capture Script
 * 
 * This script will create a Thai language survey and capture the exact
 * validation error response from the backend to identify the root cause
 * of the 400 error when creating surveys with Thai content.
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:4000/api';

// Test user credentials
const TEST_USER = {
  email: 'winut.hf@gmail.com',
  password: 'Kick2you@ss'
};

// Thai language survey data (exact scenario from the issue)
const THAI_SURVEY_DATA = {
  title: "ความพึงพอใจของลูกค้า", // "Customer Satisfaction" in Thai
  description: "กรุณาช่วยเราปรับปรุงบริการ", // "Please help us improve our service" in Thai
  questions: [
    {
      id: "q_thai_001",
      type: "single_choice",
      text: "คุณพอใจกับบริการไหม?", // "Are you satisfied with the service?" in Thai
      required: true,
      order: 1,
      options: [
        {
          id: "opt_thai_001",
          text: "พอใจมาก", // "Very satisfied" in Thai
          value: "very_satisfied"
        },
        {
          id: "opt_thai_002", 
          text: "พอใจ", // "Satisfied" in Thai
          value: "satisfied"
        }
      ]
    }
  ],
  target_segment: {},
  access_type: "public"
};

let authToken = null;

async function login() {
  try {
    console.log('🔐 Logging in...');
    const response = await axios.post(`${API_BASE_URL}/auth/login`, TEST_USER);
    authToken = response.data.token;
    console.log('✅ Login successful');
    return authToken;
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
    throw error;
  }
}

async function createThaiSurvey() {
  try {
    console.log('\n📊 Creating Thai language survey...');
    console.log('Survey data being sent:');
    console.log(JSON.stringify(THAI_SURVEY_DATA, null, 2));
    
    console.log('\nEncoding analysis:');
    console.log('Title:', {
      text: THAI_SURVEY_DATA.title,
      length: THAI_SURVEY_DATA.title.length,
      bytes: Buffer.from(THAI_SURVEY_DATA.title, 'utf8').length,
      encoding: 'UTF-8'
    });
    console.log('Description:', {
      text: THAI_SURVEY_DATA.description,
      length: THAI_SURVEY_DATA.description.length,
      bytes: Buffer.from(THAI_SURVEY_DATA.description, 'utf8').length,
      encoding: 'UTF-8'
    });
    
    THAI_SURVEY_DATA.questions.forEach((q, i) => {
      console.log(`Question ${i + 1}:`, {
        text: q.text,
        length: q.text.length,
        bytes: Buffer.from(q.text, 'utf8').length,
        encoding: 'UTF-8'
      });
      
      if (q.options) {
        q.options.forEach((opt, j) => {
          console.log(`  Option ${j + 1}:`, {
            text: opt.text,
            length: opt.text.length,
            bytes: Buffer.from(opt.text, 'utf8').length,
            encoding: 'UTF-8'
          });
        });
      }
    });
    
    const response = await axios.post(
      `${API_BASE_URL}/surveys`,
      THAI_SURVEY_DATA,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Survey created successfully!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('\n❌ THAI SURVEY CREATION ERROR CAPTURED:');
    console.error('===========================================');
    
    if (error.response) {
      console.error('HTTP Status:', error.response.status);
      console.error('HTTP Status Text:', error.response.statusText);
      console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
      
      // Extract specific validation errors
      if (error.response.data.validationErrors) {
        console.error('\n🔍 VALIDATION ERRORS ANALYSIS:');
        error.response.data.validationErrors.forEach((validationError, index) => {
          console.error(`Validation Error ${index + 1}:`, validationError);
        });
      }
      
      // Check for encoding issues
      if (error.response.data.receivedData) {
        console.error('\n📝 RECEIVED DATA ANALYSIS:');
        console.error('Backend received:', JSON.stringify(error.response.data.receivedData, null, 2));
      }
      
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Request:', error.request);
    } else {
      console.error('Error setting up request:', error.message);
    }
    
    console.error('Full error object:', error);
    console.error('===========================================');
    
    throw error;
  }
}

async function testDatabaseConnection() {
  try {
    console.log('\n🗄️  Testing database connection...');
    const response = await axios.get(`${API_BASE_URL}/health`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    console.log('✅ Database connection OK');
  } catch (error) {
    console.error('❌ Database connection failed:', error.response?.data || error.message);
  }
}

async function testEncodingSupport() {
  try {
    console.log('\n🌐 Testing Unicode/UTF-8 encoding support...');
    
    // Test simple API call with Thai characters
    const testData = { test: "ทดสอบ" }; // "test" in Thai
    console.log('Sending test data:', testData);
    
    // This will likely fail but should give us encoding info
    const response = await axios.post(`${API_BASE_URL}/test-encoding`, testData, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    
    console.log('✅ Encoding test passed:', response.data);
  } catch (error) {
    console.log('ℹ️  Encoding test endpoint not available (expected)');
  }
}

async function main() {
  console.log('🚀 Starting Thai Language Survey Error Capture');
  console.log('==============================================');
  
  try {
    // Step 1: Login
    await login();
    
    // Step 2: Test database connection
    await testDatabaseConnection();
    
    // Step 3: Test encoding support
    await testEncodingSupport();
    
    // Step 4: Create Thai survey (this should fail and capture the error)
    await createThaiSurvey();
    
  } catch (error) {
    console.error('\n💥 Script completed with error (expected for debugging)');
    
    // Provide analysis and recommendations
    console.log('\n📋 ERROR ANALYSIS & RECOMMENDATIONS:');
    console.log('===================================');
    
    if (error.response?.status === 400) {
      console.log('• 400 Bad Request indicates validation failure');
      console.log('• Check validation errors above for specific field issues');
      console.log('• Common causes:');
      console.log('  - Character encoding (UTF-8) issues');
      console.log('  - Database column length limitations');
      console.log('  - Missing required fields or invalid data types');
      console.log('  - JSON serialization/deserialization problems');
    } else if (error.response?.status === 500) {
      console.log('• 500 Internal Server Error indicates backend processing failure');
      console.log('• Check server logs for database errors or encoding issues');
    } else if (!error.response) {
      console.log('• Network connectivity issue or server not running');
      console.log('• Ensure backend server is running on http://localhost:4000');
    }
    
    process.exit(1);
  }
  
  console.log('\n🎉 Script completed successfully!');
}

// Run the script
main().catch(error => {
  console.error('Script execution failed:', error);
  process.exit(1);
});