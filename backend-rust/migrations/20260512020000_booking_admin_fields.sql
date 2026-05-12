-- =====================================================
-- Migration: booking admin fields + booking_audit_log
-- =====================================================
-- Adds the columns the admin booking management UI edits but the original
-- `bookings` schema does not expose, plus a new `booking_audit_log` table
-- so every admin-initiated change has a durable, queryable trail.
--
-- ## Why this is additive
--
-- The original `bookings` table tracks the booking itself (dates, room,
-- price, status). The admin UI in BookingEditModal.tsx layers on top of
-- that:
--   - discount management (`discount_amount`, `discount_reason`)
--   - internal staff notes separate from the guest's `notes`
--     (`admin_notes`)
--   - explicit payment_type / payment_amount split, currently inferred at
--     read time. Persisting it lets the modal show what the admin set
--     last rather than re-computing from totals.
--
-- These are additive columns: all NULL-defaulted so existing rows keep
-- their meaning, and every read path that doesn't know about them simply
-- ignores them.
--
-- ## booking_audit_log design
--
-- A separate table (rather than e.g. a JSONB column on bookings) so that:
--   - The audit row outlives partial booking edits (one booking, many
--     audit rows — bookings 1..N : N audit rows).
--   - Indexing on `booking_id` makes the per-booking history fetch O(log n)
--     instead of having to slice a JSONB array on every read.
--   - `before_data` / `after_data` JSONB captures whichever subset of
--     fields the action touched, so we don't have to migrate the audit
--     schema every time we add a new editable booking column.
--   - `ON DELETE CASCADE` from `bookings(id)` means deleting a booking
--     cleans up its audit. `admin_id` does NOT cascade — we want the
--     audit to survive admin user deletions.
--
-- The `action` column is a free-text TEXT (not an enum) so adding new
-- audit actions (e.g. 'slip_verified') in a future PR doesn't require
-- a schema migration.
--
-- Originally written without idempotency on the assumption that the
-- migration runs exactly once. In practice, sqlx does not wrap a
-- migration in a transaction by default, so a partial application
-- (mid-file failure) leaves earlier statements in place and the next
-- deploy attempt sees "column already exists" errors. Make the
-- column adds and table creation idempotent.
-- =====================================================

-- ----- Add admin-only columns to bookings ------------------------------

ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS "discount_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "admin_notes"     TEXT,
    ADD COLUMN IF NOT EXISTS "payment_type"    VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "payment_amount"  DECIMAL(10, 2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_bookings_payment_type'
    ) THEN
        ALTER TABLE "public"."bookings"
            ADD CONSTRAINT "chk_bookings_payment_type"
            CHECK (payment_type IS NULL OR payment_type IN ('full', 'deposit'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_bookings_discount_amount_nonneg'
    ) THEN
        ALTER TABLE "public"."bookings"
            ADD CONSTRAINT "chk_bookings_discount_amount_nonneg"
            CHECK (discount_amount IS NULL OR discount_amount >= 0);
    END IF;
END $$;

-- ----- booking_audit_log table -----------------------------------------

CREATE TABLE IF NOT EXISTS "public"."booking_audit_log" (
    "id"          UUID                     NOT NULL DEFAULT gen_random_uuid(),
    "booking_id"  UUID                     NOT NULL,
    "admin_id"    UUID                     NOT NULL,
    "action"      TEXT                     NOT NULL,
    "before_data" JSONB,
    "after_data"  JSONB,
    "reason"      TEXT,
    "occurred_at" TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

    CONSTRAINT "booking_audit_log_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'booking_audit_log_booking_id_fkey'
    ) THEN
        ALTER TABLE "public"."booking_audit_log"
            ADD CONSTRAINT "booking_audit_log_booking_id_fkey"
            FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id")
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'booking_audit_log_admin_id_fkey'
    ) THEN
        ALTER TABLE "public"."booking_audit_log"
            ADD CONSTRAINT "booking_audit_log_admin_id_fkey"
            FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_booking_audit_log_booking_id"
    ON "public"."booking_audit_log" ("booking_id");

CREATE INDEX IF NOT EXISTS "idx_booking_audit_log_occurred_at"
    ON "public"."booking_audit_log" ("occurred_at" DESC);
