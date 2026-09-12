//! LINE push budget guard (C5) — `services::push_budget` + the push path.
//!
//! Each guest OA is on the LINE free plan: ~300 pushes a month, split by the
//! program plan (§8) into 0 auto-verify / 50 ops / 200 campaign / 50 reserve.
//! The guard is worth having only if it actually refuses, actually refuses
//! *per bucket per OA per month*, and never turns a spent allowance into an
//! error a guest can see. Each test below is one of those sentences.

use chrono::{TimeZone, Utc};
use serde_json::Value;

use loyalty_backend::services::push_budget::{
    PushBucket, PushBudget, PushRefusal, PushResult, PushTargetHash,
};
use loyalty_backend::types::Property;

use crate::common::{test_app_state_config, TestApp, TestUser};

/// A LINE userId of the real shape — `U` + 32 hex characters — so the "no raw
/// id in the ledger" test has something recognisable to look for.
const LINE_USER_ID: &str = "U0123456789abcdef0123456789abcdef";

/// Settings with small caps, so a test can exhaust a bucket in a few calls
/// instead of fifty. The guard reads its numbers from config exactly the way
/// production does; only the numbers differ.
fn settings_with_caps(
    ops: u32,
    campaign: u32,
    reserve: u32,
    total: u32,
) -> loyalty_backend::Settings {
    let mut settings = test_app_state_config();
    settings.line_push_budget.ops = Some(ops.to_string());
    settings.line_push_budget.campaign = Some(campaign.to_string());
    settings.line_push_budget.reserve = Some(reserve.to_string());
    settings.line_push_budget.total = Some(total.to_string());
    settings
}

/// A LINE member friended to both OAs, the fixture the push path needs.
async fn create_line_member(
    pool: &sqlx::PgPool,
    email: &str,
    line_user_id: &str,
) -> Result<TestUser, sqlx::Error> {
    let user = TestUser::new(email);
    user.insert_with_profile(pool, "Somchai", "Jaidee").await?;

    sqlx::query("UPDATE users SET oauth_provider = 'line', oauth_provider_id = $2 WHERE id = $1")
        .bind(user.id)
        .bind(line_user_id)
        .execute(pool)
        .await?;

    for property in ["hf", "hfville"] {
        sqlx::query(
            "INSERT INTO line_friendships (line_user_id, property, is_friend) \
             VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING",
        )
        .bind(line_user_id)
        .bind(property)
        .execute(pool)
        .await?;
    }

    Ok(user)
}

async fn bucket_count(pool: &sqlx::PgPool, property: &str, bucket: &str, month: &str) -> i32 {
    sqlx::query_scalar::<_, i32>(
        "SELECT count FROM line_push_budget WHERE property = $1 AND bucket = $2 AND month = $3",
    )
    .bind(property)
    .bind(bucket)
    .bind(month)
    .fetch_optional(pool)
    .await
    .expect("budget read failed")
    .unwrap_or(0)
}

// ============================================================================
// 1. Counting and refusing at the cap
// ============================================================================

/// The headline behaviour: the bucket grants exactly its cap and then refuses,
/// and the refusal says which bucket and by how much it was over.
#[tokio::test]
async fn reserve_counts_and_refuses_at_the_cap() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let settings = settings_with_caps(3, 200, 50, 300);
    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);

    for expected in 1..=3u32 {
        let outcome = budget
            .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
            .await
            .expect("reserve must not error");
        let reservation = outcome
            .granted()
            .unwrap_or_else(|| panic!("push {expected} of 3 must be granted"));
        assert_eq!(reservation.used, expected);
        assert_eq!(reservation.limit, 3);
    }

    let refused = budget
        .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
        .await
        .expect("an exhausted bucket is a refusal, never an error");
    match refused.refusal() {
        Some(PushRefusal::BucketExhausted {
            bucket,
            used,
            limit,
        }) => {
            assert_eq!(*bucket, PushBucket::Ops);
            assert_eq!((*used, *limit), (3, 3));
        },
        other => panic!("expected a bucket_exhausted refusal, got {other:?}"),
    }

    // The refusal must not have been counted: a refused push spends nothing.
    let month = loyalty_backend::services::push_budget::month_key(Utc::now());
    assert_eq!(bucket_count(app.db(), "hf", "ops", &month).await, 3);

    app.cleanup().await.ok();
}

