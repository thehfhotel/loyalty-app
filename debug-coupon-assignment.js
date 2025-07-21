const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'loyalty',
  password: 'loyalty_pass',
  database: 'loyalty_db'
});

async function debugCouponAssignment() {
  try {
    console.log('🔍 Debugging coupon assignment for 1FREE1...\n');
    
    // Check if coupon exists
    const couponResult = await pool.query(
      'SELECT id, code, name, status, valid_from, valid_until FROM coupons WHERE code = $1',
      ['1FREE1']
    );
    
    if (couponResult.rows.length === 0) {
      console.log('❌ Coupon 1FREE1 not found in database');
      return;
    }
    
    const coupon = couponResult.rows[0];
    console.log('📊 Coupon details:');
    console.log(`   ID: ${coupon.id}`);
    console.log(`   Code: ${coupon.code}`);
    console.log(`   Name: ${coupon.name}`);
    console.log(`   Status: ${coupon.status}`);
    console.log(`   Valid from: ${coupon.valid_from}`);
    console.log(`   Valid until: ${coupon.valid_until}`);
    
    // Check user
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      ['winut.hf@gmail.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('\n❌ User winut.hf@gmail.com not found in database');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('\n📊 User details:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    
    // Check user_coupons
    const userCouponResult = await pool.query(
      `SELECT uc.*, c.code as coupon_code
       FROM user_coupons uc
       JOIN coupons c ON uc.coupon_id = c.id
       WHERE uc.user_id = $1 AND c.code = $2`,
      [user.id, '1FREE1']
    );
    
    console.log(`\n📊 User coupons found: ${userCouponResult.rows.length}`);
    
    if (userCouponResult.rows.length > 0) {
      userCouponResult.rows.forEach((uc, index) => {
        console.log(`\n   Coupon #${index + 1}:`);
        console.log(`   - ID: ${uc.id}`);
        console.log(`   - Status: ${uc.status}`);
        console.log(`   - QR Code: ${uc.qr_code}`);
        console.log(`   - Assigned at: ${uc.created_at}`);
        console.log(`   - Expires at: ${uc.expires_at}`);
        console.log(`   - Used at: ${uc.used_at}`);
      });
    }
    
    // Check user_active_coupons view
    const activeResult = await pool.query(
      `SELECT * FROM user_active_coupons 
       WHERE user_id = $1 AND code = $2`,
      [user.id, '1FREE1']
    );
    
    console.log(`\n📊 Active coupons in view: ${activeResult.rows.length}`);
    
    if (activeResult.rows.length === 0) {
      console.log('\n🔍 Checking why coupon is not in active view...');
      
      // Check all user's coupons
      const allUserCoupons = await pool.query(
        `SELECT uc.status, uc.expires_at, c.code, c.status as coupon_status, c.valid_until
         FROM user_coupons uc
         JOIN coupons c ON uc.coupon_id = c.id
         WHERE uc.user_id = $1`,
        [user.id]
      );
      
      console.log(`\n📊 Total user coupons: ${allUserCoupons.rows.length}`);
      allUserCoupons.rows.forEach((uc, index) => {
        console.log(`\n   Coupon ${index + 1} (${uc.code}):`);
        console.log(`   - User coupon status: ${uc.status}`);
        console.log(`   - Coupon status: ${uc.coupon_status}`);
        console.log(`   - User expires: ${uc.expires_at}`);
        console.log(`   - Coupon expires: ${uc.valid_until}`);
      });
    }
    
    // Summary
    console.log('\n📊 SUMMARY:');
    if (coupon.status !== 'active') {
      console.log('❌ Issue: Coupon is not active (status: ' + coupon.status + ')');
    }
    if (userCouponResult.rows.length === 0) {
      console.log('❌ Issue: Coupon not assigned to user');
    } else if (activeResult.rows.length === 0) {
      const userCoupon = userCouponResult.rows[0];
      if (userCoupon.status !== 'available') {
        console.log(`❌ Issue: User coupon status is ${userCoupon.status} (not 'available')`);
      }
      if (coupon.status !== 'active') {
        console.log(`❌ Issue: Coupon status is ${coupon.status} (not 'active')`);
      }
      if (userCoupon.expires_at && new Date(userCoupon.expires_at) <= new Date()) {
        console.log('❌ Issue: User coupon has expired');
      }
      if (coupon.valid_until && new Date(coupon.valid_until) <= new Date()) {
        console.log('❌ Issue: Coupon has expired');
      }
    } else {
      console.log('✅ Coupon should be visible in /coupons page');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

debugCouponAssignment();