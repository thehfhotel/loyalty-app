//! Loyalty App Backend - Rust Implementation
//!
//! This is the main library crate for the loyalty application backend.
//! It provides a REST API for the loyalty program management system.

// Allow common clippy warnings that are style preferences rather than bugs
#![allow(clippy::needless_borrows_for_generic_args)]
#![allow(clippy::manual_clamp)]
#![allow(clippy::manual_strip)]
#![allow(clippy::type_complexity)]

// Core modules
pub mod config;
pub mod db;
pub mod error;
pub mod middleware;
pub mod models;
pub mod openapi;
pub mod redis;
pub mod routes;
pub mod services;
pub mod state;
pub mod types;
pub mod utils;

// Re-export commonly used types for convenience
pub use config::Settings;
pub use error::AppError;
pub use state::AppState;
