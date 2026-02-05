//! Integration test module
//!
//! This module contains integration tests for the loyalty backend API.
//! Tests are organized by feature/endpoint.
//!
//! # Test Organization
//!
//! - `admin_test` - Admin panel tests (/api/admin/*)
//! - `health_test` - Health check endpoint tests (/api/health/*)
//! - `auth_test` - Authentication tests (/api/auth/*)
//! - `booking_test` - Booking management tests (/api/bookings/*)
//! - `coupon_test` - Coupon management tests (/api/coupons/*)
//! - `user_test` - User management tests (/api/users/*)
//! - `loyalty_test` - Loyalty program tests (/api/loyalty/*)
//! - `survey_test` - Survey management tests (/api/surveys/*)
//! - `oauth_test` - OAuth authentication tests (/api/oauth/*)
//! - `storage_test` - Storage/file upload tests (/api/storage/*)
//! - `sse_test` - Server-Sent Events tests (/api/sse/*)
//!
//! # Running Tests
//!
//! ```bash
//! # Run all integration tests
//! cargo test --test integration
//!
//! # Run specific test file
//! cargo test --test integration health
//!
//! # Run tests requiring database (with proper environment)
//! TEST_DATABASE_URL=postgresql://... TEST_REDIS_URL=redis://... cargo test --test integration
//! ```

pub mod admin_test;
pub mod auth_test;
pub mod booking_test;
pub mod coupon_test;
pub mod health_test;
pub mod loyalty_test;
pub mod notification_test;
pub mod oauth_test;
pub mod sse_test;
pub mod storage_test;
pub mod survey_test;
pub mod user_test;

// Re-export common utilities for convenience
pub use crate::common::*;
