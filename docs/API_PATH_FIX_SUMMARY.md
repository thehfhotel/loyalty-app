# API Path Fix Summary

## Issue
Frontend was getting 404 errors when trying to access admin endpoints:
- Error: `GET http://localhost:4001/api/admin/new-member-coupon-settings 404 (Not Found)`

## Root Cause
The frontend `adminService` was using incorrect API paths. Admin routes were defined in the user router (`/api/users/admin/*`) but the frontend was trying to access them directly at `/api/admin/*`.

## Fix Applied

### 1. Updated Frontend Service Paths
Changed in `/frontend/src/services/adminService.ts`:
```typescript
// Before (incorrect):
api.get('/admin/new-member-coupon-settings')
api.put('/admin/new-member-coupon-settings', data)

// After (correct):
api.get('/users/admin/new-member-coupon-settings')
api.put('/users/admin/new-member-coupon-settings', data)
```

### 2. Backend Route Structure
The routes are correctly defined in `/backend/src/routes/user.ts`:
```typescript
router.get('/admin/new-member-coupon-settings', requireAdmin, ...)
router.put('/admin/new-member-coupon-settings', requireAdmin, ...)
```

And mounted in `/backend/src/index.ts`:
```typescript
app.use('/api/users', userRoutes)
```

This creates the full path: `/api/users/admin/new-member-coupon-settings`

## Prevention Rule Added

Added Rule #16 to `CLAUDE.md`: **API Route Path Consistency Rules**

Key points:
1. Always verify backend route mounting before implementing frontend calls
2. Test endpoints with curl before coding
3. Construct full path: `/api/{mount-path}/{route-path}`
4. Common pattern: admin routes are often nested under entity routers

## Verification
```bash
# Test the corrected endpoint:
curl -s http://localhost:4001/api/users/admin/new-member-coupon-settings

# Result: Endpoint found (auth error expected without valid token)
```

## Related Changes
- Simplified new member coupon settings to use existing coupons instead of creating new ones
- Updated database schema to store only `isEnabled` and `selectedCouponId`
- Updated backend service methods to work with the new simplified structure

## Status
✅ Issue resolved - No more 404 errors on the new member coupon settings page