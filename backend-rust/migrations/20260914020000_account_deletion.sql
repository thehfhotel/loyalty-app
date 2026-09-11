-- =====================================================
-- Migration: real account deletion (PDPA F3, gap P1-3)
-- =====================================================
-- `docs/privacy/2026-09-pdpa-data-map.md` §6 "Deletion today" and §8 gap
-- P1-3: `DELETE /api/users/account` set `is_active = false` and nothing
-- else. Every identifier survived, so a "deleted" member was still a
-- resolvable push target (`users.oauth_provider_id` + the `line_friendships`
-- rows keyed on the same LINE userId), and the next LINE/Google login
-- matched the same row and silently resurrected the account.
--
-- This migration gives the backend the three things a real erase needs:
--
--   1. `users.deleted_at` — the tombstone. The row survives (bookings,
--      slips, points transactions and audit rows stay attributable by
--      `user_id`), the identifiers on it do not.
--   2. Two views — `push_targets` and `login_identities` — so "exclude
--      deleted users" is a property of the *relation* rather than a
--      filter every caller has to remember. A new push or login query
--      that forgets the predicate is now a query against the wrong
--      object, which is reviewable; a missing `AND deleted_at IS NULL`
--      is not.
--   3. `user_deletions` — the audit row. Who asked, when, what was
--      anonymised, and how many push rows were severed. **No personal
--      data**: the provider *name* ('line'/'google') is kept, the
--      provider *id* is exactly what we just destroyed and is never
--      written here.
--
-- Idempotent by convention (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF
-- NOT EXISTS`, `CREATE OR REPLACE VIEW`, `DO`-block constraint guards).
-- =====================================================

-- ----- 1. The tombstone column ---------------------------------------

ALTER TABLE "public"."users"
    ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

COMMENT ON COLUMN "public"."users"."deleted_at"
    IS 'Set by the erasure path (services::account_deletion). Non-NULL means every identifier on this row and on user_profiles has been destroyed: email, password_hash, oauth_provider, oauth_provider_id, name, phone, date of birth, avatar. The row itself is kept so bookings, booking_slips, points_transactions and the audit logs stay attributable by user id. Distinct from is_active = false, which is a reversible admin deactivation.';

-- Erased rows are the rare case; a partial index keeps the sweep cheap
-- without paying for the 99% of rows where the column is NULL.
CREATE INDEX IF NOT EXISTS "idx_users_deleted_at"
    ON "public"."users"("deleted_at")
    WHERE "deleted_at" IS NOT NULL;

-- ----- 2. The deletion audit table -----------------------------------
-- Deliberately NOT foreign-keyed to `users`. The audit must outlive any
-- future hard delete of the user row — a FK with ON DELETE CASCADE would
-- erase the proof that an erasure happened, which is the one row PDPA
-- s.30-s.33 accountability actually needs us to keep.

CREATE TABLE IF NOT EXISTS "public"."user_deletions" (
    "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                  UUID NOT NULL,
    -- NULL for a self-service deletion; the admin's id when an admin ran it.
    "requested_by"             UUID,
    "actor"                    VARCHAR(20) NOT NULL,
    "deleted_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    -- Names of the columns that were nulled/blanked, e.g.
    -- {users.email, users.oauth_provider_id, user_profiles.phone}. Field
    -- names only — never the values that were in them.
    "anonymised_fields"        TEXT[] NOT NULL DEFAULT '{}',
    -- The provider *name* only ('line' / 'google' / NULL for a password
    -- account). The provider id is what this deletion destroyed and is
    -- never recorded.
    "oauth_provider"           VARCHAR(50),
    "line_friendships_severed" INTEGER NOT NULL DEFAULT 0,
    "refresh_tokens_revoked"   INTEGER NOT NULL DEFAULT 0,
    "notifications_purged"     INTEGER NOT NULL DEFAULT 0,
    "audit_rows_depersonalised" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_deletions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_user_deletions_actor'
          AND conrelid = '"public"."user_deletions"'::regclass
    ) THEN
        ALTER TABLE "public"."user_deletions"
            ADD CONSTRAINT "chk_user_deletions_actor"
            CHECK ("actor" IN ('self', 'admin'));
    END IF;
END $$;

-- One erasure per user. This is what makes DELETE /api/users/account
-- idempotent at the database level rather than by convention: a repeat
-- call finds `deleted_at` already set and writes nothing, and if two
-- requests race, the loser's INSERT is rejected instead of producing a
-- second audit row claiming a second erasure.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_deletions_user_id"
    ON "public"."user_deletions"("user_id");

COMMENT ON TABLE "public"."user_deletions"
    IS 'PDPA erasure audit (F3). One row per erased account: who asked, when, which fields were anonymised, how many push/session rows were severed. Contains no personal data by construction — see the column comments.';

-- ----- 3a. push_targets: the only relation push may resolve against ---
-- Every code path that turns a user id into somewhere a message can be
-- delivered reads this view, never `users` directly. Two exclusions:
--
--   * `deleted_at IS NULL`  — an erased member is not a person we hold
--     a channel for any more (PDPA erasure). This is the one this
--     migration exists for.
--   * `is_active`           — an admin-deactivated account cannot log
--     in; pushing to it was always wrong, and routing dispatch through
--     this view closes that too. COALESCE because `users.is_active` is
--     nullable with a DEFAULT.
--
-- Columns deliberately mirror `users` (`id`, not `user_id`) so switching
-- a dispatch query over is a one-word change to its FROM clause and
-- nothing else — the smaller the diff, the harder it is to get wrong.
-- `oauth_provider_id` stays nullable: a password-only account is a
-- legitimate row here with no LINE identity, and callers filter on
-- `oauth_provider`.

CREATE OR REPLACE VIEW "public"."push_targets" AS
SELECT
    u."id",
    u."email",
    u."role",
    u."is_active",
    u."oauth_provider",
    u."oauth_provider_id"
FROM "public"."users" u
WHERE u."deleted_at" IS NULL
  AND COALESCE(u."is_active", TRUE);

COMMENT ON VIEW "public"."push_targets"
    IS 'The only relation a push/notification/transactional-email dispatch may resolve a delivery identity from. Excludes erased (users.deleted_at) and deactivated (is_active = false) accounts by construction, so a dispatch query cannot forget the predicate. Readers: services/line.rs push_to_member, routes/admin.rs broadcast_notification, routes/auth.rs forgot_password. See docs/privacy/2026-09-pdpa-data-map.md §6.';

-- ----- 3b. login_identities: the only relation login may resolve against
-- Deliberately does NOT filter `is_active`: a deactivated user must still
-- resolve so the login path can answer "this account is deactivated"
-- rather than silently provisioning a duplicate. An *erased* user must
-- NOT resolve — that is the point. A LINE/Google login with the same
-- provider id after an erasure finds nothing and creates a brand-new
-- account with a brand-new user id.
--
-- Belt and braces: the erase also nulls `email`, `oauth_provider` and
-- `oauth_provider_id`, so the lookups cannot match even if a future
-- query goes around this view. The view makes the intent explicit and
-- testable; the nulling makes it true regardless.

CREATE OR REPLACE VIEW "public"."login_identities" AS
SELECT
    u."id",
    u."email",
    u."password_hash",
    u."role",
    u."is_active",
    u."email_verified",
    u."created_at",
    u."updated_at",
    u."oauth_provider",
    u."oauth_provider_id"
FROM "public"."users" u
WHERE u."deleted_at" IS NULL;

COMMENT ON VIEW "public"."login_identities"
    IS 'The only relation the OAuth/password login paths may resolve an existing account from. Excludes erased accounts (users.deleted_at) so a login with a previously-used provider id provisions a NEW user id rather than resurrecting the erased one. Keeps is_active rows visible on purpose, so a deactivated account still reports as deactivated instead of being duplicated.';
