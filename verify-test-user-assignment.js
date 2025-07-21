const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://loyalty:loyalty_pass@localhost:5432/loyalty_db'
});

async function verifyAssignment() {
  try {
    console.log('🔍 Verifying coupon assignment for test-user@example.com...\n');
    
    // Find the test user
    const userResult = await pool.query(
      'SELECT id, email, role FROM users WHERE email = $1',
      ['test-user@example.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ test-user@example.com not found in database');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('✅ Test user found:');
    console.log(`   Email: ${user.email}`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Role: ${user.role}`);
    
    // Check user's assigned coupons
    const assignedResult = await pool.query(
      `SELECT uc.id, uc.status, uc.qr_code, uc.created_at, c.code, c.name
       FROM user_coupons uc
       JOIN coupons c ON uc.coupon_id = c.id
       WHERE uc.user_id = $1
       ORDER BY uc.created_at DESC`,
      [user.id]
    );
    
    console.log(`\n📊 Assigned coupons: ${assignedResult.rows.length}`);
    if (assignedResult.rows.length > 0) {
      assignedResult.rows.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
        console.log(`      Status: ${coupon.status}`);
        console.log(`      QR Code: ${coupon.qr_code}`);
        console.log(`      Assigned: ${coupon.created_at}`);
        console.log('');
      });
    } else {
      console.log('   No coupons assigned to this user');
    }
    
    // Check active coupons view (what the API should return)
    const activeResult = await pool.query(
      `SELECT code, name, status, user_coupon_id, qr_code, expiring_soon
       FROM user_active_coupons
       WHERE user_id = $1`,
      [user.id]
    );
    
    console.log(`📊 Active coupons (API should return): ${activeResult.rows.length}`);
    if (activeResult.rows.length > 0) {
      activeResult.rows.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
        console.log(`      Status: ${coupon.status}`);
        console.log(`      QR Code: ${coupon.qr_code}`);
        console.log(`      Expiring Soon: ${coupon.expiring_soon}`);
        console.log('');
      });
    }
    
    // If no coupons assigned, let's assign the 1FREE1 coupon
    if (assignedResult.rows.length === 0) {
      console.log('🔄 No coupons found. Assigning 1FREE1 coupon...\n');
      
      // Get 1FREE1 coupon
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
      
      try {
        // Assign the coupon
        const assignResult = await pool.query(
          'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id',
          [
            coupon.id,          // coupon_id
            user.id,           // user_id
            adminId,           // assigned_by
            'Manual test assignment', // assigned_reason
            null               // custom_expiry
          ]
        );
        
        const userCouponId = assignResult.rows[0].user_coupon_id;
        console.log(`✅ Coupon assigned successfully!`);
        console.log(`📊 User Coupon ID: ${userCouponId}`);
        
        // Verify the assignment worked
        const verifyResult = await pool.query(
          `SELECT uc.id, uc.status, uc.qr_code, c.code, c.name
           FROM user_coupons uc
           JOIN coupons c ON uc.coupon_id = c.id
           WHERE uc.id = $1`,
          [userCouponId]
        );
        
        if (verifyResult.rows.length > 0) {
          const assigned = verifyResult.rows[0];
          console.log('\n✅ Assignment verified:');
          console.log(`   Coupon: ${assigned.code} - ${assigned.name}`);
          console.log(`   Status: ${assigned.status}`);
          console.log(`   QR Code: ${assigned.qr_code}`);
        }
        
      } catch (assignError) {
        console.error('❌ Assignment failed:', assignError.message);
      }
    }
    
    // Final check - what should the user see?
    const finalResult = await pool.query(
      `SELECT code, name, status, qr_code, expiring_soon, effective_expiry
       FROM user_active_coupons
       WHERE user_id = $1`,
      [user.id]
    );
    
    console.log('\n📊 FINAL STATUS:');
    console.log(`User: ${user.email}`);
    console.log(`Coupons visible to user: ${finalResult.rows.length}`);
    
    if (finalResult.rows.length > 0) {
      console.log('\n✅ User should see these coupons:');
      finalResult.rows.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
        console.log(`      QR: ${coupon.qr_code}`);
        console.log(`      Expires: ${coupon.effective_expiry}`);
        console.log(`      Expiring Soon: ${coupon.expiring_soon ? 'Yes' : 'No'}`);
      });
      
      const has1FREE1 = finalResult.rows.some(c => c.code === '1FREE1');
      console.log(`\n🎯 1FREE1 coupon assigned: ${has1FREE1 ? 'YES' : 'NO'}`);
    } else {
      console.log('\n❌ User has no active coupons');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

verifyAssignment();