-- =====================================================
-- Migration: users.email UNIQUE constraint
-- =====================================================
-- Closes the read-then-insert race in the password registration handler
-- (`routes/auth.rs::register`) and the OAuth provisioning path
-- (`services/oauth.rs::process_*_auth`). Without a uniqueness constraint
-- two concurrent signups can both pass the existence check and insert
-- duplicate rows for the same email. Login then resolves to whichever
-- row Postgres picks first, and loyalty history scatters across both
-- ids. See `docs/audits/correctness-2026-05-13.md` (CRITICAL #1) for
-- the full write-up.
--
-- ## Migration ordering
--
-- The init migration created `idx_users_email` as a plain (non-unique)
-- index. We add a UNIQUE constraint (which Postgres implements as a
-- backing unique index) and drop the redundant non-unique index, since
-- the unique index covers the same equality lookups.
--
-- ## Existing duplicates
--
-- A correct UNIQUE constraint cannot be added to a table that already
-- contains duplicates — the ALTER TABLE will fail loudly. Per the
-- audit, no duplicates exist in our staging or production environments.
-- We still defensively check first and RAISE EXCEPTION with the duplicate
-- emails listed, so the migration fails with a clear, actionable error
-- (rather than the cryptic constraint violation that ALTER TABLE would
-- emit) on the off chance a duplicate slipped in. Operators can then
-- decide how to merge or deactivate the duplicate rows before retrying.
--
-- ## Idempotency
--
-- Wrapped in `IF NOT EXISTS` / `IF EXISTS` guards so a partial-apply
-- followed by re-run doesn't error. The duplicate-detection block is
-- also safe to re-run: it's a pure SELECT that only RAISEs on failure.
-- =====================================================

-- ----- Fail loudly if duplicates exist ---------------------------------

DO $$
DECLARE
    duplicate_count INTEGER;
    duplicate_emails TEXT;
BEGIN
    SELECT COUNT(*), STRING_AGG(email, ', ' ORDER BY email)
    INTO duplicate_count, duplicate_emails
    FROM (
        SELECT LOWER(email) AS email
        FROM users
        WHERE email IS NOT NULL
        GROUP BY LOWER(email)
        HAVING COUNT(*) > 1
    ) dups;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION
            'Cannot add UNIQUE constraint on users.email: % duplicate email(s) found: %. '
            'Merge or deactivate duplicates before re-running this migration.',
            duplicate_count, duplicate_emails;
    END IF;
END $$;

-- ----- Add the UNIQUE constraint ---------------------------------------
-- Postgres creates a backing unique index automatically. Use a DO block
-- with a pg_constraint lookup so re-applying the migration on a partially
-- migrated database is a no-op rather than an error.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_email_unique'
          AND conrelid = '"public"."users"'::regclass
    ) THEN
        ALTER TABLE "public"."users"
            ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
    END IF;
END $$;

-- ----- Drop the now-redundant non-unique index -------------------------
-- The UNIQUE constraint above is backed by an implicit unique index that
-- serves all of `idx_users_email`'s lookups (and rejects duplicates,
-- which the old index did not).

DROP INDEX IF EXISTS "public"."idx_users_email";
