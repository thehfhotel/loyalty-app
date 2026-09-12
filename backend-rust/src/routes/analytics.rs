//! Analytics routes
//!
//! Provides endpoints for tracking and retrieving analytics data including
//! coupon usage, profile changes, and user engagement metrics.
//!
//! ## Endpoints
//!
//! ### User Analytics (authenticated)
//! - `POST /coupon-usage` - Track a coupon usage event
//! - `POST /profile-change` - Track a profile change event
//!
//! ### Admin Analytics (admin only)
//! - `GET /coupon-usage` - Get coupon usage analytics
//! - `GET /profile-changes` - Get profile change analytics
//! - `GET /user-engagement` - Get user engagement metrics
//! - `GET /dashboard` - Get analytics dashboard summary
//! - `GET /deposit-funnel` - Deposit-request funnel counters (task D6)

use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    middleware,
    routing::{get, post},
    Json, Router,
};
use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, has_role, require_admin, AuthUser};
use crate::state::AppState;

// ============================================================================
// Request Types
// ============================================================================

/// Request to track coupon usage
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackCouponUsageRequest {
    pub coupon_id: String,
    pub user_coupon_id: Option<String>,
    pub event_type: String,
    pub source: Option<String>,
    pub metadata: Option<JsonValue>,
}

/// Request to track profile change
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackProfileChangeRequest {
    pub field: String,
    pub old_value: Option<String>,
    pub new_value: String,
    #[serde(default = "default_change_source")]
    pub change_source: String,
    pub metadata: Option<JsonValue>,
}

fn default_change_source() -> String {
    "user".to_string()
}

/// Query parameters for analytics endpoints
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub coupon_id: Option<String>,
    pub user_id: Option<String>,
}

/// Query parameters for dashboard
#[derive(Debug, Deserialize)]
pub struct DashboardQuery {
    #[serde(default = "default_period")]
    pub period: String,
}

fn default_period() -> String {
    "30".to_string()
}

// ============================================================================
// Response Types
// ============================================================================

/// Generic success response
#[derive(Debug, Serialize)]
pub struct SuccessResponse {
    pub success: bool,
    pub message: String,
}

/// Coupon usage analytics response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CouponUsageAnalytics {
    pub total_events: i64,
    pub unique_users: i64,
    pub conversion_rate: f64,
    pub events_by_type: JsonValue,
    pub top_sources: Vec<SourceCount>,
}

/// Source count for analytics
#[derive(Debug, Serialize, FromRow)]
pub struct SourceCount {
    pub source: Option<String>,
    pub count: i64,
}

/// Profile change analytics response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileChangeAnalytics {
    pub total_changes: i64,
    pub unique_users: i64,
    pub changes_by_field: JsonValue,
    pub completion_milestones: Vec<CompletionMilestone>,
}

/// Completion milestone info
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionMilestone {
    pub user_id: Uuid,
    pub completed_at: Option<DateTime<Utc>>,
}

/// User engagement metrics response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEngagementMetrics {
    pub active_users: i64,
    pub user_segments: JsonValue,
    pub avg_coupons_per_user: f64,
    pub avg_profile_changes_per_user: f64,
    pub top_users: Vec<TopUser>,
}

/// Top user info
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TopUser {
    pub user_id: Uuid,
    pub interaction_count: i64,
}

/// Dashboard response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResponse {
    pub success: bool,
    pub data: DashboardData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub period: String,
    pub coupon_usage: CouponUsageSummary,
    pub profile_changes: ProfileChangesSummary,
    pub user_engagement: UserEngagementSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CouponUsageSummary {
    pub total_events: i64,
    pub unique_users: i64,
    pub conversion_rate: f64,
    pub top_sources: Vec<SourceCount>,
    pub event_breakdown: JsonValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileChangesSummary {
    pub total_changes: i64,
    pub unique_users: i64,
    pub top_fields: Vec<FieldCount>,
    pub recent_completions: Vec<CompletionMilestone>,
}

#[derive(Debug, Serialize)]
pub struct FieldCount {
    pub field: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEngagementSummary {
    pub active_users: i64,
    pub user_segments: JsonValue,
    pub avg_interactions: AvgInteractions,
    pub top_users: Vec<TopUser>,
}

#[derive(Debug, Serialize)]
pub struct AvgInteractions {
    pub coupons: f64,
    pub profile_changes: f64,
}

// ============================================================================
// Deposit funnel (task D6)
// ============================================================================

/// Query parameters for `GET /analytics/deposit-funnel`.
///
/// Every field is optional. The default window is the last 30 days ending
/// today in Bangkok, every property, bucketed by day.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositFunnelQuery {
    /// First day of the window, inclusive, `YYYY-MM-DD` in Asia/Bangkok.
    pub start_date: Option<String>,
    /// Last day of the window, **inclusive**, `YYYY-MM-DD` in Asia/Bangkok.
    pub end_date: Option<String>,
    /// `day` (default) | `week` | `month`.
    pub granularity: Option<String>,
    /// `hf` | `hfville` | `unknown`. Omitted means every property.
    pub property: Option<String>,
}

/// The zone every bucket boundary is cut on.
///
/// Reception works Bangkok hours and the admin UI already renders every
/// timestamp in `Asia/Bangkok` (`frontend/src/utils/bangkokTime.ts`); cutting
/// "a day" on UTC would put the 07:00-and-earlier links of one working day
/// into the previous row and make the funnel disagree with the list the desk
/// is looking at. Postgres resolves the name from its own tzdata, so this is
/// the zone and not an offset — it is the counters that must match the UI,
/// not a constant.
const FUNNEL_TIME_ZONE: &str = "Asia/Bangkok";

/// Offset used *only* to decide what "today" is when the caller sends no
/// `endDate`. Thailand has had no DST since 1976 and a fixed +07:00 ever
/// since, so a `FixedOffset` is exact here and saves pulling in `chrono-tz`
/// for one default. Every bucket boundary is still cut by Postgres from
/// [`FUNNEL_TIME_ZONE`].
const FUNNEL_UTC_OFFSET_SECONDS: i32 = 7 * 3600;

/// Days the default window reaches back from `endDate`, inclusive of both
/// ends — 29 back plus today is 30 days.
const FUNNEL_DEFAULT_SPAN_DAYS: i64 = 29;

/// Longest window the endpoint will answer, inclusive of both ends.
///
/// The query is a live aggregate (see `docs/` note in the PR): at the
/// measured cost it is a few tens of milliseconds over a year of data, and
/// the cap exists so a mistyped `startDate` of `1970-01-01` cannot turn the
/// dashboard into a sequential scan of everything.
const FUNNEL_MAX_SPAN_DAYS: i64 = 366;

/// Properties the filter accepts. `unknown` is not a typo: `bookings.property`
/// is nullable and the member-app booking flow never writes it, so those rows
/// have to be reachable under some name rather than being silently
/// unreportable.
const FUNNEL_PROPERTIES: &[&str] = &["hf", "hfville", "unknown"];

/// Booking statuses that count as "confirmed" for the funnel.
///
/// There is no `confirmed_at` column and no status history: a booking that
/// was confirmed and has since been checked in, checked out or completed
/// reads as `checked_in` / `checked_out` / `completed` today, and dropping
/// those would make last month's conversion fall as guests arrive.
const FUNNEL_CONFIRMED_STATUSES: &[&str] = &["confirmed", "checked_in", "checked_out", "completed"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FunnelGranularity {
    Day,
    Week,
    Month,
}

impl FunnelGranularity {
    /// Also the `date_trunc()` field name, which is why there is no separate
    /// SQL mapping: the wire vocabulary and Postgres' agree.
    fn as_str(self) -> &'static str {
        match self {
            FunnelGranularity::Day => "day",
            FunnelGranularity::Week => "week",
            FunnelGranularity::Month => "month",
        }
    }
}

/// Machine verdict on the slip that currently stands for a link.
///
/// The five keys are exhaustive over `booking_slips.slipok_status`, so they
/// sum to `slipsUploaded` — a breakdown that does not add up is a breakdown
/// nobody can act on.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineVerdictCounts {
    pub verified: i64,
    pub shadow_pass: i64,
    pub manual: i64,
    pub unavailable: i64,
    pub pending: i64,
}

