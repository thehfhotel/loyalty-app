//! Slip confirmation — the one path that turns a slip into a paid booking
//!
//! Extracted verbatim out of `routes::admin_slips::verify_slip` so the human
//! path and the automatic path (`routes::bookings::run_slipok_check`) cannot
//! drift apart: a machine verify and an admin verify must leave the same
//! `admin_status`, the same PMS call and the same booking status behind.
//!
//! The only difference is the actor:
//!
//! * `Some(admin_id)` — an admin pressed Verify. Behaves exactly as before
//!   the extraction, including the `booking_audit_log` row.
//! * `None` — the automatic check confirmed it. It writes the same
//!   `booking_audit_log` row, attributed to [`SLIPOK_SYSTEM_USER_ID`] — the
//!   fixed, non-loginable system actor seeded by migration
//!   `20260911000000_slipok_system_user.sql`. An automatic verify is a money
//!   decision, so it gets an audit row like any other; the actor is what
//!   makes machine and human verifies countable apart. It also stands aside
//!   for an admin who verified the same slip first, rather than overwriting
//!   their name with the machine's.
//!
//! Everything else — the `admin_status` write, the PMS payment event, the
//! booking confirmation — is identical on both paths, and the human path is
//! byte-for-byte what it was before the system actor existed.
//!
//! ## What confirmation does to the booking
//!
//! Two shapes, decided by `pms_booking_id`:
//!
//! * **PMS channel booking** (`pms_booking_id` set) — the PMS owns the
//!   room, so the payment event goes to it first and the local row follows.
//!   Unchanged since ADR-0003.
//! * **Everything else** (`pms_booking_id IS NULL`) — deposit request links
//!   and ordinary in-app bookings. Nothing else knows the guest paid, so a
//!   verified slip flips the booking here while it is still `pending`.
//!
//! A11 changes that second shape in two ways, and it is worth being exact
//! about which of them moves a live row today.
//!
//! 1. **The guard no longer names `booking_source`.** It used to read
//!    `booking_source = 'deposit_link'`; it now reads `pms_booking_id IS
//!    NULL`. What a received payment means does not depend on which screen
//!    created the booking. This is a *forward* fix, not the repair of
//!    observed damage, and the module doc should not claim otherwise: no
//!    path in this repo currently creates a non-PMS booking in `pending`
//!    outside `routes::admin_deposit_links` — the in-app create
//!    (`routes::bookings`) writes `'confirmed'` directly, the channel create
//!    always sets `pms_booking_id`, and `'deposit_link'` is the only value
//!    ever written to `booking_source` — so no live row is known to be stuck
//!    behind the old guard. It closes the hole ahead of the app
//!    booking-with-deposit flow rather than reporting a rescue.
//! 2. **The machine may not confirm a booking whose hold has lapsed; a
//!    human still may.** `routes::bookings::slipok_check` already refuses to
//!    act on a slip against an expired hold, and says why in as many words:
//!    "an admin may still override it by hand (that is a human decision);
//!    the automatic path may not". That rule was enforced only at the top of
//!    `slipok_check`, which reads `status` and `hold_expires_at` *before* the
//!    SlipOK round-trip — so a hold lapsing during the vendor call let the
//!    machine confirm a room nobody was holding any more. The flip below now
//!    carries the same condition, applied when `actor.is_none()` and only
//!    then. An admin's Verify stays unconditional on purpose: reception
//!    finishing a deposit-link booking whose 48 h link lapsed overnight is
//!    the exact case B1 shipped the manual queue for, and `routes::
//!    deposit_links` deliberately accepts the guest's upload after expiry so
//!    that a human can complete it.
//!
//! A machine verify that loses that race confirms nothing, is recorded as
//! `booking_not_payable` and is reported back on the outcome — see
//! [`booking_not_payable_reason`].
//!
//! ## A15: the channel branch fails loudly now, for both actors
//!
//! A11 fixed the *non*-PMS shape. The PMS-channel shape above it still
//! failed open, and B8 (race 2.4) is exact about how: the booking was
//! selected with **no `status` filter**, so a slip verified after the hold
//! lapsed fired `payment_verified` at a `pms_booking_id` the hold-expiry
//! sweep had already released; the guarded local `UPDATE … WHERE status =
//! 'pending'` then matched **zero** rows, `rows_affected()` was never read,
//! `booking_confirmed` was set to `true` unconditionally and the INFO line
//! said *"channel booking confirmed"*. The guest had paid and had no room,
//! and every surface said the opposite.
//!
//! Three changes close it, and they apply to the admin's Verify and to the
//! automatic path alike:
//!
//! 1. **A pre-check for what the PMS cannot be asked about.** A booking we
//!    have already given up on locally (`cancelled` / `no_show`) is refused
//!    before the transaction opens, so no slip ever reads `verified` against
//!    it and no payment event resurrects it. Note what this deliberately
//!    does *not* do: it does not judge the hold clock. See
//!    [`ChannelBooking::payability`] — the PMS never reads
//!    `book_hold_expires_at` either, and a lapsed-but-unswept hold is one it
//!    will happily confirm.
//! 2. **A PMS refusal is a refusal, not an outage.** `payment_verified` now
//!    answers [`PmsActionError::Refused`] for a 4xx — the documented 409 for
//!    a released hold (`new-hotel/docs/loyalty-channel.md:78-86`) — which is
//!    definitive and must not be retried. A 5xx or a timeout still surfaces
//!    as before so the action *is* retried.
//! 3. **`rows_affected()` is read wherever a guarded update decides an
//!    outcome.** Zero rows is never "confirmed" any more: it is either the
//!    idempotent replay against an already-`confirmed` booking, or a
//!    divergence loud enough to stop the call.
//!
//! All three land in the same place — [`refuse_channel_confirmation`]: the
//! booking is left untouched, the slip goes to `admin_status = needs_action`
//! (and gives up its `slipok_trans_ref`, so the guest can re-upload the same
//! transfer against the re-booking), an audit row carrying
//! `booking_not_payable` and the PMS's own answer records why, and the
//! caller gets a **409**, never a 200.
//!
//! What the refusal pointedly does **not** touch is `slipok_status` /
//! `slipok_reason` / `slipok_checked_at`. Those are the machine's record of
//! what it made of the *slip*, and they are the sample the shadow-window
//! agreement report counts; a refusal is a judgement about the *booking*.
//! The audit row carries everything a human needs.
//!
//! Unlike the non-PMS shape, an admin's Verify does **not** override here.
//! A deposit link that lapsed is a piece of paperwork a human can finish; a
//! PMS hold that lapsed is a *room* the PMS may already have sold to
//! somebody else, and no button in this app can take it back. The honest
//! answer to reception is "this booking is gone, re-book it at the desk".
//!
//! ## sqlx note
//!
//! The extraction that created this module **moved** its compile-time
//! queries rather than rewriting them, because the offline cache in `.sqlx/`
//! is keyed on the query text and byte-identical text needs no `cargo sqlx
//! prepare` run. A11 does change one of them — the non-PMS flip below gained
//! its `$2` override — so that query has a fresh cache entry and any further
//! edit to its text needs `scripts/regen-sqlx-cache.sh` again. Everything
//! that needs no cache entry (the refusal bookkeeping, the trans-ref read)
//! is a runtime `sqlx::query` on purpose.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde_json::json;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::services::pms_channel::PmsActionError;
use crate::state::AppState;

