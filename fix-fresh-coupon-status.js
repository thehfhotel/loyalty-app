const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loyalty_db',
  user: 'loyalty',
  password: 'loyalty_pass'
});

async function fixFreshCouponStatus() {
  console.log('🔧 Fixing Fresh Coupon Status...\n');
  
  const client = await pool.connect();
  
  try {
    // Get all draft coupons that start with FRESH
    const draftCouponsResult = await client.query(`
      SELECT id, code, name, status
      FROM coupons 
      WHERE code LIKE 'FRESH%' AND status = 'draft'
      ORDER BY created_at DESC
    `);
    
    console.log(`📊 Found ${draftCouponsResult.rows.length} draft FRESH coupons to activate`);
    
    for (const coupon of draftCouponsResult.rows) {
      console.log(`🔄 Activating: ${coupon.code}`);
      
      const updateResult = await client.query(`
        UPDATE coupons 
        SET status = 'active', updated_at = NOW()
        WHERE id = $1
        RETURNING code, status
      `, [coupon.id]);
      
      if (updateResult.rows.length > 0) {
        console.log(`✅ Activated: ${updateResult.rows[0].code} → ${updateResult.rows[0].status}`);
      }
    }
    
    // Now test assignment with the latest fresh coupon
    const latestCouponResult = await client.query(`
      SELECT id, code, name, status
      FROM coupons 
      WHERE code LIKE 'FRESH%' AND status = 'active'
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (latestCouponResult.rows.length === 0) {
      console.log('❌ No active fresh coupons found');
      return;
    }
    
    const coupon = latestCouponResult.rows[0];
    console.log(`\n🎯 Testing assignment with active coupon: ${coupon.code}`);
    
    // Get customer user
    const userResult = await client.query(`
      SELECT id, email FROM users WHERE email = 'customer@hotel.com'
    `);
    const user = userResult.rows[0];
    
    // Test assignment
    try {
      await client.query('BEGIN');
      
      const assignResult = await client.query(`
        SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id
      `, [coupon.id, user.id, user.id, 'Fixed fresh coupon test', null]);
      
      console.log('✅ Assignment successful!');
      console.log('📊 User coupon ID:', assignResult.rows[0].user_coupon_id);
      
      // Get the user coupon details
      const userCouponResult = await client.query(`
        SELECT qr_code, status, expires_at
        FROM user_coupons 
        WHERE id = $1
      `, [assignResult.rows[0].user_coupon_id]);
      
      if (userCouponResult.rows.length > 0) {
        const userCoupon = userCouponResult.rows[0];
        console.log('📊 User coupon created:');
        console.log('  QR Code:', userCoupon.qr_code);
        console.log('  Status:', userCoupon.status);
        console.log('  Expires:', userCoupon.expires_at);
        
        console.log('\n🎉 COUPON ASSIGNMENT NOW WORKING WITH FIXED STATUS!');
      }
      
      await client.query('COMMIT');
      
    } catch (assignError) {
      await client.query('ROLLBACK');
      console.log('❌ Assignment still failed:', assignError.message);
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

fixFreshCouponStatus();