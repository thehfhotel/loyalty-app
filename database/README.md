# Database Schema Documentation

This directory contains the loyalty app database schema and initialization scripts.

## Consolidated Schema Approach

We have replaced the migration-based approach with a single consolidated schema file for easier maintenance and deployment.

### Files Overview

- **`consolidated_schema.sql`** - Complete database schema (replaces 23 migrations)
- **`init-consolidated.sh`** - Interactive initialization script
- **`init-db.sh`** - Original migration-based script (deprecated)
- **`migrations/`** - Original migration files (for reference only)
- **`seeds/`** - Optional seed data

## Database Structure

### Core Tables (23 total)
- **Users & Authentication**: `users`, `user_profiles`, `password_reset_tokens`, `refresh_tokens`, `user_audit_log`
- **Account Linking**: `account_link_requests`, `linked_accounts`, `account_linking_audit`
- **Feature Toggles**: `feature_toggles`, `feature_toggle_audit`
- **Loyalty System**: `tiers`, `points_transactions`, `user_loyalty`, `points_earning_rules`
- **Coupon System**: `coupons`, `user_coupons`, `coupon_redemptions`
- **Reception ID**: `reception_id_sequence`
- **Survey System**: `surveys`, `survey_responses`, `survey_invitations`, `survey_coupon_assignments`, `survey_reward_history`

### Functions (12 total)
- Account linking functions (3)
- Feature toggle audit (1)
- Reception ID generation (1)
- Loyalty system functions (2)
- Coupon system functions (3)
- Survey reward functions (2)

### Indexes (54 total)
Comprehensive indexing for optimal query performance across all tables.

### Views (2 total)
- `user_tier_info` - User loyalty tier information
- `user_active_coupons` - Available user coupons

## Quick Start

### Using Consolidated Schema (Recommended)

```bash
# Initialize new database
./init-consolidated.sh

# Force reinitialization
./init-consolidated.sh --force

# With backup
./init-consolidated.sh --force --backup
```

### Using Docker

```bash
# Copy consolidated schema to Docker init directory
cp consolidated_schema.sql /docker-entrypoint-initdb.d/

# Start PostgreSQL container - schema will be applied automatically
docker-compose up -d postgres
```

### Environment Variables

```bash
export POSTGRES_DB=loyalty_app        # Database name
export POSTGRES_USER=postgres         # Database user
export POSTGRES_HOST=localhost        # Database host
export POSTGRES_PORT=5432            # Database port
```

## Migration History

The consolidated schema represents the final state after applying all 23 migrations:

### Phase 1: Core Foundation (001-006)
- **001**: Initial schema (users, profiles, auth tables)
- **002**: OAuth columns for social login
- **003**: Account linking system
- **004**: Feature toggles with audit
- **005**: Loyalty system (points, tiers)
- **006**: Coupon system

### Phase 2: System Enhancements (015-018)
- **015**: Reception ID system (8-digit)
- **016**: Remove points expiration (points never expire)
- **017**: Remove lifetime_points column
- **018**: Fix award_points function parameters

### Phase 3: Survey System (019-020)
- **019**: Complete survey system
- **020**: Survey coupon rewards integration

### Phase 4: Final Fixes (021-023)
- **021**: Fix transaction type enum
- **022**: Update reception ID format (5-digit)
- **023**: Final reception ID system (8-digit sequential blocks)

## Key Design Decisions

### Points System
- **No Expiration**: Points never expire (migration 016)
- **No Lifetime Tracking**: Removed lifetime_points column (migration 017)
- **Current Points Only**: Simplified tracking for better performance

### Reception ID System
- **Format**: 8-digit sequential blocks (269XXXXX)
- **Allocation**: 100 users per block with random distribution
- **Uniqueness**: Guaranteed unique IDs with collision detection

### Survey Rewards
- **Automatic Coupons**: Auto-assign coupons on survey completion
- **Flexible Limits**: Award limits and custom expiry dates
- **Full Audit**: Complete history of reward assignments

### Data Integrity
- **Foreign Keys**: Comprehensive referential integrity
- **Check Constraints**: Data validation at database level
- **Triggers**: Automatic timestamp updates and business logic

## Troubleshooting

### Common Issues

1. **Connection Failed**
   ```bash
   # Check PostgreSQL is running
   systemctl status postgresql
   
   # Verify connection parameters
   psql -h localhost -p 5432 -U postgres -c '\q'
   ```

2. **Schema Already Exists**
   ```bash
   # Use force flag to recreate
   ./init-consolidated.sh --force --backup
   ```

3. **Permission Denied**
   ```bash
   # Make script executable
   chmod +x init-consolidated.sh
   ```

### Validation Queries

```sql
-- Check table count
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

-- Verify core functions exist
SELECT proname FROM pg_proc WHERE proname LIKE '%reception_id%';

-- Check initial data
SELECT name, min_points FROM tiers ORDER BY sort_order;
```

## Migration from Legacy System

If migrating from the old migration-based system:

1. **Backup existing database**
   ```bash
   pg_dump loyalty_app > backup_$(date +%Y%m%d).sql
   ```

2. **Initialize with consolidated schema**
   ```bash
   ./init-consolidated.sh --force --backup
   ```

3. **Restore data if needed**
   ```bash
   # Extract data-only dump from backup
   pg_restore --data-only backup_20240724.sql
   ```

## Support

For issues or questions:
1. Check the migration conflicts resolved in `consolidated_schema.sql`
2. Verify environment variables are set correctly
3. Ensure PostgreSQL version compatibility (≥12.0)
4. Review the original migration files in `migrations/` for context