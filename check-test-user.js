const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://loyalty:loyalty_pass@localhost:5432/loyalty_db'
});

async function checkTestUser() {
  try {
    console.log('🔍 Checking test user in database...\n');
    
    // Check if test user exists
    const userResult = await pool.query(
      'SELECT id, email, role, created_at FROM users WHERE email = $1',
      ['winut.hf@gmail.com']
    );
    
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      console.log('✅ Test user found:');
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Created: ${user.created_at}`);
      
      // Check user's coupons
      const couponResult = await pool.query(
        `SELECT uc.id, uc.status, uc.qr_code, c.code, c.name
         FROM user_coupons uc
         JOIN coupons c ON uc.coupon_id = c.id
         WHERE uc.user_id = $1
         ORDER BY uc.created_at DESC`,
        [user.id]
      );
      
      console.log(`\n📊 User has ${couponResult.rows.length} assigned coupons:`);
      couponResult.rows.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
        console.log(`      Status: ${coupon.status}, QR: ${coupon.qr_code}`);
      });
      
      // Check active coupons view
      const activeResult = await pool.query(
        `SELECT code, name, status, expiring_soon
         FROM user_active_coupons
         WHERE user_id = $1`,
        [user.id]
      );
      
      console.log(`\n📊 Active coupons (what user should see): ${activeResult.rows.length}`);
      activeResult.rows.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name} (expiring soon: ${coupon.expiring_soon})`);
      });
      
    } else {
      console.log('❌ Test user not found. Creating test user...');
      
      // Create test user with bcrypt hash for "password123"
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('password123', 10);
      
      const createResult = await pool.query(
        `INSERT INTO users (email, password_hash, role, is_active, email_verified)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, role`,
        ['winut.hf@gmail.com', hashedPassword, 'super_admin', true, true]
      );
      
      const newUser = createResult.rows[0];
      console.log('✅ Created test user:');
      console.log(`   Email: ${newUser.email}`);
      console.log(`   Role: ${newUser.role}`);
      console.log(`   ID: ${newUser.id}`);
    }
    
  } catch (error) {
    if (error.message.includes('bcrypt')) {
      console.log('⚠️ bcrypt not installed, user creation skipped');
    } else {
      console.error('Error:', error.message);
    }
  } finally {
    await pool.end();
  }
}

checkTestUser();