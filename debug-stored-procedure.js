const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loyalty_db',
  user: 'loyalty',
  password: 'loyalty_pass'
});

async function debugStoredProcedure() {
  console.log('🔍 Debugging Stored Procedure assign_coupon_to_user...\n');
  
  const client = await pool.connect();
  
  try {
    // Get coupon details
    console.log('📊 Getting coupon details...');
    const couponResult = await client.query(`
      SELECT 
        id, code, name, status, valid_from, valid_until,
        usage_limit, used_count, usage_limit_per_user,
        type, value, currency
      FROM coupons 
      WHERE code = 'TEST865679'
    `);
    
    if (couponResult.rows.length === 0) {
      console.log('❌ Coupon TEST865679 not found');
      return;
    }
    
    const coupon = couponResult.rows[0];
    console.log('✅ Coupon found:');
    console.log('  ID:', coupon.id);
    console.log('  Code:', coupon.code);
    console.log('  Name:', coupon.name);
    console.log('  Status:', coupon.status);
    console.log('  Valid From:', coupon.valid_from);
    console.log('  Valid Until:', coupon.valid_until);
    console.log('  Usage Limit:', coupon.usage_limit);
    console.log('  Used Count:', coupon.used_count);
    console.log('  Usage Limit Per User:', coupon.usage_limit_per_user);
    
    // Get user details
    console.log('\n👤 Getting user details...');
    const userResult = await client.query(`
      SELECT id, email, role
      FROM users 
      WHERE email = 'customer@hotel.com'
    `);
    
    if (userResult.rows.length === 0) {
      console.log('❌ User customer@hotel.com not found');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('✅ User found:');
    console.log('  ID:', user.id);
    console.log('  Email:', user.email);
    console.log('  Role:', user.role);
    
    // Check existing user_coupons for this combination
    console.log('\n🔍 Checking existing user_coupons...');
    const existingCouponsResult = await client.query(`
      SELECT 
        id, status, qr_code, expires_at, created_at
      FROM user_coupons 
      WHERE user_id = $1 AND coupon_id = $2
    `, [user.id, coupon.id]);
    
    console.log(`Found ${existingCouponsResult.rows.length} existing user coupons for this combination:`);
    existingCouponsResult.rows.forEach((uc, index) => {
      console.log(`  ${index + 1}. Status: ${uc.status}, QR: ${uc.qr_code}, Expires: ${uc.expires_at}, Created: ${uc.created_at}`);
    });
    
    // Count non-revoked coupons for usage limit check
    const userUsageResult = await client.query(`
      SELECT COUNT(*) as count
      FROM user_coupons 
      WHERE coupon_id = $1 AND user_id = $2 AND status != 'revoked'
    `, [coupon.id, user.id]);
    
    const currentUserUsage = parseInt(userUsageResult.rows[0].count);
    console.log(`\n📊 Current user usage count: ${currentUserUsage}`);
    console.log(`📊 Usage limit per user: ${coupon.usage_limit_per_user}`);
    
    if (coupon.usage_limit_per_user && currentUserUsage >= coupon.usage_limit_per_user) {
      console.log('❌ User usage limit would be exceeded!');
    } else {
      console.log('✅ User usage limit check passed');
    }
    
    // Test the stored procedure directly with detailed error handling
    console.log('\n🎯 Testing stored procedure directly...');
    
    try {
      await client.query('BEGIN');
      
      const result = await client.query(`
        SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id
      `, [coupon.id, user.id, user.id, 'Direct test assignment', null]);
      
      console.log('✅ Stored procedure executed successfully');
      console.log('📊 Result:', result.rows[0]);
      
      // Check if user_coupon was actually created
      const checkResult = await client.query(`
        SELECT id, qr_code, status
        FROM user_coupons 
        WHERE id = $1
      `, [result.rows[0].user_coupon_id]);
      
      if (checkResult.rows.length > 0) {
        console.log('✅ User coupon created:', checkResult.rows[0]);
      } else {
        console.log('❌ User coupon not found after creation');
      }
      
      await client.query('ROLLBACK'); // Don't actually save the test assignment
      
    } catch (spError) {
      await client.query('ROLLBACK');
      console.log('❌ Stored procedure failed:');
      console.log('  Error:', spError.message);
      console.log('  Code:', spError.code);
      console.log('  Detail:', spError.detail);
      console.log('  Hint:', spError.hint);
    }
    
    // Check the unique constraint that might be causing issues
    console.log('\n🔍 Checking unique constraint...');
    const constraintResult = await client.query(`
      SELECT 
        conname, 
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'user_coupons'::regclass 
        AND contype = 'u'
    `);
    
    console.log('Unique constraints on user_coupons:');
    constraintResult.rows.forEach(constraint => {
      console.log(`  ${constraint.conname}: ${constraint.definition}`);
    });
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    client.release();
  }
}

debugStoredProcedure();