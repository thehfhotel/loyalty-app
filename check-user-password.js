const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'loyalty',
  password: 'loyalty_pass',
  database: 'loyalty_db'
});

async function checkUser() {
  try {
    // First check the table structure
    const columns = await pool.query(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_name = 'users' 
       ORDER BY ordinal_position`
    );
    
    console.log('Users table columns:', columns.rows.map(r => r.column_name).join(', '));
    
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      ['winut.hf@gmail.com']
    );
    
    if (result.rows.length > 0) {
      const user = result.rows[0];
      console.log('\nUser found:');
      console.log(`  Email: ${user.email}`);
      console.log(`  Role: ${user.role}`);
      console.log(`  Created: ${user.created_at}`);
      console.log('\nNote: Passwords are hashed, so we cannot see the actual password.');
      console.log('If this is a test user, the default password is usually "password123"');
      console.log('Try logging in with that password.');
    } else {
      console.log('User not found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkUser();