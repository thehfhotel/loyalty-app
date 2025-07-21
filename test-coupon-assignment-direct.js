const fetch = require('node-fetch');

async function testCouponAssignmentDirect() {
  console.log('🔍 Testing Coupon Assignment Directly...\n');
  
  try {
    // Get admin token
    const loginResponse = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@hotel.com',
        password: 'admin123'
      })
    });
    
    const loginData = await loginResponse.json();
    const adminToken = loginData.tokens?.accessToken;
    console.log('✅ Got admin token');
    
    // Get all users
    const usersResponse = await fetch('http://localhost:4000/api/loyalty/admin/users?limit=20', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const usersData = await usersResponse.json();
    const users = usersData.data?.users || [];
    
    // Find customer@hotel.com user
    const customerUser = users.find(u => u.email === 'customer@hotel.com');
    if (!customerUser) {
      console.log('❌ customer@hotel.com not found');
      return;
    }
    
    console.log(`Found customer user: ${customerUser.email} (ID: ${customerUser.user_id})`);
    
    // Get active coupons
    const couponsResponse = await fetch('http://localhost:4000/api/coupons?page=1&limit=10', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const couponsData = await couponsResponse.json();
    const activeCoupons = couponsData.data?.coupons?.filter(c => c.status === 'active') || [];
    
    if (activeCoupons.length === 0) {
      console.log('❌ No active coupons found');
      return;
    }
    
    const testCoupon = activeCoupons[0];
    console.log(`Testing with coupon: ${testCoupon.name} (${testCoupon.code}) - Status: ${testCoupon.status}`);
    
    // Test assignment
    console.log('\\n🎯 Testing assignment...');
    const assignResponse = await fetch('http://localhost:4000/api/coupons/assign', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        couponId: testCoupon.id,
        userIds: [customerUser.user_id],
        assignedReason: 'Direct assignment test'
      })
    });
    
    const assignData = await assignResponse.json();
    console.log('📊 Assignment response:', JSON.stringify(assignData, null, 2));
    
    // Check if assignment worked by logging in as customer
    if (assignResponse.ok) {
      console.log('\\n👤 Testing customer login and coupons...');
      
      const customerLoginResponse = await fetch('http://localhost:4000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'customer@hotel.com',
          password: 'customer123'
        })
      });
      
      if (customerLoginResponse.ok) {
        const customerLoginData = await customerLoginResponse.json();
        const customerToken = customerLoginData.tokens?.accessToken;
        
        const customerCouponsResponse = await fetch('http://localhost:4000/api/coupons/my-coupons', {
          headers: {
            'Authorization': `Bearer ${customerToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        const customerCouponsData = await customerCouponsResponse.json();
        console.log('📊 Customer coupons:', JSON.stringify(customerCouponsData, null, 2));
        
        const customerCoupons = customerCouponsData.data?.coupons || [];
        if (customerCoupons.length > 0) {
          console.log('\\n🎉 SUCCESS! Customer has coupons assigned!');
          
          const assignedCoupon = customerCoupons[0];
          console.log(`\\n🔍 Testing QR validation for: ${assignedCoupon.qrCode}`);
          
          const validateResponse = await fetch(`http://localhost:4000/api/coupons/validate/${assignedCoupon.qrCode}`);
          const validateData = await validateResponse.json();
          
          if (validateData.valid) {
            console.log('✅ QR code validation successful!');
            console.log('🎊 COUPON ACTIVATION IS NOW WORKING!');
          } else {
            console.log('❌ QR validation failed:', validateData.message);
          }
        } else {
          console.log('❌ Customer still has no coupons');
        }
      } else {
        console.log('❌ Customer login failed');
      }
    } else {
      console.log('❌ Assignment failed');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testCouponAssignmentDirect();