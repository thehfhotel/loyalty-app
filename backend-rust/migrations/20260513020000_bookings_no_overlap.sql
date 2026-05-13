-- =====================================================
-- Migration: bookings overlap-exclusion constraint
-- =====================================================
-- Closes the TOCTOU race in `routes/bookings.rs::insert_booking`. The
-- old code did SELECT-available-rooms then INSERT-booking on the pool
-- with no transaction and no row-level locking, so two concurrent
-- requests for overlapping dates could both observe the same room as
-- free and both insert. See `docs/audits/correctness-2026-05-13.md`
-- (CRITICAL #2) for the full write-up.
--
-- ## Why an EXCLUDE constraint
--
-- A SERIALIZABLE-style transaction with `SELECT ... FOR UPDATE` on the
-- candidate room would also close the race, but it requires every code
-- path that inserts into `bookings` to follow the same locking
-- discipline — easy to regress when a new endpoint is added. An
-- `EXCLUDE USING gist` constraint is enforced atomically by Postgres
-- on every INSERT/UPDATE regardless of the application path, which is
-- the same defense-in-depth shape we apply to UNIQUE constraints.
--
-- The constraint says: no two non-cancelled bookings may share the
-- same `room_id` while their `[check_in_date, check_out_date)` date
-- ranges overlap. The half-open range `[...)` matches the application
-- semantics — checking out on the same day a new guest checks in is
-- allowed.
--
-- ## Required extension: btree_gist
--
-- The standard `gist` operator class covers ranges out of the box, but
-- the equality match on `room_id` (a UUID — therefore a btree type)
-- requires `btree_gist` so the same index can compare both `=` for UUID
-- and `&&` for daterange.
--
-- ## Cancelled bookings
--
-- The partial `WHERE (status NOT IN (...))` clause lets a cancelled
-- booking and a new confirmed one coexist for the same room on the
-- same dates, matching the existing application logic at
-- `routes/bookings.rs:909-917` (which already excludes cancelled rows
-- from the availability subquery).
--
-- ## Idempotency
--
-- `CREATE EXTENSION IF NOT EXISTS` and a `pg_constraint` lookup so a
-- partial-apply followed by re-run is a no-op rather than an error.
-- =====================================================

-- ----- Required extension ----------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----- Overlap-exclusion constraint ------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bookings_no_overlap'
          AND conrelid = '"public"."bookings"'::regclass
    ) THEN
        ALTER TABLE "public"."bookings"
            ADD CONSTRAINT "bookings_no_overlap"
            EXCLUDE USING gist (
                room_id WITH =,
                daterange(check_in_date, check_out_date, '[)') WITH &&
            )
            WHERE (status NOT IN ('cancelled', 'no_show'));
    END IF;
END $$;
