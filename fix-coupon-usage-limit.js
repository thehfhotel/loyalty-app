const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://loyalty:loyalty_pass@localhost:5432/loyalty_db'
});

async function fixCouponUsageLimit() {
  try {
    console.log('🔧 Fixing coupon usage limits for testing...\n');
    
    // Check current 1FREE1 coupon settings
    const couponResult = await pool.query(
      'SELECT id, code, name, usage_limit_per_user FROM coupons WHERE code = $1',
      ['1FREE1']
    );
    
    if (couponResult.rows.length === 0) {
      console.log('❌ 1FREE1 coupon not found');
      return;
    }
    
    const coupon = couponResult.rows[0];
    console.log(`📊 Current coupon: ${coupon.code} - ${coupon.name}`);
    console.log(`📊 Usage limit per user: ${coupon.usage_limit_per_user}`);
    
    // Update to allow multiple uses per user
    console.log('\n🔄 Updating usage limit to allow multiple uses...');
    
    await pool.query(
      'UPDATE coupons SET usage_limit_per_user = 5 WHERE code = $1',
      ['1FREE1']
    );
    
    console.log('✅ Updated 1FREE1 coupon to allow 5 uses per user');
    
    // Also create a completely new coupon that's different for testing
    console.log('\n🔄 Creating a second coupon type for testing...');
    
    try {
      const newCoupon = await pool.query(
        `INSERT INTO coupons (
          code, name, description, terms_and_conditions, type, value, currency, 
          minimum_spend, maximum_discount, valid_from, valid_until, 
          usage_limit, usage_limit_per_user, status, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          (SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1)
        ) RETURNING id, code, name`,
        [
          'SAVE20',                        // code
          '20% ส่วนลด',                     // name  
          'ส่วนลด 20% สำหรับการใช้งานครั้งต่อไป', // description
          'ไม่สามารถใช้ร่วมกับโปรโมชั่นอื่นได้', // terms_and_conditions
          'percentage',                    // type
          20.00,                          // value
          'THB',                          // currency
          100.00,                         // minimum_spend
          500.00,                         // maximum_discount
          new Date().toISOString(),       // valid_from
          new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // valid_until (90 days)
          1000,                           // usage_limit
          3,                              // usage_limit_per_user
          'active'                        // status
        ]
      );
      
      console.log(`✅ Created new coupon: ${newCoupon.rows[0].code} - ${newCoupon.rows[0].name}`);
      
    } catch (err) {
      if (err.message.includes('duplicate key')) {
        console.log('ℹ️ SAVE20 coupon already exists');
      } else {
        console.error('Error creating new coupon:', err.message);
      }
    }
    
    // Now assign multiple coupons to test user
    console.log('\n🔄 Assigning multiple coupons to test user...');
    
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      ['test-user@example.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Test user not found');
      return;
    }
    
    const userId = userResult.rows[0].id;
    
    // Get admin user
    const adminResult = await pool.query(
      "SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1"
    );
    const adminId = adminResult.rows.length > 0 ? adminResult.rows[0].id : userId;
    
    // Assign second 1FREE1 coupon
    try {
      const assignment2 = await pool.query(
        'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id',
        [
          coupon.id,          // coupon_id
          userId,             // user_id
          adminId,            // assigned_by
          'Testing multiple coupon display #2', // assigned_reason
          null                // custom_expiry
        ]
      );
      console.log(`✅ Assigned second 1FREE1 coupon: ${assignment2.rows[0].user_coupon_id}`);
    } catch (err) {
      console.log(`⚠️ Could not assign second 1FREE1: ${err.message}`);
    }
    
    // Assign SAVE20 coupon if it exists
    const save20Result = await pool.query(
      'SELECT id FROM coupons WHERE code = $1',
      ['SAVE20']
    );
    
    if (save20Result.rows.length > 0) {
      try {
        const assignment3 = await pool.query(
          'SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id',
          [
            save20Result.rows[0].id,    // coupon_id
            userId,                     // user_id
            adminId,                    // assigned_by
            'Testing different coupon type', // assigned_reason
            null                        // custom_expiry
          ]
        );
        console.log(`✅ Assigned SAVE20 coupon: ${assignment3.rows[0].user_coupon_id}`);
      } catch (err) {
        console.log(`⚠️ Could not assign SAVE20: ${err.message}`);
      }
    }
    
    // Check final state
    console.log('\n📊 FINAL COUPON STATE:');
    
    const finalCoupons = await pool.query(
      `SELECT user_coupon_id, code, name, qr_code, status
       FROM user_active_coupons
       WHERE user_id = $1
       ORDER BY assigned_at DESC`,
      [userId]
    );
    
    console.log(`Total active coupons: ${finalCoupons.rows.length}`);
    finalCoupons.rows.forEach((coupon, index) => {
      console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
      console.log(`      User Coupon ID: ${coupon.user_coupon_id}`);
      console.log(`      QR Code: ${coupon.qr_code}`);
      console.log('');
    });
    
    const couponCount = {};
    finalCoupons.rows.forEach(c => {
      couponCount[c.code] = (couponCount[c.code] || 0) + 1;
    });
    
    console.log('📊 COUNT BY COUPON TYPE:');
    Object.entries(couponCount).forEach(([code, count]) => {
      console.log(`   ${code}: ${count} ${count === 1 ? 'instance' : 'separate instances'}`);
    });
    
    if (finalCoupons.rows.length >= 3) {
      console.log('\n✅ SUCCESS: Multiple coupons are now available for testing!');
      console.log('📊 These should appear as separate coupon cards in the UI');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixCouponUsageLimit();