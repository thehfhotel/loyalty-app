# Avatar Fixes Validation Test Plan

## 🔍 **Issues Fixed**

### Issue #1: Emoji Selection Shows 👤 Instead of Selected Emoji
- **Fix**: Updated `formatEmojiAvatar()` to handle `emoji:` URL format
- **Location**: `frontend/src/utils/emojiUtils.ts:84-90`

### Issue #2: LINE OAuth Overrides Custom Avatar  
- **Fix**: Updated OAuth service to preserve emoji avatars
- **Location**: `backend/src/services/oauthService.ts:380,166`

## 🧪 **Manual Testing Steps**

### Test 1: Emoji Selection in Profile Settings
1. Navigate to `/profile` settings
2. Click on profile picture to open emoji selector
3. Select any emoji from the grid (e.g., 🐶, 😀, 🎯)
4. Confirm selection
5. **Expected**: Profile picture should show selected emoji, not 👤
6. **Verify**: Refresh page - emoji should persist

### Test 2: LINE OAuth Avatar Preservation
1. Set profile picture to an emoji (e.g., 🚀)
2. Logout from application
3. Login with LINE OAuth
4. **Expected**: Profile picture remains as 🚀, not LINE profile picture
5. **Check logs**: Should see preservation debug message

### Test 3: New LINE Users
1. Create new LINE OAuth account (clear browser data)
2. Login with LINE for first time
3. **Expected**: Gets LINE profile picture initially
4. Change to emoji in settings
5. Logout and re-login with LINE
6. **Expected**: Emoji preserved, not overridden

## 🔍 **Debug Verification**

### Backend Logs to Monitor
```bash
# Watch for LINE avatar preservation logs
docker logs loyalty_backend 2>&1 | grep "LINE avatar preservation"

# Expected output:
[OAuth Service] LINE avatar preservation check {
  userId: "...",
  currentAvatar: "emoji:🚀",
  newLineAvatar: "https://...",
  willPreserve: true
}
```

### Database Verification
```sql
-- Check avatar_url format in database
SELECT user_id, avatar_url 
FROM user_profiles 
WHERE avatar_url LIKE 'emoji:%';

-- Should return records like:
-- user_id | avatar_url
-- --------|------------
-- abc123  | emoji:🚀
```

## ⚠️ **Potential Edge Cases**

1. **Empty emoji selection**: Should fall back to 👤
2. **Invalid emoji URL**: Should show 👤 default  
3. **Mixed avatar types**: Uploaded images should not be affected
4. **Google OAuth**: Should also preserve emoji avatars (same logic applied)

## 🔧 **Rollback Plan**

If issues occur, revert these files:
- `frontend/src/utils/emojiUtils.ts` (line 84-90)
- `backend/src/services/oauthService.ts` (lines 166, 380)

## ✅ **Success Criteria**

- [x] Emoji selection shows correct emoji, not 👤
- [x] LINE re-login preserves custom emoji avatars
- [x] New users still get LINE profile pictures initially  
- [x] Uploaded images remain unaffected
- [x] Google OAuth also preserves emoji avatars