/// The one user row every automatic slip verification is attributed to.
///
/// Seeded by migration `20260911000000_slipok_system_user.sql` as
/// `slipok@system.hf.invalid`, display name "SlipOK", non-loginable. The
/// value is a fixed constant rather than a lookup: it is part of the
/// cross-repo interface for the deposit programme (admin surfaces, the
/// shadow-window agreement report and the human-touch KPI all key off it),
/// so it must never be regenerated.
///
/// Guest-facing surfaces never render this actor's name — a guest sees
/// "ตรวจสอบอัตโนมัติ" / "checked automatically", never "SlipOK".
pub const SLIPOK_SYSTEM_USER_ID: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0051_10b0);

/// True when `admin_verified_by` names the SlipOK system actor — i.e. the
/// slip was verified by the machine and no human has since touched it.
///
/// Both admin mutations in `routes::admin_slips` re-stamp
/// `admin_verified_by` with the acting admin, so a human verify or reject
/// after an automatic one flips this back to `false`, which is exactly what
/// the human-touch count wants.
pub fn is_slipok_actor(admin_verified_by: Option<Uuid>) -> bool {
    admin_verified_by == Some(SLIPOK_SYSTEM_USER_ID)
}

/// The slip row after confirmation, plus what confirmation did to the
/// booking. Carries exactly the columns `AdminSlipResponse` needs so the
/// admin handler still answers without a second read.
#[derive(Debug, Clone)]
pub struct ConfirmOutcome {
    pub id: Uuid,
    pub booking_id: Uuid,
    /// `None` once the image has been erased under the F2 retention policy
    /// (`booking_slips.slip_url` lost its `NOT NULL` in
    /// `20260912020000_slip_retention_access_log.sql`). Nullability only —
    /// nothing about when or why a slip is confirmed changed here.
    pub slip_url: Option<String>,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub admin_status: Option<String>,
    pub admin_verified_at: Option<DateTime<Utc>>,
    pub admin_verified_by: Option<Uuid>,
    pub admin_notes: Option<String>,
    pub slipok_status: Option<String>,
    pub slipok_verified_at: Option<DateTime<Utc>>,
    /// True when this call flipped the booking the slip pays for to
    /// `confirmed` — either through the PMS payment event (channel
    /// booking) or directly (every other booking).
    pub booking_confirmed: bool,
    /// Why the booking was **not** confirmed, when a verified slip could
    /// not move it.
    ///
    /// Only ever [`slip_match::REASON_BOOKING_NOT_PAYABLE`] today, and only
    /// ever on the automatic path: the booking is still `pending` but its
    /// hold has run out, so the room is gone and a machine confirming it
    /// would promise a bed nobody is holding. An admin's Verify overrides an
    /// expired hold by design and never lands here. `None` covers both
    /// "confirmed it" and the ordinary idempotent re-verify of a booking
    /// that was already `confirmed`, which refuses nothing.
    ///
    /// Surfaced to the actor on `AdminSlipResponse` and used by
    /// `routes::admin_slips` to hold back the "confirmed by staff" desk
    /// mail, so no surface can announce a confirmation that did not
    /// happen.
    ///
    /// [`slip_match::REASON_BOOKING_NOT_PAYABLE`]: crate::services::slip_match::REASON_BOOKING_NOT_PAYABLE
    pub booking_not_confirmed_reason: Option<&'static str>,
}

/// Mark a slip verified and confirm the booking it pays for.
///
/// `actor` is the admin who pressed Verify, or `None` when the automatic
/// SlipOK check confirmed the slip. See the module docs for the single
/// behavioural difference between the two.
///
/// Errors leave the slip untouched: the slip update and the audit row are
/// one transaction, and the PMS call runs after the commit exactly as it did
/// inline in `admin_slips.rs` (a PMS failure surfaces so the action is
/// retried, rather than leaving money received against an expiring hold).
pub async fn confirm_slip(
    state: &AppState,
    slip_id: Uuid,
    booking_id: Uuid,
    actor: Option<Uuid>,
) -> Result<ConfirmOutcome, AppError> {
    confirm_slip_with_notes(state, slip_id, booking_id, actor, None).await
}

