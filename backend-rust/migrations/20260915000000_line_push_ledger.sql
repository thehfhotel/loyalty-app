-- LINE push budget guard (C5) — the two tables behind `services::push_budget`.
--
-- Each guest OA is on the LINE free plan: ~300 push messages a month, shared
-- by everything we send. The program plan (§8) splits that allowance into
-- fixed buckets — 0 auto-verify, 50 ops/report, 200 campaign, 50 reserve —
-- and the backend refuses a push whose bucket is spent rather than letting
-- one feature quietly eat another's share (or push the OA into paid tier).
--
-- Two tables, because they answer two different questions:
--
--   * `line_push_budget` is the *counter*: one row per (OA, bucket, month)
--     holding how much of that bucket the month has spent. It is the thing
--     `reserve()` increments atomically and the thing the admin endpoint
--     reads. The primary key is what makes the increment safe.
--
--   * `line_push_ledger` is the *audit trail*: one row per reserve decision,
--     naming the bucket, who it was for, when, and how it ended.
--
-- ## No LINE userId in plain text
--
-- `target_hash` is SHA-256 of the LINE userId, hex, and the CHECK constraint
-- enforces exactly that shape: 64 lowercase hex characters. A raw LINE
-- userId ("U" + 32 hex) cannot satisfy it, so the database itself refuses a
-- row that leaks the identifier — the rule is not left to the call site.
-- A LINE userId carries 128 bits of entropy, so the full-length digest is
-- not brute-forceable; this is deliberately NOT the 48-bit truncation
-- `utils::hash_email` uses for log correlation.
--
-- ## Month
--
-- `month` is 'YYYY-MM' in **Asia/Bangkok** (UTC+7, no DST) — the calendar
-- the people reading the admin page live in. Stored as text rather than a
-- date so the bucket key reads the same in the table as in the endpoint.
--
-- Idempotent by convention (CLAUDE.md): CREATE TABLE/INDEX IF NOT EXISTS,
-- DO-block constraint guards.

CREATE TABLE IF NOT EXISTS "public"."line_push_budget" (
    "property"   VARCHAR(10)  NOT NULL,
    "bucket"     VARCHAR(20)  NOT NULL,
    "month"      VARCHAR(7)   NOT NULL,
    "count"      INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "line_push_budget_pkey" PRIMARY KEY ("property", "bucket", "month"),
    CONSTRAINT "chk_line_push_budget_property"
        CHECK ("property" IN ('hf', 'hfville')),
    CONSTRAINT "chk_line_push_budget_bucket"
        CHECK ("bucket" IN ('auto_verify', 'ops', 'campaign', 'reserve')),
    CONSTRAINT "chk_line_push_budget_month"
        CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "chk_line_push_budget_count" CHECK ("count" >= 0)
);

-- The admin read endpoint asks for one month across both OAs and all
-- buckets; the guard asks for one OA's whole month to check the shared
-- 300 total. Both are served by leading on month.
CREATE INDEX IF NOT EXISTS "idx_line_push_budget_month"
    ON "public"."line_push_budget"("month", "property");

CREATE TABLE IF NOT EXISTS "public"."line_push_ledger" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "property"    VARCHAR(10)  NOT NULL,
    "bucket"      VARCHAR(20)  NOT NULL,
    "month"       VARCHAR(7)   NOT NULL,
    "target_hash" VARCHAR(64)  NOT NULL,
    "result"      VARCHAR(40)  NOT NULL,
    "sent_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "line_push_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_line_push_ledger_property"
        CHECK ("property" IN ('hf', 'hfville')),
    CONSTRAINT "chk_line_push_ledger_bucket"
        CHECK ("bucket" IN ('auto_verify', 'ops', 'campaign', 'reserve')),
    CONSTRAINT "chk_line_push_ledger_month"
        CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- The privacy guarantee, enforced by the database and not by the caller.
    CONSTRAINT "chk_line_push_ledger_target_hash"
        CHECK ("target_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "chk_line_push_ledger_result"
        CHECK ("result" IN (
            'reserved', 'delivered', 'failed',
            'refused_bucket_exhausted', 'refused_month_total_exhausted',
            'refused_reserve_without_override'
        ))
);

CREATE INDEX IF NOT EXISTS "idx_line_push_ledger_month"
    ON "public"."line_push_ledger"("month", "property", "bucket");

CREATE INDEX IF NOT EXISTS "idx_line_push_ledger_sent_at"
    ON "public"."line_push_ledger"("sent_at" DESC);
