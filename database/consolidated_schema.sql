-- =============================================================================
-- LOYALTY APP - CONSOLIDATED DATABASE SCHEMA
-- =============================================================================
-- This file replaces the migration chain and provides a complete database
-- initialization from scratch. Created from migrations 001-023 analysis.
-- 
-- Original Migration Order (from git commit history):
-- 001: Initial schema (users, profiles, auth tables)
-- 002: OAuth columns 
-- 003: Account linking system
-- 004: Feature toggles
-- 005: Loyalty system (points, tiers)
-- 006: Coupon system
-- 015: Reception ID system (8-digit)
-- 016: Remove points expiration (points never expire)
-- 017: Remove lifetime_points column
-- 018: Fix award_points function parameters
-- 019: Survey system
-- 020: Survey coupon rewards
-- 021: Fix transaction type enum (conflicts with 016-017)
-- 022: Update reception ID format (5-digit 269XX)
-- 023: Final reception ID system (8-digit sequential blocks)
-- =============================================================================

BEGIN;

-- =============================================================================
-- EXTENSIONS AND TYPES
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core user role enum
CREATE TYPE user_role AS ENUM ('customer', 'admin', 'super_admin');

-- Points transaction types (final version from migration analysis)
CREATE TYPE points_transaction_type AS ENUM (
    'earned_stay', 
    'earned_bonus', 
    'redeemed', 
    'expired', 
    'admin_adjustment',
    'admin_award',
    'admin_deduction'
);

-- Coupon system enums
CREATE TYPE coupon_type AS ENUM (
    'percentage',    -- Percentage discount (e.g., 10% off)
    'fixed_amount',  -- Fixed amount discount (e.g., $50 off)
    'bogo',         -- Buy one get one free
    'free_upgrade', -- Free room upgrade
    'free_service'  -- Free service (spa, dining, etc.)
);

CREATE TYPE coupon_status AS ENUM (
    'draft',        -- Created but not active
    'active',       -- Available for use
    'paused',       -- Temporarily disabled
    'expired',      -- Past expiry date
    'exhausted'     -- Usage limit reached
);

CREATE TYPE user_coupon_status AS ENUM (
    'available',    -- Available for use
    'used',         -- Already redeemed
    'expired',      -- Past expiry date
    'revoked'       -- Admin revoked access
);

-- =============================================================================
-- UTILITY FUNCTIONS
-- =============================================================================

-- Function to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- CORE USER TABLES (from 001_init_schema + 002_oauth_columns)
-- =============================================================================

-- Main users table with OAuth support
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255), -- Made nullable for OAuth users (002)
    role user_role DEFAULT 'customer',
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- OAuth columns (from 002_add_oauth_columns)
    oauth_provider VARCHAR(50),
    oauth_provider_id VARCHAR(255)
);

-- User profiles table with reception ID (final 8-digit format from 023)
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    date_of_birth DATE,
    preferences JSONB DEFAULT '{}',
    avatar_url VARCHAR(500),
    reception_id VARCHAR(8) UNIQUE NOT NULL, -- Final 8-digit format (269XXXXX)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Refresh tokens for JWT
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User audit log
CREATE TABLE user_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- ACCOUNT LINKING SYSTEM (from 003_account_linking)
-- =============================================================================

-- Account link requests table
CREATE TABLE account_link_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_email VARCHAR(255) NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('link_to_email', 'link_to_existing')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days'
);

-- Linked accounts table - tracks which accounts are linked together
CREATE TABLE linked_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    primary_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    linked_by UUID REFERENCES users(id),
    UNIQUE(primary_user_id, linked_user_id),
    -- Prevent circular linking
    CHECK (primary_user_id != linked_user_id)
);

-- Account linking audit log
CREATE TABLE account_linking_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    target_email VARCHAR(255),
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID REFERENCES account_link_requests(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- FEATURE TOGGLES SYSTEM (from 004_feature_toggles)
-- =============================================================================

-- Feature toggles table
CREATE TABLE feature_toggles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feature_key VARCHAR(100) UNIQUE NOT NULL,
    feature_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

-- Feature toggle audit table
CREATE TABLE feature_toggle_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feature_toggle_id UUID NOT NULL REFERENCES feature_toggles(id) ON DELETE CASCADE,
    previous_state BOOLEAN,
    new_state BOOLEAN NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reason TEXT,
    ip_address INET,
    user_agent TEXT
);