/// [`confirm_slip`] with the admin's optional notes.
///
/// Only the admin handler passes notes; they land on `admin_notes` and in
/// the audit row's `reason`, which is why the notes-free [`confirm_slip`]
/// above is the entry point for the automatic path.
pub async fn confirm_slip_with_notes(
    state: &AppState,
    slip_id: Uuid,
    booking_id: Uuid,
    actor: Option<Uuid>,
    admin_notes: Option<String>,
) -> Result<ConfirmOutcome, AppError> {
    let actor_id = actor.unwrap_or(SLIPOK_SYSTEM_USER_ID);

    // A15 — the payability pre-check for a PMS-channel booking, run before
    // anything is written. The PMS owns the room; if it has let the hold go
    // there is nothing a verified slip can confirm, and stamping the slip
    // first would leave it reading `verified` against a booking that never
    // moved. Read once here and reused for the payment event below: the only
    // thing between the two is this function's own transaction, and the PMS
    // is the authority on anything that moves inside it.
    let channel = read_channel_booking(state.db(), booking_id).await?;
    if let Some(channel) = &channel {
        if let ChannelPayability::Refused { detail } = channel.payability() {
            return Err(refuse_channel_confirmation(
                state.db(),
                booking_id,
                slip_id,
                actor_id,
                ChannelRefusal {
                    booking_status: channel.status.clone(),
                    hold_expires_at: channel.hold_expires_at,
                    pms_booking_id: channel.pms_booking_id.clone(),
                    pms_status: None,
                    pms_body: None,
                    detail,
                },
            )
            .await);
        }
    }

    let mut tx = state.db().begin().await?;

    // Capture the previous state *before* the UPDATE so the audit row
    // can describe what changed. `FOR UPDATE` serialises concurrent
    // admins racing to verify the same slip — under contention exactly
    // one admin "wins" the row and the other reads the post-write state
    // when it acquires the lock.
    let before = sqlx::query!(
        r#"
        SELECT admin_status, admin_verified_at, admin_verified_by, admin_notes
        FROM booking_slips
        WHERE id = $1
        FOR UPDATE
        "#,
        slip_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    // The automatic check runs inline for several seconds after the slip
    // row becomes visible, so an admin can press Verify inside that window.
    // If they did, theirs stands: re-running the UPDATE with `actor = None`
    // would overwrite `admin_verified_by` with the system actor (destroying
    // the attribution behind an audit row that names them) and post a
    // second payment event. An admin re-verifying keeps its old behaviour —
    // that is a deliberate human action, and the extraction had to preserve
    // it exactly.
    if actor.is_none() && before.admin_status.as_deref() == Some("verified") {
        let outcome = read_outcome(&mut tx, slip_id).await?;
        tx.commit().await?;
        tracing::info!(
            slip_id = %slip_id,
            booking_id = %booking_id,
            "Slip was already verified; automatic confirmation is a no-op"
        );
        return Ok(outcome);
    }

    // Who the slip is stamped with. An automatic verify is attributed to the
    // system actor rather than to nobody, so `admin_verified_by` answers
    // "who decided this" for every verified slip in the table — the query
    // behind the human-touch KPI is then a single `admin_verified_by`
    // comparison instead of a join against the audit log.
    let verified_by: Option<Uuid> = Some(actor.unwrap_or(SLIPOK_SYSTEM_USER_ID));

    let row = sqlx::query!(
        r#"
        UPDATE booking_slips
        SET admin_status      = 'verified',
            admin_verified_at = NOW(),
            admin_verified_by = $1,
            admin_notes       = COALESCE($2, admin_notes)
        WHERE id = $3
        RETURNING
            id,
            booking_id,
            slip_url,
            uploaded_at,
            admin_status,
            admin_verified_at,
            admin_verified_by,
            admin_notes,
            slipok_status,
            slipok_verified_at
        "#,
        verified_by,
        admin_notes,
        slip_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    match actor {
        Some(admin_id) => {
            let before_json = json!({
                "adminStatus": before.admin_status,
                "adminVerifiedBy": before.admin_verified_by,
                "adminVerifiedAt": before.admin_verified_at,
                "adminNotes": before.admin_notes,
            });
            let after_json = json!({
                "adminStatus": row.admin_status,
                "adminVerifiedBy": row.admin_verified_by,
                "adminVerifiedAt": row.admin_verified_at,
                "adminNotes": row.admin_notes,
                "slipId": row.id,
            });

            insert_slip_audit_row(
                &mut *tx,
                row.booking_id,
                admin_id,
                "slip_verified",
                Some(before_json),
                Some(after_json),
                admin_notes.clone(),
            )
            .await?;

            tx.commit().await?;

            tracing::info!(
                slip_id = %slip_id,
                booking_id = %row.booking_id,
                admin_id = %admin_id,
                "Admin verified slip"
            );
        },
        None => {
            // The bank reference stored by the SlipOK check is the forensic
            // anchor for an automatic decision, so it goes on the audit row
            // as well as in the log line. Runtime query (not the macro) so
            // the new `slipok_trans_ref` column needs no `.sqlx` cache entry.
            let trans_ref: Option<String> =
                sqlx::query_scalar("SELECT slipok_trans_ref FROM booking_slips WHERE id = $1")
                    .bind(slip_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .flatten();

            let before_json = json!({
                "adminStatus": before.admin_status,
                "adminVerifiedBy": before.admin_verified_by,
                "adminVerifiedAt": before.admin_verified_at,
                "adminNotes": before.admin_notes,
            });
            let after_json = json!({
                "adminStatus": row.admin_status,
                "adminVerifiedBy": row.admin_verified_by,
                "adminVerifiedAt": row.admin_verified_at,
                "adminNotes": row.admin_notes,
                "slipId": row.id,
                "slipokTransRef": trans_ref,
                "autoVerified": true,
            });

            // Same action as the human path: what happened is identical, and
            // `admin_id` is what says who did it. Anything keyed on the
            // action string keeps working, and the actor is the one filter
            // that separates machine from human.
            insert_slip_audit_row(
                &mut *tx,
                row.booking_id,
                SLIPOK_SYSTEM_USER_ID,
                "slip_verified",
                Some(before_json),
                Some(after_json),
                Some(match trans_ref.as_deref() {
                    Some(r) => format!("Verified automatically (bank reference {r})"),
                    None => "Verified automatically".to_string(),
                }),
            )
            .await?;

            tx.commit().await?;

            tracing::info!(
                slip_id = %slip_id,
                booking_id = %row.booking_id,
                trans_ref = trans_ref.as_deref().unwrap_or("unknown"),
                admin_id = %SLIPOK_SYSTEM_USER_ID,
                "SlipOK auto-verified slip"
            );
        },
    }

    // PMS booking channel (ADR-0003): a verified slip IS the payment event
    // for a channel booking. Confirm the PMS booking first — if the PMS is
    // unreachable this returns an error so the admin retries the verify
    // action (idempotent on both sides) rather than leaving money received
    // against a hold that would silently expire.
    let mut booking_confirmed = false;
    let mut booking_not_confirmed_reason: Option<&'static str> = None;
    if let Some(channel) = channel {
        let pms = crate::services::pms_channel::PmsChannelClient::from_settings(state.config())?;
        // The PMS needs the received amount — it doesn't persist the
        // guest's deposit50/full choice.
        match pms
            .payment_verified(&channel.pms_booking_id, channel.amount_received)
            .await
        {
            Ok(()) => {},
            // The PMS answered and said no — a 409 for a hold it has already
            // released, per docs/loyalty-channel.md. Retrying cannot change
            // that answer, so this is the end of the line for this booking:
            // refuse loudly instead of dressing an outage up as one.
            Err(PmsActionError::Refused { status, body }) => {
                return Err(refuse_channel_confirmation(
                    state.db(),
                    row.booking_id,
                    slip_id,
                    actor_id,
                    ChannelRefusal {
                        booking_status: channel.status.clone(),
                        hold_expires_at: channel.hold_expires_at,
                        pms_booking_id: channel.pms_booking_id.clone(),
                        pms_status: Some(status),
                        pms_body: Some(body),
                        detail: "the PMS refused the payment event".to_string(),
                    },
                )
                .await);
            },
            // Unchanged: the PMS could not answer. Surfacing the error is
            // what makes the admin press Verify again, and what makes the
            // automatic path run `revert_auto_confirm`.
            Err(e) => return Err(AppError::from(e)),
        }

        let flipped = sqlx::query!(
            r#"UPDATE bookings SET status = 'confirmed', updated_at = NOW()
               WHERE id = $1 AND status = 'pending'"#,
            row.booking_id
        )
        .execute(state.db())
        .await?;

        // B8 2.4, the line that made this fail open: `booking_confirmed` used
        // to be set to `true` here without ever reading `rows_affected()`,
        // and the INFO line below announced a confirmation the guarded
        // UPDATE had refused to make.
        if flipped.rows_affected() == 0 {
            let current = current_booking_status(state.db(), row.booking_id).await?;
            if current.as_deref().is_some_and(is_settled) {
                // The ordinary idempotent re-verify, or a balance slip from
                // a guest already in the room: the booking had already taken
                // its payment decision and the PMS took the event as a replay
                // (`already_confirmed: true`). Nothing moved, and reporting
                // `booking_confirmed = false` is the truth about *this* call.
                //
                // Note this must accept every `SETTLED_STATUSES` value, not
                // just `confirmed` — a `checked_in` booking never matches the
                // `status = 'pending'` guard above, and treating that as a
                // divergence refused a payment the PMS had just accepted.
                tracing::info!(
                    booking_id = %row.booking_id,
                    pms_booking_id = %channel.pms_booking_id,
                    status = current.as_deref().unwrap_or("unknown"),
                    "channel booking had already settled; the payment event was a replay"
                );
            } else {
                // The PMS accepted the payment and the local row is neither
                // `pending` nor `confirmed` — it moved under us, most likely
                // cancelled by the hold-expiry sweep between the pre-check
                // and now. Money received against a booking nobody can
                // serve: refuse, and put it in front of a human.
                return Err(refuse_channel_confirmation(
                    state.db(),
                    row.booking_id,
                    slip_id,
                    actor_id,
                    ChannelRefusal {
                        booking_status: current.unwrap_or_else(|| "unknown".to_string()),
                        hold_expires_at: channel.hold_expires_at,
                        pms_booking_id: channel.pms_booking_id.clone(),
                        pms_status: None,
                        pms_body: None,
                        detail: "the PMS accepted the payment but the local booking was no \
                                 longer pending"
                            .to_string(),
                    },
                )
                .await);
            }
        } else {
            booking_confirmed = true;
            tracing::info!(
                booking_id = %row.booking_id,
                pms_booking_id = %channel.pms_booking_id,
                "channel booking confirmed after slip verification"
            );
        }
    } else {
        // Every booking with no PMS hold behind it (A11): deposit request
        // links (B1) and ordinary in-app bookings alike. There is no PMS
        // booking to tell, so the verified slip IS the whole payment event:
        // flip the booking here or the guest pays and their page never
        // leaves `pending` / `checking`.
        //
        // The guard used to name `booking_source = 'deposit_link'`;
        // `pms_booking_id IS NULL` is the whole rule now, because
        // `booking_source` does not change what a received payment means.
        // See the module docs for what that does and does not fix today.
        //
        // Two conditions, and they do not apply to the same actors:
        //
        // * `status = 'pending'` — **both actors**. The only status a
        //   payment can move, and what makes this idempotent: re-verifying
        //   an already-confirmed booking updates no row and reports
        //   `booking_confirmed = false`, which is the truth — this call
        //   confirmed nothing. A cancelled or checked-out booking is not
        //   moved either, by anybody.
        // * the hold has not run out — **the machine only**. A deposit link
        //   stamps the link's expiry onto `hold_expires_at`, so a lapsed
        //   link's booking is one the automatic path must not confirm:
        //   `slipok_check` reads that column before the SlipOK call and
        //   already refuses on it, and this repeats the check after the call
        //   so a hold expiring mid-round-trip cannot slip through.
        //
        //   An admin's Verify skips it. `slipok_check` states the rule as
        //   "an admin may still override it by hand (that is a human
        //   decision); the automatic path may not", and it is the only way
        //   reception can finish a deposit-link booking whose link lapsed
        //   before the guest's transfer was looked at — a case
        //   `routes::deposit_links` deliberately keeps accepting uploads
        //   for. Applying the machine's rule to the human would delete the
        //   manual completion path B1 shipped, and leave no API able to put
        //   the booking right (`UpdateBookingRequest` carries no status).
        //
        // `$2` is that override: true when a human pressed Verify.
        let admin_override = actor.is_some();
        let flipped = sqlx::query!(
            r#"
            UPDATE bookings
            SET status = 'confirmed', updated_at = NOW()
            WHERE id = $1
              AND status = 'pending'
              AND pms_booking_id IS NULL
              AND ($2::boolean OR hold_expires_at IS NULL OR hold_expires_at > NOW())
            "#,
            row.booking_id,
            admin_override,
        )
        .execute(state.db())
        .await?;

        if flipped.rows_affected() == 0 {
            // Nothing moved. Two very different reasons, and only one of
            // them needs to reach a human: the booking was already
            // `confirmed` (the idempotent re-verify above — silence is
            // right), or it is still `pending` behind a lapsed hold (the
            // machine only; see above).
            //
            // The second is money received against a room that is no
            // longer held, and the verify must NOT confirm it. Record it
            // with the same vocabulary the automatic path uses for exactly
            // this state — `booking_not_payable`, the reason
            // `slipok_check` writes when it refuses to act on a perfect
            // slip — so the desk reads one word for one situation.
            //
            // It goes in `booking_audit_log`, not on the slip's
            // `slipok_*` columns: those carry the machine's own decision
            // (`shadow_pass` and its bank reference are what the
            // shadow-window agreement report counts), and overwriting them
            // from a human verify would destroy that record. The audit log
            // is append-only, is already what the booking detail page
            // renders, and is attributed to the same actor as the verify.
            //
            // Best-effort, deliberately: this runs *after* the slip
            // transaction committed, so a pool timeout on the re-read or the
            // insert must not turn a verify that already succeeded into a
            // failure. Propagating it would give the desk a 500 for a slip
            // the database already says is `verified`, and on the automatic
            // path `slipok_check` treats any `Err` from `confirm_slip` as
            // "auto-confirm failed" and calls `revert_auto_confirm` —
            // unwinding a verification that was never the thing that broke.
            // Losing the bookkeeping row is the smaller failure, and it is
            // loud: the ERROR below, plus the WARN the helper logs.
            booking_not_confirmed_reason =
                match booking_not_payable_reason(state.db(), row.booking_id, slip_id, actor_id)
                    .await
                {
                    Ok(reason) => reason,
                    Err(e) => {
                        tracing::error!(
                            slip_id = %slip_id,
                            booking_id = %row.booking_id,
                            error = %e,
                            "could not record why a verified slip did not confirm \
                             its booking; the verify itself stands"
                        );
                        None
                    },
                };
        } else {
            booking_confirmed = true;
            tracing::info!(
                booking_id = %row.booking_id,
                "booking confirmed after slip verification"
            );

            // The desk email for this confirmation (B0) is *not* fired here,
            // and deliberately so. Every caller of this function already
            // fires `BookingNotifyEvent::DepositVerified { slip_id }` after
            // it returns — the admin's Verify in `routes::admin_slips`, and
            // the automatic path via the event `run_slipok_check` hands back
            // to whichever upload handler ran it (`routes::bookings` and,
            // for a deposit link, `routes::deposit_links`). A second call in
            // here would be the same dedup key twice, and worse: the
            // automatic path runs this function *inside* the SlipOK latency
            // budget, and `notify` claims the event in `booking_notify_log`
            // before it spawns the send. A deadline landing between the
            // claim and the spawn is exactly the dropped message B0 moved
            // the call out of the budget to prevent.
        }
    }

    debug_assert_eq!(
        row.booking_id, booking_id,
        "caller passed a booking id that does not own this slip"
    );

    Ok(ConfirmOutcome {
        id: row.id,
        booking_id: row.booking_id,
        slip_url: row.slip_url,
        uploaded_at: row.uploaded_at,
        admin_status: row.admin_status,
        admin_verified_at: row.admin_verified_at,
        admin_verified_by: row.admin_verified_by,
        admin_notes: row.admin_notes,
        slipok_status: row.slipok_status,
        slipok_verified_at: row.slipok_verified_at,
        booking_confirmed,
        booking_not_confirmed_reason,
    })
}

/// The PMS-channel facts a confirmation needs, read in one go.
///
/// `status` and `hold_expires_at` are the two columns B8 found missing from
/// the old select (`admin_slips.rs:235-244`, now here): without them the
/// confirm path could not tell a live hold from one the sweep had already
/// released, and fired the payment event at both.
#[derive(Debug, Clone)]
struct ChannelBooking {
    pms_booking_id: String,
    /// What the guest was asked to pay now — the PMS does not persist the
    /// deposit50/full choice, so the amount travels with the event.
    amount_received: Decimal,
    status: String,
    hold_expires_at: Option<DateTime<Utc>>,
}

/// Whether a channel booking may still be told about a payment.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ChannelPayability {
    /// `pending` with a hold that has not run out — post the payment event
    /// and flip the local row.
    Payable,
    /// Already `confirmed`. The payment event is a replay (the PMS answers
    /// `already_confirmed: true`) and the local flip moves nothing; this is
    /// the ordinary re-verify, and it is not an error.
    AlreadyConfirmed,
    /// Nothing may be posted. `detail` says why, in one clause, and lands on
    /// the audit row a human reads.
    Refused { detail: String },
}

/// The statuses in which a channel booking has already taken its payment
/// decision, so a payment event is a **replay** rather than a change.
///
/// One list, used by both places that have to agree about it:
/// [`ChannelBooking::payability`] before the PMS call, and the zero-row
/// branch after it. They were written separately once and immediately
/// drifted — the pre-check accepted a checked-in guest and the post-check
/// did not, so a balance slip sailed past the first and was refused by the
/// second. Mirrors `new-hotel`'s own replay arm
/// (`"confirmed" | "checkedin" | "completed"`), which differs from this
/// vocabulary by spelling only.
const SETTLED_STATUSES: [&str; 4] = ["confirmed", "checked_in", "checked_out", "completed"];

/// True when a payment event against this status is a replay.
fn is_settled(status: &str) -> bool {
    SETTLED_STATUSES.contains(&status)
}

impl ChannelBooking {
    /// Decide locally **only what the PMS cannot tell us**, and ask the PMS
    /// about everything else.
    ///
    /// The first cut of this refused on `hold_expires_at` before calling the
    /// PMS, and that was wrong in a way that mattered: `new-hotel`'s
    /// `ChannelService::confirm_payment` matches on `book_status` and
    /// **never reads `book_hold_expires_at`**
    /// (`hotel-backend/src/service/channel.rs`). A hold whose clock has run
    /// out but which the PMS's own 5-minute sweep
    /// (`scheduler/jobs.rs:250`) has not reached yet is still `pending`
    /// there, and `payment-verified` confirms it with a 200. Refusing that
    /// locally threw away a booking the PMS was perfectly willing to
    /// honour — reception would have been told to re-book a room the guest
    /// already had.
    ///
    /// So the local clock decides nothing. The PMS is the authority on its
    /// own hold, and its 409 is the refusal (see
    /// `crate::services::pms_channel::PmsActionError::Refused`).
    ///
    /// What the local row *does* decide is the case where calling the PMS
    /// would be wrong regardless of its answer:
    ///
    /// * **`cancelled` / `no_show`** — we have already given this booking up.
    ///   Posting a payment event could only resurrect a deposit against a
    ///   booking nobody is holding. Refuse, without a call.
    /// * **`confirmed` / `checked_in` / `checked_out` / `completed`** — the
    ///   payment event is a replay, and the PMS says so itself: its
    ///   `"confirmed" | "checkedin" | "completed"` arm returns
    ///   `already_confirmed: true` with a 200. A balance slip against a
    ///   guest who is already in the room is an ordinary thing to receive,
    ///   not an error. The local flip then matches no row, which is the
    ///   truth about *this* call.
    /// * **`pending`** — ask the PMS.
    fn payability(&self) -> ChannelPayability {
        match self.status.as_str() {
            // Mirrors new-hotel's replay arm one-for-one. Note the
            // vocabularies differ by spelling only: this repo writes
            // `checked_in` / `checked_out`, the PMS writes `checkedin`.
            settled if is_settled(settled) => ChannelPayability::AlreadyConfirmed,
            "pending" => ChannelPayability::Payable,
            other => ChannelPayability::Refused {
                detail: format!("the local booking is '{other}', which cannot take a payment"),
            },
        }
    }
}

/// Read the channel facts for a booking, or `None` when it is not a channel
/// booking at all (`pms_booking_id IS NULL` — deposit links and ordinary
/// in-app bookings, handled by the branch below).
///
/// A runtime query on purpose: it needs no `.sqlx` offline-cache entry, and
/// the columns it adds over the query it replaces are plain reads.
async fn read_channel_booking(
    db: &sqlx::PgPool,
    booking_id: Uuid,
) -> AppResult<Option<ChannelBooking>> {
    let row: Option<(String, Decimal, String, Option<DateTime<Utc>>)> = sqlx::query_as(
        r#"
        SELECT pms_booking_id,
               COALESCE(amount_due_now, total_price),
               status,
               hold_expires_at
        FROM bookings
        WHERE id = $1 AND pms_booking_id IS NOT NULL
        "#,
    )
    .bind(booking_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(
        |(pms_booking_id, amount_received, status, hold_expires_at)| ChannelBooking {
            pms_booking_id,
            amount_received,
            status,
            hold_expires_at,
        },
    ))
}

/// The booking's status right now, for telling apart the reasons a guarded
/// `UPDATE` matched nothing.
async fn current_booking_status(db: &sqlx::PgPool, booking_id: Uuid) -> AppResult<Option<String>> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT status FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_optional(db)
            .await?,
    )
}

