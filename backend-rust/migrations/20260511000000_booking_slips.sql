-- =====================================================
-- Migration: booking_slips (canonical schema)
-- =====================================================
-- Records payment slip uploads against a booking, plus the SlipOK and admin
-- review workflow columns. A single booking may accumulate multiple slips
-- (e.g. a deposit slip and a balance slip), so each row has its own primary
-- key rather than attaching a `slip_url` column to `bookings`.
--
-- The slip URL itself is produced by `POST /api/slips/upload`, which writes
-- the file to `/storage/slips/<uuid>.<ext>` and returns the path. This table
-- links those URLs to the booking they were uploaded against, who uploaded
-- them, and the verification state (SlipOK auto-verification + admin
-- review).
--
-- This migration is the canonical definition of the `booking_slips` table.
-- It was produced by reconciling the on-disk Rust migration with the schema
-- already deployed to production (which originated from a Prisma migration
-- that was never copied into this repo). The migration row at
-- `20260511000000` was inserted by a previous deploy with a partial body, so
-- production will NOT re-execute this file; the rewrite only takes effect on
-- fresh databases (e2e, local dev, tests) — and there it must reproduce the
-- production schema exactly so that compile-time sqlx queries validate
-- against the same shape they will see in prod.
--
-- Required extensions (`uuid-ossp` for `uuid_generate_v4()`) are created by
-- `20240101000000_init.sql`, which runs first.
-- =====================================================

-- ----- Table ------------------------------------------------------------

CREATE TABLE "public"."booking_slips" (
    "id"                 UUID                     NOT NULL DEFAULT uuid_generate_v4(),
    "booking_id"         UUID                     NOT NULL,
    "slip_url"           TEXT                     NOT NULL,
    "uploaded_by"        UUID                     NOT NULL,
    "uploaded_at"        TIMESTAMP WITH TIME ZONE          DEFAULT CURRENT_TIMESTAMP,
    "slipok_status"      VARCHAR(20)                       DEFAULT 'pending',
    "slipok_verified_at" TIMESTAMP WITH TIME ZONE,
    "slipok_response"    JSONB,
    "admin_status"       VARCHAR(20)                       DEFAULT 'pending',
    "admin_verified_at"  TIMESTAMP WITH TIME ZONE,
    "admin_verified_by"  UUID,
    "admin_notes"        TEXT,
    "is_primary"         BOOLEAN                           DEFAULT false,
    "created_at"         TIMESTAMP WITH TIME ZONE          DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP WITH TIME ZONE          DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_slips_pkey" PRIMARY KEY ("id")
);

-- ----- Foreign keys -----------------------------------------------------
-- booking_id: cascade deletes — slips are meaningless without the parent
-- booking. uploaded_by / admin_verified_by have NO cascade (matches
-- production); deleting a user is rare and we want a FK error rather than
-- silent data loss in the slip audit trail.

ALTER TABLE "public"."booking_slips"
    ADD CONSTRAINT "booking_slips_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id")
    ON DELETE CASCADE;

ALTER TABLE "public"."booking_slips"
    ADD CONSTRAINT "booking_slips_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id");

ALTER TABLE "public"."booking_slips"
    ADD CONSTRAINT "booking_slips_admin_verified_by_fkey"
    FOREIGN KEY ("admin_verified_by") REFERENCES "public"."users"("id");

-- ----- Indexes ----------------------------------------------------------

CREATE INDEX "idx_booking_slips_booking_id"
    ON "public"."booking_slips" ("booking_id");

CREATE INDEX "idx_booking_slips_uploaded_by"
    ON "public"."booking_slips" ("uploaded_by");

CREATE INDEX "idx_booking_slips_uploaded_at"
    ON "public"."booking_slips" ("uploaded_at" DESC);

CREATE INDEX "idx_booking_slips_slipok_status"
    ON "public"."booking_slips" ("slipok_status");

CREATE INDEX "idx_booking_slips_admin_status"
    ON "public"."booking_slips" ("admin_status");

-- ----- updated_at trigger -----------------------------------------------
-- Keeps `updated_at` in sync on every UPDATE without the application having
-- to remember. Matches the function body deployed in production
-- (verified via `\sf update_booking_slips_updated_at`).

CREATE OR REPLACE FUNCTION public.update_booking_slips_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER booking_slips_updated_at
    BEFORE UPDATE ON "public"."booking_slips"
    FOR EACH ROW
    EXECUTE FUNCTION public.update_booking_slips_updated_at();
