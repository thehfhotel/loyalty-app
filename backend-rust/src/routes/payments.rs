//! Payment routes
//!
//! Provides endpoints for PromptPay QR code generation.

use axum::{
    extract::{Extension, Query, State},
    middleware,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, AuthUser};
use crate::services::promptpay::PromptPayService;
use crate::state::AppState;

// ==================== REQUEST/RESPONSE TYPES ====================

#[derive(Debug, Deserialize)]
pub struct QrCodeQuery {
    pub amount: f64,
    pub booking_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct QrCodeResponse {
    pub svg: String,
    pub amount: f64,
    pub currency: String,
}

// ==================== ROUTE HANDLERS ====================

/// GET /api/payments/promptpay-qr - Generate PromptPay QR code
async fn generate_promptpay_qr(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<QrCodeQuery>,
) -> AppResult<Json<QrCodeResponse>> {
    // Verify booking exists and belongs to user
    let booking_owner: Option<(Uuid,)> =
        sqlx::query_as("SELECT user_id FROM bookings WHERE id = $1")
            .bind(params.booking_id)
            .fetch_optional(state.db())
            .await?;

    let (owner_id,) = booking_owner
        .ok_or_else(|| AppError::NotFound(format!("Booking {}", params.booking_id)))?;

    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    if owner_id != user_id {
        return Err(AppError::Forbidden(
            "You can only generate QR codes for your own bookings".to_string(),
        ));
    }

    // Get Tax ID from config
    let tax_id =
        state.config().promptpay.tax_id.as_ref().ok_or_else(|| {
            AppError::Configuration("PromptPay Tax ID not configured".to_string())
        })?;

    // Generate QR SVG
    let service = PromptPayService::new(tax_id.clone())?;
    let svg = service.generate_qr_svg(params.amount)?;

    tracing::info!(
        user_id = %auth_user.id,
        booking_id = %params.booking_id,
        amount = params.amount,
        "PromptPay QR generated"
    );

    Ok(Json(QrCodeResponse {
        svg,
        amount: params.amount,
        currency: "THB".to_string(),
    }))
}

// ==================== ROUTER ====================

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/promptpay-qr", get(generate_promptpay_qr))
        .layer(middleware::from_fn(auth_middleware))
}
