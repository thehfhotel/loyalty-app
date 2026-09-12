-- =====================================================
-- Migration: the guest-rights request log (PDPA F3, gap P2-7)
-- =====================================================
-- `docs/privacy/2026-09-pdpa-data-map.md` §8 gap 7: "Rights request path
-- (F3): access, correction, erasure, objection to messaging — with a
-- written turnaround (PDPA s.30-s.32 default 30 days), a log of requests,
-- and an answer for a request that arrives by LINE rather than email."
--
-- The erasure *mechanism* already exists (`services::account_deletion`,
-- migration `20260914020000_account_deletion.sql`). What was missing is
-- the **request log** around it: the row that proves a member asked, when
-- they asked, who answered, and what the answer was. Without it the 30-day
-- clock is nobody's and an audit has nothing to read.
--
-- ## What this table is, and is not
--
-- It is a **work log**, not a second copy of the member's data. A row
-- carries a user id, a kind, a status, the member's own free-text note and
-- the resolver's note — nothing else. The data an access request produces
-- is assembled on demand by `GET /api/admin/privacy/requests/:id/export`
-- and is never stored here: a rights table that accumulated exports would
-- become the largest single pile of personal data in the system, created
-- by the very process meant to reduce it.
--
-- ## Four kinds, four statuses
--
-- `kind` mirrors PDPA s.30 (access), s.33 (erasure), s.35 (rectification)
-- and s.32 (objection — in practice "stop messaging me"). `status` is the
-- desk's workflow: `open` → `in_progress` → `done` | `refused`. A refusal
-- is a first-class outcome, not an error: s.31/s.33 let a controller
-- refuse with a reason (a legal retention duty, an unverifiable
-- requester), and the reason has to be written down. That is what
-- `resolution_note` is for, and why it is required on both terminal
-- statuses at the route layer.
--
-- ## One open request per kind per user
--
-- Enforced by a **partial unique index** rather than by a SELECT-then-
-- INSERT in the handler, so two taps on a slow phone cannot both win.
-- Partial, because the constraint is only about *live* work: a member
-- whose erasure request was refused last year must be able to ask again.
--
-- ## Member scope only, deliberately
--
-- `user_id` is NOT NULL, so this table serves the authenticated member.
-- §2 of the map is emphatic that a deposit-link guest has no account and
-- will never be found by `user_id` — their branch is the published contact
-- address and a manual desk procedure, documented in
-- `docs/privacy/rights-path.md`. Encoding a half-built non-member branch
-- in the schema would suggest a route that does not exist; the runbook is
-- honest about the seam instead. (F1 §10 Q4: the identity proof that
-- branch needs is an owner and lawyer decision, not a coding one.)
--
-- ## No cascade to `users`
--
-- Like `user_deletions`, this table is deliberately not foreign-keyed with
-- `ON DELETE CASCADE`. The proof that someone exercised a right must
-- outlive any future hard delete of the user row — erasing the record of
-- an erasure request is the one deletion PDPA accountability cannot
-- tolerate. The FK is `ON DELETE RESTRICT` for the same reason the slip
-- audit columns are: we want an error, not silent loss.
--
-- Additive and idempotent throughout (`CREATE TABLE IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`, `DO`-block constraint guards), per
-- CLAUDE.md. It changes no existing row and no existing column.
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."privacy_requests" (
    "id"              UUID        NOT NULL DEFAULT uuid_generate_v4(),
    "user_id"         UUID        NOT NULL,
    -- access | erasure | rectification | objection
    "kind"            VARCHAR(20) NOT NULL,
    -- open | in_progress | done | refused
    "status"          VARCHAR(20) NOT NULL DEFAULT 'open',
    -- The member's own words. Free text, length-capped at the route layer.
    -- For a rectification request this is where "my surname is spelled
    -- wrong" lives; for an objection, which messages they want stopped.
    "note"            TEXT,
    "requested_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set together with a terminal status. NULL while the request is live.
    "resolved_at"     TIMESTAMPTZ,
    -- The admin who closed it. NULL while the request is live.
    "resolved_by"     UUID,
    -- What we did, or why we refused. Required on `done` and `refused`.
    "resolution_note" TEXT,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- ----- Constraints ------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_privacy_requests_kind'
          AND conrelid = '"public"."privacy_requests"'::regclass
    ) THEN
        ALTER TABLE "public"."privacy_requests"
            ADD CONSTRAINT "chk_privacy_requests_kind"
            CHECK ("kind" IN ('access', 'erasure', 'rectification', 'objection'));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_privacy_requests_status'
          AND conrelid = '"public"."privacy_requests"'::regclass
    ) THEN
        ALTER TABLE "public"."privacy_requests"
            ADD CONSTRAINT "chk_privacy_requests_status"
            CHECK ("status" IN ('open', 'in_progress', 'done', 'refused'));
    END IF;
