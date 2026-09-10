-- =====================================================
-- Migration: slip image retention + admin-viewer access log (task F2)
-- =====================================================
-- Two of the P1 gaps in `docs/privacy/2026-09-pdpa-data-map.md` §8 land
-- here, and both are about the same object: a photograph of a bank
-- transfer that frequently carries a *third party's* name and masked
-- account (the payer is often not the guest).
--
-- ## Gap 1 — nothing has ever deleted a slip image
--
-- `STORAGE_PATH/slips/<uuid>.<ext>` is written by `POST /api/slips/upload`
-- and never removed: no job, no route, no `remove_file`. The data map's
-- proposal is 90 days after the booking closes, but the number is the
-- owner's to set, so the sweep is driven by `SLIP_RETENTION_DAYS` and is
-- OFF while that variable is blank or unset.
--
-- When the sweep erases an image it leaves the metadata row intact — the
-- amount, `slipok_trans_ref` and the decision are payment evidence and the
-- duplicate-detection key, and a chargeback question arrives long after
-- the picture stops being useful. So the row gets a tombstone instead of a
-- delete:
--
--   * `slip_url`   -> NULL   (the path no longer resolves to anything)
--   * `deleted_at` -> NOW()
--   * `deletion_reason` -> a short machine key, e.g. `retention_sweep`
--
-- `slip_url` therefore has to lose its NOT NULL. That is the only
-- destructive-looking change in this file and it is deliberate: an empty
-- string would be a path that still looks like a path, and a row deleted
-- outright would put a hole in the audit trail.
--
-- ## Gap 2 — viewing a slip is not recorded anywhere
--
-- `serve_slip` authorises and returns bytes; it writes no audit row
-- (`routes/storage.rs`). Today we cannot answer "who looked at this
-- guest's payer's bank details". `slip_access_log` is that answer: one row
-- per admin-facing read of a slip image or of a response that carries its
-- URL. The guest's own view of their own slip is NOT logged — the point of
-- the table is staff accountability, not surveilling the data subject.
--
-- ## Idempotency
--
-- `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX
-- IF NOT EXISTS` and `DO`-block constraint guards throughout, per
-- CLAUDE.md: a partial application during a failed deploy must not wedge
-- the next attempt. `ALTER COLUMN ... DROP NOT NULL` is idempotent in
-- Postgres on its own.
-- =====================================================

-- ----- slip tombstone ---------------------------------------------------

ALTER TABLE "public"."booking_slips"
    ADD COLUMN IF NOT EXISTS "deleted_at"      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "deletion_reason" TEXT;

ALTER TABLE "public"."booking_slips"
    ALTER COLUMN "slip_url" DROP NOT NULL;

COMMENT ON COLUMN "public"."booking_slips"."slip_url"
    IS 'Path the upload endpoint returned, e.g. /storage/slips/<uuid>.jpg. NULL once the image has been erased under retention — read it together with deleted_at.';

COMMENT ON COLUMN "public"."booking_slips"."deleted_at"
    IS 'When the image file was erased. NULL means the image is still on disk. The metadata row itself is never deleted by retention.';

COMMENT ON COLUMN "public"."booking_slips"."deletion_reason"
    IS 'Why the image was erased: retention_sweep today; a rights-request key (F3) later. Free text by type, a short machine key by convention.';

-- Drives the retention sweep's candidate scan: it only ever looks at rows
-- that still have an image.
CREATE INDEX IF NOT EXISTS "idx_booking_slips_live"
    ON "public"."booking_slips" ("booking_id")
    WHERE "deleted_at" IS NULL;