-- =============================================================================
-- LOYALTY SYSTEM (from 005_loyalty_system + fixes 016, 017, 018)
-- =============================================================================

-- Loyalty tiers table
CREATE TABLE tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    min_points INTEGER NOT NULL,
    benefits JSONB DEFAULT '{}',
    color VARCHAR(7) NOT NULL, -- Hex color code
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Points transactions table (no expiration - per migration 016)
CREATE TABLE points_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL, -- Can be negative for deductions
    type points_transaction_type NOT NULL,
    description TEXT,
    reference_id VARCHAR(100), -- External reference (e.g., booking ID)
    admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Who made admin changes
    admin_reason TEXT, -- Reason for admin adjustments
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    -- NOTE: expires_at removed per migration 016 - points never expire
);

-- User loyalty status table (lifetime_points removed per migration 017)
CREATE TABLE user_loyalty (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_points INTEGER DEFAULT 0,
    tier_id UUID REFERENCES tiers(id) ON DELETE SET NULL,
    tier_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    points_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    -- NOTE: lifetime_points column removed per migration 017
);

-- Points earning rules configuration
CREATE TABLE points_earning_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    points_per_unit DECIMAL(10,2) NOT NULL, -- Points earned per unit (e.g., per dollar spent)
    unit_type VARCHAR(50) DEFAULT 'currency', -- currency, nights, etc.
    multiplier_by_tier JSONB DEFAULT '{}', -- Tier-specific multipliers
    is_active BOOLEAN DEFAULT true,
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- COUPON SYSTEM (from 006_coupon_system)
-- =============================================================================

-- Coupons master table
CREATE TABLE coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    terms_and_conditions TEXT,
    type coupon_type NOT NULL,
    value DECIMAL(10,2), -- Percentage (0-100) or fixed amount
    currency VARCHAR(3) DEFAULT 'USD', -- For fixed amount coupons
    minimum_spend DECIMAL(10,2), -- Minimum purchase amount
    maximum_discount DECIMAL(10,2), -- Maximum discount for percentage coupons
    
    -- Availability settings
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    usage_limit INTEGER, -- Total usage limit across all users
    usage_limit_per_user INTEGER DEFAULT 1, -- Usage limit per individual user
    used_count INTEGER DEFAULT 0, -- Track total usage
    
    -- Targeting settings
    tier_restrictions JSONB DEFAULT '[]', -- Array of tier names that can use this coupon
    customer_segment JSONB DEFAULT '{}', -- Custom targeting criteria
    
    -- Admin metadata
    status coupon_status DEFAULT 'draft',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User coupons (assignment and tracking)
CREATE TABLE user_coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    
    -- Individual coupon instance data
    status user_coupon_status DEFAULT 'available',
    qr_code TEXT NOT NULL UNIQUE, -- QR code for this specific instance
    
    -- Usage tracking
    used_at TIMESTAMP WITH TIME ZONE,
    used_by_admin UUID REFERENCES users(id) ON DELETE SET NULL, -- Admin who processed redemption
    redemption_location VARCHAR(255), -- Where it was redeemed
    redemption_details JSONB DEFAULT '{}', -- Additional redemption metadata
    
    -- Assignment metadata
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL, -- Admin who assigned
    assigned_reason TEXT, -- Reason for assignment (campaign, loyalty reward, etc.)
    expires_at TIMESTAMP WITH TIME ZONE, -- Individual expiry (can override coupon expiry)
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Coupon redemption history (audit trail)
CREATE TABLE coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_coupon_id UUID NOT NULL REFERENCES user_coupons(id) ON DELETE CASCADE,
    
    -- Transaction details
    original_amount DECIMAL(10,2),
    discount_amount DECIMAL(10,2),
    final_amount DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Context
    transaction_reference VARCHAR(255), -- Booking ID, receipt number, etc.
    redemption_channel VARCHAR(50) DEFAULT 'mobile_app', -- mobile_app, web, pos, front_desk
    staff_member_id UUID REFERENCES users(id) ON DELETE SET NULL,
    location VARCHAR(255),
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- RECEPTION ID SYSTEM (from 015, 022, 023 - final sequential block version)
-- =============================================================================