/// Human decision on the slip that currently stands for a link. Exhaustive
/// over `booking_slips.admin_status`, so these also sum to `slipsUploaded`.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanDecisionCounts {
    pub verified: i64,
    pub needs_action: i64,
    pub pending: i64,
}

/// Where confirmed bookings came from.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingSourceCounts {
    pub deposit_link: i64,
    pub app: i64,
    pub channel: i64,
}

impl BookingSourceCounts {
    /// `source` is produced by the SQL `CASE` below, so the fallback arm is
    /// unreachable in practice; it counts as `app` rather than vanishing,
    /// because a bookings total that silently loses rows is worse than one
    /// row filed under the wrong heading.
    fn add(&mut self, source: &str, count: i64) {
        match source {
            "deposit_link" => self.deposit_link += count,
            "channel" => self.channel += count,
            _ => self.app += count,
        }
    }
}

/// One row of the funnel — either a bucket, or the window's totals.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositFunnelCounters {
    pub links_issued: i64,
    pub links_opened: i64,
    pub slips_uploaded: i64,
    pub machine_verdict: MachineVerdictCounts,
    pub human_decision: HumanDecisionCounts,
    pub bookings_confirmed: i64,
    /// Median minutes from the link being issued to the guest's first slip,
    /// over the links in this row that got one. `null` when none did.
    pub median_minutes_link_to_slip: Option<f64>,
    /// Median minutes from a slip landing to an admin deciding it
    /// (`verified` or `needs_action`). `null` when nothing was decided.
    pub median_minutes_slip_to_decision: Option<f64>,
    /// Bookings **created** in this bucket that are confirmed today, split by
    /// where they came from. Deliberately a different cohort from
    /// `bookingsConfirmed` above, which counts *links* issued in the bucket
    /// whose booking is confirmed now — see the handler docs.
    pub bookings_by_source: BookingSourceCounts,
}

/// One bucket of the funnel.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositFunnelBucket {
    /// First day of the bucket, in `FUNNEL_TIME_ZONE`.
    pub bucket_start: NaiveDate,
    /// `hf` | `hfville` | `unknown`.
    pub property: String,
    #[serde(flatten)]
    pub counters: DepositFunnelCounters,
}

/// `GET /analytics/deposit-funnel` response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositFunnelResponse {
    pub granularity: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub property: Option<String>,
    pub timezone: String,
    pub totals: DepositFunnelCounters,
    pub buckets: Vec<DepositFunnelBucket>,
}

/// Raw funnel row. `bucket` and `property` are `NULL` on the one row produced
/// by the empty grouping set — that row is the window's totals.
#[derive(Debug, FromRow)]
struct FunnelRow {
    bucket: Option<NaiveDate>,
    property: Option<String>,
    links_issued: i64,
    links_opened: i64,
    slips_uploaded: i64,
    machine_verified: i64,
    machine_shadow_pass: i64,
    machine_manual: i64,
    machine_unavailable: i64,
    machine_pending: i64,
    human_verified: i64,
    human_needs_action: i64,
    human_pending: i64,
    bookings_confirmed: i64,
    median_link_to_slip: Option<f64>,
    median_slip_to_decision: Option<f64>,
}

/// Raw bookings-by-source row.
#[derive(Debug, FromRow)]
struct BookingSourceRow {
    bucket: NaiveDate,
    property: String,
    source: String,
    bookings_confirmed: i64,
}

// ============================================================================
// Valid Event Types
// ============================================================================

const VALID_COUPON_EVENT_TYPES: &[&str] = &[
    "view",
    "assign",
    "redeem_attempt",
    "redeem_success",
    "redeem_fail",
    "expire",
    "revoke",
];

const VALID_CHANGE_SOURCES: &[&str] = &["user", "admin", "system"];

// ============================================================================
// Handlers - User Analytics
// ============================================================================

