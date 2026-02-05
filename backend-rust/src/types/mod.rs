use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Pagination parameters for list endpoints.
///
/// Used for both request parameters and response metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    /// Current page number (1-indexed)
    pub page: u32,
    /// Number of items per page
    pub limit: u32,
    /// Total number of items across all pages
    pub total: u64,
}

impl Pagination {
    /// Creates a new Pagination instance.
    pub fn new(page: u32, limit: u32, total: u64) -> Self {
        Self { page, limit, total }
    }

    /// Calculates the offset for database queries.
    ///
    /// Returns the number of items to skip based on page and limit.
    #[inline]
    pub fn offset(&self) -> u64 {
        ((self.page.saturating_sub(1)) as u64) * (self.limit as u64)
    }

    /// Calculates the total number of pages.
    #[inline]
    pub fn total_pages(&self) -> u32 {
        if self.limit == 0 {
            return 0;
        }
        self.total.div_ceil(self.limit as u64) as u32
    }

    /// Checks if there is a next page.
    #[inline]
    pub fn has_next(&self) -> bool {
        self.page < self.total_pages()
    }

    /// Checks if there is a previous page.
    #[inline]
    pub fn has_prev(&self) -> bool {
        self.page > 1
    }
}

impl Default for Pagination {
    fn default() -> Self {
        Self {
            page: 1,
            limit: 20,
            total: 0,
        }
    }
}

/// Pagination query parameters for request parsing.
#[derive(Debug, Clone, Deserialize)]
pub struct PaginationQuery {
    /// Page number (1-indexed, defaults to 1)
    #[serde(default = "default_page")]
    pub page: u32,
    /// Items per page (defaults to 20, max 100)
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_page() -> u32 {
    1
}

fn default_limit() -> u32 {
    20
}

impl PaginationQuery {
    /// Validates and normalizes pagination parameters.
    ///
    /// Ensures page is at least 1 and limit is between 1 and 100.
    pub fn normalize(&self) -> Self {
        Self {
            page: self.page.max(1),
            limit: self.limit.clamp(1, 100),
        }
    }

    /// Calculates the offset for database queries.
    #[inline]
    pub fn offset(&self) -> u64 {
        ((self.page.saturating_sub(1)) as u64) * (self.limit as u64)
    }
}

/// Standard API response wrapper for consistent response format.
///
/// All API endpoints should return responses wrapped in this struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    /// Indicates if the request was successful
    pub success: bool,
    /// Response payload (present on success)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    /// Error message (present on failure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Optional pagination metadata for list endpoints
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagination: Option<Pagination>,
}

impl<T> ApiResponse<T> {
    /// Creates a successful response with data.
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            pagination: None,
        }
    }

    /// Creates a successful response with data and pagination.
    pub fn success_with_pagination(data: T, pagination: Pagination) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            pagination: Some(pagination),
        }
    }

    /// Creates an error response.
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message.into()),
            pagination: None,
        }
    }
}

impl<T: Default> Default for ApiResponse<T> {
    fn default() -> Self {
        Self::success(T::default())
    }
}

/// JWT claims structure for authentication tokens.
///
/// Contains user identity and token metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user ID)
    pub sub: Uuid,
    /// User's email address
    pub email: String,
    /// User's role (e.g., "user", "admin")
    pub role: String,
    /// Expiration time (Unix timestamp)
    pub exp: i64,
    /// Issued at time (Unix timestamp)
    pub iat: i64,
}

impl Claims {
    /// Creates new JWT claims for a user.
    ///
    /// # Arguments
    ///
    /// * `user_id` - The user's UUID
    /// * `email` - The user's email address
    /// * `role` - The user's role
    /// * `expiration_seconds` - Token lifetime in seconds
    pub fn new(user_id: Uuid, email: String, role: String, expiration_seconds: i64) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            sub: user_id,
            email,
            role,
            exp: now + expiration_seconds,
            iat: now,
        }
    }

    /// Returns the user ID from claims.
    #[inline]
    pub fn user_id(&self) -> Uuid {
        self.sub
    }

    /// Checks if the token has expired.
    #[inline]
    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() > self.exp
    }

    /// Checks if the user has admin role.
    #[inline]
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

/// Sort order for list queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    /// Ascending order (A-Z, 0-9, oldest first)
    #[default]
    Asc,
    /// Descending order (Z-A, 9-0, newest first)
    Desc,
}

