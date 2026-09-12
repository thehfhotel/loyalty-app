//! Admin LINE routes — reading the OA push budget back (C5)
//!
//! One endpoint, and it exists because the budget guard in
//! `services::push_budget` is otherwise invisible: it silently declines to
//! send, which is the correct behaviour and a terrible thing to discover by
//! noticing guests stopped getting messages.
//!
//! - `GET /api/admin/line/push-budget` — month-to-date usage per bucket per OA
//!
//! Mounted by merging into `routes::admin`, which applies `auth_middleware`;
//! the handler then calls `require_admin`, the pattern `routes::admin_slips`
//! and `routes::admin_deposit_links` use.
//!
//! Read-only, and deliberately so. The caps are configuration
//! (`LINE_PUSH_BUDGET_*`), not state an admin edits at runtime: the number
//! that matters is LINE's, and an endpoint that let somebody raise the local
//! cap past the real one would only move the failure from our logs to LINE's.

use axum::{
    extract::{Extension, State},
    routing::get,
    Json, Router,
};
use serde::Serialize;

use crate::error::AppResult;
use crate::middleware::auth::{require_admin, AuthUser};
use crate::services::push_budget::{PropertyUsage, PushBudget};
use crate::state::AppState;

/// `GET /api/admin/line/push-budget` response body.
#[derive(Debug, Serialize)]
pub struct PushBudgetResponse {
    pub success: bool,
    pub data: PushBudgetData,
}

#[derive(Debug, Serialize)]
pub struct PushBudgetData {
    /// `YYYY-MM` in Asia/Bangkok — the month these numbers are to date for.
    pub month: String,
    /// The whole-OA monthly ceiling (`LINE_PUSH_BUDGET_TOTAL`, default 300).
    pub total_limit: u32,
    /// Every OA and every bucket, including the ones still at zero.
    pub properties: Vec<PropertyUsage>,
}

/// GET /api/admin/line/push-budget
async fn get_push_budget(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> AppResult<Json<PushBudgetResponse>> {
    require_admin(&user)?;

    let budget = PushBudget::from_settings(state.config());
    let (month, properties) = budget.usage(state.db()).await?;

    Ok(Json(PushBudgetResponse {
        success: true,
        data: PushBudgetData {
            month,
            total_limit: budget.limits().total,
            properties,
        },
    }))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/line/push-budget", get(get_push_budget))
}
