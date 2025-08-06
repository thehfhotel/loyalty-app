# Coupon Award Expiry Issue Analysis

## Issue Summary
- **User Membership ID**: 26900004
- **Problem**: User received notification about coupon award but sees 0 coupons
- **Root Cause**: System awarded an expired coupon

## Investigation Results

### Timeline
1. **Coupon Created**: July 27, 2025 (valid until July 29, 2025)
2. **Coupon Expires**: July 29, 2025
3. **User Completes Profile**: August 5, 2025 (6 days after expiration)
4. **System Awards Expired Coupon**: August 5, 2025
5. **User Sees No Coupons**: Because `user_active_coupons` view filters out expired coupons

### Database Evidence
```sql
-- Coupon validity period (EXPIRED)
valid_from: 2025-07-27 00:00:00+00
valid_until: 2025-07-29 23:59:59.999+00

-- User coupon awarded date (AFTER EXPIRATION)
awarded_at: 2025-08-05 12:04:02.280649+00

-- Current system time
current_time: 2025-08-05 12:06:23.832157+00
```

### Why User Sees 0 Coupons
The `user_active_coupons` view filters coupons with these conditions:
1. `uc.status = 'available'` ✓
2. `c.status = 'active'` ✓
3. `uc.expires_at IS NULL OR uc.expires_at > now()` ❌ (EXPIRED)
4. `c.valid_until IS NULL OR c.valid_until > now()` ❌ (EXPIRED)

## Root Cause

### Backend Bug in `awardNewMemberCoupon` Method
**Location**: `/backend/src/services/userService.ts:359`

**Current Code** (INSUFFICIENT):
```sql
SELECT id, code, name, description, valid_until AS "validUntil"
FROM coupons 
WHERE id = $1 AND status = 'active'
```

**Problem**: Only checks `status = 'active'` but ignores validity period

**Should Check**:
```sql
SELECT id, code, name, description, valid_until AS "validUntil"
FROM coupons 
WHERE id = $1 AND status = 'active' AND valid_until > NOW()
```

## Impact Assessment

### Immediate Impact
- User received notification but no actual usable coupon
- Poor user experience - feels cheated
- Database contains expired coupons assigned to users

### Potential Scale
- Any user who completes profile after admin-selected coupon expires will get this issue
- Could affect multiple users if admin doesn't update coupon selection regularly

## Solutions

### 1. Fix the Award Logic (Critical)
Update the coupon validation query to check validity:

```typescript
const [coupon] = await query<{...}>(
  `SELECT 
    id, code, name, description,
    valid_until AS "validUntil"
  FROM coupons 
  WHERE id = $1 AND status = 'active' AND valid_until > NOW()`,
  [couponId]
);
```

### 2. Add Admin Warning System (Important)
- Add validation in admin settings to warn when selected coupon is near expiry
- Automatically disable new member coupon system when selected coupon expires
- Show expiry date in admin interface

### 3. Extend Expired Coupon (Immediate Fix for User)
- Either extend the existing coupon's validity
- Or award a new valid coupon to affected users

### 4. Add Expiry Monitoring (Preventive)
- Background job to check for expiring coupons used in new member settings
- Email alerts to admins when coupons are about to expire

## Immediate Actions for User 26900004

### Option 1: Extend Current Coupon
```sql
UPDATE coupons 
SET valid_until = NOW() + INTERVAL '30 days'
WHERE id = '1065fa56-2d74-4df0-b1e4-1f77593750bf';
```

### Option 2: Create New Coupon and Award
1. Create new coupon with future expiry
2. Update new member settings to use new coupon
3. Award new coupon to the user manually

## Prevention Measures

1. **Code Fix**: Update validation logic in `awardNewMemberCoupon`
2. **Admin UI**: Show coupon expiry dates in new member settings
3. **Monitoring**: Add alerts for expiring coupons
4. **Testing**: Add test cases for expired coupon scenarios

## Testing Required

After fixing:
1. Test awarding with active, non-expired coupon ✓
2. Test awarding with active but expired coupon (should fail gracefully)
3. Test awarding with inactive coupon (should fail gracefully)
4. Test admin UI shows appropriate warnings for expired coupons