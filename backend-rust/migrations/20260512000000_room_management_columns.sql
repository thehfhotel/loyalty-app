-- =====================================================
-- Migration: room management columns
-- =====================================================
-- Adds the missing columns the admin room/room-type management UI expects.
-- The original room_types/rooms tables (init.sql) only modelled what the
-- public booking flow needed; the admin management pages send a richer
-- payload (bed type, amenities list, image URLs, presentation order, room
-- notes) that the writes side of this surface depends on.
--
-- This is an additive migration: every new column is nullable or has a
-- safe default, so existing rows in staging/production remain valid.
-- =====================================================

-- ----- room_types -------------------------------------------------------
-- bed_type: matches the BED_TYPE_OPTIONS list in RoomTypeManagement.tsx
--   ('single' | 'double' | 'twin' | 'king'). Nullable because legacy room
--   types were created without one; the frontend renders '-' for null.
--   A CHECK constraint keeps the value set finite without introducing a
--   PostgreSQL ENUM type (which is awkward to evolve).
-- amenities, images: stored as text[]. The frontend sends/receives JSON
--   string arrays (`string[]`), which sqlx round-trips to PG arrays
--   natively; using JSONB would force the client to read/write `Value`
--   and gain nothing here — every element is a plain string.
-- sort_order: integer, defaults to 0. Used by the list endpoint to give
--   admins a stable, deterministic ordering they control without renaming
--   the room types.
-- IF NOT EXISTS on each ADD COLUMN so re-running this migration after a
-- partial application (sqlx doesn't wrap migrations in a transaction by
-- default — a mid-statement failure leaves earlier columns in place)
-- succeeds without manual cleanup. The check constraint and index are
-- guarded the same way.
ALTER TABLE "public"."room_types"
    ADD COLUMN IF NOT EXISTS "bed_type"   VARCHAR(16),
    ADD COLUMN IF NOT EXISTS "amenities"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "images"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_room_types_bed_type'
    ) THEN
        ALTER TABLE "public"."room_types"
            ADD CONSTRAINT "chk_room_types_bed_type"
            CHECK (bed_type IS NULL OR bed_type IN ('single', 'double', 'twin', 'king'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_room_types_sort_order"
    ON "public"."room_types" ("sort_order", LOWER("name"));

-- ----- rooms ------------------------------------------------------------
ALTER TABLE "public"."rooms"
    ADD COLUMN IF NOT EXISTS "notes" TEXT;
