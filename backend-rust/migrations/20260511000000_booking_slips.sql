-- =====================================================
-- Migration: booking_slips
-- =====================================================
-- Adds a table to record payment slips uploaded against a booking.
--
-- A single booking can accumulate multiple slips (e.g. a deposit slip and a
-- balance slip), which is why each row has its own primary key rather than
-- attaching a `slip_url` column to `bookings`.
--
-- The slip URL itself is produced by `POST /api/slips/upload`, which writes the
-- file to `/storage/slips/<uuid>.<ext>` and returns the path. This table just
-- links those URLs to the booking they were uploaded for, along with who
-- uploaded them and when.
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."booking_slips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "slip_url" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "booking_slips_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."booking_slips" ADD CONSTRAINT "booking_slips_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."booking_slips" ADD CONSTRAINT "booking_slips_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "idx_booking_slips_booking_id"
    ON "public"."booking_slips" ("booking_id");

CREATE INDEX IF NOT EXISTS "idx_booking_slips_uploaded_at"
    ON "public"."booking_slips" ("uploaded_at" DESC);
