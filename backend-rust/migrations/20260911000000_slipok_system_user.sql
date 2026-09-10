-- =====================================================
-- Migration: the SlipOK system actor
-- =====================================================
-- `booking_audit_log.admin_id` is `UUID NOT NULL` with an FK to `users`,
-- so before this migration an automatic slip verification could not be
-- audited at all: `services::slip_confirm::confirm_slip` skipped the audit
-- row entirely when it ran with no admin behind it, and logged a
-- `tracing::info!` instead. A money decision with no row in the audit
-- table is not auditable, and it is what makes the "how many verifies did
-- a human touch" number countable at all.
--
-- This seeds ONE fixed, named user row that the automatic path attributes
-- itself to. The id is a constant, not a lookup: it is compiled into the
-- backend as `services::slip_confirm::SLIPOK_SYSTEM_USER_ID` and is part
-- of the cross-repo interface for this program, so it must never be
-- regenerated.
--
--   id     00000000-0000-4000-8000-0000005110b0
--   email  slipok@system.hf.invalid
--   name   SlipOK   (in `user_profiles.first_name` — `users` has no name
--                    column, and the admin audit-history panel renders
--                    `user_profiles` first/last name, falling back to the
--                    email; without a profile row the desk would read
--                    "slipok@system.hf.invalid" against every automatic
--                    verify)
--
-- ## Why it can never log in
--
-- Four independent guards, because this row carries the `admin` role:
--
--   1. `is_active = false`. Every authentication path requires an active
--      row — password login (`routes::auth::login`), the refresh path, and
--      the Cloudflare Access admin exchange (`routes::auth::cf_exchange`,
--      `... AND role::text IN ('admin','super_admin') AND is_active`).
--   2. `password_hash IS NULL`. Password login rejects a row with no hash
--      before it ever reaches the verifier.
--   3. `oauth_provider IS NULL` / `oauth_provider_id IS NULL`. The OAuth
--      provisioning path matches on `(oauth_provider, oauth_provider_id)`
--      and then on email; neither can ever match, because
--   4. the email sits under `.invalid` (RFC 2606), a TLD that is
--      guaranteed never to resolve, so no identity provider — Google,
--      LINE or Cloudflare Access — can ever assert it.
--
-- Guards 1 and 2 are additionally pinned by a CHECK constraint below, so
-- the row cannot be activated or given a password even by hand at the
-- database.
--
-- ## Why the `admin` role
--
-- The FK itself requires no particular role — it points at `users(id)`
-- and nothing more. `admin` is the least-privileged role that reads
-- correctly for a row that appears in `booking_audit_log.admin_id` and in
-- the admin user list; `super_admin` would be strictly more than the
-- audit trail needs, and the login guards above mean the grant can never
-- be exercised.
--
-- ## Membership id
--
-- `user_profiles.membership_id` is `NOT NULL` and uniquely indexed, so
-- the profile row needs one. Real membership ids are eight digits in the
-- `269#####` shape (`routes::membership::validate_membership_id` and
-- `generate_membership_id`), so the reserved literal `SYSTEM00` can never
-- collide with a generated id and can never be looked up as one.
--
-- ## Idempotency
--
-- `ON CONFLICT ... DO UPDATE` rather than `DO NOTHING`: re-running the
-- migration converges a tampered row back to the seeded state, which is
-- what an idempotent seed of a security-relevant row should do.
-- =====================================================

-- ----- the actor row ---------------------------------------------------

INSERT INTO "public"."users"
    (id, email, password_hash, role, is_active, email_verified,
     oauth_provider, oauth_provider_id)
VALUES
    ('00000000-0000-4000-8000-0000005110b0'::uuid,
     'slipok@system.hf.invalid',
     NULL,
     'admin'::"public"."user_role",
     false,
     false,
     NULL,
     NULL)
ON CONFLICT (id) DO UPDATE
SET email             = EXCLUDED.email,
    password_hash     = NULL,
    role              = EXCLUDED.role,
    is_active         = false,
    email_verified    = false,
    oauth_provider    = NULL,
    oauth_provider_id = NULL,
    updated_at        = NOW();

-- ----- its display name ------------------------------------------------

INSERT INTO "public"."user_profiles"
    (user_id, first_name, last_name, membership_id)
VALUES
    ('00000000-0000-4000-8000-0000005110b0'::uuid, 'SlipOK', '', 'SYSTEM00')
ON CONFLICT (user_id) DO UPDATE
SET first_name = EXCLUDED.first_name,
    last_name  = EXCLUDED.last_name,
    updated_at = NOW();

-- ----- the row can never become loginable ------------------------------
-- Guarded by a `pg_constraint` lookup so re-applying the migration on a
-- partially migrated database is a no-op rather than an error.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_slipok_system_actor_not_loginable'
          AND conrelid = '"public"."users"'::regclass
    ) THEN
        ALTER TABLE "public"."users"
            ADD CONSTRAINT "users_slipok_system_actor_not_loginable"
            CHECK (
                id <> '00000000-0000-4000-8000-0000005110b0'::uuid
                OR (is_active IS NOT TRUE AND password_hash IS NULL)
            );
    END IF;
END $$;

COMMENT ON CONSTRAINT "users_slipok_system_actor_not_loginable"
    ON "public"."users"
    IS 'The SlipOK system actor exists only to own booking_audit_log rows for automatic slip verifications. It must never be activated or given a password.';