/// POST /analytics/coupon-usage
/// Track a coupon usage event
async fn track_coupon_usage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<TrackCouponUsageRequest>,
) -> Result<(StatusCode, Json<SuccessResponse>), AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate required fields
    if payload.coupon_id.is_empty() {
        return Err(AppError::BadRequest("couponId is required".to_string()));
    }

    if payload.event_type.is_empty() {
        return Err(AppError::BadRequest("eventType is required".to_string()));
    }

    // Validate event type
    if !VALID_COUPON_EVENT_TYPES.contains(&payload.event_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid eventType. Must be one of: {}",
            VALID_COUPON_EVENT_TYPES.join(", ")
        )));
    }

    let coupon_id = Uuid::parse_str(&payload.coupon_id)
        .map_err(|_| AppError::BadRequest("Invalid coupon ID format".to_string()))?;

    let user_coupon_id = payload
        .user_coupon_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|_| AppError::BadRequest("Invalid user coupon ID format".to_string()))?;

    // Insert analytics record
    sqlx::query(
        r#"
        INSERT INTO coupon_usage_analytics
        (user_id, coupon_id, user_coupon_id, event_type, source, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        "#,
    )
    .bind(user_id)
    .bind(coupon_id)
    .bind(user_coupon_id)
    .bind(&payload.event_type)
    .bind(&payload.source)
    .bind(&payload.metadata)
    .execute(state.db())
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(SuccessResponse {
            success: true,
            message: "Coupon usage event tracked successfully".to_string(),
        }),
    ))
}

/// POST /analytics/profile-change
/// Track a profile change event
async fn track_profile_change(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<TrackProfileChangeRequest>,
) -> Result<(StatusCode, Json<SuccessResponse>), AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate required fields
    if payload.field.is_empty() {
        return Err(AppError::BadRequest("field is required".to_string()));
    }

    // Validate change source
    if !VALID_CHANGE_SOURCES.contains(&payload.change_source.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid changeSource. Must be one of: {}",
            VALID_CHANGE_SOURCES.join(", ")
        )));
    }

    // Insert analytics record
    sqlx::query(
        r#"
        INSERT INTO profile_change_analytics
        (user_id, field, old_value, new_value, change_source, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        "#,
    )
    .bind(user_id)
    .bind(&payload.field)
    .bind(&payload.old_value)
    .bind(&payload.new_value)
    .bind(&payload.change_source)
    .bind(&payload.metadata)
    .execute(state.db())
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(SuccessResponse {
            success: true,
            message: "Profile change event tracked successfully".to_string(),
        }),
    ))
}

// ============================================================================
// Handlers - Admin Analytics
// ============================================================================

/// GET /analytics/coupon-usage
/// Get coupon usage analytics (admin only)
async fn get_coupon_usage_analytics(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<Json<CouponUsageAnalytics>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let end_date = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap());

    // Get total events and unique users
    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_events,
            COUNT(DISTINCT user_id) as unique_users
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
          AND ($3::uuid IS NULL OR coupon_id = $3)
          AND ($4::uuid IS NULL OR user_id = $4)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .bind(
        params
            .coupon_id
            .as_ref()
            .and_then(|id| Uuid::parse_str(id).ok()),
    )
    .bind(
        params
            .user_id
            .as_ref()
            .and_then(|id| Uuid::parse_str(id).ok()),
    )
    .fetch_one(state.db())
    .await
    .unwrap_or((0, 0));

    // Get events by type
    let events_by_type: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT event_type, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        GROUP BY event_type
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    let events_map: serde_json::Map<String, JsonValue> = events_by_type
        .into_iter()
        .map(|(t, c)| (t, JsonValue::Number(c.into())))
        .collect();

    // Get top sources
    let top_sources: Vec<SourceCount> = sqlx::query_as(
        r#"
        SELECT source, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE source IS NOT NULL
          AND ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        GROUP BY source
        ORDER BY count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    // Calculate conversion rate (redeem_success / redeem_attempt)
    let conversion: Option<(i64, i64)> = sqlx::query_as(
        r#"
        SELECT
            SUM(CASE WHEN event_type = 'redeem_success' THEN 1 ELSE 0 END)::bigint,
            SUM(CASE WHEN event_type = 'redeem_attempt' THEN 1 ELSE 0 END)::bigint
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_optional(state.db())
    .await?;

    let conversion_rate = match conversion {
        Some((success, attempts)) if attempts > 0 => (success as f64 / attempts as f64) * 100.0,
        _ => 0.0,
    };

    Ok(Json(CouponUsageAnalytics {
        total_events: stats.0,
        unique_users: stats.1,
        conversion_rate,
        events_by_type: JsonValue::Object(events_map),
        top_sources,
    }))
}

/// GET /analytics/profile-changes
/// Get profile change analytics (admin only)
async fn get_profile_change_analytics(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<Json<ProfileChangeAnalytics>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let end_date = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap());

    // Get total changes and unique users
    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_changes,
            COUNT(DISTINCT user_id) as unique_users
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
          AND ($3::uuid IS NULL OR user_id = $3)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .bind(
        params
            .user_id
            .as_ref()
            .and_then(|id| Uuid::parse_str(id).ok()),
    )
    .fetch_one(state.db())
    .await
    .unwrap_or((0, 0));

    // Get changes by field
    let changes_by_field: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT field, COUNT(*) as count
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        GROUP BY field
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    let changes_map: serde_json::Map<String, JsonValue> = changes_by_field
        .into_iter()
        .map(|(f, c)| (f, JsonValue::Number(c.into())))
        .collect();

    Ok(Json(ProfileChangeAnalytics {
        total_changes: stats.0,
        unique_users: stats.1,
        changes_by_field: JsonValue::Object(changes_map),
        completion_milestones: vec![], // Simplified - could be populated from a completions table
    }))
}

/// GET /analytics/user-engagement
/// Get user engagement metrics (admin only)
async fn get_user_engagement_metrics(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<Json<UserEngagementMetrics>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let end_date = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap());

    // Get active users (users with any analytics activity)
    let active_users: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT user_id)
        FROM (
            SELECT user_id FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            UNION
            SELECT user_id FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
        ) combined
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(state.db())
    .await
    .unwrap_or((0,));

    // Get average interactions per user
    let coupon_avg: (f64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(AVG(count), 0)
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
        ) user_counts
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(state.db())
    .await
    .unwrap_or((0.0,));

    let profile_avg: (f64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(AVG(count), 0)
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
        ) user_counts
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(state.db())
    .await
    .unwrap_or((0.0,));

    // Get top users by interaction count
    let top_users: Vec<TopUser> = sqlx::query_as(
        r#"
        SELECT user_id, SUM(count)::bigint as interaction_count
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
            UNION ALL
            SELECT user_id, COUNT(*) as count
            FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
        ) combined
        GROUP BY user_id
        ORDER BY interaction_count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    Ok(Json(UserEngagementMetrics {
        active_users: active_users.0,
        user_segments: serde_json::json!({}), // Simplified
        avg_coupons_per_user: coupon_avg.0,
        avg_profile_changes_per_user: profile_avg.0,
        top_users,
    }))
}