END
$$;

-- A terminal status carries a timestamp; a live one does not. This is the
-- invariant the 30-day clock is measured against, so the database holds it
-- rather than trusting every future writer.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_privacy_requests_resolved_at'
          AND conrelid = '"public"."privacy_requests"'::regclass
    ) THEN
        ALTER TABLE "public"."privacy_requests"
            ADD CONSTRAINT "chk_privacy_requests_resolved_at"
            CHECK (
                ("status" IN ('done', 'refused') AND "resolved_at" IS NOT NULL)
                OR ("status" IN ('open', 'in_progress') AND "resolved_at" IS NULL)
            );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'privacy_requests_user_id_fkey'
          AND conrelid = '"public"."privacy_requests"'::regclass
    ) THEN
        ALTER TABLE "public"."privacy_requests"
            ADD CONSTRAINT "privacy_requests_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
            ON DELETE RESTRICT;
    END IF;
END
$$;

-- ----- Indexes ----------------------------------------------------------

-- The duplicate guard. Partial on the live statuses, so a member can ask
-- again after a previous request of the same kind was closed or refused.
-- This index is what answers 409 under concurrency; the handler's SELECT
-- is only there to produce a friendly body.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_privacy_requests_open_kind"
    ON "public"."privacy_requests"("user_id", "kind")
    WHERE "status" IN ('open', 'in_progress');

-- The member's own list: "ข้อมูลของฉัน" reads every request for one user,
-- newest first.
CREATE INDEX IF NOT EXISTS "idx_privacy_requests_user_requested_at"
    ON "public"."privacy_requests"("user_id", "requested_at" DESC);

-- The admin queue: open work, oldest first, because the oldest is the one
-- closest to the 30-day deadline.
CREATE INDEX IF NOT EXISTS "idx_privacy_requests_open_queue"
    ON "public"."privacy_requests"("requested_at")
    WHERE "status" IN ('open', 'in_progress');

-- ----- Documentation ----------------------------------------------------

COMMENT ON TABLE "public"."privacy_requests"
    IS 'PDPA s.30-s.33 data-subject rights requests from authenticated members. A work log, not a data store: the access export is assembled on demand and never persisted here. Non-member (deposit-link) requests have no row — they arrive at the published contact address and are handled by the desk procedure in docs/privacy/rights-path.md.';

COMMENT ON COLUMN "public"."privacy_requests"."kind"
    IS 'access (s.30) | erasure (s.33) | rectification (s.35) | objection (s.32, in practice "stop messaging me").';

COMMENT ON COLUMN "public"."privacy_requests"."status"
    IS 'open | in_progress | done | refused. A refusal is a valid outcome with a written reason in resolution_note, not an error.';

COMMENT ON COLUMN "public"."privacy_requests"."note"
    IS 'The member''s own words, free text. Never an export, never a copy of their data.';

COMMENT ON COLUMN "public"."privacy_requests"."requested_at"
    IS 'Start of the 30-day response clock (PDPA s.30/s.31/s.32 default).';

COMMENT ON COLUMN "public"."privacy_requests"."resolution_note"
    IS 'What we did, or why we refused. Required by the route on both terminal statuses — a refusal without a reason is not a refusal PDPA recognises.';
