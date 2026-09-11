//! PDPA account erasure (F3, gap P1-3 of `docs/privacy/2026-09-pdpa-data-map.md`).
//!
//! ## What "deletion" used to mean, and why it was a P1 defect
//!
//! `DELETE /api/users/account` ran `UPDATE users SET is_active = false`
//! and stopped there. Every identifier survived that, with three
//! consequences the data map (§6 "Deletion today") called out:
//!
//! 1. `users.oauth_provider_id` still resolved, so `push_to_member`
//!    still found a LINE userId and still pushed to a "deleted" member.
//! 2. The `line_friendships` rows, keyed on that same LINE userId,
//!    stayed linked and friended.
//! 3. The next LINE or Google login matched the same row by provider id
//!    (or by email) and silently resurrected the account.
//!
//! ## What it means now
//!
//! [`erase_account`] runs one transaction that severs the person from
//! every identity and delivery path while leaving the money and the
//! accountability trail intact:
//!
//! | Table | What happens | Why |
//! |---|---|---|
//! | `users` | `email`, `password_hash`, `oauth_provider`, `oauth_provider_id` nulled/blanked; `is_active = false`; `email_verified = false`; `deleted_at = NOW()` | The row (and therefore the id) survives so everything below stays attributable |
//! | `user_profiles` | `first_name`, `last_name`, `phone`, `date_of_birth`, `avatar_url` nulled, `preferences` emptied; `membership_id` kept | `membership_id` is a pseudonymous program key, not a personal identifier, and it is `NOT NULL` |
//! | `line_friendships` | rows for that LINE userId **deleted** | The row *is* the LINE userId — marking `is_friend = false` would keep holding the identifier we were asked to erase. A genuine later follow event re-creates it for whatever account exists then |
//! | `refresh_tokens` | deleted | Erasure that leaves a live session open is not erasure |
//! | `notifications` | deleted | In-app inbox rows carry rendered names in `title`/`message` and nobody can ever read them again |
//! | `user_audit_log` | `ip_address` and `user_agent` nulled, rows kept | Leaves the audit "attributable by user id only", which is exactly what the data map asks for |
//! | `bookings`, `booking_slips`, `points_transactions`, `stays`, `user_loyalty`, `booking_audit_log` | **untouched** | Accounting and audit records (§6: bookings 5 years). Admins still list them under the old user id |
//! | `user_deletions` | one audit row written | Who, when, what was anonymised, how many push rows were severed — and no personal data |
//!
//! ## The trade-off, stated plainly
//!
//! A subsequent LINE or Google login with the same provider id creates a
//! **new** account with a **new** user id. The erased account's points,
//! tier and night count cannot be reclaimed, because the only link back
//! to them was the provider id we just destroyed — and keeping that link
//! is precisely the defect this module fixes. There is no "undo": the
//! guest-facing copy has to say so before the button is pressed.
//!
//! ## Why the exclusion is a view, not a filter
//!
//! Push and login resolve through the `push_targets` / `login_identities`
//! views (migration `20260914020000_account_deletion.sql`). A new dispatch
//! query that forgets `AND deleted_at IS NULL` is invisible in review; one
//! that reads `users` instead of `push_targets` is a visible mistake in
//! the FROM clause. The nulling above makes the exclusion true even if a
//! query does go around the views — belt and braces, because a privacy
//! guarantee that depends on everyone remembering something is not one.

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;

/// Who asked for the erasure. Recorded in `user_deletions.actor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeletionActor {
    /// The member themselves, via `DELETE /api/users/account`.
    SelfService,
    /// An admin acting on a rights request, carrying the admin's user id.
    Admin(Uuid),
}

impl DeletionActor {
    /// The `user_deletions.actor` discriminator (`chk_user_deletions_actor`).
    fn as_str(self) -> &'static str {
        match self {
            Self::SelfService => "self",
            Self::Admin(_) => "admin",
        }
    }

    /// `user_deletions.requested_by` — `None` for a self-service erase.
    fn requested_by(self) -> Option<Uuid> {
        match self {
            Self::SelfService => None,
            Self::Admin(id) => Some(id),
        }
    }
}