/// Everything a refusal has to put on the record.
#[derive(Debug, Clone)]
struct ChannelRefusal {
    booking_status: String,
    hold_expires_at: Option<DateTime<Utc>>,
    pms_booking_id: String,
    /// The HTTP status the PMS answered with, when the PMS is what refused.
    pms_status: Option<u16>,
    /// The PMS's response body, truncated by the client.
    pms_body: Option<String>,
    /// One clause saying which of the refusal shapes this is.
    detail: String,
}

/// Refuse to confirm a PMS-channel booking, and make the refusal impossible
/// to miss.
///
/// Four things happen, in this order, and the error is returned even if the
/// bookkeeping half fails — the one outcome that must never occur is a
/// caller reading 200 for a booking that did not move:
///
/// 1. **The booking is left exactly as it was.** No status write, no
///    `updated_at` touch. The room is the PMS's to give back, not ours.
/// 2. **The slip goes back to the desk** — `admin_status = 'needs_action'`
///    with `slipok_reason = booking_not_payable`, the same word
///    `routes::bookings::slipok_check` writes when it refuses to act on a
///    perfect slip against a dead booking, so reception reads one word for
///    one situation. `slipok_trans_ref` is deliberately **kept**: unlike the
///    PMS-outage revert (where the same booking will be retried and the
///    guest may legitimately re-upload), this booking is finished, and the
///    bank reference is the only link between the money that arrived and the
///    refusal. A `shadow_pass` keeps its `slipok_status` too — that column is
///    what the shadow-window agreement report counts, and a refusal is not a
///    machine decision about the slip.
/// 3. **An audit row** (`booking_not_confirmed`) carrying the booking's
///    state and, when the PMS is what refused, its status code and body.
/// 4. **A WARN**, and a 409 to the caller.
async fn refuse_channel_confirmation(
    db: &sqlx::PgPool,
    booking_id: Uuid,
    slip_id: Uuid,
    actor_id: Uuid,
    refusal: ChannelRefusal,
) -> AppError {
    let reason = crate::services::slip_match::REASON_BOOKING_NOT_PAYABLE;

    if let Err(e) =
        record_channel_refusal(db, booking_id, slip_id, actor_id, &refusal, reason).await
    {
        // The refusal itself still stands — the caller gets the 409 below and
        // the booking was never touched. What is lost is the desk's copy of
        // it, which is worth an ERROR and is not worth turning into a
        // different error for the admin.
        tracing::error!(
            slip_id = %slip_id,
            booking_id = %booking_id,
            error = %e,
            "could not record a refused channel confirmation; the refusal stands \
             but the slip may still read verified"
        );
    }

    tracing::warn!(
        slip_id = %slip_id,
        booking_id = %booking_id,
        pms_booking_id = %refusal.pms_booking_id,
        booking_status = %refusal.booking_status,
        hold_expires_at = ?refusal.hold_expires_at,
        pms_status = ?refusal.pms_status,
        reason = %reason,
        detail = %refusal.detail,
        "refusing to confirm a PMS channel booking from a verified slip; the \
         booking was left untouched and the slip needs a human"
    );

    AppError::Conflict(format!(
        "{reason}: {} — the booking was not confirmed and the slip is back in the \
         admin queue as needs_action. The room has to be re-booked at the desk.",
        refusal.detail
    ))
}