impl SortOrder {
    /// Returns the SQL keyword for this sort order.
    #[inline]
    pub fn as_sql(&self) -> &'static str {
        match self {
            SortOrder::Asc => "ASC",
            SortOrder::Desc => "DESC",
        }
    }

    /// Returns true if ascending order.
    #[inline]
    pub fn is_asc(&self) -> bool {
        matches!(self, SortOrder::Asc)
    }

    /// Returns true if descending order.
    #[inline]
    pub fn is_desc(&self) -> bool {
        matches!(self, SortOrder::Desc)
    }
}

impl std::fmt::Display for SortOrder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_sql())
    }
}

/// Common sorting query parameters.
#[derive(Debug, Clone, Deserialize)]
pub struct SortQuery {
    /// Field to sort by
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Sort order (asc or desc)
    #[serde(default)]
    pub order: SortOrder,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pagination_offset_calculation() {
        let p = Pagination::new(1, 20, 100);
        assert_eq!(p.offset(), 0);

        let p = Pagination::new(2, 20, 100);
        assert_eq!(p.offset(), 20);

        let p = Pagination::new(5, 10, 100);
        assert_eq!(p.offset(), 40);
    }

    #[test]
    fn pagination_total_pages() {
        let p = Pagination::new(1, 20, 100);
        assert_eq!(p.total_pages(), 5);

        let p = Pagination::new(1, 20, 95);
        assert_eq!(p.total_pages(), 5);

        let p = Pagination::new(1, 20, 101);
        assert_eq!(p.total_pages(), 6);
    }

    #[test]
    fn pagination_has_next_prev() {
        let p = Pagination::new(1, 20, 100);
        assert!(p.has_next());
        assert!(!p.has_prev());

        let p = Pagination::new(3, 20, 100);
        assert!(p.has_next());
        assert!(p.has_prev());

        let p = Pagination::new(5, 20, 100);
        assert!(!p.has_next());
        assert!(p.has_prev());
    }

    #[test]
    fn pagination_query_normalize() {
        let q = PaginationQuery { page: 0, limit: 0 };
        let normalized = q.normalize();
        assert_eq!(normalized.page, 1);
        assert_eq!(normalized.limit, 1);

        let q = PaginationQuery {
            page: 1,
            limit: 200,
        };
        let normalized = q.normalize();
        assert_eq!(normalized.limit, 100);
    }

    #[test]
    fn api_response_success() {
        let response = ApiResponse::success("test data");
        assert!(response.success);
        assert_eq!(response.data, Some("test data"));
        assert!(response.error.is_none());
    }

    #[test]
    fn api_response_error() {
        let response: ApiResponse<()> = ApiResponse::error("Something went wrong");
        assert!(!response.success);
        assert!(response.data.is_none());
        assert_eq!(response.error, Some("Something went wrong".to_string()));
    }

    #[test]
    fn claims_expiration() {
        let claims = Claims::new(
            Uuid::new_v4(),
            "test@example.com".to_string(),
            "user".to_string(),
            3600,
        );
        assert!(!claims.is_expired());

        let expired_claims = Claims {
            sub: Uuid::new_v4(),
            email: "test@example.com".to_string(),
            role: "user".to_string(),
            exp: chrono::Utc::now().timestamp() - 100,
            iat: chrono::Utc::now().timestamp() - 200,
        };
        assert!(expired_claims.is_expired());
    }

    #[test]
    fn claims_admin_check() {
        let admin = Claims::new(
            Uuid::new_v4(),
            "admin@example.com".to_string(),
            "admin".to_string(),
            3600,
        );
        assert!(admin.is_admin());

        let user = Claims::new(
            Uuid::new_v4(),
            "user@example.com".to_string(),
            "user".to_string(),
            3600,
        );
        assert!(!user.is_admin());
    }

    #[test]
    fn sort_order_sql() {
        assert_eq!(SortOrder::Asc.as_sql(), "ASC");
        assert_eq!(SortOrder::Desc.as_sql(), "DESC");
    }

    #[test]
    fn sort_order_display() {
        assert_eq!(format!("{}", SortOrder::Asc), "ASC");
        assert_eq!(format!("{}", SortOrder::Desc), "DESC");
    }
}