/// The columns [`erase_account`] nulls or blanks, recorded verbatim in
/// `user_deletions.anonymised_fields`.
///
/// Field *names* only. The values that were in them are what the erase
/// destroyed; writing any of them into the audit row would defeat it.
pub const ANONYMISED_FIELDS: &[&str] = &[
    "users.email",
    "users.password_hash",
    "users.oauth_provider",
    "users.oauth_provider_id",
    "user_profiles.first_name",
    "user_profiles.last_name",
    "user_profiles.phone",
    "user_profiles.date_of_birth",
    "user_profiles.avatar_url",
    "user_profiles.preferences",
    "user_audit_log.ip_address",
    "user_audit_log.user_agent",
];

/// What one erasure did. All counts are zero on a repeat call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeletionOutcome {
    /// `true` when the account was already erased and this call changed
    /// nothing — the idempotent second `DELETE`.
    pub already_erased: bool,
    /// `line_friendships` rows removed (0-2: one per property OA).
    pub line_friendships_severed: i64,
    /// Live sessions invalidated.
    pub refresh_tokens_revoked: i64,
    /// In-app notification rows removed.
    pub notifications_purged: i64,
    /// `user_audit_log` rows whose IP / user-agent were nulled.
    pub audit_rows_depersonalised: i64,
}

