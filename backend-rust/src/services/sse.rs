//! Server-Sent Events (SSE) Service
//!
//! Provides real-time event broadcasting to connected clients.
//! Manages SSE connections per user and supports targeted or broadcast messaging.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

/// Default channel capacity for SSE broadcast channels
const DEFAULT_CHANNEL_CAPACITY: usize = 100;

/// SSE event types supported by the system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SseEventType {
    /// New notification received
    Notification,
    /// Loyalty points or tier update
    LoyaltyUpdate,
    /// New coupon assigned to user
    CouponAssigned,
    /// Connection established confirmation
    Connected,
    /// Heartbeat to keep connection alive
    Heartbeat,
    /// Slip uploaded (for admin notifications)
    SlipUploaded,
}

impl std::fmt::Display for SseEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            SseEventType::Notification => "notification",
            SseEventType::LoyaltyUpdate => "loyalty_update",
            SseEventType::CouponAssigned => "coupon_assigned",
            SseEventType::Connected => "connected",
            SseEventType::Heartbeat => "heartbeat",
            SseEventType::SlipUploaded => "slip_uploaded",
        };
        write!(f, "{}", s)
    }
}

/// SSE event structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SseEvent {
    /// Type of the SSE event
    pub event_type: SseEventType,
    /// Event payload data
    pub data: Value,
}

impl SseEvent {
    /// Create a new SSE event
    pub fn new(event_type: SseEventType, data: Value) -> Self {
        Self { event_type, data }
    }

    /// Create a notification event
    pub fn notification(data: Value) -> Self {
        Self::new(SseEventType::Notification, data)
    }

    /// Create a loyalty update event
    pub fn loyalty_update(data: Value) -> Self {
        Self::new(SseEventType::LoyaltyUpdate, data)
    }

    /// Create a coupon assigned event
    pub fn coupon_assigned(data: Value) -> Self {
        Self::new(SseEventType::CouponAssigned, data)
    }

    /// Create a connected event
    pub fn connected(message: &str) -> Self {
        Self::new(
            SseEventType::Connected,
            serde_json::json!({ "message": message }),
        )
    }

    /// Create a heartbeat event
    pub fn heartbeat() -> Self {
        Self::new(SseEventType::Heartbeat, serde_json::json!({}))
    }

    /// Create a slip uploaded event (for admin notifications)
    pub fn slip_uploaded(booking_id: &str, slip_id: &str) -> Self {
        Self::new(
            SseEventType::SlipUploaded,
            serde_json::json!({
                "bookingId": booking_id,
                "slipId": slip_id,
                "timestamp": chrono::Utc::now().timestamp_millis()
            }),
        )
    }

    /// Format the event for SSE wire format
    pub fn to_sse_string(&self) -> String {
        let data = serde_json::to_string(&self.data).unwrap_or_else(|_| "{}".to_string());
        format!("event: {}\ndata: {}\n\n", self.event_type, data)
    }
}

/// Client connection info
#[derive(Debug, Clone)]
pub struct ClientConnection {
    /// Unique client ID
    pub client_id: Uuid,
    /// User ID this client belongs to
    pub user_id: String,
    /// Broadcast sender for this client
    sender: broadcast::Sender<SseEvent>,
}

impl ClientConnection {
    /// Subscribe to receive events for this client
    pub fn subscribe(&self) -> broadcast::Receiver<SseEvent> {
        self.sender.subscribe()
    }
}

/// SSE Connection Manager
///
/// Manages active SSE connections per user and handles event distribution.
/// Thread-safe and designed for concurrent access.
#[derive(Debug)]
pub struct SseConnectionManager {
    /// Map of user_id -> map of client_id -> client connection
    connections: Arc<RwLock<HashMap<String, HashMap<Uuid, ClientConnection>>>>,
    /// Broadcast channel for global events (sent to all users)
    global_sender: broadcast::Sender<SseEvent>,
}

impl Default for SseConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for SseConnectionManager {
    fn clone(&self) -> Self {
        Self {
            connections: Arc::clone(&self.connections),
            global_sender: self.global_sender.clone(),
        }
    }
}

