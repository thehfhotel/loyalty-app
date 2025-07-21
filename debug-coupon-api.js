const fetch = require('node-fetch');

async function debugCouponAPI() {
  console.log('🔍 Debugging Coupon API Endpoints...\n');
  
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
    console.log('✅ Got admin token:', adminToken ? 'Yes' : 'No');
    
    if (!adminToken) {
      console.log('❌ Failed to get admin token');
      return;
    }
    
    // Step 2: Get all users to see available test users
    console.log('\\n👥 Getting available users...');
    const usersResponse = await fetch('http://localhost:4000/api/loyalty/admin/users?limit=10', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (usersResponse.ok) {
      const usersData = await usersResponse.json();
      console.log('✅ Available users:');
      const users = usersData.data?.users || [];
      users.forEach((user, index) => {
        console.log(`  ${index + 1}. ${user.email} (ID: ${user.user_id})`);
      });
      
      // Step 3: Get list of coupons
      console.log('\\n🎫 Getting available coupons...');
      const couponsResponse = await fetch('http://localhost:4000/api/coupons?page=1&limit=10', {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (couponsResponse.ok) {
        const couponsData = await couponsResponse.json();
        console.log('✅ Available coupons:');
        const coupons = couponsData.data?.coupons || [];
        coupons.forEach((coupon, index) => {
          console.log(`  ${index + 1}. ${coupon.name} (${coupon.code}) - Status: ${coupon.status || 'N/A'}`);
        });
        
        // Step 4: Test user login for available test users
        if (users.length > 0) {
          const testPasswords = ['password123', 'customer123', 'test123', 'user123'];
          const testUsers = [
            'test.user@example.com',
            'customer@hotel.com', 
            'support@hotel.com'
          ].filter(email => users.some(u => u.email === email));
          
          let userToken = null;
          let loggedInUser = null;
          
          for (const testUserEmail of testUsers) {
            for (const password of testPasswords) {
              console.log(`\\n🔐 Testing login for ${testUserEmail} with password: ${password}`);
              
              const userLoginResponse = await fetch('http://localhost:4000/api/auth/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  email: testUserEmail,
                  password: password
                })
              });
          
              if (userLoginResponse.ok) {
                const userLoginData = await userLoginResponse.json();
                userToken = userLoginData.tokens?.accessToken;
                loggedInUser = users.find(u => u.email === testUserEmail);
                console.log(`✅ User login successful for ${testUserEmail}`);
                break;
              } else {
                console.log(`❌ Login failed for ${testUserEmail} with ${password}`);
              }
            }
            if (userToken) break;
          }
          
          if (userToken && loggedInUser) {
            
            // Step 5: Get user's coupons
            console.log('\\n🎫 Getting user coupons...');
            const userCouponsResponse = await fetch('http://localhost:4000/api/coupons/my-coupons', {
              headers: {
                'Authorization': `Bearer ${userToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            const userCouponsData = await userCouponsResponse.json();
            console.log('📊 User coupons response:', JSON.stringify(userCouponsData, null, 2));
            
            // Step 6: Test coupon validation if user has coupons
            const userCoupons = userCouponsData.data?.coupons || [];
            if (userCoupons.length > 0) {
              const testCoupon = userCoupons[0];
              console.log(`\\n🔍 Testing coupon validation for: ${testCoupon.code || testCoupon.qrCode}`);
              
              const qrCode = testCoupon.qrCode || testCoupon.code;
              const validateResponse = await fetch(`http://localhost:4000/api/coupons/validate/${qrCode}`);
              
              const validateData = await validateResponse.json();
              console.log('📊 Coupon validation response:', JSON.stringify(validateData, null, 2));
              
              // Step 7: Test coupon redemption
              if (validateData.valid) {
                console.log('\\n💰 Testing coupon redemption...');
                const redeemResponse = await fetch('http://localhost:4000/api/coupons/redeem', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    qrCode: qrCode,
                    originalAmount: 100.00,
                    transactionReference: `TEST_${Date.now()}`,
                    location: 'Test Location'
                  })
                });
                
                const redeemData = await redeemResponse.json();
                console.log('📊 Coupon redemption response:', JSON.stringify(redeemData, null, 2));
                
                if (redeemData.success) {
                  console.log('✅ Coupon redemption successful!');
                } else {
                  console.log('❌ Coupon redemption failed:', redeemData.message);
                }
              } else {
                console.log('❌ Coupon validation failed - cannot test redemption');
              }
            } else {
              console.log('⚠️  User has no coupons assigned');
              
              // Try to assign a coupon if we have one
              if (coupons.length > 0) {
                console.log('\\n🎯 Attempting to assign a coupon to user...');
                const testCoupon = coupons[0];
                
                const assignResponse = await fetch('http://localhost:4000/api/coupons/assign', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    couponId: testCoupon.id,
                    userIds: [loggedInUser.user_id],
                    assignedReason: 'Debug test assignment'
                  })
                });
                
                const assignData = await assignResponse.json();
                console.log('📊 Coupon assignment response:', JSON.stringify(assignData, null, 2));
                
                if (assignResponse.ok) {
                  console.log('✅ Coupon assigned successfully');
                  
                  // Now get user coupons again
                  const newUserCouponsResponse = await fetch('http://localhost:4000/api/coupons/my-coupons', {
                    headers: {
                      'Authorization': `Bearer ${userToken}`,
                      'Content-Type': 'application/json'
                    }
                  });
                  
                  const newUserCouponsData = await newUserCouponsResponse.json();
                  console.log('📊 Updated user coupons:', JSON.stringify(newUserCouponsData, null, 2));
                } else {
                  console.log('❌ Coupon assignment failed');
                }
              }
            }
          } else {
            console.log('❌ Could not login with any test user/password combination');
          }
        }
      } else {
        console.log('❌ Failed to get coupons');
      }
    } else {
      console.log('❌ Failed to get users');
    }
    
    console.log('\\n🎉 API debugging completed!');
    
  } catch (error) {
    console.error('❌ API debug failed:', error.message);
  }
}

debugCouponAPI();