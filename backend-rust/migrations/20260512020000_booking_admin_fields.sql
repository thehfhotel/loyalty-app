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
-- No `IF NOT EXISTS` / DO blocks: this is the first time these columns
-- and the audit table appear in any environment, so a plain `ADD COLUMN`
-- / `CREATE TABLE` is correct and any "already exists" outcome here
-- would indicate a deploy-order bug worth surfacing.
-- =====================================================

-- ----- Add admin-only columns to bookings ------------------------------

ALTER TABLE "public"."bookings"
    ADD COLUMN "discount_amount" DECIMAL(10, 2),
    ADD COLUMN "discount_reason" TEXT,
    ADD COLUMN "admin_notes"     TEXT,
    ADD COLUMN "payment_type"    VARCHAR(20),
    ADD COLUMN "payment_amount"  DECIMAL(10, 2);

-- Constrain payment_type to known values. NULL allowed (legacy rows /
-- bookings that haven't gone through the new payment flow yet).
ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "chk_bookings_payment_type"
    CHECK (payment_type IS NULL OR payment_type IN ('full', 'deposit'));

-- Constrain discount to non-negative. NULL = "no discount applied".
ALTER TABLE "public"."bookings"
    ADD CONSTRAINT "chk_bookings_discount_amount_nonneg"
    CHECK (discount_amount IS NULL OR discount_amount >= 0);

-- ----- booking_audit_log table -----------------------------------------

CREATE TABLE "public"."booking_audit_log" (
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

ALTER TABLE "public"."booking_audit_log"
    ADD CONSTRAINT "booking_audit_log_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id")
    ON DELETE CASCADE;

ALTER TABLE "public"."booking_audit_log"
    ADD CONSTRAINT "booking_audit_log_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id");

CREATE INDEX "idx_booking_audit_log_booking_id"
    ON "public"."booking_audit_log" ("booking_id");

CREATE INDEX "idx_booking_audit_log_occurred_at"
    ON "public"."booking_audit_log" ("occurred_at" DESC);