/// GET /analytics/dashboard
/// Get analytics dashboard summary (admin only)
async fn get_analytics_dashboard(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<DashboardQuery>,
) -> Result<Json<DashboardResponse>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let days: i64 = params.period.parse().unwrap_or(30);
    let start_date = Utc::now() - chrono::Duration::days(days);

    let analytics_query = AnalyticsQuery {
        start_date: Some(start_date.format("%Y-%m-%d").to_string()),
        end_date: None,
        coupon_id: None,
        user_id: None,
    };

    // Get coupon usage analytics
    let coupon_analytics =
        get_coupon_usage_analytics_internal(state.db(), &analytics_query).await?;

    // Get profile change analytics
    let profile_analytics =
        get_profile_change_analytics_internal(state.db(), &analytics_query).await?;

    // Get user engagement metrics
    let engagement_metrics =
        get_user_engagement_metrics_internal(state.db(), &analytics_query).await?;

    Ok(Json(DashboardResponse {
        success: true,
        data: DashboardData {
            period: format!("{} days", days),
            coupon_usage: CouponUsageSummary {
                total_events: coupon_analytics.total_events,
                unique_users: coupon_analytics.unique_users,
                conversion_rate: coupon_analytics.conversion_rate,
                top_sources: coupon_analytics.top_sources.into_iter().take(5).collect(),
                event_breakdown: coupon_analytics.events_by_type,
            },
            profile_changes: ProfileChangesSummary {
                total_changes: profile_analytics.total_changes,
                unique_users: profile_analytics.unique_users,
                top_fields: extract_top_fields(&profile_analytics.changes_by_field, 5),
                recent_completions: profile_analytics
                    .completion_milestones
                    .into_iter()
                    .take(10)
                    .collect(),
            },
            user_engagement: UserEngagementSummary {
                active_users: engagement_metrics.active_users,
                user_segments: engagement_metrics.user_segments,
                avg_interactions: AvgInteractions {
                    coupons: engagement_metrics.avg_coupons_per_user,
                    profile_changes: engagement_metrics.avg_profile_changes_per_user,
                },
                top_users: engagement_metrics.top_users.into_iter().take(10).collect(),
            },
        },
    }))
}

/// GET /analytics/deposit-funnel
///
/// Counters for the deposit-request funnel (task D6), per property, per
/// day/week/month, over the tables that already exist. No reporting system,
/// no rollup table: see the PR for the measurements behind that choice.
///
/// ## The cohort, and why the two "confirmed" numbers differ
///
/// Every funnel stage is attributed to the bucket the **link was issued in**,
/// not the bucket the stage happened in. A link issued on Monday and paid on
/// Tuesday counts in Monday's row at every stage, so a row reads as "of the
/// links we issued that day, this many were opened, paid, decided,
/// confirmed" — the only reading under which the numbers form a funnel.
///
/// `bookingsBySource` cannot join that cohort: an app or PMS-channel booking
/// has no link to be issued, so it is bucketed by `bookings.created_at`. It
/// therefore answers a different question ("what did we take that day, and
/// through which door") and the `depositLink` figure in it will not generally
/// equal `bookingsConfirmed` above it.
///
/// ## Which slip stands for a link
///
/// A booking can accumulate several slips and, through Reissue, several
/// links. A slip is attributed to the link that was live when it was
/// uploaded (`uploaded_at` between that link's `issued_at` and the next
/// one's), and a link's machine verdict and human decision are read off its
/// **latest** such slip — a guest whose first slip came back `needs_action`
/// and whose second was verified has been verified, not both.
async fn get_deposit_funnel(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<DepositFunnelQuery>,
) -> Result<Json<DepositFunnelResponse>, AppError> {
    require_admin(&auth_user)?;

    let granularity = parse_funnel_granularity(params.granularity.as_deref())?;
    let property = parse_funnel_property(params.property.as_deref())?;
    let (start_date, end_date) = resolve_funnel_range(
        params.start_date.as_deref(),
        params.end_date.as_deref(),
        bangkok_today(),
    )?;

    let funnel_rows: Vec<FunnelRow> = sqlx::query_as(FUNNEL_SQL)
        .bind(start_date)
        .bind(end_date)
        .bind(granularity.as_str())
        .bind(property.as_deref())
        .bind(FUNNEL_TIME_ZONE)
        .fetch_all(state.db())
        .await?;

    let source_rows: Vec<BookingSourceRow> = sqlx::query_as(BOOKING_SOURCE_SQL)
        .bind(start_date)
        .bind(end_date)
        .bind(granularity.as_str())
        .bind(property.as_deref())
        .bind(FUNNEL_TIME_ZONE)
        .bind(FUNNEL_CONFIRMED_STATUSES)
        .fetch_all(state.db())
        .await?;

    let (totals, buckets) = merge_funnel_rows(funnel_rows, source_rows);

    Ok(Json(DepositFunnelResponse {
        granularity: granularity.as_str().to_string(),
        start_date,
        end_date,
        property,
        timezone: FUNNEL_TIME_ZONE.to_string(),
        totals,
        buckets,
    }))
}

