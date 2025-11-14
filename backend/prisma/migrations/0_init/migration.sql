-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."coupon_status" AS ENUM ('draft', 'active', 'paused', 'expired', 'exhausted');

-- CreateEnum
CREATE TYPE "public"."coupon_type" AS ENUM ('percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service');

-- CreateEnum
CREATE TYPE "public"."points_transaction_type" AS ENUM ('earned_stay', 'earned_bonus', 'redeemed', 'expired', 'admin_adjustment', 'admin_award', 'admin_deduction');

-- CreateEnum
CREATE TYPE "public"."user_coupon_status" AS ENUM ('available', 'used', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "public"."user_role" AS ENUM ('customer', 'admin', 'super_admin');

-- CreateTable: account_link_requests
CREATE TABLE "public"."account_link_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "requester_user_id" UUID NOT NULL,
    "target_email" VARCHAR(255) NOT NULL,
    "target_user_id" UUID,
    "request_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) DEFAULT 'pending',
    "message" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) DEFAULT (now() + '7 days'::interval),

    CONSTRAINT "account_link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: account_linking_audit
CREATE TABLE "public"."account_linking_audit" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target_email" VARCHAR(255),
    "target_user_id" UUID,
    "request_id" UUID,
    "details" JSONB DEFAULT '{}',
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_linking_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupon_analytics
CREATE TABLE "public"."coupon_analytics" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "coupon_id" UUID NOT NULL,
    "analytics_date" DATE NOT NULL,
    "total_assigned" INTEGER DEFAULT 0,
    "total_used" INTEGER DEFAULT 0,
    "total_expired" INTEGER DEFAULT 0,
    "total_revenue_impact" DECIMAL(12,2) DEFAULT 0.00,
    "unique_users_assigned" INTEGER DEFAULT 0,
    "unique_users_redeemed" INTEGER DEFAULT 0,
    "average_time_to_redemption" interval,
    "conversion_rate" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupon_redemptions
CREATE TABLE "public"."coupon_redemptions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_coupon_id" UUID NOT NULL,
    "original_amount" DECIMAL(10,2),
    "discount_amount" DECIMAL(10,2),
    "final_amount" DECIMAL(10,2),
    "currency" VARCHAR(3) DEFAULT 'USD',
    "transaction_reference" VARCHAR(255),
    "redemption_channel" VARCHAR(50) DEFAULT 'mobile_app',
    "staff_member_id" UUID,
    "location" VARCHAR(255),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupon_translations
CREATE TABLE "public"."coupon_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coupon_id" UUID NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms_and_conditions" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupons
CREATE TABLE "public"."coupons" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "terms_and_conditions" TEXT,
    "type" "public"."coupon_type" NOT NULL,
    "value" DECIMAL(10,2),
    "currency" VARCHAR(3) DEFAULT 'USD',
    "minimum_spend" DECIMAL(10,2),
    "maximum_discount" DECIMAL(10,2),
    "valid_from" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(6),
    "usage_limit" INTEGER,
    "usage_limit_per_user" INTEGER DEFAULT 1,
    "used_count" INTEGER DEFAULT 0,
    "tier_restrictions" JSONB DEFAULT '[]',
    "customer_segment" JSONB DEFAULT '{}',
    "status" "public"."coupon_status" DEFAULT 'draft',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "original_language" VARCHAR(10) DEFAULT 'th',
    "available_languages" JSONB DEFAULT '["th"]',
    "last_translated" TIMESTAMPTZ(6),
    "translation_status" VARCHAR(20) DEFAULT 'none',

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable: feature_toggle_audit
CREATE TABLE "public"."feature_toggle_audit" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "feature_toggle_id" UUID NOT NULL,
    "previous_state" BOOLEAN,
    "new_state" BOOLEAN NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "feature_toggle_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable: feature_toggles
CREATE TABLE "public"."feature_toggles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "feature_key" VARCHAR(100) NOT NULL,
    "feature_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "feature_toggles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: linked_accounts
CREATE TABLE "public"."linked_accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "primary_user_id" UUID NOT NULL,
    "linked_user_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "linked_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: membership_id_sequence