impl SseConnectionManager {
    /// Create a new SSE connection manager
    pub fn new() -> Self {
        let (global_sender, _) = broadcast::channel(DEFAULT_CHANNEL_CAPACITY);
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            global_sender,
        }
    }

    /// Add a new client connection for a user
    ///
    /// Returns the client ID and a receiver for SSE events.
    pub async fn add_client(&self, user_id: &str) -> (Uuid, broadcast::Receiver<SseEvent>) {
        let client_id = Uuid::new_v4();
        let (sender, receiver) = broadcast::channel(DEFAULT_CHANNEL_CAPACITY);

        let connection = ClientConnection {
            client_id,
            user_id: user_id.to_string(),
            sender,
        };

        let mut connections = self.connections.write().await;
        connections
            .entry(user_id.to_string())
            .or_default()
            .insert(client_id, connection);

        tracing::info!(
            user_id = %user_id,
            client_id = %client_id,
            "SSE client connected"
        );

        (client_id, receiver)
    }

    /// Remove a client connection
    pub async fn remove_client(&self, user_id: &str, client_id: Uuid) {
        let mut connections = self.connections.write().await;

        if let Some(user_connections) = connections.get_mut(user_id) {
            user_connections.remove(&client_id);

            // Clean up empty user entries
            if user_connections.is_empty() {
                connections.remove(user_id);
            }
        }

        tracing::info!(
            user_id = %user_id,
            client_id = %client_id,
            "SSE client disconnected"
        );
    }

    /// Send an event to a specific user (all their connected clients)
    pub async fn send_to_user(&self, user_id: &str, event: SseEvent) {
        let connections = self.connections.read().await;

        if let Some(user_connections) = connections.get(user_id) {
            let mut sent_count = 0;
            let mut error_count = 0;

            for (client_id, connection) in user_connections.iter() {
                match connection.sender.send(event.clone()) {
                    Ok(_) => sent_count += 1,
                    Err(e) => {
                        error_count += 1;
                        tracing::debug!(
                            client_id = %client_id,
                            error = %e,
                            "Failed to send SSE event to client"
                        );
                    },
                }
            }

            tracing::debug!(
                user_id = %user_id,
                event_type = %event.event_type,
                sent = sent_count,
                errors = error_count,
                "SSE event sent to user"
            );
        } else {
            tracing::debug!(
                user_id = %user_id,
                event_type = %event.event_type,
                "No active SSE connections for user"
            );
        }
    }

    /// Send an event to multiple users
    pub async fn send_to_users(&self, user_ids: &[&str], event: SseEvent) {
        for user_id in user_ids {
            self.send_to_user(user_id, event.clone()).await;
        }
    }

    /// Broadcast an event to all connected users
    pub async fn broadcast_to_all(&self, event: SseEvent) {
        let connections = self.connections.read().await;

        let mut sent_count = 0;
        let mut error_count = 0;

        for (user_id, user_connections) in connections.iter() {
            for (client_id, connection) in user_connections.iter() {
                match connection.sender.send(event.clone()) {
                    Ok(_) => sent_count += 1,
                    Err(e) => {
                        error_count += 1;
                        tracing::debug!(
                            user_id = %user_id,
                            client_id = %client_id,
                            error = %e,
                            "Failed to broadcast SSE event to client"
                        );
                    },
                }
            }
        }

        tracing::info!(
            event_type = %event.event_type,
            sent = sent_count,
            errors = error_count,
            "SSE event broadcasted to all clients"
        );
    }

    /// Subscribe to global broadcast events
    pub fn subscribe_global(&self) -> broadcast::Receiver<SseEvent> {
        self.global_sender.subscribe()
    }

    /// Broadcast a global event (uses the global channel)
    pub fn broadcast_global(
        &self,
        event: SseEvent,
    ) -> Result<usize, broadcast::error::SendError<SseEvent>> {
        self.global_sender.send(event)
    }

    /// Get the number of connected clients for a user
    pub async fn get_client_count(&self, user_id: &str) -> usize {
        let connections = self.connections.read().await;
        connections.get(user_id).map(|c| c.len()).unwrap_or(0)
    }

    /// Get the total number of connected clients across all users
    pub async fn get_total_client_count(&self) -> usize {
        let connections = self.connections.read().await;
        connections.values().map(|c| c.len()).sum()
    }

    /// Get the number of connected users
    pub async fn get_user_count(&self) -> usize {
        let connections = self.connections.read().await;
        connections.len()
    }

    /// Check if a user has any active connections
    pub async fn is_user_connected(&self, user_id: &str) -> bool {
        let connections = self.connections.read().await;
        connections.get(user_id).is_some_and(|c| !c.is_empty())
    }
}

/// Global SSE service instance
///
/// Uses lazy initialization to create a singleton instance.
static SSE_SERVICE: std::sync::OnceLock<SseConnectionManager> = std::sync::OnceLock::new();

/// Get the global SSE service instance
pub fn get_sse_service() -> &'static SseConnectionManager {
    SSE_SERVICE.get_or_init(SseConnectionManager::new)
}

/// Helper functions for common SSE operations
pub mod helpers {
    use super::*;

    /// Send a notification event to a user
    pub async fn send_notification(user_id: &str, notification_data: Value) {
        let event = SseEvent::notification(notification_data);
        get_sse_service().send_to_user(user_id, event).await;
    }

    /// Send a loyalty update event to a user
    pub async fn send_loyalty_update(user_id: &str, points: i32, tier: &str, total_nights: i32) {
        let event = SseEvent::loyalty_update(serde_json::json!({
            "currentPoints": points,
            "tier": tier,
            "totalNights": total_nights,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }));
        get_sse_service().send_to_user(user_id, event).await;
    }

    /// Send a coupon assigned event to a user
    pub async fn send_coupon_assigned(user_id: &str, coupon_data: Value) {
        let event = SseEvent::coupon_assigned(coupon_data);
        get_sse_service().send_to_user(user_id, event).await;
    }

