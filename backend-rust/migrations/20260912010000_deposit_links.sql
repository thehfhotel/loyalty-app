-- =====================================================
-- Migration: deposit request links (workstream B, task B1)
-- =====================================================
-- Reception takes a booking by phone, LINE or at the desk and issues ONE
-- link for it. The guest opens the link, sees the amount and a PromptPay
-- QR with the amount already filled in, and uploads the slip. No login:
-- the token in the URL is the capability.
--
-- A deposit request is an ordinary `bookings` row plus one row in
-- `booking_deposit_links`. Almost every column it needs already exists —
-- `20260710000000_property_line_channel.sql` added `property`,
-- `guest_name`, `guest_phone`, `payment_option`, `amount_due_now`,
-- `balance_due` and `hold_expires_at` for the PMS channel. This migration
-- adds the two that do not: where the booking came from, and the iHOTEL
-- number reception can type in.
--
-- ## Why `pms_ref` and not `pms_booking_id`
--
-- `services::slip_confirm::confirm_slip` treats a non-null
-- `pms_booking_id` as a PMS *channel* booking and calls
-- `pms.payment_verified()`. The channel is dark, so putting the iHOTEL
-- number there would 500 the admin's Verify button and send the automatic
-- path down `revert_auto_confirm` with `confirm_failed`. `pms_ref` is free
-- text that nothing reads — it exists so the desk can tie the app row back
-- to the PMS by eye.
--
-- Setting `hold_expires_at` on these rows is safe: the expiry sweep in
-- `services::pms_channel` is guarded on `pms_booking_id IS NOT NULL`, so
-- it never touches a deposit-link booking. What the column buys is that a
-- slip uploaded after the link expired lands on `booking_not_payable` for
-- free, through the check that already exists.
--
-- ## The token is never stored
--
-- `token_hash` holds the SHA-256 of a 32-byte CSPRNG token, and lookup is
-- by hash. A database leak therefore yields no live links, and there is no
-- timing oracle in the lookup. The token itself is shown to reception once
-- at creation and never again; losing it means Reissue, which mints a new
-- one and stamps `revoked_at` on the old row.
--
-- ## Idempotency
--
-- `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX
-- IF NOT EXISTS` and `DO`-block constraint guards throughout, per
-- CLAUDE.md: a partial application during a failed deploy must not wedge
-- the next attempt.
-- =====================================================

-- ----- booking provenance ----------------------------------------------

ALTER TABLE "public"."bookings"
    ADD COLUMN IF NOT EXISTS "booking_source" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "pms_ref"        VARCHAR(100);

COMMENT ON COLUMN "public"."bookings"."booking_source"
    IS 'Where the booking came from: app | deposit_link | channel. NULL on rows that predate this column.';
COMMENT ON COLUMN "public"."bookings"."pms_ref"
    IS 'Free-text PMS (iHOTEL) reference typed by reception. Never the channel booking id — see pms_booking_id.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_bookings_booking_source'
    ) THEN
        ALTER TABLE "public"."bookings"
            ADD CONSTRAINT "chk_bookings_booking_source"
            CHECK ("booking_source" IS NULL
                   OR "booking_source" IN ('app', 'deposit_link', 'channel'));
    END IF;
END $$;

-- The admin link list filters on it, and `slip_confirm` reads it on every
-- verified slip to decide whether to flip a non-channel booking.
CREATE INDEX IF NOT EXISTS "idx_bookings_booking_source"
    ON "public"."bookings"("booking_source")
    WHERE "booking_source" IS NOT NULL;

-- ----- the links themselves --------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."booking_deposit_links" (
    "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
    "booking_id"      UUID NOT NULL,
    -- SHA-256 of the token. The token is never stored.
    "token_hash"      BYTEA NOT NULL,
    "issued_by"       UUID NOT NULL,
    "issued_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "expires_at"      TIMESTAMPTZ(6) NOT NULL,
    "revoked_at"      TIMESTAMPTZ(6),
    "first_opened_at" TIMESTAMPTZ(6),
    "open_count"      INTEGER NOT NULL DEFAULT 0,
    "note"            TEXT,

    CONSTRAINT "booking_deposit_links_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'booking_deposit_links_booking_id_fkey'
    ) THEN
        ALTER TABLE "public"."booking_deposit_links"
            ADD CONSTRAINT "booking_deposit_links_booking_id_fkey"
            FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'booking_deposit_links_issued_by_fkey'
    ) THEN
        ALTER TABLE "public"."booking_deposit_links"
            ADD CONSTRAINT "booking_deposit_links_issued_by_fkey"
            FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "booking_deposit_links_token_uidx"
    ON "public"."booking_deposit_links"("token_hash");
