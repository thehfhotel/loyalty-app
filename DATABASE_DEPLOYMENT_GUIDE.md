# Database Deployment Guide

## 🎯 **Recommended Database Deployment Strategy**

Based on analysis of the current database state and best practices, this guide provides the optimal approach for deploying the loyalty app database schema.

## 📊 **Current Database Status**

✅ **Known Good Database**: Your current localhost database (24 tables) represents the final state after all migrations  
✅ **Consolidated Schema**: The `consolidated_schema.sql` file matches this final state  
✅ **Clean Architecture**: All migration conflicts resolved and files properly archived  

## 🚀 **Best Practices Implementation**

### **1. Use Consolidated Schema Approach**

The **consolidated schema approach** is now the recommended method for all deployments:

```bash
# Recommended deployment command
./database/deploy-database.sh --force --backup --seed
```

**Benefits**:
- ✅ **Single Source of Truth**: One file defines entire schema
- ✅ **No Migration Conflicts**: Eliminates complex migration chain issues
- ✅ **Faster Deployment**: Direct schema application (vs 23 sequential migrations)
- ✅ **Consistent Results**: Same schema every time across all environments
- ✅ **Simplified Maintenance**: One file to update instead of managing migration chain

### **2. Migration Files Archive Strategy**

All migration files have been **moved to `database/migrations/archive/`**:

#### **Archived Files** (DO NOT USE):
```
migrations/archive/
├── 001_init_schema.sql                          # Phase 1: Foundation
├── 002_add_oauth_columns.sql
├── 003_account_linking.sql
├── 004_feature_toggles.sql
├── 005_loyalty_system.sql
├── 006_coupon_system.sql
├── 015_add_reception_id.sql                     # Phase 2: Enhancements
├── 016_remove_points_expiration.sql
├── 017_remove_lifetime_points_column_fixed.sql
├── 018_fix_award_points_function.sql
├── 019_create_survey_system.sql                 # Phase 3: Survey System
├── 020_survey_coupon_rewards.sql
├── 021_fix_transaction_type_enum.sql            # Phase 4: Final Fixes
├── 022_update_reception_id_format.sql
├── 023_update_reception_id_sequential_blocks.sql
└── *.bak files (conflicted migrations)
```

#### **Active Files** (USE THESE):
```
database/
├── consolidated_schema.sql          # ⭐ Primary schema file
├── deploy-database.sh              # ⭐ Recommended deployment script
├── zzz-init-consolidated.sh         # Docker container init
└── seeds/001_survey_data.sql        # Optional seed data
```

### **3. Deployment Workflows**

#### **Fresh Database Deployment**
```bash
# New environment or clean deployment
./database/deploy-database.sh --seed
```

#### **Existing Database Update** 
```bash
# Updates existing database (creates backup first)
./database/deploy-database.sh --force --backup
```

#### **Development Environment**
```bash
# Quick development setup
docker compose up -d postgres
./database/deploy-database.sh --seed
```

#### **Production Environment**
```bash
# Production deployment with backup
./database/deploy-database.sh --force --backup
# Then test thoroughly before going live
```

## 🔧 **Technical Implementation**

### **Database Schema Structure**
- **Tables**: 24 (includes all features: users, loyalty, coupons, surveys, OAuth)
- **Functions**: 12 (business logic and utilities)
- **Indexes**: 54 (optimized for query performance)
- **Views**: 2 (user_tier_info, user_active_coupons)
- **Extensions**: uuid-ossp (for UUID generation)

### **Key Features Implemented**
1. **User Management**: Complete user system with profiles and audit
2. **OAuth Integration**: Google, Facebook, LINE social login
3. **Account Linking**: Link multiple OAuth accounts to single user
4. **Feature Toggles**: Dynamic feature management with audit
5. **Loyalty System**: Points, tiers, earning rules (no expiration)
6. **Coupon System**: Full coupon management with redemption tracking  
7. **Survey System**: Complete survey system with reward integration
8. **Reception ID System**: 8-digit sequential block format (269XXXXX)

### **Data Integrity Features**
- ✅ **Foreign Key Constraints**: Comprehensive referential integrity
- ✅ **Check Constraints**: Database-level data validation
- ✅ **Triggers**: Automatic timestamp updates and business logic
- ✅ **Unique Constraints**: Prevent duplicate critical data
- ✅ **Audit Trails**: Full history tracking for critical operations

## 🔍 **Deployment Verification**

After deployment, verify success:

```bash
# Check table count (should be 24)
docker compose exec postgres psql -U loyalty -d loyalty_db -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"

# Check core functions exist
docker compose exec postgres psql -U loyalty -d loyalty_db -c "SELECT proname FROM pg_proc WHERE proname LIKE '%reception_id%';"

# Verify sample data
docker compose exec postgres psql -U loyalty -d loyalty_db -c "SELECT name, min_points FROM tiers ORDER BY sort_order;"
```

**Expected Results**:
- ✅ 24 tables created
- ✅ Reception ID functions available
- ✅ Tier system configured (Bronze: 0, Silver: 1000, Gold: 5000, Platinum: 20000)

## 🔄 **Migration from Legacy System**

If you have an existing database using the old migration approach:

### **Step 1: Backup Current Database**
```bash
docker compose exec postgres pg_dump -U loyalty -d loyalty_db > legacy_database_backup.sql
```

### **Step 2: Deploy Consolidated Schema**
```bash
./database/deploy-database.sh --force --backup
```

### **Step 3: Migrate Data (if needed)**
```bash
# If you need to preserve specific data, extract it from backup
# and insert into new schema (manual process based on your needs)
```

## ⚠️ **Important Notes**

### **DO NOT**:
- ❌ Use files in `migrations/archive/` directory
- ❌ Run individual migration files  
- ❌ Mix migration approach with consolidated schema
- ❌ Manually modify the consolidated schema without testing

### **DO**:
- ✅ Always use `deploy-database.sh` for deployments
- ✅ Create backups before force deployments
- ✅ Test deployments in development first
- ✅ Verify deployment with the provided validation queries
- ✅ Keep the consolidated schema as the single source of truth

## 🎉 **Benefits Achieved**

1. **Simplified Deployment**: One command deploys entire database
2. **Eliminated Conflicts**: No more migration ordering or conflict issues
3. **Faster Performance**: Direct schema application vs sequential migrations
4. **Better Maintenance**: Single file to update instead of complex migration chain
5. **Consistent Results**: Same database state across all environments
6. **Clear Documentation**: Archived old files with proper warnings
7. **Safe Operations**: Backup and verification built into deployment process

## 📞 **Support & Troubleshooting**

**Common Issues**:
1. **Connection Failed**: Ensure PostgreSQL container is running (`docker compose up -d postgres`)
2. **Permission Denied**: Make sure deploy script is executable (`chmod +x database/deploy-database.sh`)
3. **Schema Exists**: Use `--force` flag to redeploy existing database
4. **Backup Failed**: Check disk space and PostgreSQL container health

**For Questions**:
1. Check the archived migration files for historical context
2. Review the consolidated schema for current implementation details  
3. Use the deployment script's help: `./database/deploy-database.sh --help`
4. Verify environment variables are correctly set

This consolidated approach provides a robust, maintainable, and efficient database deployment strategy for the loyalty application. 🚀