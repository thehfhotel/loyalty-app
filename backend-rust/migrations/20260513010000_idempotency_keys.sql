-- =====================================================
-- Migration: idempotency_keys table
-- =====================================================
-- Backs the `Idempotency-Key` header handling for mutation endpoints
-- that must not double-execute on retry. See
-- `docs/audits/correctness-2026-05-13.md` (CRITICAL #3 and HIGH #5).
--
-- ## Why a dedicated table
--
-- - Strict per-admin scoping: the primary key `(admin_id, key)` means
--   two different admins can reuse the same client-generated UUID
--   without collision, while the same admin's retry of the same UUID
--   gets the cached response.
-- - Cached response body: storing `response_body` lets the second
--   call return byte-for-byte the same JSON the first call returned,
--   so clients can't tell whether they hit the cache or the original
--   write — which is the whole point of idempotency.
-- - TTL via `created_at` index: the cleanup is left to ops infra
--   (`pg_cron` or a scheduled DELETE), keeping this migration
--   schema-only and side-effect-free.
--
-- ## Why `admin_id` not `user_id`
--
-- The first consumers are admin-initiated awards (`POST
-- /api/loyalty/award`) and booking-slip uploads (`POST
-- /api/bookings/:id/slips`). Both are gated on an authenticated user
-- id, which can be either the customer or an admin — calling the
-- column `admin_id` would mislead future readers. Renaming to
-- `user_id` so the same table covers customer-initiated retries
-- (e.g. a future "submit a payment slip with retry" path) without
-- a follow-up migration.
--
-- ## Idempotency
--
-- `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` so a
-- partial-apply followed by re-run is a no-op rather than an error.
-- =====================================================

-- ----- idempotency_keys table ------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "user_id"         UUID                     NOT NULL,
    "key"             TEXT                     NOT NULL,
    "request_path"    TEXT                     NOT NULL,
    "response_status" INTEGER                  NOT NULL,
    "response_body"   BYTEA,
    "created_at"      TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id", "key")
);

-- The FK is intentionally `ON DELETE CASCADE` — removing a user
-- removes their idempotency residue rather than orphaning rows that
-- can never be purged correctly. NO `ON UPDATE CASCADE` since
-- `users.id` is a UUID PK that never changes.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'idempotency_keys_user_id_fkey'
    ) THEN
        ALTER TABLE "public"."idempotency_keys"
            ADD CONSTRAINT "idempotency_keys_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
            ON DELETE CASCADE;
    END IF;
END $$;

-- ----- Index for TTL sweeps --------------------------------------------
-- `pg_cron` (or a scheduled application job) deletes rows older than
-- e.g. 24 hours via `DELETE FROM idempotency_keys WHERE created_at <
-- NOW() - INTERVAL '24 hours'`. The index keeps that sweep O(log n)
-- regardless of the table size.

CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_created_at"
    ON "public"."idempotency_keys" ("created_at");
