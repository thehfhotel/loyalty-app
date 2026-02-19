//! Server-Sent Events (SSE) Routes
//!
//! Provides SSE endpoints for real-time event streaming to clients.
//! All endpoints require authentication.

use axum::{
    extract::Query,
    http::StatusCode,
    middleware,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Extension, Json, Router,
};
use futures::stream::{self, Stream, StreamExt};
use serde::Deserialize;
use std::{convert::Infallible, pin::Pin, time::Duration};
use tokio_stream::wrappers::BroadcastStream;

use crate::error::ErrorResponse;
use crate::middleware::auth::{auth_middleware, AuthUser};
use crate::services::sse::{get_sse_service, SseEvent};
use crate::state::AppState;

/// Query parameters for SSE connection
#[derive(Debug, Deserialize)]
pub struct SseQuery {
    /// Optional JWT token for EventSource (which can't set headers)
    pub token: Option<String>,
}

/// SSE event handler - establishes SSE connection for authenticated users
///
/// This endpoint establishes a Server-Sent Events connection that streams
/// real-time events to the client. Events include:
/// - notification: New notifications
/// - loyalty_update: Points/tier changes
/// - coupon_assigned: New coupons assigned
///
/// Authentication can be provided via:
/// 1. Authorization header (Bearer token)
/// 2. Query parameter `token` (for EventSource which can't set headers)
///
/// # Response
/// Returns a stream of SSE events. The connection is kept alive with
/// periodic heartbeat messages every 30 seconds.
async fn sse_events_handler(
    Extension(user): Extension<AuthUser>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let user_id = user.id.clone();
    let sse_service = get_sse_service();

    // Add client and get receiver
    let (client_id, receiver) = sse_service.add_client(&user_id).await;

    tracing::info!(
        user_id = %user_id,
        client_id = %client_id,
        "SSE connection established"
    );

    // Create initial connected event
    let connected_event = SseEvent::connected("Connected to real-time updates");

    // Convert broadcast receiver to stream
    let event_stream = BroadcastStream::new(receiver).filter_map(|result| async {
        match result {
            Ok(sse_event) => Some(sse_event),
            Err(e) => {
                tracing::debug!(error = %e, "SSE broadcast receive error");
                None
            },
        }
    });

    // Create the SSE event stream
    let initial_stream = stream::once(async move { connected_event });

    // Combine initial event with the ongoing event stream
    let combined_stream = initial_stream.chain(event_stream);

    // Map SSE events to Axum SSE Event type
    let sse_stream = combined_stream.map(move |sse_event| {
        let event = Event::default()
            .event(sse_event.event_type.to_string())
            .data(serde_json::to_string(&sse_event.data).unwrap_or_else(|_| "{}".to_string()));

        Ok::<_, Infallible>(event)
    });

    // Wrap with cleanup on drop - CleanupStream will box internally
    let final_stream = CleanupStream::new(sse_stream, user_id, client_id);

    Sse::new(final_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("heartbeat"),
    )
}

/// Type alias for pinned boxed stream
type BoxedSseStream = Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>;

/// Stream wrapper that performs cleanup when dropped
struct CleanupStream {
    inner: BoxedSseStream,
    user_id: String,
    client_id: uuid::Uuid,
    cleaned_up: bool,
}

impl CleanupStream {
    fn new<S>(inner: S, user_id: String, client_id: uuid::Uuid) -> Self
    where
        S: Stream<Item = Result<Event, Infallible>> + Send + 'static,
    {
        Self {
            inner: Box::pin(inner),
            user_id,
            client_id,
            cleaned_up: false,
        }
    }
}

impl Stream for CleanupStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.inner.as_mut().poll_next(cx)
    }
}

impl Drop for CleanupStream {
    fn drop(&mut self) {
        if !self.cleaned_up {
            self.cleaned_up = true;
            let user_id = self.user_id.clone();
            let client_id = self.client_id;

            tracing::info!(
                user_id = %user_id,
                client_id = %client_id,
                "SSE connection closed, cleaning up"
            );

            // Spawn cleanup task
            tokio::spawn(async move {
                get_sse_service().remove_client(&user_id, client_id).await;
            });
        }
    }
}