/// Funnel stages, per bucket and property plus one totals row.
///
/// `$1` start date, `$2` end date (both inclusive, in `$5`), `$3` the
/// `date_trunc` field, `$4` the optional property filter, `$5` the time zone.
const FUNNEL_SQL: &str = r#"
WITH link AS (
    SELECT
        dl.id                            AS link_id,
        dl.booking_id                    AS booking_id,
        dl.issued_at                     AS issued_at,
        dl.last_opened_at                AS last_opened_at,
        -- The moment a Reissue took over, so a slip counts against the link
        -- that was live when the guest uploaded it and not against every
        -- link the booking ever had.
        LEAD(dl.issued_at) OVER (PARTITION BY dl.booking_id ORDER BY dl.issued_at)
                                         AS superseded_at,
        date_trunc($3, dl.issued_at AT TIME ZONE $5)::date AS bucket,
        COALESCE(b.property, 'unknown')  AS property,
        b.status                         AS booking_status
    FROM booking_deposit_links dl
    JOIN bookings b ON b.id = dl.booking_id
    WHERE dl.issued_at >= ($1::date::timestamp AT TIME ZONE $5)
      AND dl.issued_at <  (($2::date + 1)::timestamp AT TIME ZONE $5)
      AND ($4::text IS NULL OR COALESCE(b.property, 'unknown') = $4)
),
slip AS (
    SELECT
        l.link_id                                                  AS link_id,
        MIN(s.uploaded_at)                                         AS first_uploaded_at,
        (ARRAY_AGG(s.slipok_status ORDER BY s.uploaded_at DESC))[1] AS last_slipok_status,
        (ARRAY_AGG(s.admin_status  ORDER BY s.uploaded_at DESC))[1] AS last_admin_status,
        MIN(EXTRACT(EPOCH FROM (s.admin_verified_at - s.uploaded_at))::double precision / 60.0)
            FILTER (WHERE s.admin_status IN ('verified', 'needs_action')
                      AND s.admin_verified_at IS NOT NULL)          AS decision_minutes
    FROM link l
    JOIN booking_slips s
      ON s.booking_id = l.booking_id
     AND s.uploaded_at >= l.issued_at
     AND (l.superseded_at IS NULL OR s.uploaded_at < l.superseded_at)
    GROUP BY l.link_id
)
SELECT
    l.bucket                                                        AS bucket,
    l.property                                                      AS property,
    COUNT(*)::bigint                                                AS links_issued,
    COUNT(*) FILTER (WHERE l.last_opened_at IS NOT NULL)::bigint    AS links_opened,
    COUNT(s.link_id)::bigint                                        AS slips_uploaded,
    COUNT(*) FILTER (WHERE s.last_slipok_status = 'verified')::bigint     AS machine_verified,
    COUNT(*) FILTER (WHERE s.last_slipok_status = 'shadow_pass')::bigint  AS machine_shadow_pass,
    COUNT(*) FILTER (WHERE s.last_slipok_status = 'manual')::bigint       AS machine_manual,
    COUNT(*) FILTER (WHERE s.last_slipok_status = 'unavailable')::bigint  AS machine_unavailable,
    COUNT(*) FILTER (WHERE s.link_id IS NOT NULL
                       AND COALESCE(s.last_slipok_status, 'pending')
                           NOT IN ('verified', 'shadow_pass', 'manual', 'unavailable'))::bigint
                                                                    AS machine_pending,
    COUNT(*) FILTER (WHERE s.last_admin_status = 'verified')::bigint     AS human_verified,
    COUNT(*) FILTER (WHERE s.last_admin_status = 'needs_action')::bigint AS human_needs_action,
    COUNT(*) FILTER (WHERE s.link_id IS NOT NULL
                       AND COALESCE(s.last_admin_status, 'pending')
                           NOT IN ('verified', 'needs_action'))::bigint
                                                                    AS human_pending,
    COUNT(*) FILTER (WHERE l.booking_status
                           IN ('confirmed', 'checked_in', 'checked_out', 'completed'))::bigint
                                                                    AS bookings_confirmed,
    percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (s.first_uploaded_at - l.issued_at))::double precision / 60.0
    )                                                               AS median_link_to_slip,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY s.decision_minutes) AS median_slip_to_decision
FROM link l
LEFT JOIN slip s ON s.link_id = l.link_id
-- The empty grouping set is the totals row: medians cannot be summed out of
-- the buckets, so Postgres computes them over the whole window in the same
-- pass rather than the handler running the query twice.
GROUP BY GROUPING SETS ((l.bucket, l.property), ())
ORDER BY l.bucket NULLS FIRST, l.property NULLS FIRST
"#;

/// Confirmed bookings by where they came from, per bucket and property.
///
/// `booking_source` is only ever written by the deposit-link handler: the
/// member app (`routes::bookings::create_booking`) and the PMS channel both
/// leave it `NULL`, so the split is *derived* — a `NULL` source with a
/// `pms_booking_id` is a channel booking, and everything else left over is
/// the app. Reading `booking_source` alone would report every app booking as
/// a channel one, or as nothing at all.
const BOOKING_SOURCE_SQL: &str = r#"
SELECT
    date_trunc($3, b.created_at AT TIME ZONE $5)::date AS bucket,
    COALESCE(b.property, 'unknown')                    AS property,
    CASE
        WHEN b.booking_source = 'deposit_link' THEN 'deposit_link'
        WHEN b.booking_source = 'channel' OR b.pms_booking_id IS NOT NULL THEN 'channel'
        ELSE 'app'
    END                                                AS source,
    COUNT(*)::bigint                                   AS bookings_confirmed
FROM bookings b
WHERE b.created_at >= ($1::date::timestamp AT TIME ZONE $5)
  AND b.created_at <  (($2::date + 1)::timestamp AT TIME ZONE $5)
  AND b.status = ANY($6)
  AND ($4::text IS NULL OR COALESCE(b.property, 'unknown') = $4)
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
"#;

// ----------------------------------------------------------------------------
// Deposit funnel helpers — pure, so they are unit-testable without a database
// ----------------------------------------------------------------------------

/// Today in Bangkok. See [`FUNNEL_UTC_OFFSET_SECONDS`] for why a fixed offset
/// is exact for Thailand.
fn bangkok_today() -> NaiveDate {
    let offset = chrono::FixedOffset::east_opt(FUNNEL_UTC_OFFSET_SECONDS)
        .expect("Bangkok's +07:00 offset is in range");
    Utc::now().with_timezone(&offset).date_naive()
}

fn parse_funnel_date(raw: &str, field: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").map_err(|_| {
        // `{:?}` so a stray newline in the query string cannot forge a line
        // in the log this error is written to.
        AppError::BadRequest(format!(
            "{} must be a date in YYYY-MM-DD form, got {:?}",
            field,
            raw.trim()
        ))
    })
}