-- This sequence table is used to generate unique membership IDs for users
CREATE TABLE "public"."membership_id_sequence" (
    "id" SERIAL NOT NULL,
    "current_user_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reception_id_sequence_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."membership_id_sequence" IS 'Sequence for generating unique 8-character membership IDs';

-- CreateTable: password_reset_tokens
CREATE TABLE "public"."password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable: points_earning_rules
CREATE TABLE "public"."points_earning_rules" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "points_per_unit" DECIMAL(10,2) NOT NULL,
    "unit_type" VARCHAR(50) DEFAULT 'currency',
    "multiplier_by_tier" JSONB DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "valid_from" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_earning_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: points_transactions
CREATE TABLE "public"."points_transactions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "type" "public"."points_transaction_type" NOT NULL,
    "description" TEXT,
    "reference_id" VARCHAR(100),
    "admin_user_id" UUID,
    "admin_reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "nights_stayed" INTEGER DEFAULT 0,

    CONSTRAINT "points_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: refresh_tokens
CREATE TABLE "public"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable: survey_coupon_assignments
CREATE TABLE "public"."survey_coupon_assignments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "survey_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "max_awards" INTEGER,
    "awarded_count" INTEGER DEFAULT 0,
    "assigned_by" UUID,
    "assigned_reason" TEXT DEFAULT 'Survey completion reward',
    "custom_expiry_days" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_coupon_assignments_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."survey_coupon_assignments" IS 'Links surveys to coupons that should be awarded upon completion';

-- CreateTable: survey_invitations
CREATE TABLE "public"."survey_invitations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "survey_id" UUID,
    "user_id" UUID,
    "status" VARCHAR(50) DEFAULT 'pending',
    "sent_at" TIMESTAMP(6),
    "viewed_at" TIMESTAMP(6),
    "expires_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_invitations_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."survey_invitations" IS 'Tracks survey invitations sent to specific users';

-- CreateTable: survey_responses
CREATE TABLE "public"."survey_responses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "survey_id" UUID,
    "user_id" UUID,
    "answers" JSONB NOT NULL,
    "is_completed" BOOLEAN DEFAULT false,
    "progress" INTEGER DEFAULT 0,
    "started_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."survey_responses" IS 'Stores user responses to surveys';

-- CreateTable: survey_reward_history
CREATE TABLE "public"."survey_reward_history" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "survey_coupon_assignment_id" UUID NOT NULL,
    "survey_response_id" UUID NOT NULL,
    "user_coupon_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "awarded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "award_condition_met" VARCHAR(50) NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_reward_history_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."survey_reward_history" IS 'Audit trail of survey completion rewards';

-- CreateTable: survey_translations
CREATE TABLE "public"."survey_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "survey_id" UUID NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: surveys
CREATE TABLE "public"."surveys" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL,
    "target_segment" JSONB DEFAULT '{}',
    "status" VARCHAR(50) DEFAULT 'draft',
    "scheduled_start" TIMESTAMP(6),
    "scheduled_end" TIMESTAMP(6),
    "created_by" UUID,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "access_type" VARCHAR(20) NOT NULL DEFAULT 'public',
    "original_language" VARCHAR(10) DEFAULT 'th',
    "available_languages" JSONB DEFAULT '["th"]',
    "last_translated" TIMESTAMPTZ(6),
    "translation_status" VARCHAR(20) DEFAULT 'none',

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."surveys" IS 'Stores survey definitions and configurations';

-- CreateTable: tiers (NIGHTS-BASED TIER SYSTEM)
CREATE TABLE "public"."tiers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(50) NOT NULL,
    "min_points" INTEGER NOT NULL DEFAULT 0,
    "min_nights" INTEGER NOT NULL DEFAULT 0,
    "benefits" JSONB DEFAULT '{}',
    "color" VARCHAR(7) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

COMMENT ON COLUMN "public"."tiers"."min_points" IS 'Legacy field - kept for compatibility but NOT used for tier calculation';
COMMENT ON COLUMN "public"."tiers"."min_nights" IS 'ONLY requirement for tier - determines membership level based on total nights stayed';

-- CreateTable: translation_jobs
CREATE TABLE "public"."translation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "source_language" VARCHAR(10) NOT NULL,
    "target_languages" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "characters_translated" INTEGER DEFAULT 0,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'azure',
    "error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "translation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_audit_log
CREATE TABLE "public"."user_audit_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "details" JSONB DEFAULT '{}',
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_coupons
CREATE TABLE "public"."user_coupons" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "status" "public"."user_coupon_status" DEFAULT 'available',
    "qr_code" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "used_by_admin" UUID,
    "redemption_location" VARCHAR(255),
    "redemption_details" JSONB DEFAULT '{}',
    "assigned_by" UUID,
    "assigned_reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_coupons_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."user_coupons" IS 'User-specific coupon assignments with QR codes for redemption';

-- CreateTable: user_loyalty (NIGHTS-BASED TIER TRACKING)
CREATE TABLE "public"."user_loyalty" (
    "user_id" UUID NOT NULL,
    "current_points" INTEGER DEFAULT 0,
    "total_nights" INTEGER DEFAULT 0,
    "tier_id" UUID,
    "tier_updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "points_updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_loyalty_pkey" PRIMARY KEY ("user_id")
);

COMMENT ON COLUMN "public"."user_loyalty"."current_points" IS 'Points for rewards/redemption only - NOT used for tier calculation';
COMMENT ON COLUMN "public"."user_loyalty"."total_nights" IS 'Total nights stayed - ONLY factor determining tier membership';

-- CreateTable: user_profiles
CREATE TABLE "public"."user_profiles" (
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "phone" VARCHAR(20),
    "date_of_birth" DATE,
    "preferences" JSONB DEFAULT '{}',
    "avatar_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "membership_id" VARCHAR(8) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable: users
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255),
    "role" "public"."user_role" DEFAULT 'customer',
    "is_active" BOOLEAN DEFAULT true,
    "email_verified" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "oauth_provider" VARCHAR(50),
    "oauth_provider_id" VARCHAR(255),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: account_link_requests
CREATE INDEX "idx_account_link_requests_expires" ON "public"."account_link_requests"("expires_at");
CREATE INDEX "idx_account_link_requests_requester" ON "public"."account_link_requests"("requester_user_id");
CREATE INDEX "idx_account_link_requests_status" ON "public"."account_link_requests"("status");
CREATE INDEX "idx_account_link_requests_target" ON "public"."account_link_requests"("target_user_id");
CREATE INDEX "idx_account_link_requests_target_email" ON "public"."account_link_requests"("target_email");

-- CreateIndex: account_linking_audit
CREATE INDEX "idx_account_linking_audit_created" ON "public"."account_linking_audit"("created_at");
CREATE INDEX "idx_account_linking_audit_user" ON "public"."account_linking_audit"("user_id");

-- CreateIndex: coupon_analytics
CREATE INDEX "idx_coupon_analytics_coupon_id" ON "public"."coupon_analytics"("coupon_id");
CREATE INDEX "idx_coupon_analytics_date" ON "public"."coupon_analytics"("analytics_date");
CREATE UNIQUE INDEX "coupon_analytics_coupon_id_analytics_date_key" ON "public"."coupon_analytics"("coupon_id", "analytics_date");

-- CreateIndex: coupon_redemptions
CREATE INDEX "idx_coupon_redemptions_created_at" ON "public"."coupon_redemptions"("created_at");
CREATE INDEX "idx_coupon_redemptions_transaction_ref" ON "public"."coupon_redemptions"("transaction_reference");
CREATE INDEX "idx_coupon_redemptions_user_coupon_id" ON "public"."coupon_redemptions"("user_coupon_id");

-- CreateIndex: coupon_translations
CREATE INDEX "idx_coupon_translations_coupon_lang" ON "public"."coupon_translations"("coupon_id", "language");
CREATE UNIQUE INDEX "coupon_translations_coupon_id_language_key" ON "public"."coupon_translations"("coupon_id", "language");

-- CreateIndex: coupons
CREATE INDEX "idx_coupons_code" ON "public"."coupons"("code");
CREATE INDEX "idx_coupons_created_by" ON "public"."coupons"("created_by");
CREATE INDEX "idx_coupons_status" ON "public"."coupons"("status");
CREATE INDEX "idx_coupons_type" ON "public"."coupons"("type");
CREATE INDEX "idx_coupons_valid_dates" ON "public"."coupons"("valid_from", "valid_until");
CREATE UNIQUE INDEX "coupons_code_key" ON "public"."coupons"("code");

-- CreateIndex: feature_toggle_audit
CREATE INDEX "idx_feature_toggle_audit_changed_at" ON "public"."feature_toggle_audit"("changed_at");
CREATE INDEX "idx_feature_toggle_audit_feature_id" ON "public"."feature_toggle_audit"("feature_toggle_id");

-- CreateIndex: feature_toggles
CREATE INDEX "idx_feature_toggles_enabled" ON "public"."feature_toggles"("is_enabled");
CREATE INDEX "idx_feature_toggles_key" ON "public"."feature_toggles"("feature_key");
CREATE UNIQUE INDEX "feature_toggles_feature_key_key" ON "public"."feature_toggles"("feature_key");

-- CreateIndex: linked_accounts
CREATE INDEX "idx_linked_accounts_linked" ON "public"."linked_accounts"("linked_user_id");
CREATE INDEX "idx_linked_accounts_primary" ON "public"."linked_accounts"("primary_user_id");
CREATE UNIQUE INDEX "linked_accounts_primary_user_id_linked_user_id_key" ON "public"."linked_accounts"("primary_user_id", "linked_user_id");

-- CreateIndex: password_reset_tokens
CREATE INDEX "idx_password_reset_tokens_token" ON "public"."password_reset_tokens"("token");
CREATE INDEX "idx_password_reset_tokens_user_id" ON "public"."password_reset_tokens"("user_id");
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "public"."password_reset_tokens"("token");

-- CreateIndex: points_earning_rules
CREATE INDEX "idx_points_earning_rules_active" ON "public"."points_earning_rules"("is_active");

-- CreateIndex: points_transactions
CREATE INDEX "idx_points_transactions_created_at" ON "public"."points_transactions"("created_at");
CREATE INDEX "idx_points_transactions_expires_at" ON "public"."points_transactions"("expires_at");
CREATE INDEX "idx_points_transactions_type" ON "public"."points_transactions"("type");
CREATE INDEX "idx_points_transactions_user_id" ON "public"."points_transactions"("user_id");

-- CreateIndex: refresh_tokens
CREATE INDEX "idx_refresh_tokens_token" ON "public"."refresh_tokens"("token");
CREATE INDEX "idx_refresh_tokens_user_id" ON "public"."refresh_tokens"("user_id");
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "public"."refresh_tokens"("token");

-- CreateIndex: survey_coupon_assignments
CREATE INDEX "idx_survey_coupon_assignments_active" ON "public"."survey_coupon_assignments"("is_active");
CREATE INDEX "idx_survey_coupon_assignments_coupon_id" ON "public"."survey_coupon_assignments"("coupon_id");
CREATE INDEX "idx_survey_coupon_assignments_survey_id" ON "public"."survey_coupon_assignments"("survey_id");
CREATE UNIQUE INDEX "survey_coupon_assignments_survey_id_coupon_id_key" ON "public"."survey_coupon_assignments"("survey_id", "coupon_id");

-- CreateIndex: survey_invitations
CREATE INDEX "idx_survey_invitations_status" ON "public"."survey_invitations"("status");
CREATE INDEX "idx_survey_invitations_survey_id" ON "public"."survey_invitations"("survey_id");
CREATE INDEX "idx_survey_invitations_user_id" ON "public"."survey_invitations"("user_id");
CREATE UNIQUE INDEX "idx_survey_invitations_unique" ON "public"."survey_invitations"("survey_id", "user_id");

-- CreateIndex: survey_responses
CREATE INDEX "idx_survey_responses_completed" ON "public"."survey_responses"("is_completed");
CREATE INDEX "idx_survey_responses_survey_id" ON "public"."survey_responses"("survey_id");
CREATE INDEX "idx_survey_responses_user_id" ON "public"."survey_responses"("user_id");
CREATE UNIQUE INDEX "idx_survey_responses_unique" ON "public"."survey_responses"("survey_id", "user_id");

-- CreateIndex: survey_reward_history
CREATE INDEX "idx_survey_reward_history_assignment_id" ON "public"."survey_reward_history"("survey_coupon_assignment_id");
CREATE INDEX "idx_survey_reward_history_awarded_at" ON "public"."survey_reward_history"("awarded_at");
CREATE INDEX "idx_survey_reward_history_user_id" ON "public"."survey_reward_history"("user_id");
CREATE UNIQUE INDEX "survey_reward_history_survey_coupon_assignment_id_user_id_key" ON "public"."survey_reward_history"("survey_coupon_assignment_id", "user_id");

-- CreateIndex: survey_translations
CREATE INDEX "idx_survey_translations_survey_lang" ON "public"."survey_translations"("survey_id", "language");
CREATE UNIQUE INDEX "survey_translations_survey_id_language_key" ON "public"."survey_translations"("survey_id", "language");

-- CreateIndex: surveys
CREATE INDEX "idx_surveys_access_type" ON "public"."surveys"("access_type");
CREATE INDEX "idx_surveys_created_at" ON "public"."surveys"("created_at");
CREATE INDEX "idx_surveys_created_by" ON "public"."surveys"("created_by");
CREATE INDEX "idx_surveys_status" ON "public"."surveys"("status");
CREATE INDEX "idx_surveys_status_access_type" ON "public"."surveys"("status", "access_type");

-- CreateIndex: tiers (NIGHTS-BASED INDEXING)
CREATE INDEX "idx_tiers_min_points" ON "public"."tiers"("min_points");
CREATE INDEX "idx_tiers_min_nights" ON "public"."tiers"("min_nights");
CREATE INDEX "idx_tiers_sort_order" ON "public"."tiers"("sort_order");
CREATE UNIQUE INDEX "tiers_name_key" ON "public"."tiers"("name");

-- CreateIndex: translation_jobs
CREATE INDEX "idx_translation_jobs_created_by" ON "public"."translation_jobs"("created_by");
CREATE INDEX "idx_translation_jobs_entity" ON "public"."translation_jobs"("entity_type", "entity_id");
CREATE INDEX "idx_translation_jobs_status" ON "public"."translation_jobs"("status");

-- CreateIndex: user_audit_log
CREATE INDEX "idx_user_audit_log_created_at" ON "public"."user_audit_log"("created_at");
CREATE INDEX "idx_user_audit_log_user_id" ON "public"."user_audit_log"("user_id");

-- CreateIndex: user_coupons
CREATE INDEX "idx_user_coupons_coupon_id" ON "public"."user_coupons"("coupon_id");
CREATE INDEX "idx_user_coupons_expires_at" ON "public"."user_coupons"("expires_at");
CREATE INDEX "idx_user_coupons_qr_code" ON "public"."user_coupons"("qr_code");
CREATE INDEX "idx_user_coupons_status" ON "public"."user_coupons"("status");
CREATE INDEX "idx_user_coupons_user_id" ON "public"."user_coupons"("user_id");
CREATE UNIQUE INDEX "user_coupons_qr_code_key" ON "public"."user_coupons"("qr_code");

-- CreateIndex: user_loyalty (NIGHTS-BASED INDEXING)
CREATE INDEX "idx_user_loyalty_current_points" ON "public"."user_loyalty"("current_points");
CREATE INDEX "idx_user_loyalty_total_nights" ON "public"."user_loyalty"("total_nights");
CREATE INDEX "idx_user_loyalty_tier_id" ON "public"."user_loyalty"("tier_id");

-- CreateIndex: user_profiles
CREATE INDEX "idx_user_profiles_user_id" ON "public"."user_profiles"("user_id");
CREATE UNIQUE INDEX "idx_user_profiles_membership_id" ON "public"."user_profiles"("membership_id");

-- CreateIndex: users
CREATE INDEX "idx_users_email" ON "public"."users"("email");
CREATE INDEX "idx_users_oauth_provider_id" ON "public"."users"("oauth_provider", "oauth_provider_id");
CREATE INDEX "idx_users_role" ON "public"."users"("role");

-- AddForeignKey: account_link_requests
ALTER TABLE "public"."account_link_requests" ADD CONSTRAINT "account_link_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."account_link_requests" ADD CONSTRAINT "account_link_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: account_linking_audit
ALTER TABLE "public"."account_linking_audit" ADD CONSTRAINT "account_linking_audit_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."account_link_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."account_linking_audit" ADD CONSTRAINT "account_linking_audit_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."account_linking_audit" ADD CONSTRAINT "account_linking_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: coupon_analytics
ALTER TABLE "public"."coupon_analytics" ADD CONSTRAINT "coupon_analytics_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: coupon_redemptions
ALTER TABLE "public"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_coupon_id_fkey" FOREIGN KEY ("user_coupon_id") REFERENCES "public"."user_coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: coupon_translations
ALTER TABLE "public"."coupon_translations" ADD CONSTRAINT "coupon_translations_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: coupons
ALTER TABLE "public"."coupons" ADD CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: feature_toggle_audit
ALTER TABLE "public"."feature_toggle_audit" ADD CONSTRAINT "feature_toggle_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."feature_toggle_audit" ADD CONSTRAINT "feature_toggle_audit_feature_toggle_id_fkey" FOREIGN KEY ("feature_toggle_id") REFERENCES "public"."feature_toggles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: feature_toggles
ALTER TABLE "public"."feature_toggles" ADD CONSTRAINT "feature_toggles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."feature_toggles" ADD CONSTRAINT "feature_toggles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: linked_accounts
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "linked_accounts_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "linked_accounts_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "linked_accounts_primary_user_id_fkey" FOREIGN KEY ("primary_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: password_reset_tokens
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: points_transactions
ALTER TABLE "public"."points_transactions" ADD CONSTRAINT "points_transactions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."points_transactions" ADD CONSTRAINT "points_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: refresh_tokens
ALTER TABLE "public"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: survey_coupon_assignments
ALTER TABLE "public"."survey_coupon_assignments" ADD CONSTRAINT "survey_coupon_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_coupon_assignments" ADD CONSTRAINT "survey_coupon_assignments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_coupon_assignments" ADD CONSTRAINT "survey_coupon_assignments_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: survey_invitations
ALTER TABLE "public"."survey_invitations" ADD CONSTRAINT "survey_invitations_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_invitations" ADD CONSTRAINT "survey_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: survey_responses
ALTER TABLE "public"."survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_responses" ADD CONSTRAINT "survey_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: survey_reward_history
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_survey_coupon_assignment_id_fkey" FOREIGN KEY ("survey_coupon_assignment_id") REFERENCES "public"."survey_coupon_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_survey_response_id_fkey" FOREIGN KEY ("survey_response_id") REFERENCES "public"."survey_responses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_user_coupon_id_fkey" FOREIGN KEY ("user_coupon_id") REFERENCES "public"."user_coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: survey_translations
ALTER TABLE "public"."survey_translations" ADD CONSTRAINT "survey_translations_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: surveys
ALTER TABLE "public"."surveys" ADD CONSTRAINT "surveys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: translation_jobs
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "translation_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: user_audit_log
ALTER TABLE "public"."user_audit_log" ADD CONSTRAINT "user_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: user_coupons
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_used_by_admin_fkey" FOREIGN KEY ("used_by_admin") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: user_loyalty
ALTER TABLE "public"."user_loyalty" ADD CONSTRAINT "user_loyalty_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."user_loyalty" ADD CONSTRAINT "user_loyalty_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: user_profiles
ALTER TABLE "public"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Add CHECK constraints
ALTER TABLE "public"."account_link_requests" ADD CONSTRAINT "check_request_type" CHECK (request_type IN ('family_link', 'account_merge'));
ALTER TABLE "public"."account_link_requests" ADD CONSTRAINT "check_status" CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled'));
ALTER TABLE "public"."coupons" ADD CONSTRAINT "check_coupon_validity" CHECK (valid_until IS NULL OR valid_until > valid_from);
ALTER TABLE "public"."coupon_translations" ADD CONSTRAINT "check_language_code" CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$');
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "check_different_users" CHECK (primary_user_id != linked_user_id);
ALTER TABLE "public"."survey_invitations" ADD CONSTRAINT "check_invitation_status" CHECK (status IN ('pending', 'sent', 'viewed', 'completed', 'expired'));
ALTER TABLE "public"."survey_responses" ADD CONSTRAINT "check_progress_range" CHECK (progress >= 0 AND progress <= 100);
ALTER TABLE "public"."survey_translations" ADD CONSTRAINT "check_survey_language_code" CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$');
ALTER TABLE "public"."surveys" ADD CONSTRAINT "check_access_type" CHECK (access_type IN ('public', 'invite_only'));
ALTER TABLE "public"."surveys" ADD CONSTRAINT "check_survey_status" CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived'));
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "check_entity_type" CHECK (entity_type IN ('coupon', 'survey'));
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "check_job_status" CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "check_progress" CHECK (progress >= 0 AND progress <= 100);
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "check_provider" CHECK (provider IN ('azure', 'google', 'manual'));
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "check_translation_language_code" CHECK (source_language ~ '^[a-z]{2}(-[A-Z]{2})?$');

-- ========================================
-- NIGHTS-BASED TIER SYSTEM STORED PROCEDURES
-- ========================================

-- Stored Procedure: recalculate_user_tier_by_nights
-- This function automatically recalculates and updates user tier based on total_nights
CREATE OR REPLACE FUNCTION recalculate_user_tier_by_nights(p_user_id UUID)
RETURNS TABLE (
  new_tier_id UUID,
  new_tier_name VARCHAR(50),
  tier_changed BOOLEAN
) AS $$
DECLARE
  v_total_nights INTEGER;
  v_current_tier_id UUID;
  v_new_tier_id UUID;
  v_new_tier_name VARCHAR(50);
  v_tier_changed BOOLEAN := FALSE;
BEGIN
  -- Get user's current total nights and tier
  SELECT ul.total_nights, ul.tier_id
  INTO v_total_nights, v_current_tier_id
  FROM user_loyalty ul
  WHERE ul.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User loyalty record not found for user_id: %', p_user_id;
  END IF;

  -- Find the appropriate tier based on total nights
  -- Select the highest tier where min_nights <= user's total_nights
  SELECT t.id, t.name
  INTO v_new_tier_id, v_new_tier_name
  FROM tiers t
  WHERE t.is_active = TRUE
    AND t.min_nights <= v_total_nights
  ORDER BY t.min_nights DESC, t.sort_order DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- If no tier found, assign Bronze (lowest tier)
    SELECT t.id, t.name
    INTO v_new_tier_id, v_new_tier_name
    FROM tiers t
    WHERE t.is_active = TRUE
    ORDER BY t.sort_order ASC
    LIMIT 1;
  END IF;

  -- Check if tier changed
  IF v_current_tier_id IS DISTINCT FROM v_new_tier_id THEN
    v_tier_changed := TRUE;

    -- Update user's tier
    UPDATE user_loyalty
    SET tier_id = v_new_tier_id,
        tier_updated_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Log tier change in audit log (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_audit_log') THEN
      INSERT INTO user_audit_log (user_id, action, details, created_at)
      VALUES (
        p_user_id,
        'tier_upgrade_by_nights',
        jsonb_build_object(
          'old_tier_id', v_current_tier_id,
          'new_tier_id', v_new_tier_id,
          'new_tier_name', v_new_tier_name,
          'total_nights', v_total_nights,
          'upgrade_reason', 'nights_threshold_met'
        ),
        NOW()
      );
    END IF;
  END IF;

  -- Return results
  RETURN QUERY SELECT v_new_tier_id, v_new_tier_name, v_tier_changed;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the stored procedure
COMMENT ON FUNCTION recalculate_user_tier_by_nights IS 'Recalculates and updates user tier based on total_nights. Returns new tier info and whether tier changed. Call this function after updating total_nights in user_loyalty table.';

-- Stored Procedure: award_points
-- This maintains the existing award_points function for points transactions
CREATE OR REPLACE FUNCTION award_points(
    p_user_id UUID,
    p_points INTEGER,
    p_transaction_type VARCHAR(50),
    p_description TEXT DEFAULT NULL,
    p_reference_id VARCHAR(100) DEFAULT NULL,
    p_admin_user_id UUID DEFAULT NULL,
    p_admin_reason TEXT DEFAULT NULL,
    p_nights_stayed INTEGER DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
    v_new_points INTEGER;
    v_transaction_id UUID;
BEGIN
    -- Insert the points transaction
    INSERT INTO points_transactions (
        user_id, points, type, description, reference_id,
        admin_user_id, admin_reason, nights_stayed, created_at
    ) VALUES (
        p_user_id, p_points, p_transaction_type::points_transaction_type,
        p_description, p_reference_id, p_admin_user_id, p_admin_reason,
        p_nights_stayed, NOW()
    ) RETURNING id INTO v_transaction_id;

    -- Update user's current points and total_nights in user_loyalty
    UPDATE user_loyalty
    SET current_points = current_points + p_points,
        total_nights = COALESCE(total_nights, 0) + p_nights_stayed,
        points_updated_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING current_points INTO v_new_points;

    -- If nights were awarded, recalculate tier
    IF p_nights_stayed > 0 THEN
        PERFORM recalculate_user_tier_by_nights(p_user_id);
    END IF;

    RETURN jsonb_build_object(
        'transaction_id', v_transaction_id,
        'new_points_balance', v_new_points,
        'nights_added', p_nights_stayed
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION award_points IS 'Awards points to a user and updates their total_nights. Automatically recalculates tier when nights are awarded.';