/// Buckets and OAs are independent ledgers. An exhausted ops bucket must not
/// stop a campaign, and HF's spending must not touch HF Ville's.
#[tokio::test]
async fn buckets_and_oas_are_counted_separately() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let settings = settings_with_caps(1, 1, 50, 300);
    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);

    assert!(budget
        .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
        .await
        .unwrap()
        .granted()
        .is_some());
    assert!(
        budget
            .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
            .await
            .unwrap()
            .refusal()
            .is_some(),
        "hf/ops is spent"
    );

    assert!(
        budget
            .reserve(app.db(), Property::Hf, PushBucket::Campaign, &target)
            .await
            .unwrap()
            .granted()
            .is_some(),
        "a spent ops bucket must not spend the campaign bucket"
    );
    assert!(
        budget
            .reserve(app.db(), Property::Hfville, PushBucket::Ops, &target)
            .await
            .unwrap()
            .granted()
            .is_some(),
        "each OA has its own free plan"
    );

    app.cleanup().await.ok();
}

/// The plan fixes auto-verify at zero, and a zero cap refuses the very first
/// push rather than granting one and refusing the second.
#[tokio::test]
async fn the_auto_verify_bucket_is_zero_and_refuses_immediately() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let budget = PushBudget::from_settings(&test_app_state_config());
    let target = PushTargetHash::of(LINE_USER_ID);

    let outcome = budget
        .reserve(app.db(), Property::Hf, PushBucket::AutoVerify, &target)
        .await
        .expect("reserve must not error");
    assert_eq!(
        outcome.refusal().map(PushRefusal::reason),
        Some("bucket_exhausted")
    );
    assert_eq!(budget.limits().auto_verify, 0);

    app.cleanup().await.ok();
}

/// The whole-OA ceiling is enforced on top of the per-bucket caps, so raising
/// one bucket by hand cannot overshoot what LINE actually gives us.
#[tokio::test]
async fn the_month_total_caps_the_oa_even_when_a_bucket_has_room() {
    let app = TestApp::new().await.expect("Failed to create test app");
    // Buckets sum to 4 but the OA is allowed 2 for the month.
    let settings = settings_with_caps(2, 2, 0, 2);
    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);

    assert!(budget
        .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
        .await
        .unwrap()
        .granted()
        .is_some());
    assert!(budget
        .reserve(app.db(), Property::Hf, PushBucket::Campaign, &target)
        .await
        .unwrap()
        .granted()
        .is_some());

    // The campaign bucket still has room; the OA does not.
    let refused = budget
        .reserve(app.db(), Property::Hf, PushBucket::Campaign, &target)
        .await
        .unwrap();
    match refused.refusal() {
        Some(PushRefusal::MonthTotalExhausted { used, limit }) => {
            assert_eq!((*used, *limit), (2, 2));
        },
        other => panic!("expected a month_total_exhausted refusal, got {other:?}"),
    }

    app.cleanup().await.ok();
}

// ============================================================================
// 2. Month rollover
// ============================================================================

/// A new month is a new allowance. The count is keyed by the Bangkok calendar
/// month, so the same exhausted bucket grants again on the first of the next.
#[tokio::test]
async fn a_new_month_starts_a_new_allowance() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let settings = settings_with_caps(1, 200, 50, 300);
    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);

    let january = Utc.with_ymd_and_hms(2026, 1, 15, 3, 0, 0).unwrap();
    let february = Utc.with_ymd_and_hms(2026, 2, 1, 3, 0, 0).unwrap();

    let first = budget
        .reserve_at(
            app.db(),
            Property::Hf,
            PushBucket::Ops,
            &target,
            false,
            january,
        )
        .await
        .unwrap();
    assert_eq!(
        first.granted().map(|r| r.month.clone()),
        Some("2026-01".into())
    );

    assert!(
        budget
            .reserve_at(
                app.db(),
                Property::Hf,
                PushBucket::Ops,
                &target,
                false,
                january
            )
            .await
            .unwrap()
            .refusal()
            .is_some(),
        "January's single push is spent"
    );

    let rolled = budget
        .reserve_at(
            app.db(),
            Property::Hf,
            PushBucket::Ops,
            &target,
            false,
            february,
        )
        .await
        .unwrap();
    let reservation = rolled
        .granted()
        .expect("February must start from zero, not inherit January's count");
    assert_eq!(reservation.month, "2026-02");
    assert_eq!(reservation.used, 1);

    // January's row is untouched — the rollover adds a row, it does not reset one.
    assert_eq!(bucket_count(app.db(), "hf", "ops", "2026-01").await, 1);
    assert_eq!(bucket_count(app.db(), "hf", "ops", "2026-02").await, 1);

    app.cleanup().await.ok();
}

// ============================================================================
// 3. The reserve bucket needs the override
// ============================================================================