/// Resolve the window. Both ends are inclusive; `endDate` defaults to today
/// in Bangkok and `startDate` to 29 days before `endDate`.
fn resolve_funnel_range(
    start: Option<&str>,
    end: Option<&str>,
    today: NaiveDate,
) -> Result<(NaiveDate, NaiveDate), AppError> {
    let end_date = match end.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => parse_funnel_date(raw, "endDate")?,
        None => today,
    };
    let start_date = match start.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => parse_funnel_date(raw, "startDate")?,
        None => end_date - chrono::Duration::days(FUNNEL_DEFAULT_SPAN_DAYS),
    };

    if start_date > end_date {
        return Err(AppError::BadRequest(
            "startDate must not be after endDate".to_string(),
        ));
    }
    if (end_date - start_date).num_days() + 1 > FUNNEL_MAX_SPAN_DAYS {
        return Err(AppError::BadRequest(format!(
            "The date range must not exceed {} days",
            FUNNEL_MAX_SPAN_DAYS
        )));
    }

    Ok((start_date, end_date))
}

fn parse_funnel_granularity(raw: Option<&str>) -> Result<FunnelGranularity, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None | Some("day") => Ok(FunnelGranularity::Day),
        Some("week") => Ok(FunnelGranularity::Week),
        Some("month") => Ok(FunnelGranularity::Month),
        Some(other) => Err(AppError::BadRequest(format!(
            "Invalid granularity {:?}. Must be one of: day, week, month",
            other
        ))),
    }
}

fn parse_funnel_property(raw: Option<&str>) -> Result<Option<String>, AppError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(value) if FUNNEL_PROPERTIES.contains(&value) => Ok(Some(value.to_string())),
        Some(other) => Err(AppError::BadRequest(format!(
            "Invalid property {:?}. Must be one of: {}",
            other,
            FUNNEL_PROPERTIES.join(", ")
        ))),
    }
}

/// Minutes to one decimal place. A median of `23.483333333333334` minutes is
/// not more true than `23.5`, it is only harder to read and impossible to
/// assert on.
fn round_minutes(value: Option<f64>) -> Option<f64> {
    value.map(|minutes| (minutes * 10.0).round() / 10.0)
}

impl DepositFunnelCounters {
    fn apply(&mut self, row: &FunnelRow) {
        self.links_issued = row.links_issued;
        self.links_opened = row.links_opened;
        self.slips_uploaded = row.slips_uploaded;
        self.machine_verdict = MachineVerdictCounts {
            verified: row.machine_verified,
            shadow_pass: row.machine_shadow_pass,
            manual: row.machine_manual,
            unavailable: row.machine_unavailable,
            pending: row.machine_pending,
        };
        self.human_decision = HumanDecisionCounts {
            verified: row.human_verified,
            needs_action: row.human_needs_action,
            pending: row.human_pending,
        };
        self.bookings_confirmed = row.bookings_confirmed;
        self.median_minutes_link_to_slip = round_minutes(row.median_link_to_slip);
        self.median_minutes_slip_to_decision = round_minutes(row.median_slip_to_decision);
    }
}

/// Fold the two result sets into one series.
///
/// A bucket can exist in either query alone — a day on which links were
/// issued but nothing was booked, or one on which an app booking came in and
/// no link was issued — so the output is the union of both, keyed by
/// `(bucket, property)` and ordered by it.
fn merge_funnel_rows(
    funnel_rows: Vec<FunnelRow>,
    source_rows: Vec<BookingSourceRow>,
) -> (DepositFunnelCounters, Vec<DepositFunnelBucket>) {
    let mut totals = DepositFunnelCounters::default();
    let mut buckets: BTreeMap<(NaiveDate, String), DepositFunnelCounters> = BTreeMap::new();

    for row in &funnel_rows {
        match (row.bucket, row.property.as_ref()) {
            (Some(bucket), Some(property)) => {
                buckets
                    .entry((bucket, property.clone()))
                    .or_default()
                    .apply(row);
            },
            // The empty grouping set: `bucket` and `property` are NULL and
            // never are on a real row, `property` being a COALESCE.
            _ => totals.apply(row),
        }
    }

    for row in source_rows {
        totals
            .bookings_by_source
            .add(&row.source, row.bookings_confirmed);
        buckets
            .entry((row.bucket, row.property))
            .or_default()
            .bookings_by_source
            .add(&row.source, row.bookings_confirmed);
    }

    let buckets = buckets
        .into_iter()
        .map(|((bucket_start, property), counters)| DepositFunnelBucket {
            bucket_start,
            property,
            counters,
        })
        .collect();

    (totals, buckets)
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

async fn get_coupon_usage_analytics_internal(
    db: &sqlx::PgPool,
    params: &AnalyticsQuery,
) -> Result<CouponUsageAnalytics, AppError> {
    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_events,
            COUNT(DISTINCT user_id) as unique_users
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        "#,
    )
    .bind(start_date)
    .fetch_one(db)
    .await
    .unwrap_or((0, 0));

    let events_by_type: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT event_type, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        GROUP BY event_type
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let events_map: serde_json::Map<String, JsonValue> = events_by_type
        .into_iter()
        .map(|(t, c)| (t, JsonValue::Number(c.into())))
        .collect();

    let top_sources: Vec<SourceCount> = sqlx::query_as(
        r#"
        SELECT source, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE source IS NOT NULL
          AND ($1::timestamp IS NULL OR created_at >= $1)
        GROUP BY source
        ORDER BY count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    Ok(CouponUsageAnalytics {
        total_events: stats.0,
        unique_users: stats.1,
        conversion_rate: 0.0,
        events_by_type: JsonValue::Object(events_map),
        top_sources,
    })
}

async fn get_profile_change_analytics_internal(
    db: &sqlx::PgPool,
    params: &AnalyticsQuery,
) -> Result<ProfileChangeAnalytics, AppError> {
    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_changes,
            COUNT(DISTINCT user_id) as unique_users
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        "#,
    )
    .bind(start_date)
    .fetch_one(db)
    .await
    .unwrap_or((0, 0));

    let changes_by_field: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT field, COUNT(*) as count
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        GROUP BY field
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let changes_map: serde_json::Map<String, JsonValue> = changes_by_field
        .into_iter()
        .map(|(f, c)| (f, JsonValue::Number(c.into())))
        .collect();

    Ok(ProfileChangeAnalytics {
        total_changes: stats.0,
        unique_users: stats.1,
        changes_by_field: JsonValue::Object(changes_map),
        completion_milestones: vec![],
    })
}