/// Longest PMS body allowed inside the *human-readable* audit reason.
///
/// Shorter than the 500 the structured `after_data.pmsResponse` keeps,
/// because this string is rendered as one line in the booking's history
/// list next to a Thai sentence. The full body is one field away for anyone
/// who needs it.
const MAX_PMS_BODY_IN_REASON: usize = 200;

/// Make a PMS response body safe to paste into a rendered audit line.
///
/// The body is whatever the PMS (or something in front of it) chose to send:
/// a Cloudflare Access challenge answers HTML, an nginx error page answers
/// markup, and either could carry a newline that breaks the history list
/// into pieces or an angle bracket a future renderer trusts. So: collapse
/// every run of whitespace (newlines and tabs included) to one space, drop
/// the characters that could open a tag or a quote, then cut to
/// [`MAX_PMS_BODY_IN_REASON`] **characters** — the body may well be Thai, so
/// counting bytes would split a codepoint.
///
/// The structured `after_data.pmsResponse` is unaffected: it is JSON, it is
/// never rendered as markup, and a reader who wants the whole answer reads
/// it there.
fn reason_safe_pms_body(body: &str) -> String {
    let cleaned: String = body
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !matches!(c, '<' | '>' | '"' | '\'' | '`' | '\\'))
        .collect();

    // One space between words, none at the ends.
    let mut collapsed = String::with_capacity(cleaned.len());
    let mut last_was_space = true;
    for c in cleaned.chars() {
        if c == ' ' {
            if !last_was_space {
                collapsed.push(c);
            }
            last_was_space = true;
        } else {
            collapsed.push(c);
            last_was_space = false;
        }
    }
    let collapsed = collapsed.trim_end();

    if collapsed.chars().count() <= MAX_PMS_BODY_IN_REASON {
        return collapsed.to_string();
    }
    let kept: String = collapsed.chars().take(MAX_PMS_BODY_IN_REASON).collect();
    format!("{kept}… (truncated)")
}

