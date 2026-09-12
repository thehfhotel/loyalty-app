-- =====================================================
-- Migration: SlipOK degradation state + monthly check counter (task A4)
-- =====================================================
-- Two tiny tables behind `services::slipok_health`, which turns a stream of
-- SlipOK call outcomes into **one** "slips are queued for manual
-- verification" alert and **one** recovery notice.
--
-- ## Why a table and not Redis
--
-- The alert is a promise: "we told the desk". Redis here is a cache with no
-- persistence guarantee — a restart or an eviction would re-arm the alert
-- and the desk would get the same message again, which is exactly the noise
-- the cooldown exists to prevent. It is also where the *monthly* check count
-- lives, and that has to survive a deploy: the 80 %-of-quota warning is
-- meaningless if the counter resets every time a container is recreated.
--
-- ## `slipok_health` — the singleton episode row
--
-- One row, `id = 1`, guarded by a CHECK so a second row cannot appear. It
-- holds the current degradation *episode*:
--
--   consecutive_failures  failures since the last answer from the vendor.
--                         Reset to 0 by any answer, including "this slip is
--                         bad" — a verdict means the vendor is up.
--   degraded              whether the automatic check is currently standing
--                         aside and every slip is going to the manual queue.
--   degraded_since        when this episode began.
--   degraded_reason       quota_exceeded | api_error | timeout — why it
--                         began (the reason of the failure that tipped it).
--   announced             whether *this* episode's alert was actually sent.
--                         A recovery notice goes out only for an episode the
--                         desk was told about; announcing a recovery from a
--                         degradation nobody heard about is pure noise.
--   last_alert_at         cooldown anchor. A flapping vendor cannot send a
--                         second degradation alert until the cooldown
--                         (`SLIPOK_DEGRADE_ALERT_COOLDOWN_MINS`, default 60)
--                         has elapsed.
--   last_recovery_at      when the last recovery notice went out.
--
-- The transition is computed under `SELECT ... FOR UPDATE` inside one
-- transaction, so two slips failing at the same instant produce one alert
-- and not two.
--
-- ## `slipok_monthly_usage` — our own count of checks
--
-- The real monthly quota is unknown until the owner records it (task A3), so
-- `SLIPOK_MONTHLY_QUOTA` is blank by default and the 80 % warning simply
-- never fires. When it is set, the warning fires against **our own** count
-- of calls that reached the vendor, because the vendor exposes no counter we
-- can read.
--
-- `month` is the first day of the month in **Asia/Bangkok**, not UTC: the
-- quota is a Thai vendor's calendar month and the hotel's, and a UTC month
-- boundary would attribute the first seven hours of every month to the
-- previous one.
--
-- `quota_alert_sent_at` makes the warning once-per-month: it is stamped by a
-- conditional UPDATE (`WHERE quota_alert_sent_at IS NULL`), so concurrent
-- checks race for one row and exactly one wins.
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."slipok_health" (
    "id"                   SMALLINT     NOT NULL DEFAULT 1,
    "consecutive_failures" INTEGER      NOT NULL DEFAULT 0,
    "degraded"             BOOLEAN      NOT NULL DEFAULT FALSE,
    "degraded_since"       TIMESTAMPTZ,
    "degraded_reason"      TEXT,
    "announced"            BOOLEAN      NOT NULL DEFAULT FALSE,
    "last_alert_at"        TIMESTAMPTZ,
    "last_recovery_at"     TIMESTAMPTZ,
    "updated_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "slipok_health_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "slipok_health_singleton" CHECK ("id" = 1)
);

-- Seed the singleton so the tracker never has to distinguish "no row yet"
-- from "healthy". Idempotent: a re-run leaves an existing row untouched.
INSERT INTO "public"."slipok_health" ("id") VALUES (1)
    ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "public"."slipok_monthly_usage" (
    -- First day of the month, Asia/Bangkok.
    "month"               DATE        NOT NULL,
    "checks"              BIGINT      NOT NULL DEFAULT 0,
    "quota_alert_sent_at" TIMESTAMPTZ,
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "slipok_monthly_usage_pkey" PRIMARY KEY ("month")
);
