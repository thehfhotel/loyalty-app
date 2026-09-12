-- =====================================================
-- Migration: drop the legacy `booking_slips.slipok_verified_at` column
-- =====================================================
-- The column was created by `20260511000000_booking_slips.sql` and never
-- written to. When the automatic SlipOK check landed
-- (`20260910000000_booking_slips_slipok.sql`) it recorded its timestamp in
-- the new `slipok_checked_at` instead, so `slipok_verified_at` has been
-- NULL on every row of every environment since the table existed.
--
-- It survived this long only because the admin slip response still carried
-- it: `routes/admin_slips.rs` documented it as "Legacy, always null … kept
-- on the response only until A6's sidebar stops reading it; drop it then,
-- along with the column." A6 (#443) shipped and its sidebar still read the
-- field as a fallback for the check time — a fallback that could never
-- fire, because the value was always NULL. That fallback is gone now, and
-- with it the last reader, so the column goes too.
--
-- `slipok_checked_at` is the one timestamp for "when the machine last
-- decided about this slip". Nothing is lost: there is no data in the
-- column to migrate anywhere.
--
-- Idempotent by the directory's convention (`IF EXISTS`), so a partial
-- application during a failed deploy does not wedge the next attempt.
-- =====================================================

ALTER TABLE "public"."booking_slips"
    DROP COLUMN IF EXISTS "slipok_verified_at";
