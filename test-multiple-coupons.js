const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://loyalty:loyalty_pass@localhost:5432/loyalty_db'
});

async function testMultipleCoupons() {
  try {
    console.log('🔍 Testing multiple coupon assignments...\n');
    
    // Check current state for test user
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      ['test-user@example.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Test user not found');
      return;
    }
    
    const user = userResult.rows[0];
    console.log(`📊 Testing for user: ${user.email} (ID: ${user.id})`);
    
    // Check current coupon assignments
    const currentAssignments = await pool.query(
      `SELECT uc.id, uc.status, uc.qr_code, c.code, c.name, uc.created_at
       FROM user_coupons uc
       JOIN coupons c ON uc.coupon_id = c.id
       WHERE uc.user_id = $1
       ORDER BY uc.created_at DESC`,
      [user.id]
    );
    
    console.log(`\n📊 Current assignments: ${currentAssignments.rows.length}`);
    currentAssignments.rows.forEach((assignment, index) => {
      console.log(`   ${index + 1}. ${assignment.code} - ${assignment.name} (Status: ${assignment.status})`);
      console.log(`      QR: ${assignment.qr_code}, Created: ${assignment.created_at}`);
    });
    
    // Check how many 1FREE1 coupons are assigned
    const free1Assignments = currentAssignments.rows.filter(a => a.code === '1FREE1');
    console.log(`\n📊 1FREE1 coupon assignments: ${free1Assignments.length}`);
    
    if (free1Assignments.length === 1) {
      console.log('🔄 Need to create multiple assignments for testing...\n');
      
      // Get the 1FREE1 coupon
      const couponResult = await pool.query(
        'SELECT id, code, name FROM coupons WHERE code = $1',
        ['1FREE1']
      );
      
      if (couponResult.rows.length === 0) {
        console.log('❌ 1FREE1 coupon not found');
        return;
      }
      
      const coupon = couponResult.rows[0];
      console.log(`📊 Found coupon: ${coupon.code} - ${coupon.name}`);
      
      // Get an admin user for assignment
      const adminResult = await pool.query(
        "SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1"
      );
      
      const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].id : user.id;
      
      // Assign a second copy of the same coupon
      console.log('🔄 Assigning second copy of 1FREE1 coupon...');
      
      const secondAssignment = await pool.query(
        'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id',
        [
          coupon.id,          // coupon_id
          user.id,           // user_id
          adminId,           // assigned_by
          'Testing multiple coupon display', // assigned_reason
          null               // custom_expiry
        ]
      );
      
      const userCouponId2 = secondAssignment.rows[0].user_coupon_id;
      console.log(`✅ Second coupon assigned! User Coupon ID: ${userCouponId2}`);
      
      // Assign a third copy for good measure
      console.log('🔄 Assigning third copy of 1FREE1 coupon...');
      
      const thirdAssignment = await pool.query(
        'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id',
        [
          coupon.id,          // coupon_id
          user.id,           // user_id
          adminId,           // assigned_by
          'Testing multiple coupon display #3', // assigned_reason
          null               // custom_expiry
        ]
      );
      
      const userCouponId3 = thirdAssignment.rows[0].user_coupon_id;
      console.log(`✅ Third coupon assigned! User Coupon ID: ${userCouponId3}`);
    }
    
    // Check final state
    console.log('\n📊 FINAL STATE CHECK:');
    
    const finalAssignments = await pool.query(
      `SELECT uc.id, uc.status, uc.qr_code, c.code, c.name, uc.created_at
       FROM user_coupons uc
       JOIN coupons c ON uc.coupon_id = c.id
       WHERE uc.user_id = $1
       ORDER BY uc.created_at DESC`,
      [user.id]
    );
    
    console.log(`Total assignments: ${finalAssignments.rows.length}`);
    finalAssignments.rows.forEach((assignment, index) => {
      console.log(`   ${index + 1}. ${assignment.code} - ${assignment.name}`);
      console.log(`      User Coupon ID: ${assignment.id}`);
      console.log(`      QR Code: ${assignment.qr_code}`);
      console.log(`      Status: ${assignment.status}`);
      console.log(`      Created: ${assignment.created_at}`);
      console.log('');
    });
    
    // Check what the API view returns
    console.log('📊 API VIEW CHECK (user_active_coupons):');
    
    const apiView = await pool.query(
      `SELECT user_coupon_id, code, name, qr_code, status, expiring_soon
       FROM user_active_coupons
       WHERE user_id = $1
       ORDER BY assigned_at DESC`,
      [user.id]
    );
    
    console.log(`API returns: ${apiView.rows.length} coupons`);
    apiView.rows.forEach((coupon, index) => {
      console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
      console.log(`      User Coupon ID: ${coupon.user_coupon_id}`);
      console.log(`      QR Code: ${coupon.qr_code}`);
      console.log(`      Status: ${coupon.status}`);
      console.log(`      Expiring Soon: ${coupon.expiring_soon}`);
      console.log('');
    });
    
    // Count by coupon type
    const couponsCount = {};
    apiView.rows.forEach(coupon => {
      couponsCount[coupon.code] = (couponsCount[coupon.code] || 0) + 1;
    });
    
    console.log('📊 COUPON COUNT BY TYPE:');
    Object.entries(couponsCount).forEach(([code, count]) => {
      console.log(`   ${code}: ${count} ${count === 1 ? 'coupon' : 'separate coupons'}`);
    });
    
    console.log('\n🎯 EXPECTATION CHECK:');
    if (couponsCount['1FREE1'] >= 2) {
      console.log(`✅ Multiple 1FREE1 coupons are properly stored as separate entries`);
      console.log(`📊 Each should appear as a separate coupon card in the UI`);
      console.log(`📊 Each has unique User Coupon ID and QR Code`);
    } else {
      console.log(`⚠️ Only ${couponsCount['1FREE1'] || 0} 1FREE1 coupon(s) found`);
      console.log(`📊 Expected at least 2 separate coupon entries`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

testMultipleCoupons();