async fn get_user_engagement_metrics_internal(
    db: &sqlx::PgPool,
    params: &AnalyticsQuery,
) -> Result<UserEngagementMetrics, AppError> {
    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let active_users: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT user_id)
        FROM (
            SELECT user_id FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
            UNION
            SELECT user_id FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
        ) combined
        "#,
    )
    .bind(start_date)
    .fetch_one(db)
    .await
    .unwrap_or((0,));

    let top_users: Vec<TopUser> = sqlx::query_as(
        r#"
        SELECT user_id, SUM(count)::bigint as interaction_count
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
            GROUP BY user_id
            UNION ALL
            SELECT user_id, COUNT(*) as count
            FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
            GROUP BY user_id
        ) combined
        GROUP BY user_id
        ORDER BY interaction_count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    Ok(UserEngagementMetrics {
        active_users: active_users.0,
        user_segments: serde_json::json!({}),
        avg_coupons_per_user: 0.0,
        avg_profile_changes_per_user: 0.0,
        top_users,
    })
}

fn extract_top_fields(changes_by_field: &JsonValue, limit: usize) -> Vec<FieldCount> {
    let mut fields: Vec<FieldCount> = if let JsonValue::Object(map) = changes_by_field {
        map.iter()
            .filter_map(|(field, count)| {
                count.as_i64().map(|c| FieldCount {
                    field: field.clone(),
                    count: c,
                })
            })
            .collect()
    } else {
        vec![]
    };

    fields.sort_by(|a, b| b.count.cmp(&a.count));
    fields.truncate(limit);
    fields
}

// ============================================================================
// Router
// ============================================================================