/// SSE endpoint with token query parameter support
///
/// This wrapper handles authentication via query parameter for EventSource
/// which cannot set custom headers.
#[allow(dead_code)]
async fn _sse_events_with_query(
    Query(query): Query<SseQuery>,
    auth_result: Result<Extension<AuthUser>, Response>,
) -> Response {
    // If we have a valid AuthUser from middleware, use it
    match auth_result {
        Ok(Extension(user)) => {
            let sse = sse_events_handler(Extension(user)).await;
            sse.into_response()
        },
        Err(_) => {
            // Try query parameter token
            if let Some(token) = query.token {
                let jwt_secret = std::env::var("JWT_SECRET")
                    .unwrap_or_else(|_| "development-secret-change-in-production".to_string());
                // Validate token manually
                match validate_token_from_query(&token, &jwt_secret) {
                    Ok(user) => {
                        let sse = sse_events_handler(Extension(user)).await;
                        sse.into_response()
                    },
                    Err(response) => response,
                }
            } else {
                let body = Json(ErrorResponse::new(
                    "unauthorized",
                    "Authentication required. Provide token via Authorization header or query parameter.",
                ));
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
        },
    }
}

/// Validate JWT token from query parameter
#[allow(clippy::result_large_err)]
fn validate_token_from_query(token: &str, jwt_secret: &str) -> Result<AuthUser, Response> {
    use crate::middleware::auth::Claims;
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};

    let decoding_key = DecodingKey::from_secret(jwt_secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 60;

    match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(token_data) => Ok(AuthUser::from(token_data.claims)),
        Err(err) => {
            tracing::debug!("SSE token validation error: {:?}", err);
            let (message, error_code) = match err.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                    ("Token has expired", "token_expired")
                },
                _ => ("Invalid authentication token", "invalid_token"),
            };
            let body = Json(ErrorResponse::new(error_code, message));
            Err((StatusCode::UNAUTHORIZED, body).into_response())
        },
    }
}

/// Handler that attempts authentication via header first, then falls back to query
async fn sse_handler_with_fallback(
    Query(query): Query<SseQuery>,
    jwt_secret_ext: Option<Extension<crate::middleware::auth::JwtSecret>>,
    auth_user: Option<Extension<AuthUser>>,
) -> Response {
    let jwt_secret = jwt_secret_ext.map(|Extension(s)| s.0).unwrap_or_else(|| {
        std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "development-secret-change-in-production".to_string())
    });

    match auth_user {
        Some(Extension(user)) => {
            let sse = sse_events_handler(Extension(user)).await;
            sse.into_response()
        },
        None => {
            // Try query parameter token
            if let Some(token) = query.token {
                match validate_token_from_query(&token, &jwt_secret) {
                    Ok(user) => {
                        let sse = sse_events_handler(Extension(user)).await;
                        sse.into_response()
                    },
                    Err(response) => response,
                }
            } else {
                let body = Json(ErrorResponse::new(
                    "unauthorized",
                    "Authentication required. Provide token via Authorization header or query parameter.",
                ));
                (StatusCode::UNAUTHORIZED, body).into_response()
            }
        },
    }
}

/// SSE connection info endpoint
/// Returns information about the current SSE connection state
async fn sse_info_handler(Extension(user): Extension<AuthUser>) -> Json<serde_json::Value> {
    let sse_service = get_sse_service();
    let client_count = sse_service.get_client_count(&user.id).await;

    Json(serde_json::json!({
        "userId": user.id,
        "connectedClients": client_count,
        "supportedEvents": [
            "notification",
            "loyalty_update",
            "coupon_assigned",
            "connected",
            "heartbeat"
        ]
    }))
}

/// Create SSE routes
///
/// Routes:
/// - GET /events - Establishes SSE connection (requires auth via header or query param)
/// - GET /info - Returns SSE connection info (requires auth)
///
/// Returns a Router that expects AppState to be provided via `.with_state()`
/// when merged into the main router.
pub fn routes() -> Router<AppState> {
    Router::new()
        // Main SSE endpoint with optional auth middleware
        // Uses optional_auth_middleware and falls back to query token
        .route(
            "/events",
            get(sse_handler_with_fallback)
                .layer(middleware::from_fn(crate::middleware::auth::optional_auth_middleware)),
        )
        // Info endpoint requires auth
        .route(
            "/info",
            get(sse_info_handler).layer(middleware::from_fn(auth_middleware)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sse_query_deserialization() {
        let query: SseQuery = serde_json::from_str(r#"{"token": "abc123"}"#).unwrap();
        assert_eq!(query.token, Some("abc123".to_string()));

        let query: SseQuery = serde_json::from_str(r#"{}"#).unwrap();
        assert!(query.token.is_none());
    }

    #[test]
    fn test_validate_token_from_query_invalid() {
        let result = validate_token_from_query("invalid-token", "some-secret");
        assert!(result.is_err());
    }
}
