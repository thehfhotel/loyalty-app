//! Integration test module
//!
//! This module contains integration tests for the loyalty backend API.
//! Tests are organized by feature/endpoint.
//!
//! # Test Organization
//!
//! - `admin_test` - Admin panel tests (/api/admin/*)
//! - `audit_retention_test` - F10: booking_audit_log + slip_access_log retention
//! - `health_test` - Health check endpoint tests (/api/health/*)
//! - `auth_test` - Authentication tests (/api/auth/*)
//! - `booking_notify_test` - Property booking-notification email (B0)
//! - `booking_test` - Booking management tests (/api/bookings/*)
//! - `coupon_test` - Coupon management tests (/api/coupons/*)
//! - `deposit_link_test` - Deposit request links (/api/deposit/*, /api/admin/deposit-links)
//! - `user_test` - User management tests (/api/users/*)
//! - `verify_status_flip_test` - What verifying a slip does to the booking (A11)
//! - `loyalty_test` - Loyalty program tests (/api/loyalty/*)
//! - `survey_test` - Survey management tests (/api/surveys/*)
//! - `oauth_test` - OAuth authentication tests (/api/oauth/*)
//! - `slipok_auto_verify_test` - Automatic SlipOK slip verification
//! - `slipok_system_actor_test` - The seeded SlipOK audit actor's guards
//! - `slip_retention_test` - F2: slip image retention + admin access logging
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

pub mod admin_bootstrap_test;
pub mod admin_test;
pub mod audit_retention_test;
pub mod auth_test;
pub mod booking_notify_test;
pub mod booking_test;
pub mod cf_access_test;
pub mod coupon_test;
pub mod deposit_link_test;
pub mod health_test;
pub mod loyalty_test;
pub mod notification_test;
pub mod oauth_test;
pub mod slip_retention_test;
pub mod slipok_auto_verify_test;
pub mod slipok_system_actor_test;
pub mod slips_test;
pub mod sse_test;
pub mod stays_test;
pub mod storage_test;
pub mod survey_test;
pub mod tier_admin_test;
pub mod user_test;
pub mod verify_status_flip_test;

// Re-export common utilities for convenience
pub use crate::common::*;
