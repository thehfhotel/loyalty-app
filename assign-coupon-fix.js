const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'loyalty',
  password: 'loyalty_pass',
  database: 'loyalty_db'
});

async function assignCoupon() {
  try {
    console.log('🔄 Assigning coupon 1FREE1 to winut.hf@gmail.com...\n');
    
    // Get coupon ID
    const couponResult = await pool.query(
      'SELECT id FROM coupons WHERE code = $1',
      ['1FREE1']
    );
    
    if (couponResult.rows.length === 0) {
      console.log('❌ Coupon 1FREE1 not found');
      return;
    }
    
    const couponId = couponResult.rows[0].id;
    console.log(`📊 Coupon ID: ${couponId}`);
    
    // Get user ID
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      ['winut.hf@gmail.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ User winut.hf@gmail.com not found');
      return;
    }
    
    const userId = userResult.rows[0].id;
    console.log(`📊 User ID: ${userId}`);
    
    // Get admin user (for assigned_by)
    const adminResult = await pool.query(
      "SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1"
    );
    
    const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].id : userId;
    console.log(`📊 Admin ID: ${adminId}`);
    
    // Call the assign_coupon_to_user function
    try {
      const assignResult = await pool.query(
        'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id',
        [
          couponId,
          userId,
          adminId,
          'Manual assignment for testing',
          null // No custom expiry
        ]
      );
      
      const userCouponId = assignResult.rows[0].user_coupon_id;
      console.log(`\n✅ SUCCESS: Coupon assigned!`);
      console.log(`📊 User Coupon ID: ${userCouponId}`);
      
      // Verify the assignment
      const verifyResult = await pool.query(
        `SELECT uc.*, c.code, c.name
         FROM user_coupons uc
         JOIN coupons c ON uc.coupon_id = c.id
         WHERE uc.id = $1`,
        [userCouponId]
      );
      
      if (verifyResult.rows.length > 0) {
        const uc = verifyResult.rows[0];
        console.log('\n📊 Assignment Details:');
        console.log(`   - Coupon Code: ${uc.code}`);
        console.log(`   - Coupon Name: ${uc.name}`);
        console.log(`   - Status: ${uc.status}`);
        console.log(`   - QR Code: ${uc.qr_code}`);
        console.log(`   - Expires: ${uc.expires_at || 'No expiry'}`);
      }
      
      // Check if it appears in active view
      const activeResult = await pool.query(
        `SELECT * FROM user_active_coupons 
         WHERE user_id = $1 AND code = $2`,
        [userId, '1FREE1']
      );
      
      if (activeResult.rows.length > 0) {
        console.log('\n✅ Coupon is now visible in user_active_coupons view');
        console.log('✅ It should appear on the /coupons page!');
      } else {
        console.log('\n❌ Coupon is still not in active view - check view conditions');
      }
      
    } catch (error) {
      console.error('\n❌ Assignment failed:', error.message);
      if (error.message.includes('usage limit')) {
        console.log('💡 The coupon or user has reached the usage limit');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

assignCoupon();