/// The write half of [`refuse_channel_confirmation`], in one transaction.
///
/// Runtime queries: the `slipok_*` columns are new in migration
/// `20260910000000_booking_slips_slipok.sql` and need no `.sqlx` entry.
async fn record_channel_refusal(
    db: &sqlx::PgPool,
    booking_id: Uuid,
    slip_id: Uuid,
    actor_id: Uuid,
    refusal: &ChannelRefusal,
    reason: &'static str,
) -> AppResult<()> {
    use sqlx::Row;

    let mut tx = db.begin().await?;

    let before = sqlx::query(
        r#"
        SELECT admin_status, admin_verified_by, slipok_status, slipok_reason
        FROM booking_slips
        WHERE id = $1
        FOR UPDATE
        "#,
    )
    .bind(slip_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    let before_admin_status: Option<String> = before.try_get("admin_status")?;
    let before_verified_by: Option<Uuid> = before.try_get("admin_verified_by")?;
    let before_slipok_status: Option<String> = before.try_get("slipok_status")?;
    let before_slipok_reason: Option<String> = before.try_get("slipok_reason")?;

    // Exactly two columns move, and the restraint is the point.
    //
    // **`admin_status`** — the slip goes back to the desk queue. This is the
    // whole operational signal, and it is also the flag
    // `revert_auto_confirm` reads to know the refusal already dealt with
    // this slip.
    //
    // **`slipok_trans_ref`** — cleared. This booking is finished; reception
    // re-books the room, and the guest will upload the same transfer against
    // the new booking. Leaving the reference behind would make that upload
    // collide with the partial unique index and come back `duplicate`,
    // sending a guest who did nothing wrong into the manual queue a second
    // time. The reference is not lost: the audit row below carries the whole
    // story, and `booking_slips` keeps the amount and the decision.
    //
    // **`slipok_status` / `slipok_reason` / `slipok_checked_at` are left
    // alone**, and that is deliberate rather than an oversight. Those three
    // are the *machine's* record of what it thought of the slip, and they
    // are the sample the shadow-window agreement report counts. A refusal is
    // not a judgement about the slip — the money did arrive, the reference
    // did match — it is a judgement about the booking. Overwriting a
    // `shadow_pass` with `manual` / `booking_not_payable` would silently
    // move a row from the "machine and human agreed" column to the "machine
    // sent it to a human" column and quietly bias the decision to flip
    // `SLIPOK_AUTO_VERIFY`.
    //
    // `admin_verified_at` / `admin_verified_by` are not re-stamped either:
    // nobody verified anything here. On the PMS-409 path the slip
    // transaction has already stamped them, and that stamp is true — it
    // records the verify that then failed to confirm.
    let after = sqlx::query(
        r#"
        UPDATE booking_slips
        SET admin_status     = 'needs_action',
            slipok_trans_ref = NULL
        WHERE id = $1
        RETURNING admin_status, slipok_status, slipok_reason
        "#,
    )
    .bind(slip_id)
    .fetch_one(&mut *tx)
    .await?;

    let (reason_th, reason_en) =
        crate::services::booking_notify::reason_wording(reason).unwrap_or((reason, reason));

    insert_slip_audit_row(
        &mut *tx,
        booking_id,
        actor_id,
        ACTION_BOOKING_NOT_CONFIRMED,
        Some(json!({
            "status": refusal.booking_status,
            "holdExpiresAt": refusal.hold_expires_at,
            "adminStatus": before_admin_status,
            "adminVerifiedBy": before_verified_by,
            "slipokStatus": before_slipok_status,
            "slipokReason": before_slipok_reason,
        })),
        Some(json!({
            "status": refusal.booking_status,
            "holdExpiresAt": refusal.hold_expires_at,
            "slipId": slip_id,
            "reason": reason,
            "adminStatus": after.try_get::<Option<String>, _>("admin_status")?,
            "slipokStatus": after.try_get::<Option<String>, _>("slipok_status")?,
            "pmsBookingId": refusal.pms_booking_id,
            "pmsStatus": refusal.pms_status,
            "pmsResponse": refusal.pms_body,
            "detail": refusal.detail,
        })),
        Some(format!(
            "{reason_th} ({detail_th}) / {reason_en} ({reason}: {detail}{pms})",
            detail_th = "ยืนยันการจองกับระบบโรงแรมไม่สำเร็จ ตรวจสอบสลิปแล้วแต่ยังไม่ยืนยันการจอง",
            detail = refusal.detail,
            pms = match (refusal.pms_status, refusal.pms_body.as_deref()) {
                (Some(status), Some(body)) => {
                    format!("; PMS answered {status} {}", reason_safe_pms_body(body))
                },
                (Some(status), None) => format!("; PMS answered {status}"),
                _ => String::new(),
            },
        )),
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

/// The audit action written when a verified slip could not confirm the
/// booking it pays for.
///
/// A distinct action rather than a second `slip_verified` row: the verify
/// itself stands (the money did arrive, and the slip says so), but the
/// booking did not move, and the desk has to be able to see that from the
/// booking's own history. Counting rows by action must not confuse the two.
pub const ACTION_BOOKING_NOT_CONFIRMED: &str = "booking_not_confirmed";

/// Decide whether a booking that refused to flip did so because it is no
/// longer payable, and if so record it.
///
/// Called only when the `UPDATE` above matched no row, and in practice only
/// on the automatic path — an admin's Verify overrides an expired hold, so
/// the only zero-row case a human can produce is a booking that was not
/// `pending`, which is refused nothing and written nothing. Re-reads the
/// booking to tell the two cases apart:
///
/// * already `confirmed` (or cancelled, checked out, …) — nothing was
///   refused, so nothing is written and the caller reports `None`;
/// * still `pending` with a `hold_expires_at` in the past — the room is no
///   longer held, so the payment cannot confirm anything. One
///   `booking_not_confirmed` audit row, attributed to `actor_id` (the admin
///   who pressed Verify, or [`SLIPOK_SYSTEM_USER_ID`]) and carrying
///   [`crate::services::slip_match::REASON_BOOKING_NOT_PAYABLE`] as its
///   reason, plus a WARN.
///
/// Runtime queries throughout: nothing here needs the `.sqlx` offline cache,
/// and the audit insert goes through the shared helper.
async fn booking_not_payable_reason(
    db: &sqlx::PgPool,
    booking_id: Uuid,
    slip_id: Uuid,
    actor_id: Uuid,
) -> AppResult<Option<&'static str>> {
    let row: Option<(String, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT status, hold_expires_at FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_optional(db)
            .await?;

    let Some((status, hold_expires_at)) = row else {
        return Ok(None);
    };

    let expired_hold = hold_expires_at.is_some_and(|expires| expires <= Utc::now());
    if status != "pending" || !expired_hold {
        return Ok(None);
    }

    let reason = crate::services::slip_match::REASON_BOOKING_NOT_PAYABLE;

    // The desk reads this row in the booking's history, in Thai. Reuse the
    // locked `payment.slipok.reason.*` pair (PR #404) rather than inventing
    // a second sentence for the same situation — the slip badge and this row
    // then say the same thing. Falling back to the key keeps a wording table
    // that lost the entry from producing an empty reason.
    let (reason_th, reason_en) =
        crate::services::booking_notify::reason_wording(reason).unwrap_or((reason, reason));

    insert_slip_audit_row(
        db,
        booking_id,
        actor_id,
        ACTION_BOOKING_NOT_CONFIRMED,
        Some(json!({ "status": status, "holdExpiresAt": hold_expires_at })),
        Some(json!({
            "status": status,
            "holdExpiresAt": hold_expires_at,
            "slipId": slip_id,
            "reason": reason,
        })),
        Some(format!(
            "{reason_th} (หมดเวลาถือห้องแล้ว ตรวจสอบสลิปแล้วแต่ยังไม่ยืนยันการจอง) / \
             {reason_en} ({reason}: slip verified, hold had already expired)"
        )),
    )
    .await?;

    tracing::warn!(
        booking_id = %booking_id,
        slip_id = %slip_id,
        reason = %reason,
        "slip verified against a booking whose hold had expired; the booking \
         was left unconfirmed and needs a human"
    );

    Ok(Some(reason))
}

/// The audit action written when an automatic confirmation is undone.
///
/// A distinct action rather than a second `slip_verified` row: the
/// shadow-window agreement report and the human-touch KPI both count
/// `slip_verified` rows owned by [`SLIPOK_SYSTEM_USER_ID`], and a verify
/// that was rolled back must not be counted as a decision that held.
pub const ACTION_SLIP_VERIFY_REVERTED: &str = "slip_verify_reverted";

/// Undo a half-finished automatic confirmation.
///
/// [`confirm_slip`] commits the slip's `admin_status` — and the
/// `slip_verified` audit row naming [`SLIPOK_SYSTEM_USER_ID`] — before it
/// calls the PMS, so a PMS failure on the automatic path would otherwise
/// leave a slip that claims to be verified against a booking that never got
/// confirmed. Nobody retries it: there is no admin holding a button. Put the
/// slip back in the admin's queue, say why, and **contradict the audit row
/// in the audit log**, so the history cannot permanently assert a verify
/// that was rolled back.
///
/// Lives here rather than in `routes::bookings` because it is the
/// compensating half of [`confirm_slip`]: the two must agree on the actor,
/// on the audit contract and on which writes are one transaction. Being
/// `pub` is also what lets the integration suite drive the admin-won-the-race
/// branch directly, which no HTTP-level fixture can reach.
///
/// Returns `true` when the slip was reverted, and `false` in the two cases
/// where there is nothing to take back: an admin had verified the slip in
/// the meantime and their decision stands, or a channel refusal had already
/// moved it to `needs_action` and said why.
///
/// Runtime queries, like the rest of the `slipok_*` writes: those columns are
/// new in migration `20260910000000_booking_slips_slipok.sql` and a runtime
/// query needs no `.sqlx` offline-cache entry.
pub async fn revert_auto_confirm(db: &sqlx::PgPool, slip_id: Uuid) -> AppResult<bool> {
    use sqlx::Row;

    let mut tx = db.begin().await?;

    // `FOR UPDATE` is what makes the guard below sound: an admin pressing
    // Verify between this read and the UPDATE would otherwise have their
    // stamp overwritten by the revert.
    let before = sqlx::query(
        r#"
        SELECT booking_id, admin_status, admin_verified_at, admin_verified_by,
               slipok_status, slipok_reason, slipok_trans_ref
        FROM booking_slips
        WHERE id = $1
        FOR UPDATE
        "#,
    )
    .bind(slip_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    let booking_id: Uuid = before.try_get("booking_id")?;
    let before_admin_status: Option<String> = before.try_get("admin_status")?;
    let before_verified_at: Option<DateTime<Utc>> = before.try_get("admin_verified_at")?;
    let before_verified_by: Option<Uuid> = before.try_get("admin_verified_by")?;
    let before_slipok_status: Option<String> = before.try_get("slipok_status")?;
    let before_slipok_reason: Option<String> = before.try_get("slipok_reason")?;
    let before_trans_ref: Option<String> = before.try_get("slipok_trans_ref")?;

    // Stand aside for a refusal that has already put this slip right — and
    // for **nothing else**.
    //
    // `slipok_check` calls this on *any* `Err` from `confirm_slip`, and
    // those errors are not all alike:
    //
    // * **A channel refusal** (`refuse_channel_confirmation`) has already
    //   moved the slip to `needs_action` and cleared `slipok_trans_ref`, and
    //   wrote a `booking_not_confirmed` audit row saying why. Reverting on
    //   top of that would reset it to `pending` / `confirm_failed` and
    //   replace a precise reason with a vague one. Skip.
    // * **Everything else** — a PMS outage, a pool timeout, a failure
    //   *before* the slip transaction committed — must still be reverted,
    //   and this is the case an earlier version of this guard got wrong. It
    //   tested `admin_status != 'verified'` and skipped, which quietly left
    //   the pre-commit failure behind: `record_slipok_result` had already
    //   written `slipok_status = 'verified'` and stored the bank reference,
    //   so the slip sat on `pending` with a `slipok_trans_ref` nobody would
    //   ever clear — and the guest's perfectly good re-upload came back
    //   `duplicate` against the partial unique index.
    //
    // So the test is the refusal's own signature, not the absence of a
    // verify. `admin_status = 'needs_action'` is what
    // `refuse_channel_confirmation` writes and the only way a slip reaches
    // this function in that state; an admin who marked it by hand did not
    // come through `slipok_check`, and standing aside for them is right
    // anyway.
    if before_admin_status.as_deref() == Some("needs_action") {
        tx.rollback().await?;
        tracing::info!(
            slip_id = %slip_id,
            booking_id = %booking_id,
            slipok_reason = ?before_slipok_reason,
            "nothing to revert: the slip is already on needs_action, which is \
             where the channel refusal put it"
        );
        return Ok(false);
    }

    // Never undo an admin's own verification, only the machine's. NULL is
    // accepted too, so a slip verified by an older build — before the system
    // actor existed — can still be reverted.
    if !(before_verified_by.is_none() || is_slipok_actor(before_verified_by)) {
        tx.rollback().await?;
        tracing::warn!(
            slip_id = %slip_id,
            booking_id = %booking_id,
            admin_verified_by = ?before_verified_by,
            "Automatic confirmation failed part-way, but an admin had already \
             verified this slip; leaving their decision standing. The slip \
             reads verified against a booking the PMS did not confirm — \
             someone has to reconcile it by hand."
        );
        return Ok(false);
    }

    let after = sqlx::query(
        r#"
        UPDATE booking_slips
        SET admin_status      = 'pending',
            admin_verified_at = NULL,
            admin_verified_by = NULL,
            slipok_status     = $1,
            slipok_reason     = $2,
            slipok_trans_ref  = NULL,
            slipok_checked_at = NOW()
        WHERE id = $3
        RETURNING admin_status, admin_verified_at, admin_verified_by, slipok_status
        "#,
    )
    .bind(crate::services::slip_match::SLIPOK_STATUS_MANUAL)
    .bind(crate::services::slip_match::REASON_CONFIRM_FAILED)
    .bind(slip_id)
    .fetch_one(&mut *tx)
    .await?;

    let before_json = json!({
        "adminStatus": before_admin_status,
        "adminVerifiedBy": before_verified_by,
        "adminVerifiedAt": before_verified_at,
        "slipokStatus": before_slipok_status,
        "slipokTransRef": before_trans_ref,
        "slipId": slip_id,
    });
    let after_json = json!({
        "adminStatus": after.try_get::<Option<String>, _>("admin_status")?,
        "adminVerifiedBy": after.try_get::<Option<Uuid>, _>("admin_verified_by")?,
        "adminVerifiedAt": after.try_get::<Option<DateTime<Utc>>, _>("admin_verified_at")?,
        "slipokStatus": after.try_get::<Option<String>, _>("slipok_status")?,
        "slipokReason": crate::services::slip_match::REASON_CONFIRM_FAILED,
        "slipId": slip_id,
    });

    // Written inside the same transaction as the revert: the desk must never
    // read the machine's verify without the row that takes it back.
    insert_slip_audit_row(
        &mut *tx,
        booking_id,
        SLIPOK_SYSTEM_USER_ID,
        ACTION_SLIP_VERIFY_REVERTED,
        Some(before_json),
        Some(after_json),
        Some(format!(
            "Automatic verification reverted ({}): confirming the booking failed after the slip was marked verified",
            crate::services::slip_match::REASON_CONFIRM_FAILED
        )),
    )
    .await?;

    tx.commit().await?;

    tracing::warn!(
        slip_id = %slip_id,
        booking_id = %booking_id,
        "Automatic verification reverted; slip returned to the manual queue"
    );

    Ok(true)
}

/// Read a slip row as a [`ConfirmOutcome`] without changing it.
///
/// Used when the automatic path finds the slip already verified. A runtime
/// query rather than the macro: `slipok_*` columns are new in migration
/// `20260910000000_booking_slips_slipok.sql` and a runtime query needs no
/// `.sqlx` offline-cache entry.
async fn read_outcome(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    slip_id: Uuid,
) -> Result<ConfirmOutcome, AppError> {
    use sqlx::Row;

    let row = sqlx::query(
        r#"
        SELECT id, booking_id, slip_url, uploaded_at, admin_status,
               admin_verified_at, admin_verified_by, admin_notes,
               slipok_status, slipok_verified_at
        FROM booking_slips
        WHERE id = $1
        "#,
    )
    .bind(slip_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    Ok(ConfirmOutcome {
        id: row.try_get("id")?,
        booking_id: row.try_get("booking_id")?,
        slip_url: row.try_get("slip_url")?,
        uploaded_at: row.try_get("uploaded_at")?,
        admin_status: row.try_get("admin_status")?,
        admin_verified_at: row.try_get("admin_verified_at")?,
        admin_verified_by: row.try_get("admin_verified_by")?,
        admin_notes: row.try_get("admin_notes")?,
        slipok_status: row.try_get("slipok_status")?,
        slipok_verified_at: row.try_get("slipok_verified_at")?,
        booking_confirmed: false,
        booking_not_confirmed_reason: None,
    })
}

/// Insert a single `booking_audit_log` row from inside the caller's
/// transaction. Mirrors `routes::admin_bookings::insert_audit_row`
/// (kept local rather than `pub`-ing the original to avoid coupling
/// admin_slips to admin_bookings's internals — both files are part of
/// the admin surface and share the audit-row contract by convention,
/// not by import).
pub(crate) async fn insert_slip_audit_row<'c, E>(
    executor: E,
    booking_id: Uuid,
    admin_id: Uuid,
    action: &str,
    before_data: Option<serde_json::Value>,
    after_data: Option<serde_json::Value>,
    reason: Option<String>,
) -> AppResult<()>
where
    E: sqlx::Executor<'c, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO booking_audit_log
            (booking_id, admin_id, action, before_data, after_data, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        booking_id,
        admin_id,
        action,
        before_data,
        after_data,
        reason,
    )
    .execute(executor)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The system actor's id is a cross-repo constant (the migration that
    /// seeds the row, the admin surfaces and the shadow-window report all
    /// hard-code it). A typo here would silently attribute every automatic
    /// verify to a row that does not exist, and the FK would then fail the
    /// whole confirmation.
    #[test]
    fn slipok_system_user_id_is_the_locked_value() {
        assert_eq!(
            SLIPOK_SYSTEM_USER_ID.hyphenated().to_string(),
            "00000000-0000-4000-8000-0000005110b0"
        );
    }

    /// The audit row a refused confirmation writes is rendered to reception
    /// in Thai. It borrows the locked `payment.slipok.reason.*` pair rather
    /// than carrying its own wording, so the entry has to exist — otherwise
    /// the row silently degrades to the bare English key.
    #[test]
    fn the_refusal_reason_has_locked_thai_wording() {
        let reason = crate::services::slip_match::REASON_BOOKING_NOT_PAYABLE;
        let (th, en) = crate::services::booking_notify::reason_wording(reason)
            .expect("booking_not_payable must have locked wording");
        assert!(!th.is_ascii(), "the Thai half must actually be Thai: {th}");
        assert!(!en.is_empty());
    }

    #[test]
    fn is_slipok_actor_only_matches_the_system_actor() {
        assert!(is_slipok_actor(Some(SLIPOK_SYSTEM_USER_ID)));
        assert!(!is_slipok_actor(Some(Uuid::new_v4())));
        assert!(!is_slipok_actor(None));
    }
}
