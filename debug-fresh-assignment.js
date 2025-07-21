const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loyalty_db',
  user: 'loyalty',
  password: 'loyalty_pass'
});

async function debugFreshAssignment() {
  console.log('🔍 Debugging Fresh Coupon Assignment...\n');
  
  const client = await pool.connect();
  
  try {
    // Get the latest fresh coupon
    const couponResult = await client.query(`
      SELECT id, code, name, status, usage_limit_per_user
      FROM coupons 
      WHERE code LIKE 'FRESH%'
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (couponResult.rows.length === 0) {
      console.log('❌ No fresh coupon found');
      return;
    }
    
    const coupon = couponResult.rows[0];
    console.log('✅ Fresh coupon found:', coupon.code);
    console.log('📊 Status:', coupon.status);
    console.log('📊 Usage limit per user:', coupon.usage_limit_per_user);
    
    // Get customer user
    const userResult = await client.query(`
      SELECT id, email FROM users WHERE email = 'customer@hotel.com'
    `);
    const user = userResult.rows[0];
    console.log('✅ Customer found:', user.email);
    
    // Check if user has ANY coupons for this fresh coupon
    const existingResult = await client.query(`
      SELECT id, status, created_at 
      FROM user_coupons 
      WHERE user_id = $1 AND coupon_id = $2
    `, [user.id, coupon.id]);
    
    console.log(`📊 Existing user_coupons for fresh coupon: ${existingResult.rows.length}`);
    
    // Test the stored procedure assignment
    console.log('\n🎯 Testing fresh coupon assignment...');
    
    try {
      await client.query('BEGIN');
      
      const result = await client.query(`
        SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id
      `, [coupon.id, user.id, user.id, 'Debug fresh assignment', null]);
      
      console.log('✅ Assignment successful!');
      console.log('📊 User coupon ID:', result.rows[0].user_coupon_id);
      
      // Get the created coupon details
      const newCouponResult = await client.query(`
        SELECT qr_code, status, expires_at
        FROM user_coupons 
        WHERE id = $1
      `, [result.rows[0].user_coupon_id]);
      
      if (newCouponResult.rows.length > 0) {
        const newUserCoupon = newCouponResult.rows[0];
        console.log('📊 Created user coupon:');
        console.log('  QR Code:', newUserCoupon.qr_code);
        console.log('  Status:', newUserCoupon.status);
        console.log('  Expires:', newUserCoupon.expires_at);
        
        console.log('\n🎉 FRESH COUPON ASSIGNMENT WORKING!');
      }
      
      await client.query('COMMIT');
      
    } catch (spError) {
      await client.query('ROLLBACK');
      console.log('❌ Assignment failed:');
      console.log('  Error:', spError.message);
      console.log('  Code:', spError.code);
      console.log('  Detail:', spError.detail);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

debugFreshAssignment();