-- `slip_url` is now a lookup key, and there was no index on it before.
--
-- Two hot callers: `routes::storage::serve_slip` resolves the URL an admin
-- asked for to the row the access log has to name, on every image fetch; and
-- the retention sweep's `NOT EXISTS` shared-file guard asks whether any other
-- live row points at the same file. Both were sequential scans.
--
-- Not UNIQUE, deliberately. A unique index would be the stronger fix for the
-- shared-file problem, but this table already exists in production and a
-- migration that fails on pre-existing duplicates would wedge the deploy.
-- Duplicates are prevented going forward at the API instead
-- (`routes::bookings::add_booking_slip` rejects a URL already attached to a
-- live row), and tolerated safely in the sweep by the `NOT EXISTS` guard.
-- Promoting this to UNIQUE is a follow-up for once production is known clean.
CREATE INDEX IF NOT EXISTS "idx_booking_slips_slip_url"
    ON "public"."booking_slips" ("slip_url")
    WHERE "slip_url" IS NOT NULL;

-- ----- admin-viewer access log ------------------------------------------
--
-- `route` is a stable machine key for the surface that served the slip
-- (e.g. `GET /api/storage/slips/:filename`), not the literal request line:
-- the literal path contains the slip UUID, and this table already names
-- the slip in its own column.
--
-- `request_id` ties a row back to the request's log lines. Nullable
-- because the header is client-supplied and a request may not carry one.

CREATE TABLE IF NOT EXISTS "public"."slip_access_log" (
    "id"          UUID        NOT NULL DEFAULT uuid_generate_v4(),
    "slip_id"     UUID,
    "admin_id"    UUID        NOT NULL,
    "route"       TEXT        NOT NULL,
    "accessed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "request_id"  TEXT,

    CONSTRAINT "slip_access_log_pkey" PRIMARY KEY ("id")
);

-- `CREATE TABLE IF NOT EXISTS` is a no-op against a table left behind by an
-- earlier partial run, so any column added to this file later needs its own
-- `ADD COLUMN IF NOT EXISTS` guard rather than an edit to the block above.

-- `slip_id` is NULLABLE and the FK is ON DELETE SET NULL, not CASCADE.
--
-- `DELETE /api/bookings/slips/:slip_id` is a hard delete of the row, and
-- `booking_slips` itself cascades from `bookings`. Under CASCADE, deleting
-- either would silently take the access history with it — so the one action
-- most likely to follow a complaint about a slip is the action that erases
-- the record of who read it. That is the opposite of what an audit table is
-- for.
--
-- SET NULL rather than making the guest's delete a soft delete: that endpoint
-- is a guest-facing behaviour with its own tests and semantics, and quietly
-- changing what DELETE means is a bigger and less reviewable change than
-- letting an audit row outlive its subject. An orphaned row still answers
-- "this admin read a slip at this time"; it simply no longer names which,
-- which also means it holds nothing about the guest at all.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'slip_access_log_slip_id_fkey'
          AND conrelid = '"public"."slip_access_log"'::regclass
    ) THEN
        ALTER TABLE "public"."slip_access_log"
            ADD CONSTRAINT "slip_access_log_slip_id_fkey"
            FOREIGN KEY ("slip_id") REFERENCES "public"."booking_slips"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

-- admin_id does NOT cascade, matching `booking_audit_log`: the record of
-- who read a guest's banking photograph must survive that admin's account
-- being removed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'slip_access_log_admin_id_fkey'
          AND conrelid = '"public"."slip_access_log"'::regclass
    ) THEN
        ALTER TABLE "public"."slip_access_log"
            ADD CONSTRAINT "slip_access_log_admin_id_fkey"
            FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id")
            ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_slip_access_log_slip_id"
    ON "public"."slip_access_log" ("slip_id", "accessed_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_slip_access_log_admin_id"
    ON "public"."slip_access_log" ("admin_id", "accessed_at" DESC);

COMMENT ON TABLE "public"."slip_access_log"
    IS 'One row per admin-facing read of a slip image or of a response carrying its URL (PDPA data map §8 gap 2). The guest reading their own slip is deliberately not logged.';

COMMENT ON COLUMN "public"."slip_access_log"."slip_id"
    IS 'The slip that was read. NULL only when that booking_slips row was later hard-deleted (ON DELETE SET NULL): the record of the read outlives its subject rather than vanishing with it.';

COMMENT ON COLUMN "public"."slip_access_log"."route"
    IS 'Stable machine key for the surface that served the slip, e.g. GET /api/storage/slips/:filename. Never the literal request line.';