/// The reserve bucket is held back for ops. Asking for it the ordinary way is
/// refused even when it is completely unspent — the override is the whole
/// access control, so a caller that does not say "this is ops" cannot have it.
#[tokio::test]
async fn the_reserve_bucket_refuses_without_the_override() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let settings = settings_with_caps(50, 200, 5, 300);
    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);
    let month = loyalty_backend::services::push_budget::month_key(Utc::now());

    let refused = budget
        .reserve(app.db(), Property::Hf, PushBucket::Reserve, &target)
        .await
        .expect("a missing override is a refusal, never an error");
    assert_eq!(
        refused.refusal(),
        Some(&PushRefusal::ReserveWithoutOverride),
        "the reserve bucket must not be drawable without an explicit override"
    );
    assert_eq!(
        bucket_count(app.db(), "hf", "reserve", &month).await,
        0,
        "a refused reserve must not consume the bucket it was refused from"
    );

    let granted = budget
        .reserve_with_override(app.db(), Property::Hf, PushBucket::Reserve, &target, true)
        .await
        .unwrap();
    assert!(
        granted.granted().is_some(),
        "ops with the override may draw on the reserve"
    );
    assert_eq!(bucket_count(app.db(), "hf", "reserve", &month).await, 1);

    app.cleanup().await.ok();
}

// ============================================================================
// 4. The ledger holds no raw LINE userId
// ============================================================================

/// The privacy guarantee. Every ledger row — granted, settled or refused —
/// carries a 64-hex SHA-256 of the LINE userId and nothing that looks like the
/// identifier itself.
#[tokio::test]
async fn the_ledger_row_never_contains_a_raw_line_user_id() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let settings = settings_with_caps(1, 200, 50, 300);
    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);

    let granted = budget
        .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
        .await
        .unwrap();
    let reservation = granted.granted().expect("first push is granted").clone();
    budget
        .settle(app.db(), &reservation, PushResult::Delivered)
        .await
        .expect("settle failed");

    // And a refusal row, which takes a different code path to the same table.
    budget
        .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
        .await
        .unwrap();

    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT target_hash, result FROM line_push_ledger ORDER BY sent_at, result")
            .fetch_all(app.db())
            .await
            .expect("ledger read failed");

    assert_eq!(rows.len(), 2, "both the send and the refusal are recorded");
    for (target_hash, result) in &rows {
        assert_ne!(target_hash, LINE_USER_ID);
        assert!(
            !target_hash.contains("U0123"),
            "the ledger must not carry the LINE userId in plain text"
        );
        assert_eq!(target_hash.len(), 64);
        assert!(target_hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(*target_hash, PushTargetHash::of(LINE_USER_ID).as_str());
        assert!(!result.is_empty());
    }
    assert_eq!(rows[0].1, "delivered");
    assert_eq!(rows[1].1, "refused_bucket_exhausted");

    // Belt and braces: the userId appears nowhere in the table at all.
    let leaked: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM line_push_ledger WHERE target_hash LIKE 'U%'")
            .fetch_one(app.db())
            .await
            .expect("scan failed");
    assert_eq!(leaked, 0);

    app.cleanup().await.ok();
}

/// The database refuses a raw identifier even if a future call site tries to
/// write one — the constraint, not the call site, is the guarantee.
#[tokio::test]
async fn the_ledger_constraint_rejects_a_raw_identifier() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let result = sqlx::query(
        "INSERT INTO line_push_ledger (property, bucket, month, target_hash, result) \
         VALUES ('hf', 'ops', '2026-09', $1, 'delivered')",
    )
    .bind(LINE_USER_ID)
    .execute(app.db())
    .await;

    assert!(
        result.is_err(),
        "a LINE userId must not be storable in target_hash"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 5. The push path
// ============================================================================

/// A refused push is a no-op, not an error: `push_to_member` answers
/// `budget_exhausted`, never `Err`, and nothing is sent. The OA here has a
/// channel token configured, so the only thing standing between the member
/// and a LINE call is the guard — if it let the push through, the test would
/// be trying to reach api.line.me.
#[tokio::test]
async fn push_to_member_refused_by_the_budget_is_a_no_op() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = create_line_member(app.db(), "budget-push@example.com", LINE_USER_ID)
        .await
        .expect("Failed to create LINE member");

    let mut settings = settings_with_caps(1, 200, 50, 300);
    settings.line_messaging.hf.access_token = Some("test-channel-token".to_string());
    settings.line_messaging.hf.channel_secret = Some("test-channel-secret".to_string());
    settings.line_messaging.hfville.access_token = Some("test-channel-token".to_string());
    settings.line_messaging.hfville.channel_secret = Some("test-channel-secret".to_string());

    let budget = PushBudget::from_settings(&settings);
    let target = PushTargetHash::of(LINE_USER_ID);
    let month = loyalty_backend::services::push_budget::month_key(Utc::now());

    // Spend both OAs' single ops push, so every candidate is out of budget.
    for property in [Property::Hf, Property::Hfville] {
        assert!(budget
            .reserve(app.db(), property, PushBucket::Ops, &target)
            .await
            .unwrap()
            .granted()
            .is_some());
    }

    let outcome = loyalty_backend::services::line::push_to_member(
        app.db(),
        &settings,
        user.id,
        Some(Property::Hf),
        PushBucket::Ops,
        "ขอบคุณที่เข้าพักค่ะ",
    )
    .await
    .expect("a spent budget must never surface as an error to the guest");

    assert!(!outcome.delivered());
    assert_eq!(
        outcome.reason(),
        "budget_exhausted",
        "the no-op must name the budget, so it is distinguishable from a \
         LINE misconfiguration in the logs"
    );
    assert_eq!(
        bucket_count(app.db(), "hf", "ops", &month).await,
        1,
        "a refused push must not consume more quota"
    );
    assert_eq!(bucket_count(app.db(), "hfville", "ops", &month).await, 1);

    app.cleanup().await.ok();
}

