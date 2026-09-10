-- =====================================================
-- Migration: booking_slips — SlipOK live verification columns
-- =====================================================
-- Records what SlipOK said about a guest-uploaded slip so the automatic
-- check and the admin sidebar read from the same row.
--
-- `slipok_status` vocabulary written by the automatic check
-- (`services/slip_match.rs` + `routes/bookings.rs::run_slipok_check`):
--
--   verified     SlipOK answered, every check passed, and auto-verify was
--                on — the slip was confirmed without an admin.
--   shadow_pass  Every check passed but SLIPOK_AUTO_VERIFY is off, so the
--                slip is still queued for manual verification. This is the
--                calibration state: compare it against what the admin did.
--   manual       SlipOK answered but a check failed. `slipok_reason` is one
--                of: amount_mismatch, receiver_mismatch, duplicate,
--                slip_invalid.
--   unavailable  No usable answer from SlipOK. `slipok_reason` is one of:
--                quota_exceeded, timeout, api_error, not_configured.
--
-- `slipok_status` already exists (VARCHAR(20), DEFAULT 'pending', from
-- `20260511000000_booking_slips.sql`); it is listed here only so a database
-- that somehow lacks it converges. `ADD COLUMN IF NOT EXISTS` makes that a
-- no-op everywhere else, per the idempotent-migration convention in
-- CLAUDE.md.
--
-- The partial unique index on `slipok_trans_ref` is the real duplicate
-- defence: one bank transaction reference can back at most one slip row.
-- NULLs are excluded so the many slips that never reach a SlipOK answer
-- (or fail a check) do not collide with each other.
-- =====================================================

ALTER TABLE "public"."booking_slips"
    ADD COLUMN IF NOT EXISTS "slipok_status"     TEXT,
    ADD COLUMN IF NOT EXISTS "slipok_reason"     TEXT,
    ADD COLUMN IF NOT EXISTS "slipok_trans_ref"  TEXT,
    ADD COLUMN IF NOT EXISTS "slipok_checked_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "booking_slips_slipok_trans_ref_uidx"
    ON "public"."booking_slips" ("slipok_trans_ref")
    WHERE "slipok_trans_ref" IS NOT NULL;