-- Reception ID sequence tracking table (from migration 023)
CREATE TABLE reception_id_sequence (
    id SERIAL PRIMARY KEY,
    current_user_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- SURVEY SYSTEM (from 019_create_survey_system + 020_survey_coupon_rewards)
-- =============================================================================

-- Surveys table
CREATE TABLE surveys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    questions JSONB NOT NULL,
    target_segment JSONB DEFAULT '{}',
    access_type VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_type IN ('public', 'invite_only')),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'closed')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Survey responses table
CREATE TABLE survey_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    responses JSONB NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Survey invitations table (for invite-only surveys)
CREATE TABLE survey_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitation_token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '30 days',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(survey_id, user_id)
);

-- Survey coupon assignments table (from migration 020)
CREATE TABLE survey_coupon_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    award_limit INTEGER, -- Max number of this coupon to award for this survey
    awards_given INTEGER DEFAULT 0, -- Track how many have been awarded
    custom_expiry_days INTEGER, -- Custom expiry override for survey-awarded coupons
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(survey_id, coupon_id)
);

-- Survey reward history table (from migration 020)
CREATE TABLE survey_reward_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_response_id UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_coupon_id UUID NOT NULL REFERENCES user_coupons(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES survey_coupon_assignments(id) ON DELETE CASCADE,
    awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Users and profiles indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_oauth_provider_id ON users(oauth_provider, oauth_provider_id);
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_reception_id ON user_profiles(reception_id);
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_user_audit_log_user_id ON user_audit_log(user_id);
CREATE INDEX idx_user_audit_log_created_at ON user_audit_log(created_at);

-- Account linking indexes
CREATE INDEX idx_account_link_requests_requester ON account_link_requests(requester_user_id);
CREATE INDEX idx_account_link_requests_target ON account_link_requests(target_user_id);
CREATE INDEX idx_account_link_requests_target_email ON account_link_requests(target_email);
CREATE INDEX idx_account_link_requests_status ON account_link_requests(status);
CREATE INDEX idx_account_link_requests_expires ON account_link_requests(expires_at);
CREATE INDEX idx_linked_accounts_primary ON linked_accounts(primary_user_id);
CREATE INDEX idx_linked_accounts_linked ON linked_accounts(linked_user_id);
CREATE INDEX idx_account_linking_audit_user ON account_linking_audit(user_id);
CREATE INDEX idx_account_linking_audit_created ON account_linking_audit(created_at);

-- Feature toggles indexes
CREATE INDEX idx_feature_toggles_key ON feature_toggles(feature_key);
CREATE INDEX idx_feature_toggles_enabled ON feature_toggles(is_enabled);
CREATE INDEX idx_feature_toggle_audit_feature_id ON feature_toggle_audit(feature_toggle_id);
CREATE INDEX idx_feature_toggle_audit_changed_at ON feature_toggle_audit(changed_at);

-- Loyalty system indexes
CREATE INDEX idx_tiers_sort_order ON tiers(sort_order);
CREATE INDEX idx_tiers_min_points ON tiers(min_points);
CREATE INDEX idx_points_transactions_user_id ON points_transactions(user_id);
CREATE INDEX idx_points_transactions_type ON points_transactions(type);
CREATE INDEX idx_points_transactions_created_at ON points_transactions(created_at);
CREATE INDEX idx_user_loyalty_tier_id ON user_loyalty(tier_id);
CREATE INDEX idx_user_loyalty_current_points ON user_loyalty(current_points);
CREATE INDEX idx_points_earning_rules_active ON points_earning_rules(is_active);

-- Coupon system indexes
CREATE INDEX idx_coupons_code ON coupons(code);
CREATE INDEX idx_coupons_status ON coupons(status);
CREATE INDEX idx_coupons_type ON coupons(type);
CREATE INDEX idx_coupons_valid_dates ON coupons(valid_from, valid_until);
CREATE INDEX idx_coupons_created_by ON coupons(created_by);
CREATE INDEX idx_user_coupons_user_id ON user_coupons(user_id);
CREATE INDEX idx_user_coupons_coupon_id ON user_coupons(coupon_id);
CREATE INDEX idx_user_coupons_status ON user_coupons(status);
CREATE INDEX idx_user_coupons_qr_code ON user_coupons(qr_code);
CREATE INDEX idx_user_coupons_expires_at ON user_coupons(expires_at);
CREATE INDEX idx_coupon_redemptions_user_coupon_id ON coupon_redemptions(user_coupon_id);
CREATE INDEX idx_coupon_redemptions_created_at ON coupon_redemptions(created_at);
CREATE INDEX idx_coupon_redemptions_transaction_ref ON coupon_redemptions(transaction_reference);

-- Survey system indexes
CREATE INDEX idx_surveys_status ON surveys(status);
CREATE INDEX idx_surveys_access_type ON surveys(access_type);
CREATE INDEX idx_survey_responses_survey_id ON survey_responses(survey_id);
CREATE INDEX idx_survey_responses_user_id ON survey_responses(user_id);
CREATE INDEX idx_survey_invitations_survey_id ON survey_invitations(survey_id);
CREATE INDEX idx_survey_invitations_user_id ON survey_invitations(user_id);
CREATE INDEX idx_survey_invitations_token ON survey_invitations(invitation_token);
CREATE INDEX idx_survey_coupon_assignments_survey_id ON survey_coupon_assignments(survey_id);
CREATE INDEX idx_survey_reward_history_user_id ON survey_reward_history(user_id);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT COLUMNS
-- =============================================================================

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_account_link_requests_updated_at BEFORE UPDATE ON account_link_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_feature_toggles_updated_at BEFORE UPDATE ON feature_toggles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tiers_updated_at BEFORE UPDATE ON tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_loyalty_updated_at BEFORE UPDATE ON user_loyalty
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_points_earning_rules_updated_at BEFORE UPDATE ON points_earning_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON coupons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_coupons_updated_at BEFORE UPDATE ON user_coupons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_surveys_updated_at BEFORE UPDATE ON surveys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_survey_responses_updated_at BEFORE UPDATE ON survey_responses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_survey_invitations_updated_at BEFORE UPDATE ON survey_invitations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_survey_coupon_assignments_updated_at BEFORE UPDATE ON survey_coupon_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reception_id_sequence_updated_at BEFORE UPDATE ON reception_id_sequence
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- BUSINESS LOGIC FUNCTIONS
-- =============================================================================

-- Account linking functions (from migration 003)
CREATE OR REPLACE FUNCTION get_linked_accounts(user_uuid UUID)
RETURNS TABLE(linked_user_id UUID, email VARCHAR, oauth_provider VARCHAR, first_name VARCHAR, last_name VARCHAR) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id as linked_user_id,
        u.email,
        u.oauth_provider,
        p.first_name,
        p.last_name
    FROM users u
    LEFT JOIN user_profiles p ON u.id = p.user_id
    WHERE u.id IN (
        -- Users linked to this user as primary
        SELECT la.linked_user_id FROM linked_accounts la WHERE la.primary_user_id = user_uuid
        UNION
        -- Users where this user is linked to them
        SELECT la.primary_user_id FROM linked_accounts la WHERE la.linked_user_id = user_uuid
        UNION
        -- Users linked to the same primary as this user
        SELECT la2.linked_user_id 
        FROM linked_accounts la1 
        JOIN linked_accounts la2 ON la1.primary_user_id = la2.primary_user_id 
        WHERE la1.linked_user_id = user_uuid AND la2.linked_user_id != user_uuid
    )
    AND u.id != user_uuid
    AND u.is_active = true;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION are_users_linked(user1_uuid UUID, user2_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS(
        SELECT 1 FROM linked_accounts 
        WHERE (primary_user_id = user1_uuid AND linked_user_id = user2_uuid)
           OR (primary_user_id = user2_uuid AND linked_user_id = user1_uuid)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_primary_user(user_uuid UUID)
RETURNS UUID AS $$
DECLARE
    primary_id UUID;
BEGIN
    -- Check if this user is a primary user
    SELECT user_uuid INTO primary_id 
    WHERE EXISTS(SELECT 1 FROM linked_accounts WHERE primary_user_id = user_uuid);
    
    IF primary_id IS NOT NULL THEN
        RETURN primary_id;
    END IF;
    
    -- Check if this user is linked to a primary user
    SELECT primary_user_id INTO primary_id 
    FROM linked_accounts 
    WHERE linked_user_id = user_uuid 
    LIMIT 1;
    
    IF primary_id IS NOT NULL THEN
        RETURN primary_id;
    END IF;
    
    -- User is not linked, return themselves
    RETURN user_uuid;
END;
$$ LANGUAGE plpgsql;

-- Feature toggle functions (from migration 004)
CREATE OR REPLACE FUNCTION audit_feature_toggle_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Only insert audit record on updates (not inserts)
    IF TG_OP = 'UPDATE' AND OLD.is_enabled != NEW.is_enabled THEN
        INSERT INTO feature_toggle_audit (
            feature_toggle_id,
            previous_state,
            new_state,
            changed_by,
            reason
        ) VALUES (
            NEW.id,
            OLD.is_enabled,
            NEW.is_enabled,
            NEW.updated_by,
            CASE 
                WHEN NEW.is_enabled THEN 'Feature enabled'
                ELSE 'Feature disabled'
            END
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_feature_toggle_audit
    AFTER UPDATE ON feature_toggles
    FOR EACH ROW
    EXECUTE FUNCTION audit_feature_toggle_changes();

-- Reception ID generation function (final version from migration 023)
CREATE OR REPLACE FUNCTION generate_reception_id_sequential()
RETURNS VARCHAR(8) AS $$
DECLARE
    current_count INTEGER;
    new_count INTEGER;
    block_number INTEGER;
    random_within_block INTEGER;
    new_id VARCHAR(8);
    id_exists BOOLEAN;
    attempt_count INTEGER := 0;
    max_attempts INTEGER := 100;
BEGIN
    -- Get and increment the current user count atomically
    UPDATE reception_id_sequence 
    SET current_user_count = current_user_count + 1,
        updated_at = NOW()
    RETURNING current_user_count INTO new_count;
    
    -- Calculate which block (1-100, 101-200, 201-300, etc.) this user belongs to
    block_number := FLOOR((new_count - 1) / 100);
    
    -- Generate random number within the block range
    -- Block 0: 1-100, Block 1: 101-200, Block 2: 201-300, etc.
    LOOP
        random_within_block := (block_number * 100) + FLOOR(RANDOM() * 100) + 1;
        
        -- Format as 8-digit ID: 269 + 5-digit padded number
        new_id := '269' || LPAD(random_within_block::TEXT, 5, '0');
        
        -- Check if this ID already exists
        SELECT EXISTS(SELECT 1 FROM user_profiles WHERE reception_id = new_id) INTO id_exists;
        
        -- If ID doesn't exist, return it
        IF NOT id_exists THEN
            RETURN new_id;
        END IF;
        
        -- Increment attempt counter to prevent infinite loops
        attempt_count := attempt_count + 1;
        
        -- If we've tried too many times within this block, raise an exception
        IF attempt_count >= max_attempts THEN
            RAISE EXCEPTION 'Unable to generate unique reception ID in block % after % attempts. Block may be full.', block_number, max_attempts;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Loyalty system functions (final versions from migrations 017, 018)
CREATE OR REPLACE FUNCTION update_user_tier()
RETURNS TRIGGER AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    -- Find the appropriate tier based on current points
    SELECT id INTO new_tier_id
    FROM tiers 
    WHERE is_active = true 
    AND min_points <= NEW.current_points
    ORDER BY min_points DESC
    LIMIT 1;
    
    -- Update tier if it changed
    IF new_tier_id IS DISTINCT FROM NEW.tier_id THEN
        NEW.tier_id = new_tier_id;
        NEW.tier_updated_at = NOW();
    END IF;
    
    NEW.points_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_tier_on_points_change 
    BEFORE UPDATE OF current_points ON user_loyalty
    FOR EACH ROW EXECUTE FUNCTION update_user_tier();

-- Award points function (final version from migration 018, no expiration from 016)
CREATE OR REPLACE FUNCTION award_points(
    p_user_id UUID,
    p_points INTEGER,
    p_type points_transaction_type,
    p_description TEXT DEFAULT NULL,
    p_reference_id VARCHAR(100) DEFAULT NULL,
    p_admin_user_id UUID DEFAULT NULL,
    p_admin_reason TEXT DEFAULT NULL,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL -- Ignored per migration 016
)
RETURNS UUID AS $$
DECLARE
    transaction_id UUID;
    current_total INTEGER;
BEGIN
    -- Insert the points transaction (ignoring p_expires_at per migration 016)
    INSERT INTO points_transactions (
        user_id, points, type, description, reference_id, 
        admin_user_id, admin_reason
    )
    VALUES (
        p_user_id, p_points, p_type, p_description, p_reference_id,
        p_admin_user_id, p_admin_reason
    )
    RETURNING id INTO transaction_id;
    
    -- Calculate new total (no lifetime points per migration 017)
    SELECT COALESCE(SUM(points), 0) INTO current_total
    FROM points_transactions 
    WHERE user_id = p_user_id;
    
    -- Update or insert user loyalty record (no lifetime_points per migration 017)
    INSERT INTO user_loyalty (user_id, current_points)
    VALUES (p_user_id, current_total)
    ON CONFLICT (user_id) 
    DO UPDATE SET current_points = EXCLUDED.current_points;
    
    RETURN transaction_id;
END;
$$ LANGUAGE plpgsql;

-- Coupon system functions (from migration 006)
CREATE OR REPLACE FUNCTION generate_qr_code()
RETURNS TEXT AS $$
DECLARE
    qr_code TEXT;
    exists_check INTEGER;
BEGIN
    LOOP
        -- Generate 16-character alphanumeric code
        qr_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16));
        
        -- Check if it already exists
        SELECT COUNT(*) INTO exists_check FROM user_coupons WHERE qr_code = qr_code;
        
        -- Exit loop if unique
        EXIT WHEN exists_check = 0;
    END LOOP;
    
    RETURN qr_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_qr_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.qr_code IS NULL OR NEW.qr_code = '' THEN
        NEW.qr_code := generate_qr_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generate_qr_code_trigger BEFORE INSERT ON user_coupons
    FOR EACH ROW EXECUTE FUNCTION set_qr_code();

-- Survey coupon reward functions (from migration 020)
CREATE OR REPLACE FUNCTION assign_coupon_to_survey(
    p_survey_id UUID,
    p_coupon_id UUID,
    p_award_limit INTEGER DEFAULT NULL,
    p_custom_expiry_days INTEGER DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    assignment_id UUID;
BEGIN
    INSERT INTO survey_coupon_assignments (
        survey_id,
        coupon_id,
        award_limit,
        custom_expiry_days,
        created_by
    ) VALUES (
        p_survey_id,
        p_coupon_id,
        p_award_limit,
        p_custom_expiry_days,
        p_created_by
    )
    ON CONFLICT (survey_id, coupon_id) 
    DO UPDATE SET
        award_limit = EXCLUDED.award_limit,
        custom_expiry_days = EXCLUDED.custom_expiry_days,
        is_active = true,
        updated_at = NOW()
    RETURNING id INTO assignment_id;
    
    RETURN assignment_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION award_survey_completion_coupons()
RETURNS TRIGGER AS $$
DECLARE
    assignment_record RECORD;
    user_coupon_id UUID;
    custom_expiry TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Only process if survey was just completed
    IF NEW.is_completed = true AND (OLD.is_completed IS NULL OR OLD.is_completed = false) THEN
        
        -- Find all active coupon assignments for this survey
        FOR assignment_record IN 
            SELECT * FROM survey_coupon_assignments 
            WHERE survey_id = NEW.survey_id 
            AND is_active = true 
            AND (award_limit IS NULL OR awards_given < award_limit)
        LOOP
            -- Calculate custom expiry if specified
            IF assignment_record.custom_expiry_days IS NOT NULL THEN
                custom_expiry := NOW() + (assignment_record.custom_expiry_days || ' days')::INTERVAL;
            ELSE
                custom_expiry := NULL;
            END IF;
            
            -- Generate QR code and assign coupon to user
            INSERT INTO user_coupons (
                user_id,
                coupon_id,
                qr_code,
                assigned_by,
                assigned_reason,
                expires_at
            ) VALUES (
                NEW.user_id,
                assignment_record.coupon_id,
                generate_qr_code(),
                assignment_record.created_by,
                'Survey completion reward',
                custom_expiry
            ) RETURNING id INTO user_coupon_id;
            
            -- Record the reward in history
            INSERT INTO survey_reward_history (
                survey_response_id,
                user_id,
                coupon_id,
                user_coupon_id,
                assignment_id
            ) VALUES (
                NEW.id,
                NEW.user_id,
                assignment_record.coupon_id,
                user_coupon_id,
                assignment_record.id
            );
            
            -- Update the awards counter
            UPDATE survey_coupon_assignments 
            SET awards_given = awards_given + 1,
                updated_at = NOW()
            WHERE id = assignment_record.id;
        END LOOP;
        
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER survey_completion_coupon_award
    AFTER UPDATE ON survey_responses
    FOR EACH ROW 
    EXECUTE FUNCTION award_survey_completion_coupons();

-- =============================================================================
-- VIEWS
-- =============================================================================

-- User tier info view (from migration 017 - no lifetime_points)
CREATE VIEW user_tier_info AS
SELECT 
    ul.user_id,
    ul.current_points,
    t.name as tier_name,
    t.color as tier_color,
    t.benefits as tier_benefits,
    t.sort_order as tier_level,
    -- Calculate progress to next tier
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN
            ROUND(
                (ul.current_points - t.min_points)::DECIMAL / 
                (next_tier.min_points - t.min_points) * 100, 
                2
            )
        ELSE 100.0
    END as progress_percentage,
    next_tier.min_points as next_tier_points,
    next_tier.name as next_tier_name,
    (next_tier.min_points - ul.current_points) as points_to_next_tier
FROM user_loyalty ul
LEFT JOIN tiers t ON ul.tier_id = t.id
LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
WHERE t.is_active = true OR t.is_active IS NULL;

-- User active coupons view (from migration 006)
CREATE VIEW user_active_coupons AS
SELECT 
    uc.id as user_coupon_id,
    uc.user_id,
    uc.status,
    uc.qr_code,
    uc.expires_at,
    uc.created_at as assigned_at,
    c.id as coupon_id,
    c.code,
    c.name,
    c.description,
    c.terms_and_conditions,
    c.type,
    c.value,
    c.currency,
    c.minimum_spend,
    c.maximum_discount,
    c.valid_until as coupon_expires_at,
    -- Calculate effective expiry (earlier of user_coupon expiry or coupon expiry)
    CASE 
        WHEN uc.expires_at IS NOT NULL AND c.valid_until IS NOT NULL THEN
            LEAST(uc.expires_at, c.valid_until)
        ELSE
            COALESCE(uc.expires_at, c.valid_until)
    END as effective_expiry,
    -- Check if coupon is expiring soon (within 7 days)
    CASE 
        WHEN uc.expires_at IS NOT NULL AND c.valid_until IS NOT NULL THEN
            LEAST(uc.expires_at, c.valid_until) <= NOW() + INTERVAL '7 days'
        ELSE
            COALESCE(uc.expires_at, c.valid_until) <= NOW() + INTERVAL '7 days'
    END as expiring_soon
FROM user_coupons uc
JOIN coupons c ON uc.coupon_id = c.id
WHERE uc.status = 'available' 
    AND c.status = 'active'
    AND (uc.expires_at IS NULL OR uc.expires_at > NOW())
    AND (c.valid_until IS NULL OR c.valid_until > NOW());

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

-- Initialize reception ID sequence counter
INSERT INTO reception_id_sequence (current_user_count) 
SELECT 0 
WHERE NOT EXISTS (SELECT 1 FROM reception_id_sequence);

-- Insert initial feature toggles
INSERT INTO feature_toggles (feature_key, feature_name, description, is_enabled) VALUES
    ('account_linking', 'Account Linking', 'Allow users to link multiple authentication methods to a single account', true),
    ('facebook_oauth', 'Facebook Social Login', 'Enable login and registration via Facebook OAuth', false)
ON CONFLICT (feature_key) DO NOTHING;

-- Insert default tier data
INSERT INTO tiers (name, min_points, color, sort_order, benefits) VALUES
('Bronze', 0, '#CD7F32', 1, '{
    "description": "Welcome to our loyalty program",
    "perks": [
        "Free WiFi",
        "Welcome drink",
        "Priority check-in"
    ]
}'),
('Silver', 5000, '#C0C0C0', 2, '{
    "description": "Enjoy enhanced benefits",
    "perks": [
        "All Bronze benefits",
        "Room upgrade (subject to availability)",
        "Late checkout until 2 PM",
        "10% discount on dining"
    ]
}'),
('Gold', 15000, '#FFD700', 3, '{
    "description": "Premium experiences await",
    "perks": [
        "All Silver benefits",
        "Guaranteed room upgrade",
        "Late checkout until 4 PM",
        "15% discount on dining",
        "Access to executive lounge"
    ]
}'),
('Platinum', 35000, '#E5E4E2', 4, '{
    "description": "Ultimate luxury and exclusivity",
    "perks": [
        "All Gold benefits",
        "Suite upgrade (subject to availability)",
        "24-hour late checkout",
        "20% discount on dining",
        "Priority restaurant reservations",
        "Complimentary breakfast",
        "Personal concierge service"
    ]
}');

-- Insert default points earning rule
INSERT INTO points_earning_rules (name, description, points_per_unit, unit_type, multiplier_by_tier) VALUES
('Standard Earning', 'Standard points earning rate for hotel stays', 10.00, 'currency', '{
    "Bronze": 1.0,
    "Silver": 1.25,
    "Gold": 1.5,
    "Platinum": 2.0
}');

-- Insert sample coupon data
INSERT INTO coupons (code, name, description, terms_and_conditions, type, value, currency, minimum_spend, maximum_discount, valid_from, valid_until, usage_limit, usage_limit_per_user, status) VALUES
('WELCOME10', 'Welcome 10% Off', 'Get 10% off your first stay', 'Valid for first-time guests only. Cannot be combined with other offers.', 'percentage', 10.00, 'USD', 100.00, 50.00, NOW(), NOW() + INTERVAL '6 months', 1000, 1, 'active'),
('LOYALTY50', 'Loyalty $50 Off', 'Loyalty members get $50 off', 'Valid for stays of 2 nights or more. Available to Silver tier and above.', 'fixed_amount', 50.00, 'USD', 200.00, NULL, NOW(), NOW() + INTERVAL '3 months', 500, 2, 'active'),
('UPGRADE', 'Free Room Upgrade', 'Complimentary room upgrade', 'Subject to availability. Valid for Gold and Platinum members only.', 'free_upgrade', 0.00, 'USD', NULL, NULL, NOW(), NOW() + INTERVAL '1 year', 100, 1, 'active');

COMMIT;

-- =============================================================================
-- END OF CONSOLIDATED SCHEMA
-- =============================================================================
-- 
-- MIGRATION CONFLICTS RESOLVED:
-- - Points expiration removed (migration 016 takes precedence over 021)
-- - Lifetime points column removed (migration 017 confirmed)
-- - Award points function includes reference_id parameter (migration 018)
-- - Reception ID uses final 8-digit sequential block format (migration 023)
-- - Survey system includes coupon reward integration (migrations 019 + 020)
-- - All enum conflicts resolved with final migration states
-- 
-- This schema represents the final state after all 23 migrations are applied.
-- =============================================================================