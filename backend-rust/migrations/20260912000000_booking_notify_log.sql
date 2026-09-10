-- Booking notification dedup log (B0:
-- hf-tasks/tasks/direct-booking-designs/b0-booking-email-spec.md)
--
-- One row per notification *event*, claimed before the message is spawned.
-- The primary key is the whole dedup mechanism: `INSERT ... ON CONFLICT
-- (event_key) DO NOTHING` returning no row means another attempt already
-- owns this event, so this one stays quiet.
--
-- Why it is needed even though each trigger fires once:
--   * `services/idempotency.rs` replays a cached response for a repeated
--     booking-create request, and the handler would otherwise notify again;
--   * an admin can press Verify on an already-verified slip (the handler is
--     deliberately idempotent), and reception must not get a second email;
--   * the send itself retries once, and a retry must not double-send.
--
-- No FK to `bookings`: the log is a record of what was sent, and must not
-- disappear with (or block) the row it describes.
--
-- Idempotent by convention (CLAUDE.md): CREATE TABLE/INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "public"."booking_notify_log" (
    "event_key"  TEXT NOT NULL,
    "booking_id" UUID NOT NULL,
    "recipient"  TEXT NOT NULL,
    "sent_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "booking_notify_log_pkey" PRIMARY KEY ("event_key")
);

CREATE INDEX IF NOT EXISTS "idx_booking_notify_log_booking_id"
    ON "public"."booking_notify_log"("booking_id");

-- The hourly volume cap reads "how many messages has this mailbox had in the
-- last hour" before every claim, on the guest's request path.
CREATE INDEX IF NOT EXISTS "idx_booking_notify_log_recipient_sent_at"
    ON "public"."booking_notify_log"("recipient", "sent_at" DESC);