    /// Broadcast a slip uploaded event (to admin users)
    pub async fn broadcast_slip_uploaded(booking_id: &str, slip_id: &str) {
        let event = SseEvent::slip_uploaded(booking_id, slip_id);
        // Note: In a real implementation, you'd filter to only admin users
        // For now, this broadcasts to all connected users
        get_sse_service().broadcast_to_all(event).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_add_and_remove_client() {
        let manager = SseConnectionManager::new();
        let user_id = "user-123";

        // Add a client
        let (client_id, _receiver) = manager.add_client(user_id).await;

        // Verify client is connected
        assert!(manager.is_user_connected(user_id).await);
        assert_eq!(manager.get_client_count(user_id).await, 1);

        // Remove the client
        manager.remove_client(user_id, client_id).await;

        // Verify client is disconnected
        assert!(!manager.is_user_connected(user_id).await);
        assert_eq!(manager.get_client_count(user_id).await, 0);
    }

    #[tokio::test]
    async fn test_multiple_clients_per_user() {
        let manager = SseConnectionManager::new();
        let user_id = "user-456";

        // Add multiple clients for the same user
        let (client_id_1, _receiver_1) = manager.add_client(user_id).await;
        let (client_id_2, _receiver_2) = manager.add_client(user_id).await;

        assert_eq!(manager.get_client_count(user_id).await, 2);
        assert_eq!(manager.get_user_count().await, 1);

        // Remove one client
        manager.remove_client(user_id, client_id_1).await;
        assert_eq!(manager.get_client_count(user_id).await, 1);
        assert!(manager.is_user_connected(user_id).await);

        // Remove the second client
        manager.remove_client(user_id, client_id_2).await;
        assert_eq!(manager.get_client_count(user_id).await, 0);
        assert!(!manager.is_user_connected(user_id).await);
    }

    #[tokio::test]
    async fn test_send_to_user() {
        let manager = SseConnectionManager::new();
        let user_id = "user-789";

        // Add a client
        let (_client_id, mut receiver) = manager.add_client(user_id).await;

        // Send an event
        let event = SseEvent::notification(serde_json::json!({"message": "test"}));
        manager.send_to_user(user_id, event.clone()).await;

        // Verify the event was received
        let received = receiver.recv().await.unwrap();
        assert_eq!(received.event_type, SseEventType::Notification);
    }

    #[tokio::test]
    async fn test_broadcast_to_all() {
        let manager = SseConnectionManager::new();

        // Add clients for different users
        let (_client_id_1, mut receiver_1) = manager.add_client("user-1").await;
        let (_client_id_2, mut receiver_2) = manager.add_client("user-2").await;

        assert_eq!(manager.get_total_client_count().await, 2);

        // Broadcast an event
        let event = SseEvent::heartbeat();
        manager.broadcast_to_all(event).await;

        // Verify both clients received the event
        let received_1 = receiver_1.recv().await.unwrap();
        let received_2 = receiver_2.recv().await.unwrap();

        assert_eq!(received_1.event_type, SseEventType::Heartbeat);
        assert_eq!(received_2.event_type, SseEventType::Heartbeat);
    }

    #[test]
    fn test_sse_event_to_string() {
        let event = SseEvent::connected("Test connection");
        let sse_string = event.to_sse_string();

        assert!(sse_string.starts_with("event: connected\n"));
        assert!(sse_string.contains("data: "));
        assert!(sse_string.ends_with("\n\n"));
    }

    #[test]
    fn test_sse_event_type_display() {
        assert_eq!(SseEventType::Notification.to_string(), "notification");
        assert_eq!(SseEventType::LoyaltyUpdate.to_string(), "loyalty_update");
        assert_eq!(SseEventType::CouponAssigned.to_string(), "coupon_assigned");
        assert_eq!(SseEventType::Connected.to_string(), "connected");
        assert_eq!(SseEventType::Heartbeat.to_string(), "heartbeat");
        assert_eq!(SseEventType::SlipUploaded.to_string(), "slip_uploaded");
    }

    #[test]
    fn test_sse_event_constructors() {
        // Test notification constructor
        let event = SseEvent::notification(serde_json::json!({"id": 1}));
        assert_eq!(event.event_type, SseEventType::Notification);

        // Test loyalty update constructor
        let event = SseEvent::loyalty_update(serde_json::json!({"points": 100}));
        assert_eq!(event.event_type, SseEventType::LoyaltyUpdate);

        // Test coupon assigned constructor
        let event = SseEvent::coupon_assigned(serde_json::json!({"code": "ABC123"}));
        assert_eq!(event.event_type, SseEventType::CouponAssigned);

        // Test connected constructor
        let event = SseEvent::connected("Welcome!");
        assert_eq!(event.event_type, SseEventType::Connected);

        // Test heartbeat constructor
        let event = SseEvent::heartbeat();
        assert_eq!(event.event_type, SseEventType::Heartbeat);

        // Test slip uploaded constructor
        let event = SseEvent::slip_uploaded("booking-1", "slip-1");
        assert_eq!(event.event_type, SseEventType::SlipUploaded);
    }
}