/// Erase one account.
///
/// Returns `Ok(None)` when no such user row exists (the caller should
/// answer 404). Returns `Ok(Some(outcome))` otherwise, with
/// [`DeletionOutcome::already_erased`] set when the account had already
/// been erased — the whole call is a no-op in that case and **no second
/// `user_deletions` row is written**, which is what makes the endpoint
/// idempotent rather than merely tolerant of a repeat.
///
/// Everything happens in one transaction behind a `SELECT … FOR UPDATE`
/// on the user row, so two concurrent deletes serialise: the second sees
/// `deleted_at` already set and takes the no-op branch.
pub async fn erase_account(
    db: &PgPool,
    user_id: Uuid,
    actor: DeletionActor,
) -> AppResult<Option<DeletionOutcome>> {
    let mut tx = db.begin().await?;

    // Lock the row first. Without this, two concurrent deletes both read
    // deleted_at IS NULL and both try to INSERT the audit row; the unique
    // index would reject the loser with a 500 instead of a clean no-op.
    let existing = sqlx::query!(
        r#"SELECT oauth_provider, oauth_provider_id, deleted_at
           FROM users
           WHERE id = $1
           FOR UPDATE"#,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(existing) = existing else {
        tx.rollback().await?;
        return Ok(None);
    };

    if existing.deleted_at.is_some() {
        tx.rollback().await?;
        return Ok(Some(DeletionOutcome {
            already_erased: true,
            line_friendships_severed: 0,
            refresh_tokens_revoked: 0,
            notifications_purged: 0,
            audit_rows_depersonalised: 0,
        }));
    }

    // The provider *name* is kept for the audit row; the provider id is
    // used once, here, to find the friendship rows, and is then gone.
    let provider = existing.oauth_provider.clone();

    // 1. Push targeting: drop the friendship rows keyed on this LINE
    //    userId. `push_to_member` needs both the users row and a friended
    //    OA, so this is the second of two independent severings.
    let line_friendships_severed =
        match (provider.as_deref(), existing.oauth_provider_id.as_deref()) {
            (Some("line"), Some(line_user_id)) => sqlx::query!(
                r#"DELETE FROM line_friendships WHERE line_user_id = $1"#,
                line_user_id
            )
            .execute(&mut *tx)
            .await?
            .rows_affected() as i64,
            _ => 0,
        };

    // 2. Sessions.
    let refresh_tokens_revoked =
        sqlx::query!(r#"DELETE FROM refresh_tokens WHERE user_id = $1"#, user_id)
            .execute(&mut *tx)
            .await?
            .rows_affected() as i64;

    // 3. In-app inbox — the rendered copy carries the member's own name.
    let notifications_purged =
        sqlx::query!(r#"DELETE FROM notifications WHERE user_id = $1"#, user_id)
            .execute(&mut *tx)
            .await?
            .rows_affected() as i64;

    // 4. Keep the audit rows, drop the personal data on them, so the log
    //    stays attributable by user id and nothing else.
    let audit_rows_depersonalised = sqlx::query!(
        r#"UPDATE user_audit_log
           SET ip_address = NULL, user_agent = NULL
           WHERE user_id = $1
             AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)"#,
        user_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    // 5. The profile. `membership_id` survives — it is NOT NULL and it is
    //    a pseudonymous program key, not a way back to the person.
    sqlx::query!(
        r#"UPDATE user_profiles
           SET first_name    = NULL,
               last_name     = NULL,
               phone         = NULL,
               date_of_birth = NULL,
               avatar_url    = NULL,
               preferences   = '{}'::jsonb,
               updated_at    = NOW()
           WHERE user_id = $1"#,
        user_id
    )
    .execute(&mut *tx)
    .await?;

    // 6. The identity row itself. `email = NULL` rather than a synthetic
    //    placeholder: `users_email_unique` permits many NULLs but only one
    //    of any given string, so placeholders would collide on the second
    //    erasure. NULL also means the Google lookup (`WHERE email = $1 OR
    //    …`) and the password login can never match it again.
    sqlx::query!(
        r#"UPDATE users
           SET email             = NULL,
               password_hash     = '',
               email_verified    = false,
               is_active         = false,
               oauth_provider    = NULL,
               oauth_provider_id = NULL,
               deleted_at        = NOW(),
               updated_at        = NOW()
           WHERE id = $1"#,
        user_id
    )
    .execute(&mut *tx)
    .await?;

    // 7. The accountability row. No personal data: a user id, a provider
    //    name, timestamps and counts.
    let anonymised: Vec<String> = ANONYMISED_FIELDS.iter().map(|f| (*f).to_string()).collect();
    sqlx::query!(
        r#"INSERT INTO user_deletions (
               user_id, requested_by, actor, anonymised_fields, oauth_provider,
               line_friendships_severed, refresh_tokens_revoked,
               notifications_purged, audit_rows_depersonalised
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        user_id,
        actor.requested_by(),
        actor.as_str(),
        &anonymised,
        provider,
        line_friendships_severed as i32,
        refresh_tokens_revoked as i32,
        notifications_purged as i32,
        audit_rows_depersonalised as i32,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Deliberately no user id, provider id or email in the log line.
    tracing::info!(
        actor = actor.as_str(),
        line_friendships_severed,
        refresh_tokens_revoked,
        notifications_purged,
        audit_rows_depersonalised,
        "Account erased (PDPA)"
    );

    Ok(Some(DeletionOutcome {
        already_erased: false,
        line_friendships_severed,
        refresh_tokens_revoked,
        notifications_purged,
        audit_rows_depersonalised,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_discriminators_match_the_check_constraint() {
        assert_eq!(DeletionActor::SelfService.as_str(), "self");
        assert_eq!(DeletionActor::Admin(Uuid::new_v4()).as_str(), "admin");
    }

    #[test]
    fn self_service_records_no_requester() {
        assert!(DeletionActor::SelfService.requested_by().is_none());
        let admin = Uuid::new_v4();
        assert_eq!(DeletionActor::Admin(admin).requested_by(), Some(admin));
    }

    #[test]
    fn anonymised_field_list_names_columns_never_values() {
        // Every entry must be a `table.column` name. A stray value would
        // put personal data straight into the audit row.
        assert!(!ANONYMISED_FIELDS.is_empty());
        for field in ANONYMISED_FIELDS {
            assert!(
                field.starts_with("users.")
                    || field.starts_with("user_profiles.")
                    || field.starts_with("user_audit_log."),
                "unexpected entry in ANONYMISED_FIELDS: {field}"
            );
        }
        // The identifiers the data map §6 names explicitly.
        for required in [
            "users.oauth_provider_id",
            "users.email",
            "user_profiles.phone",
            "user_profiles.first_name",
        ] {
            assert!(
                ANONYMISED_FIELDS.contains(&required),
                "{required} must be anonymised"
            );
        }
    }
}
