-- =====================================================
-- Migration: one live slip row per image (task F2b)
-- =====================================================
-- `20260912020000_slip_retention_access_log.sql` added a **non-unique**
-- index on `booking_slips.slip_url` and said why:
--
--   > Not UNIQUE, deliberately. A unique index would be the stronger fix for
--   > the shared-file problem, but this table already exists in production
--   > and a migration that fails on pre-existing duplicates would wedge the
--   > deploy. […] Promoting this to UNIQUE is a follow-up for once
--   > production is known clean.
--
-- Production `booking_slips` was verified empty on 2026-09-10, and
-- `routes::bookings::add_booking_slip` has since rejected a URL already
-- attached to a live row with a 409. This is that follow-up.
--
-- ## Why a duplicate matters at all
--
-- Two live rows on one `slip_url` are not a harmless duplicate. They let one
-- guest attach another guest's bank photograph as evidence for their own
-- booking, and they are what made the retention sweep able to unlink a file
-- on behalf of row A while row B carried on claiming the image was present.
--
-- ## Defensive by construction: this migration cannot fail a deploy
--
-- The unique index is created only after a `COUNT` proves there is nothing
-- for it to trip over, and the `CREATE` itself sits in its own
-- `BEGIN … EXCEPTION` sub-transaction so that even a duplicate racing in
-- between degrades to a `NOTICE` rather than an aborted migration. The
-- outcome when duplicates exist is therefore: **skip the unique index, keep
-- the non-unique one, log a NOTICE, and let the deploy continue.** Nothing
-- is deduped, merged or deleted — a row here is payment evidence, and
-- picking which of two to destroy is not a decision a migration gets to
-- make unattended.
--
-- The sweep keeps its own grouping guard regardless
-- (`services::slip_retention`), so a database where this index was skipped
-- is still handled correctly rather than merely being handled by luck.
--
-- ## Why the old index stays
--
-- The predicates differ, and so do their callers.
-- `routes::storage::lookup_slip_ids_by_url` resolves a URL to **every** row
-- pointing at it — including tombstoned ones — on every admin image fetch,
-- and a `WHERE deleted_at IS NULL` index cannot serve that query. Dropping
-- `idx_booking_slips_slip_url` would put that hot path back on a sequential
-- scan, so both indexes stay: one for lookups, one for the constraint.
--
-- ## Idempotency
--
-- Guarded by a `pg_class` existence check and `CREATE UNIQUE INDEX` under an
-- exception handler, per CLAUDE.md: a partial application during a failed
-- deploy must not wedge the next attempt.
-- =====================================================

DO $$
DECLARE
    duplicate_urls BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'uq_booking_slips_slip_url_live'
          AND n.nspname = 'public'
    ) THEN
        RAISE NOTICE 'uq_booking_slips_slip_url_live already exists; nothing to do.';
        RETURN;
    END IF;

    -- Only non-NULL URLs can collide: NULLs are distinct in a btree unique
    -- index, so the tombstoned rows (slip_url NULL, deleted_at set) that the
    -- index predicate happens to exclude anyway could not have clashed
    -- either.
    SELECT COUNT(*) INTO duplicate_urls
    FROM (
        SELECT 1
        FROM "public"."booking_slips"
        WHERE "slip_url" IS NOT NULL
          AND "deleted_at" IS NULL
        GROUP BY "slip_url"
        HAVING COUNT(*) > 1
    ) AS d;

    IF duplicate_urls > 0 THEN
        RAISE NOTICE 'booking_slips holds % slip_url value(s) shared by more than one live row; '
                     'skipping uq_booking_slips_slip_url_live and leaving the non-unique '
                     'idx_booking_slips_slip_url in place. Nothing was deduped or deleted — '
                     'each of those rows is payment evidence. Resolve them by hand, then '
                     're-run this index creation.', duplicate_urls;
        RETURN;
    END IF;

    BEGIN
        EXECUTE 'CREATE UNIQUE INDEX "uq_booking_slips_slip_url_live" '
                'ON "public"."booking_slips" ("slip_url") '
                'WHERE "deleted_at" IS NULL';
        RAISE NOTICE 'Created uq_booking_slips_slip_url_live: one live slip row per image.';
    EXCEPTION
        WHEN unique_violation OR duplicate_table THEN
            -- A duplicate that raced in after the COUNT above, or a
            -- concurrently-created index. Either way the deploy continues on
            -- the non-unique index; the sweep's grouping guard covers it.
            RAISE NOTICE 'Could not create uq_booking_slips_slip_url_live (%); keeping the '
                         'non-unique idx_booking_slips_slip_url.', SQLERRM;
    END;
END
$$;

COMMENT ON COLUMN "public"."booking_slips"."slip_url"
    IS 'Path the upload endpoint returned, e.g. /storage/slips/<uuid>.jpg. NULL once the image has been erased under retention — read it together with deleted_at. Unique across live rows (uq_booking_slips_slip_url_live): one image backs at most one un-tombstoned slip.';