/// Create analytics routes
///
/// These routes are intended to be nested under /api/analytics via the main router.
/// All routes require authentication, with admin-only routes performing additional checks.
///
/// ## Endpoints
///
/// ### User Analytics (authenticated)
/// - `POST /coupon-usage` - Track a coupon usage event
/// - `POST /profile-change` - Track a profile change event
///
/// ### Admin Analytics (admin only)
/// - `GET /coupon-usage` - Get coupon usage analytics
/// - `GET /profile-changes` - Get profile change analytics
/// - `GET /user-engagement` - Get user engagement metrics
/// - `GET /dashboard` - Get analytics dashboard summary
/// - `GET /deposit-funnel` - Deposit-request funnel counters (task D6)
pub fn routes() -> Router<AppState> {
    Router::new()
        // User analytics endpoints
        .route("/coupon-usage", post(track_coupon_usage))
        .route("/profile-change", post(track_profile_change))
        // Admin analytics endpoints (role check in handlers)
        .route("/coupon-usage", get(get_coupon_usage_analytics))
        .route("/profile-changes", get(get_profile_change_analytics))
        .route("/user-engagement", get(get_user_engagement_metrics))
        .route("/dashboard", get(get_analytics_dashboard))
        .route("/deposit-funnel", get(get_deposit_funnel))
        .layer(middleware::from_fn(auth_middleware))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_coupon_event_types() {
        assert!(VALID_COUPON_EVENT_TYPES.contains(&"view"));
        assert!(VALID_COUPON_EVENT_TYPES.contains(&"assign"));
        assert!(VALID_COUPON_EVENT_TYPES.contains(&"redeem_success"));
        assert!(!VALID_COUPON_EVENT_TYPES.contains(&"invalid"));
    }

    #[test]
    fn test_valid_change_sources() {
        assert!(VALID_CHANGE_SOURCES.contains(&"user"));
        assert!(VALID_CHANGE_SOURCES.contains(&"admin"));
        assert!(VALID_CHANGE_SOURCES.contains(&"system"));
        assert!(!VALID_CHANGE_SOURCES.contains(&"invalid"));
    }

    #[test]
    fn test_extract_top_fields() {
        let changes = serde_json::json!({
            "email": 10,
            "phone": 5,
            "name": 15,
            "avatar": 3
        });

        let top = extract_top_fields(&changes, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].field, "name");
        assert_eq!(top[0].count, 15);
        assert_eq!(top[1].field, "email");
        assert_eq!(top[1].count, 10);
    }

    #[test]
    fn test_default_change_source() {
        assert_eq!(default_change_source(), "user");
    }

    #[test]
    fn test_default_period() {
        assert_eq!(default_period(), "30");
    }

    // ------------------------------------------------------------------
    // Deposit funnel helpers (task D6)
    // ------------------------------------------------------------------

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn funnel_row(bucket: Option<&str>, property: Option<&str>) -> FunnelRow {
        FunnelRow {
            bucket: bucket.map(date),
            property: property.map(str::to_string),
            links_issued: 10,
            links_opened: 8,
            slips_uploaded: 6,
            machine_verified: 1,
            machine_shadow_pass: 3,
            machine_manual: 1,
            machine_unavailable: 1,
            machine_pending: 0,
            human_verified: 4,
            human_needs_action: 1,
            human_pending: 1,
            bookings_confirmed: 4,
            median_link_to_slip: Some(23.483_333_333_333_3),
            median_slip_to_decision: Some(11.0),
        }
    }

    #[test]
    fn funnel_range_defaults_to_the_last_thirty_days_ending_today() {
        let today = date("2026-09-12");
        let (start, end) = resolve_funnel_range(None, None, today).unwrap();
        assert_eq!(end, today);
        assert_eq!(start, date("2026-08-14"));
        // Inclusive of both ends: exactly 30 days.
        assert_eq!((end - start).num_days() + 1, 30);
    }

    #[test]
    fn funnel_range_takes_an_explicit_window() {
        let (start, end) =
            resolve_funnel_range(Some("2026-01-01"), Some("2026-01-31"), date("2026-09-12"))
                .unwrap();
        assert_eq!(start, date("2026-01-01"));
        assert_eq!(end, date("2026-01-31"));
    }

    #[test]
    fn funnel_range_rejects_a_reversed_window() {
        let err = resolve_funnel_range(Some("2026-02-01"), Some("2026-01-01"), date("2026-09-12"))
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "got {err:?}");
    }

    #[test]
    fn funnel_range_rejects_a_window_longer_than_the_cap() {
        // 367 inclusive days.
        let err = resolve_funnel_range(Some("2025-01-01"), Some("2026-01-02"), date("2026-09-12"))
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "got {err:?}");

        // 366 is the cap and must still be answered.
        assert!(
            resolve_funnel_range(Some("2025-01-01"), Some("2026-01-01"), date("2026-09-12"))
                .is_ok()
        );
    }

    #[test]
    fn funnel_range_rejects_a_malformed_date() {
        let err = resolve_funnel_range(Some("12/09/2026"), None, date("2026-09-12")).unwrap_err();
        match err {
            AppError::BadRequest(message) => assert!(
                message.contains("startDate"),
                "the message must name the offending field: {message}"
            ),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn funnel_granularity_defaults_to_day_and_rejects_anything_else() {
        assert_eq!(
            parse_funnel_granularity(None).unwrap(),
            FunnelGranularity::Day
        );
        assert_eq!(
            parse_funnel_granularity(Some("")).unwrap(),
            FunnelGranularity::Day
        );
        assert_eq!(
            parse_funnel_granularity(Some("week")).unwrap(),
            FunnelGranularity::Week
        );
        assert_eq!(
            parse_funnel_granularity(Some("month")).unwrap(),
            FunnelGranularity::Month
        );
        // Not an allowlist typo — this value is interpolated into
        // `date_trunc`, so anything outside the three must never reach SQL.
        assert!(parse_funnel_granularity(Some("hour")).is_err());
        assert!(parse_funnel_granularity(Some("day'); DROP TABLE bookings --")).is_err());
    }

    #[test]
    fn funnel_property_filter_is_an_allowlist() {
        assert_eq!(parse_funnel_property(None).unwrap(), None);
        assert_eq!(parse_funnel_property(Some("")).unwrap(), None);
        assert_eq!(
            parse_funnel_property(Some("hf")).unwrap(),
            Some("hf".to_string())
        );
        assert_eq!(
            parse_funnel_property(Some("hfville")).unwrap(),
            Some("hfville".to_string())
        );
        // App bookings carry no property; they have to stay reachable.
        assert_eq!(
            parse_funnel_property(Some("unknown")).unwrap(),
            Some("unknown".to_string())
        );
        assert!(parse_funnel_property(Some("HF")).is_err());
        assert!(parse_funnel_property(Some("hotel")).is_err());
    }

    #[test]
    fn funnel_medians_are_rounded_to_one_decimal() {
        assert_eq!(round_minutes(Some(23.483_333_333_333_3)), Some(23.5));
        assert_eq!(round_minutes(Some(11.0)), Some(11.0));
        assert_eq!(round_minutes(None), None);
    }

    #[test]
    fn merge_splits_the_grouping_set_row_from_the_buckets() {
        let (totals, buckets) = merge_funnel_rows(
            vec![
                funnel_row(None, None),
                funnel_row(Some("2026-09-01"), Some("hf")),
                funnel_row(Some("2026-09-01"), Some("hfville")),
            ],
            vec![],
        );

        assert_eq!(
            totals.links_issued, 10,
            "the NULL/NULL row is the totals row"
        );
        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[0].bucket_start, date("2026-09-01"));
        assert_eq!(buckets[0].property, "hf");
        assert_eq!(buckets[1].property, "hfville");
        assert_eq!(buckets[0].counters.slips_uploaded, 6);
        assert_eq!(buckets[0].counters.machine_verdict.shadow_pass, 3);
        assert_eq!(buckets[0].counters.human_decision.needs_action, 1);
        assert_eq!(buckets[0].counters.median_minutes_link_to_slip, Some(23.5));
    }

    #[test]
    fn merge_unions_buckets_that_exist_in_only_one_query() {
        // A day with an app booking and no link at all must still appear —
        // otherwise the source split silently loses every app booking made on
        // a day reception issued nothing.
        let (totals, buckets) = merge_funnel_rows(
            vec![
                funnel_row(None, None),
                funnel_row(Some("2026-09-01"), Some("hf")),
            ],
            vec![
                BookingSourceRow {
                    bucket: date("2026-09-01"),
                    property: "hf".to_string(),
                    source: "deposit_link".to_string(),
                    bookings_confirmed: 4,
                },
                BookingSourceRow {
                    bucket: date("2026-09-02"),
                    property: "unknown".to_string(),
                    source: "app".to_string(),
                    bookings_confirmed: 3,
                },
                BookingSourceRow {
                    bucket: date("2026-09-02"),
                    property: "hf".to_string(),
                    source: "channel".to_string(),
                    bookings_confirmed: 2,
                },
            ],
        );

        assert_eq!(totals.bookings_by_source.deposit_link, 4);
        assert_eq!(totals.bookings_by_source.app, 3);
        assert_eq!(totals.bookings_by_source.channel, 2);

        assert_eq!(buckets.len(), 3, "the union of both result sets");
        assert_eq!(buckets[0].bucket_start, date("2026-09-01"));
        assert_eq!(buckets[0].counters.bookings_by_source.deposit_link, 4);

        // Link-less buckets carry zeroed funnel stages, not absent ones.
        let link_less = &buckets[1];
        assert_eq!(link_less.bucket_start, date("2026-09-02"));
        assert_eq!(link_less.property, "hf");
        assert_eq!(link_less.counters.links_issued, 0);
        assert_eq!(link_less.counters.bookings_by_source.channel, 2);
        assert_eq!(link_less.counters.median_minutes_link_to_slip, None);
    }

    #[test]
    fn booking_source_counts_never_drop_a_row() {
        let mut counts = BookingSourceCounts::default();
        counts.add("deposit_link", 2);
        counts.add("channel", 3);
        counts.add("app", 4);
        // The SQL CASE cannot produce this, but a total that loses rows is
        // worse than one filed under the wrong heading.
        counts.add("something_new", 1);
        assert_eq!(counts.deposit_link, 2);
        assert_eq!(counts.channel, 3);
        assert_eq!(counts.app, 5);
    }

    #[test]
    fn the_confirmed_statuses_keep_arrived_guests_in_the_funnel() {
        // There is no `confirmed_at` and no status history: if these four
        // were not all counted, last month's conversion would fall as guests
        // checked in.
        assert!(FUNNEL_CONFIRMED_STATUSES.contains(&"confirmed"));
        assert!(FUNNEL_CONFIRMED_STATUSES.contains(&"checked_in"));
        assert!(FUNNEL_CONFIRMED_STATUSES.contains(&"checked_out"));
        assert!(FUNNEL_CONFIRMED_STATUSES.contains(&"completed"));
        assert!(!FUNNEL_CONFIRMED_STATUSES.contains(&"pending"));
        assert!(!FUNNEL_CONFIRMED_STATUSES.contains(&"cancelled"));
        assert!(!FUNNEL_CONFIRMED_STATUSES.contains(&"no_show"));
    }
}
