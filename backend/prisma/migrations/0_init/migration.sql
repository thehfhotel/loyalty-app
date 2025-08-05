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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "public"."linked_accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "primary_user_id" UUID NOT NULL,
    "linked_user_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "linked_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."membership_id_sequence" (
    "id" SERIAL NOT NULL,
    "current_user_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reception_id_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "public"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "public"."tiers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(50) NOT NULL,
    "min_points" INTEGER NOT NULL,
    "benefits" JSONB DEFAULT '{}',
    "color" VARCHAR(7) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "public"."user_loyalty" (
    "user_id" UUID NOT NULL,
    "current_points" INTEGER DEFAULT 0,
    "tier_id" UUID,
    "tier_updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "points_updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "total_nights" INTEGER DEFAULT 0,

    CONSTRAINT "user_loyalty_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "idx_account_link_requests_expires" ON "public"."account_link_requests"("expires_at");

-- CreateIndex
CREATE INDEX "idx_account_link_requests_requester" ON "public"."account_link_requests"("requester_user_id");

-- CreateIndex
CREATE INDEX "idx_account_link_requests_status" ON "public"."account_link_requests"("status");

-- CreateIndex
CREATE INDEX "idx_account_link_requests_target" ON "public"."account_link_requests"("target_user_id");

-- CreateIndex
CREATE INDEX "idx_account_link_requests_target_email" ON "public"."account_link_requests"("target_email");

-- CreateIndex
CREATE INDEX "idx_account_linking_audit_created" ON "public"."account_linking_audit"("created_at");

-- CreateIndex
CREATE INDEX "idx_account_linking_audit_user" ON "public"."account_linking_audit"("user_id");

-- CreateIndex
CREATE INDEX "idx_coupon_analytics_coupon_id" ON "public"."coupon_analytics"("coupon_id");

-- CreateIndex
CREATE INDEX "idx_coupon_analytics_date" ON "public"."coupon_analytics"("analytics_date");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_analytics_coupon_id_analytics_date_key" ON "public"."coupon_analytics"("coupon_id", "analytics_date");

-- CreateIndex
CREATE INDEX "idx_coupon_redemptions_created_at" ON "public"."coupon_redemptions"("created_at");

-- CreateIndex
CREATE INDEX "idx_coupon_redemptions_transaction_ref" ON "public"."coupon_redemptions"("transaction_reference");

-- CreateIndex
CREATE INDEX "idx_coupon_redemptions_user_coupon_id" ON "public"."coupon_redemptions"("user_coupon_id");

-- CreateIndex
CREATE INDEX "idx_coupon_translations_coupon_lang" ON "public"."coupon_translations"("coupon_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_translations_coupon_id_language_key" ON "public"."coupon_translations"("coupon_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "public"."coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupons_code" ON "public"."coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupons_created_by" ON "public"."coupons"("created_by");

-- CreateIndex
CREATE INDEX "idx_coupons_status" ON "public"."coupons"("status");

-- CreateIndex
CREATE INDEX "idx_coupons_type" ON "public"."coupons"("type");

-- CreateIndex
CREATE INDEX "idx_coupons_valid_dates" ON "public"."coupons"("valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "idx_feature_toggle_audit_changed_at" ON "public"."feature_toggle_audit"("changed_at");

-- CreateIndex
CREATE INDEX "idx_feature_toggle_audit_feature_id" ON "public"."feature_toggle_audit"("feature_toggle_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_toggles_feature_key_key" ON "public"."feature_toggles"("feature_key");

-- CreateIndex
CREATE INDEX "idx_feature_toggles_enabled" ON "public"."feature_toggles"("is_enabled");

-- CreateIndex
CREATE INDEX "idx_feature_toggles_key" ON "public"."feature_toggles"("feature_key");

-- CreateIndex
CREATE INDEX "idx_linked_accounts_linked" ON "public"."linked_accounts"("linked_user_id");

-- CreateIndex
CREATE INDEX "idx_linked_accounts_primary" ON "public"."linked_accounts"("primary_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "linked_accounts_primary_user_id_linked_user_id_key" ON "public"."linked_accounts"("primary_user_id", "linked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "public"."password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_password_reset_tokens_token" ON "public"."password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_password_reset_tokens_user_id" ON "public"."password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_points_earning_rules_active" ON "public"."points_earning_rules"("is_active");

-- CreateIndex
CREATE INDEX "idx_points_transactions_created_at" ON "public"."points_transactions"("created_at");

-- CreateIndex
CREATE INDEX "idx_points_transactions_expires_at" ON "public"."points_transactions"("expires_at");

-- CreateIndex
CREATE INDEX "idx_points_transactions_type" ON "public"."points_transactions"("type");

-- CreateIndex
CREATE INDEX "idx_points_transactions_user_id" ON "public"."points_transactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "public"."refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_token" ON "public"."refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user_id" ON "public"."refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_survey_coupon_assignments_active" ON "public"."survey_coupon_assignments"("is_active");

-- CreateIndex
CREATE INDEX "idx_survey_coupon_assignments_coupon_id" ON "public"."survey_coupon_assignments"("coupon_id");

-- CreateIndex
CREATE INDEX "idx_survey_coupon_assignments_survey_id" ON "public"."survey_coupon_assignments"("survey_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_coupon_assignments_survey_id_coupon_id_key" ON "public"."survey_coupon_assignments"("survey_id", "coupon_id");

-- CreateIndex
CREATE INDEX "idx_survey_invitations_status" ON "public"."survey_invitations"("status");

-- CreateIndex
CREATE INDEX "idx_survey_invitations_survey_id" ON "public"."survey_invitations"("survey_id");

-- CreateIndex
CREATE INDEX "idx_survey_invitations_user_id" ON "public"."survey_invitations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_survey_invitations_unique" ON "public"."survey_invitations"("survey_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_survey_responses_completed" ON "public"."survey_responses"("is_completed");

-- CreateIndex
CREATE INDEX "idx_survey_responses_survey_id" ON "public"."survey_responses"("survey_id");

-- CreateIndex
CREATE INDEX "idx_survey_responses_user_id" ON "public"."survey_responses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_survey_responses_unique" ON "public"."survey_responses"("survey_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_survey_reward_history_assignment_id" ON "public"."survey_reward_history"("survey_coupon_assignment_id");

-- CreateIndex
CREATE INDEX "idx_survey_reward_history_awarded_at" ON "public"."survey_reward_history"("awarded_at");

-- CreateIndex
CREATE INDEX "idx_survey_reward_history_user_id" ON "public"."survey_reward_history"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_reward_history_survey_coupon_assignment_id_user_id_key" ON "public"."survey_reward_history"("survey_coupon_assignment_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_survey_translations_survey_lang" ON "public"."survey_translations"("survey_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "survey_translations_survey_id_language_key" ON "public"."survey_translations"("survey_id", "language");

-- CreateIndex
CREATE INDEX "idx_surveys_access_type" ON "public"."surveys"("access_type");

-- CreateIndex
CREATE INDEX "idx_surveys_created_at" ON "public"."surveys"("created_at");

-- CreateIndex
CREATE INDEX "idx_surveys_created_by" ON "public"."surveys"("created_by");

-- CreateIndex
CREATE INDEX "idx_surveys_status" ON "public"."surveys"("status");

-- CreateIndex
CREATE INDEX "idx_surveys_status_access_type" ON "public"."surveys"("status", "access_type");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_name_key" ON "public"."tiers"("name");

-- CreateIndex
CREATE INDEX "idx_tiers_min_points" ON "public"."tiers"("min_points");

-- CreateIndex
CREATE INDEX "idx_tiers_sort_order" ON "public"."tiers"("sort_order");

-- CreateIndex
CREATE INDEX "idx_translation_jobs_created_by" ON "public"."translation_jobs"("created_by");

-- CreateIndex
CREATE INDEX "idx_translation_jobs_entity" ON "public"."translation_jobs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_translation_jobs_status" ON "public"."translation_jobs"("status");

-- CreateIndex
CREATE INDEX "idx_user_audit_log_created_at" ON "public"."user_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_user_audit_log_user_id" ON "public"."user_audit_log"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_coupons_qr_code_key" ON "public"."user_coupons"("qr_code");

-- CreateIndex
CREATE INDEX "idx_user_coupons_coupon_id" ON "public"."user_coupons"("coupon_id");

-- CreateIndex
CREATE INDEX "idx_user_coupons_expires_at" ON "public"."user_coupons"("expires_at");

-- CreateIndex
CREATE INDEX "idx_user_coupons_qr_code" ON "public"."user_coupons"("qr_code");

-- CreateIndex
CREATE INDEX "idx_user_coupons_status" ON "public"."user_coupons"("status");

-- CreateIndex
CREATE INDEX "idx_user_coupons_user_id" ON "public"."user_coupons"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_loyalty_current_points" ON "public"."user_loyalty"("current_points");

-- CreateIndex
CREATE INDEX "idx_user_loyalty_tier_id" ON "public"."user_loyalty"("tier_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_user_profiles_membership_id" ON "public"."user_profiles"("membership_id");

-- CreateIndex
CREATE INDEX "idx_user_profiles_user_id" ON "public"."user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_users_email" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "idx_users_oauth_provider_id" ON "public"."users"("oauth_provider", "oauth_provider_id");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "public"."users"("role");

-- AddForeignKey
ALTER TABLE "public"."account_link_requests" ADD CONSTRAINT "account_link_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."account_link_requests" ADD CONSTRAINT "account_link_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."account_linking_audit" ADD CONSTRAINT "account_linking_audit_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."account_link_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."account_linking_audit" ADD CONSTRAINT "account_linking_audit_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."account_linking_audit" ADD CONSTRAINT "account_linking_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."coupon_analytics" ADD CONSTRAINT "coupon_analytics_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_coupon_id_fkey" FOREIGN KEY ("user_coupon_id") REFERENCES "public"."user_coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."coupon_translations" ADD CONSTRAINT "coupon_translations_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."coupons" ADD CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."feature_toggle_audit" ADD CONSTRAINT "feature_toggle_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."feature_toggle_audit" ADD CONSTRAINT "feature_toggle_audit_feature_toggle_id_fkey" FOREIGN KEY ("feature_toggle_id") REFERENCES "public"."feature_toggles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."feature_toggles" ADD CONSTRAINT "feature_toggles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."feature_toggles" ADD CONSTRAINT "feature_toggles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "linked_accounts_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "linked_accounts_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."linked_accounts" ADD CONSTRAINT "linked_accounts_primary_user_id_fkey" FOREIGN KEY ("primary_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."points_transactions" ADD CONSTRAINT "points_transactions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."points_transactions" ADD CONSTRAINT "points_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_coupon_assignments" ADD CONSTRAINT "survey_coupon_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_coupon_assignments" ADD CONSTRAINT "survey_coupon_assignments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_coupon_assignments" ADD CONSTRAINT "survey_coupon_assignments_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_invitations" ADD CONSTRAINT "survey_invitations_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_invitations" ADD CONSTRAINT "survey_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_responses" ADD CONSTRAINT "survey_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_survey_coupon_assignment_id_fkey" FOREIGN KEY ("survey_coupon_assignment_id") REFERENCES "public"."survey_coupon_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_survey_response_id_fkey" FOREIGN KEY ("survey_response_id") REFERENCES "public"."survey_responses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_user_coupon_id_fkey" FOREIGN KEY ("user_coupon_id") REFERENCES "public"."user_coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_reward_history" ADD CONSTRAINT "survey_reward_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."survey_translations" ADD CONSTRAINT "survey_translations_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."surveys" ADD CONSTRAINT "surveys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."translation_jobs" ADD CONSTRAINT "translation_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_audit_log" ADD CONSTRAINT "user_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_used_by_admin_fkey" FOREIGN KEY ("used_by_admin") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_coupons" ADD CONSTRAINT "user_coupons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_loyalty" ADD CONSTRAINT "user_loyalty_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_loyalty" ADD CONSTRAINT "user_loyalty_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

