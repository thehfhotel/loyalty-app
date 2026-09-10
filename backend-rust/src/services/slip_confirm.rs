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
use serde_json::json;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
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
    pub slip_url: String,
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
    let channel_row = sqlx::query!(
        r#"
        SELECT pms_booking_id AS "pms_booking_id!",
               COALESCE(amount_due_now, total_price) AS "amount_received!"
        FROM bookings WHERE id = $1 AND pms_booking_id IS NOT NULL
        "#,
        row.booking_id
    )
    .fetch_optional(state.db())
    .await?;

    let mut booking_confirmed = false;
    let mut booking_not_confirmed_reason: Option<&'static str> = None;
    if let Some(channel) = channel_row {
        let pms_booking_id = channel.pms_booking_id;
        let pms = crate::services::pms_channel::PmsChannelClient::from_settings(state.config())?;
        // The PMS needs the received amount — it doesn't persist the
        // guest's deposit50/full choice.
        pms.payment_verified(&pms_booking_id, channel.amount_received)
            .await?;
        sqlx::query!(
            r#"UPDATE bookings SET status = 'confirmed', updated_at = NOW()
               WHERE id = $1 AND status = 'pending'"#,
            row.booking_id
        )
        .execute(state.db())
        .await?;
        booking_confirmed = true;
        tracing::info!(
            booking_id = %row.booking_id,
            pms_booking_id = %pms_booking_id,
            "channel booking confirmed after slip verification"
        );
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
            booking_not_confirmed_reason = match booking_not_payable_reason(
                state.db(),
                row.booking_id,
                slip_id,
                actor.unwrap_or(SLIPOK_SYSTEM_USER_ID),
            )
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
/// Returns `true` when the slip was reverted, `false` when an admin had
/// verified it in the meantime and their decision was left standing.
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
               slipok_status, slipok_trans_ref
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
    let before_trans_ref: Option<String> = before.try_get("slipok_trans_ref")?;

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
