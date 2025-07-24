# Updated Loyalty Tier System

## Overview
The loyalty system has been updated from a points-based system to a **nights-based system** to better reflect hotel stays.

## New Tier Structure

### Tier 1: New Member
- **Requirement**: 0 nights
- **Color**: #808080 (Gray)
- **Benefits**:
  - Member exclusive rates
  - Free WiFi
  - Welcome amenity

### Tier 2: Silver
- **Requirement**: 1+ nights
- **Color**: #C0C0C0 (Silver)
- **Benefits**:
  - All New Member benefits
  - Room upgrade (subject to availability)
  - Late checkout until 2 PM
  - 10% discount on dining
  - Priority check-in

### Tier 3: Gold
- **Requirement**: 10+ nights
- **Color**: #FFD700 (Gold)
- **Benefits**:
  - All Silver benefits
  - Guaranteed room upgrade
  - Late checkout until 4 PM
  - 20% discount on dining
  - Complimentary breakfast
  - Executive lounge access
  - Free laundry service (3 pieces per stay)

## Database Changes

### Migration File
- `database/migrations/012_update_tiers_to_nights_based.sql`

### Key Changes
1. **Added `total_nights` column** to `user_loyalty` table
2. **Added `nights_stayed` column** to `points_transactions` table
3. **Updated tier calculation** to use nights instead of points
4. **New function**: `add_stay_nights_and_points()` for processing hotel stays
5. **Updated view**: `user_tier_info` now includes nights-based calculations

### Backward Compatibility
- Points system still works alongside nights
- Existing users automatically get estimated nights based on lifetime points
- All existing APIs continue to function

## Frontend Changes

### Updated Components
- `TierStatus.tsx`: Now displays nights requirements instead of points
- Translation files updated with nights-related strings

### New Interface Fields
- `UserLoyaltyStatus.total_nights`
- `UserLoyaltyStatus.next_tier_nights`
- `UserLoyaltyStatus.nights_to_next_tier`

### Display Logic
- Tier requirements show "1 night" or "10 nights"
- Progress bars show nights to next tier
- Maintains backward compatibility with points display

## Backend Changes

### New Service Method
```typescript
async addStayNightsAndPoints(
  userId: string,
  nights: number,
  amountSpent: number,
  referenceId?: string,
  description?: string
): Promise<{
  transactionId: string;
  pointsEarned: number;
  newTotalNights: number;
  newTierName: string;
}>
```

### Updated SQL Functions
- `update_user_tier_by_nights()`: Automatically updates tiers based on nights
- `add_stay_nights_and_points()`: Processes hotel stays with both nights and points

## Migration Instructions

1. **Database Migration**:
   ```sql
   -- Run the migration file
   \i database/migrations/012_update_tiers_to_nights_based.sql
   ```

2. **Backend Restart**:
   - Restart the backend service to load new functions

3. **Frontend Update**:
   - Frontend changes are automatically active
   - New translation strings available in both English and Thai

## Testing the System

### Test Scenarios
1. **New User Registration**: Should start as "New Member" (0 nights)
2. **First Stay**: After 1+ nights, should upgrade to "Silver"
3. **Frequent Guest**: After 10+ nights, should upgrade to "Gold"
4. **Points Award**: Points system still works for spending-based rewards

### API Endpoints
- Existing endpoints continue to work
- New nights information included in user loyalty status responses
- Points awarding system unchanged (1 THB = 10 points)

## Notes
- The system now uses nights as the primary tier progression metric
- Points are still awarded for spending (1 THB = 10 points)
- Tier benefits have been updated to be more hotel-focused
- All existing user data is preserved and migrated automatically