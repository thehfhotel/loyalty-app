-- Migration: Add Notifications System
-- Description: Creates notifications and notification_preferences tables
-- This migration adds tables that were missing from the initial baseline

-- =====================================================
-- NOTIFICATIONS SYSTEM
-- =====================================================

-- CreateEnum: notification_type (if not exists)
DO $$ BEGIN
    CREATE TYPE "public"."notification_type" AS ENUM ('info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile', 'tier_change', 'points');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: notifications
CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'info',
    "data" JSONB DEFAULT NULL,
    "read_at" TIMESTAMPTZ(6) DEFAULT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "expires_at" TIMESTAMPTZ(6) DEFAULT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable: notification_preferences
CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_preferences_user_id_type_key" UNIQUE ("user_id", "type")
);

-- AddForeignKeys (only if tables were just created)
DO $$ BEGIN
    ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddConstraints (only if not exists)
DO $$ BEGIN
    ALTER TABLE "public"."notifications" ADD CONSTRAINT "chk_notification_type"
        CHECK (type IN ('info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile', 'tier_change', 'points'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "chk_notification_preference_type"
        CHECK (type IN ('info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile', 'tier_change', 'points', 'email', 'push'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateIndex: notifications (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "public"."notifications"("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread" ON "public"."notifications"("user_id", "read_at") WHERE "read_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_notifications_created_at" ON "public"."notifications"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_notifications_type" ON "public"."notifications"("type");
CREATE INDEX IF NOT EXISTS "idx_notifications_expires_at" ON "public"."notifications"("expires_at") WHERE "expires_at" IS NOT NULL;

-- CreateIndex: notification_preferences (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "idx_notification_preferences_user_id" ON "public"."notification_preferences"("user_id");
CREATE INDEX IF NOT EXISTS "idx_notification_preferences_type" ON "public"."notification_preferences"("type");

-- CreateFunction: cleanup_expired_notifications
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications
    WHERE expires_at IS NOT NULL AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_notifications() IS 'Removes expired notifications and returns count of deleted rows';

-- CreateFunction: mark_all_notifications_read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE notifications
    SET read_at = NOW(), updated_at = NOW()
    WHERE user_id = target_user_id AND read_at IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_all_notifications_read(UUID) IS 'Marks all unread notifications as read for a specific user';

-- CreateFunction: get_unread_notification_count
CREATE OR REPLACE FUNCTION get_unread_notification_count(target_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM notifications
        WHERE user_id = target_user_id
        AND read_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_unread_notification_count(UUID) IS 'Returns count of unread, non-expired notifications for a user';
