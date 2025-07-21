const bcrypt = require('bcrypt');
const { Client } = require('pg');

async function setupTestUser() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'loyalty_db',
    user: 'loyalty_user',
    password: 'loyalty_password',
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Hash the password
    const hashedPassword = await bcrypt.hash('password123', 10);
    console.log('Password hashed');

    // Insert or update the test user
    const query = `
      INSERT INTO users (email, password, first_name, last_name, is_verified)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) 
      DO UPDATE SET 
        password = $2,
        is_verified = $5
      RETURNING id, email;
    `;

    const result = await client.query(query, [
      'test@example.com',
      hashedPassword,
      'Test',
      'User',
      true
    ]);

    console.log('Test user created/updated:', result.rows[0]);

    // Check if user is in admin list
    console.log('Test user should be admin according to admins.json');
    
  } catch (error) {
    console.error('Error setting up test user:', error);
  } finally {
    await client.end();
  }
}

setupTestUser();