# Migration Archive

These files represent the historical migration chain that has been **replaced** by the consolidated schema (`../consolidated_schema.sql`).

## ⚠️ IMPORTANT: DO NOT USE THESE FILES

These migration files are **archived for reference only** and should not be used for database initialization.

### Why These Files Are Archived

1. **Replaced by Consolidated Schema**: The `consolidated_schema.sql` file provides the complete, final database state
2. **Migration Conflicts**: Several migrations had conflicts and ordering issues that are resolved in the consolidated schema
3. **Maintenance Complexity**: 23 individual migration files were difficult to maintain and deploy consistently

### Migration History (Applied in Consolidated Schema)

#### **Phase 1: Core Foundation**
- `001_init_schema.sql` - Initial schema (users, profiles, auth tables)
- `002_add_oauth_columns.sql` - OAuth columns for social login
- `003_account_linking.sql` - Account linking system
- `004_feature_toggles.sql` - Feature toggles with audit
- `005_loyalty_system.sql` - Loyalty system (points, tiers)
- `006_coupon_system.sql` - Coupon system

#### **Phase 2: System Enhancements**
- `015_add_reception_id.sql` - Reception ID system (8-digit)
- `016_remove_points_expiration.sql` - Remove points expiration (points never expire)
- `017_remove_lifetime_points_column_fixed.sql` - Remove lifetime_points column
- `018_fix_award_points_function.sql` - Fix award_points function parameters

#### **Phase 3: Survey System**
- `019_create_survey_system.sql` - Complete survey system
- `020_survey_coupon_rewards.sql` - Survey coupon rewards integration

#### **Phase 4: Final Fixes**
- `021_fix_transaction_type_enum.sql` - Fix transaction type enum
- `022_update_reception_id_format.sql` - Update reception ID format (5-digit 269XX)
- `023_update_reception_id_sequential_blocks.sql` - Final reception ID system (8-digit sequential blocks)

#### **Archived Due to Conflicts (.bak files)**
- `010_add_survey_access_type.sql.bak` - Replaced by survey system in 019
- `011_remove_user_coupon_unique_constraint.sql.bak` - Integrated into consolidated schema
- `012_update_tiers_to_nights_based.sql.bak` - Superseded by later tier system fixes
- `013_fix_tier_system_reset.sql.bak` - Superseded by later tier system fixes
- `014_fix_tier_system_corrected.sql.bak` - Final version integrated into consolidated schema
- `014_simplify_coupon_award_conditions_fixed.sql.bak` - Integrated into consolidated schema

## Current Database Deployment

**For new deployments, use:**
```bash
# Initialize with consolidated schema
./database/zzz-init-consolidated.sh
```

**For existing databases:**
1. Backup current database: `pg_dump loyalty_db > backup.sql`
2. Use consolidated schema for fresh deployments
3. Migrate data if needed from backup

## Reference Only

These files are kept for:
- Understanding migration history
- Debugging historical issues
- Documentation of database evolution
- Code archaeology and learning

**DO NOT run these migrations directly - use the consolidated schema instead.**