/// A member with no LINE identity never reaches the guard, so an erased or
/// non-LINE account cannot burn the month's allowance.
#[tokio::test]
async fn a_member_without_a_line_identity_spends_no_budget() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = TestUser::new("no-line@example.com");
    user.insert(app.db()).await.expect("insert failed");

    let settings = settings_with_caps(50, 200, 50, 300);
    let outcome = loyalty_backend::services::line::push_to_member(
        app.db(),
        &settings,
        user.id,
        None,
        PushBucket::Ops,
        "สวัสดีค่ะ",
    )
    .await
    .expect("push routing should not error");

    assert_eq!(outcome.reason(), "no_push_target");
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM line_push_budget")
        .fetch_one(app.db())
        .await
        .expect("count failed");
    assert_eq!(rows, 0, "no identity means no reservation");

    app.cleanup().await.ok();
}

// ============================================================================
// 6. The admin read endpoint
// ============================================================================

/// `GET /api/admin/line/push-budget` reports month-to-date usage per bucket
/// per OA, including the buckets and OAs that have no row yet — an operator
/// asking "how much is left" needs the zeroes as much as the counts.
#[tokio::test]
async fn admin_endpoint_reports_month_to_date_per_bucket_per_oa() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let budget = PushBudget::from_settings(&test_app_state_config());
    let target = PushTargetHash::of(LINE_USER_ID);
    for _ in 0..2 {
        budget
            .reserve(app.db(), Property::Hf, PushBucket::Ops, &target)
            .await
            .unwrap();
    }

    let admin = TestUser::admin("budget-admin@example.com");
    admin.insert(app.db()).await.expect("admin insert failed");
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client.get("/api/admin/line/push-budget").await;
    response.assert_success();

    let body: Value = response.json().expect("response must be JSON");
    assert_eq!(body["success"], true);
    assert_eq!(
        body["data"]["month"],
        loyalty_backend::services::push_budget::month_key(Utc::now())
    );
    assert_eq!(body["data"]["total_limit"], 300);

    let properties = body["data"]["properties"]
        .as_array()
        .expect("properties must be an array");
    assert_eq!(properties.len(), 2, "both OAs are always reported");

    let hf = properties
        .iter()
        .find(|p| p["property"] == "hf")
        .expect("hf must be reported");
    assert_eq!(hf["used"], 2);
    assert_eq!(hf["limit"], 300);
    assert_eq!(hf["remaining"], 298);

    let buckets = hf["buckets"].as_array().expect("buckets must be an array");
    assert_eq!(
        buckets.len(),
        4,
        "every bucket is reported, including the untouched ones"
    );
    let ops = buckets
        .iter()
        .find(|b| b["bucket"] == "ops")
        .expect("ops bucket");
    assert_eq!(ops["used"], 2);
    assert_eq!(ops["limit"], 50);
    assert_eq!(ops["remaining"], 48);

    let auto_verify = buckets
        .iter()
        .find(|b| b["bucket"] == "auto_verify")
        .expect("auto_verify bucket");
    assert_eq!(auto_verify["limit"], 0);
    assert_eq!(auto_verify["used"], 0);

    let hfville = properties
        .iter()
        .find(|p| p["property"] == "hfville")
        .expect("hfville must be reported even with no rows");
    assert_eq!(hfville["used"], 0);
    assert_eq!(hfville["remaining"], 300);

    app.cleanup().await.ok();
}

/// The budget is operational data about the OAs, not something a member sees.
#[tokio::test]
async fn admin_endpoint_refuses_a_non_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let member = TestUser::new("budget-member@example.com");
    member.insert(app.db()).await.expect("member insert failed");
    let client = app.authenticated_client(&member.id, &member.email);

    let response = client.get("/api/admin/line/push-budget").await;
    assert!(
        !response.is_success(),
        "a member must not read the OA push budget"
    );

    app.cleanup().await.ok();
}
