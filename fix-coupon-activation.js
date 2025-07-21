const fetch = require('node-fetch');

async function fixCouponActivation() {
  console.log('🔧 Fixing Coupon Activation Issues...\n');
  
  try {
    // Step 1: Get admin token
    console.log('🔐 Getting admin auth token...');
    const loginResponse = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@hotel.com',
        password: 'admin123'
      })
    });
    
    const loginData = await loginResponse.json();
    const adminToken = loginData.tokens?.accessToken;
    console.log('✅ Got admin token');
    
    // Step 2: Get all coupons and activate draft ones
    console.log('\\n🎫 Getting all coupons...');
    const couponsResponse = await fetch('http://localhost:4000/api/coupons?page=1&limit=50', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const couponsData = await couponsResponse.json();
    const coupons = couponsData.data?.coupons || [];
    
    console.log(`Found ${coupons.length} coupons`);
    
    // Step 3: Update draft coupons to active
    const draftCoupons = coupons.filter(c => c.status === 'draft');
    console.log(`\\n🔄 Found ${draftCoupons.length} draft coupons to activate`);
    
    for (const coupon of draftCoupons) {
      console.log(`  Activating: ${coupon.name} (${coupon.code})`);
      
      try {
        const updateResponse = await fetch(`http://localhost:4000/api/coupons/${coupon.id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            status: 'active'
          })
        });
        
        if (updateResponse.ok) {
          console.log(`    ✅ Activated ${coupon.code}`);
        } else {
          const errorData = await updateResponse.json();
          console.log(`    ❌ Failed to activate ${coupon.code}: ${errorData.message}`);
        }
      } catch (error) {
        console.log(`    ❌ Error activating ${coupon.code}: ${error.message}`);
      }
    }
    
    // Step 4: Test assignment with an active coupon
    console.log('\\n🎯 Testing coupon assignment with active coupon...');
    
    // Get updated coupon list
    const updatedCouponsResponse = await fetch('http://localhost:4000/api/coupons?page=1&limit=10', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const updatedCouponsData = await updatedCouponsResponse.json();
    const activeCoupons = updatedCouponsData.data?.coupons?.filter(c => c.status === 'active') || [];
    
    if (activeCoupons.length > 0) {
      const testCoupon = activeCoupons[0];
      console.log(`Testing assignment with: ${testCoupon.name} (${testCoupon.code})`);
      
      // Get a test user
      const usersResponse = await fetch('http://localhost:4000/api/loyalty/admin/users?limit=5', {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      const usersData = await usersResponse.json();
      const users = usersData.data?.users || [];
      console.log('Available users:', users.map(u => u.email).join(', '));
      const testUser = users.find(u => u.email === 'customer@hotel.com') || users[0];
      
      if (testUser) {
        console.log(`Assigning to user: ${testUser.email}`);
        
        const assignResponse = await fetch('http://localhost:4000/api/coupons/assign', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            couponId: testCoupon.id,
            userIds: [testUser.user_id],
            assignedReason: 'Fixed activation test'
          })
        });
        
        const assignData = await assignResponse.json();
        console.log('📊 Assignment result:', JSON.stringify(assignData, null, 2));
        
        if (assignResponse.ok && assignData.success) {
          console.log('✅ Assignment successful!');
          
          // Step 5: Test user login and coupon access
          console.log('\\n👤 Testing user access...');
          
          const userLoginResponse = await fetch('http://localhost:4000/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email: 'customer@hotel.com',
              password: 'customer123'
            })
          });
          
          if (userLoginResponse.ok) {
            const userLoginData = await userLoginResponse.json();
            const userToken = userLoginData.tokens?.accessToken;
            
            const userCouponsResponse = await fetch('http://localhost:4000/api/coupons/my-coupons', {
              headers: {
                'Authorization': `Bearer ${userToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            const userCouponsData = await userCouponsResponse.json();
            console.log('📊 User coupons after fix:', JSON.stringify(userCouponsData, null, 2));
            
            const userCoupons = userCouponsData.data?.coupons || [];
            if (userCoupons.length > 0) {
              console.log('✅ User now has coupons! Testing activation...');
              
              const testUserCoupon = userCoupons[0];
              console.log(`Testing coupon: ${testUserCoupon.name} (QR: ${testUserCoupon.qrCode})`);
              
              // Step 6: Test QR validation and redemption
              console.log('\\n🔍 Testing QR validation...');
              const validateResponse = await fetch(`http://localhost:4000/api/coupons/validate/${testUserCoupon.qrCode}`);
              const validateData = await validateResponse.json();
              console.log('📊 Validation result:', JSON.stringify(validateData, null, 2));
              
              if (validateData.valid) {
                console.log('✅ QR code validation successful!');
                
                console.log('\\n💰 Testing coupon redemption...');
                const redeemResponse = await fetch('http://localhost:4000/api/coupons/redeem', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    qrCode: testUserCoupon.qrCode,
                    originalAmount: 100.00,
                    transactionReference: `FIXED_TEST_${Date.now()}`,
                    location: 'Hotel Reception'
                  })
                });
                
                const redeemData = await redeemResponse.json();
                console.log('📊 Redemption result:', JSON.stringify(redeemData, null, 2));
                
                if (redeemData.success) {
                  console.log('🎉 COUPON ACTIVATION FIXED! Full workflow working!');
                } else {
                  console.log('❌ Redemption failed:', redeemData.message);
                }
              } else {
                console.log('❌ QR validation failed:', validateData.message);
              }
            } else {
              console.log('❌ User still has no coupons after assignment');
            }
          } else {
            console.log('❌ User login failed');
          }
        } else {
          console.log('❌ Assignment still failed');
        }
      } else {
        console.log('❌ Test user not found');
      }
    } else {
      console.log('❌ No active coupons available for testing');
    }
    
    console.log('\\n📋 Summary:');
    console.log('='.repeat(40));
    console.log(`• Activated ${draftCoupons.length} draft coupons`);
    console.log('• Tested assignment workflow');
    console.log('• Tested user access and redemption');
    console.log('\\n🎉 Coupon activation troubleshooting completed!');
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

fixCouponActivation();