CREATE INDEX IF NOT EXISTS "booking_deposit_links_booking_idx"
    ON "public"."booking_deposit_links"("booking_id");

-- One LIVE token per booking. Reissue stamps `revoked_at` on the old row
-- inside the same transaction that inserts the new one, so this partial
-- unique index is what makes two live tokens impossible even if a future
-- handler forgets the revoke.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_deposit_links_one_live_uidx"
    ON "public"."booking_deposit_links"("booking_id")
    WHERE "revoked_at" IS NULL;

-- =====================================================
-- The deposit-link guest actor
-- =====================================================
-- `bookings.user_id` is NOT NULL, and a deposit-link guest has no account:
-- they arrived by phone. Pointing the row at a real member would hand that
-- member's session a stranger's slip through the storage authorisation
-- path (`routes::storage` walks `booking_slips → bookings → users`), so
-- every deposit-link booking is owned by ONE fixed, non-loginable actor.
--
-- The id is a constant compiled into the backend as
-- `routes::admin_deposit_links::DEPOSIT_LINK_SYSTEM_USER_ID`, part of the
-- cross-repo interface for this programme; it must never be regenerated.
--
--   id     00000000-0000-4000-8000-0000005110b2
--   email  deposit-link@system.hf.invalid
--   name   "Deposit link guest"
--
-- Claiming a link into a membership is out of scope for B1. The extension
-- point is one UPDATE of `bookings.user_id` behind an authenticated
-- `POST /api/deposit/:token/claim`.
--
-- ## Why it can never log in
--
-- The same four guards as the SlipOK actor
-- (`20260911000000_slipok_system_user.sql`), pinned by a CHECK so the row
-- cannot be activated, given a password, linked to an identity provider or
-- moved to a reachable address even by hand at the database:
-- `is_active = false`, `password_hash IS NULL`, no OAuth identity, and an
-- email under `.invalid` (RFC 2606) that no provider can ever assert.
--
-- Unlike the SlipOK actor this row is a `customer`, not an `admin`: it
-- owns bookings, it does not act on them.
--
-- `ON CONFLICT ... DO UPDATE` rather than `DO NOTHING`, so re-running the
-- migration converges a tampered row back to the seeded state.
-- =====================================================

INSERT INTO "public"."users"
    (id, email, password_hash, role, is_active, email_verified,
     oauth_provider, oauth_provider_id)
VALUES
    ('00000000-0000-4000-8000-0000005110b2'::uuid,
     'deposit-link@system.hf.invalid',
     NULL,
     'customer'::"public"."user_role",
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

-- `user_profiles.membership_id` is NOT NULL and uniquely indexed. Real
-- membership ids are eight digits in the `269#####` shape
-- (`routes::membership::validate_membership_id`), so the reserved literal
-- `SYSTEM01` can never collide with a generated one or be looked up as
-- one. `SYSTEM00` belongs to the SlipOK actor.
INSERT INTO "public"."user_profiles"
    (user_id, first_name, last_name, membership_id)
VALUES
    ('00000000-0000-4000-8000-0000005110b2'::uuid,
     'Deposit link', 'guest', 'SYSTEM01')
ON CONFLICT (user_id) DO UPDATE
SET first_name = EXCLUDED.first_name,
    last_name  = EXCLUDED.last_name,
    updated_at = NOW();

-- Dropped and re-added rather than added only when missing, so re-running
-- the migration converges an older or hand-edited definition on this one.
-- `IS NOT DISTINCT FROM` for the email, not `=`: a CHECK passes when its
-- expression evaluates to NULL, so `email = '...'` would let the address be
-- nulled out and the row would slip the guard.

ALTER TABLE "public"."users"
    DROP CONSTRAINT IF EXISTS "users_deposit_link_actor_not_loginable";

ALTER TABLE "public"."users"
    ADD CONSTRAINT "users_deposit_link_actor_not_loginable"
    CHECK (
        id <> '00000000-0000-4000-8000-0000005110b2'::uuid
        OR (
            is_active IS NOT TRUE
            AND password_hash IS NULL
            AND oauth_provider IS NULL
            AND oauth_provider_id IS NULL
            AND email IS NOT DISTINCT FROM 'deposit-link@system.hf.invalid'
        )
    );

COMMENT ON CONSTRAINT "users_deposit_link_actor_not_loginable"
    ON "public"."users"
    IS 'The deposit-link guest actor exists only to own bookings created from a deposit request link, so that no real member session can reach a stranger''s slip. It must never be activated, given a password, linked to an identity provider, or moved to an email address a provider could assert.';
