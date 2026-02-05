//! Email service module
//!
//! Provides email sending functionality including:
//! - SMTP configuration from environment variables
//! - Send generic emails with HTML content
//! - Send password reset emails
//! - Send welcome emails
//! - Email templates

use async_trait::async_trait;
use lettre::{
    message::{header::ContentType, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use rand::Rng;
use std::sync::Arc;
use tracing::{info, warn};

use crate::config::SmtpConfig;
use crate::error::AppError;

/// Email templates module
pub mod templates {
    /// Generate the password reset email HTML template
    ///
    /// # Arguments
    /// * `token` - The password reset token
    /// * `frontend_url` - The frontend URL for constructing the reset link
    ///
    /// # Returns
    /// The HTML content for the password reset email
    pub fn password_reset_template(token: &str, frontend_url: &str) -> String {
        let reset_link = format!("{}/reset-password?token={}", frontend_url, token);

        format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h2 style="color: #333; margin-bottom: 20px;">Reset Your Password</h2>
        <p style="color: #666; line-height: 1.6;">
            You have requested to reset your password. Click the button below to create a new password:
        </p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{reset_link}" style="background-color: #4CAF50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                Reset Password
            </a>
        </div>
        <p style="color: #666; line-height: 1.6;">
            If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 14px; color: #666;">
            {reset_link}
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
            This link expires in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
        </p>
    </div>
</body>
</html>"#,
            reset_link = reset_link
        )
    }

    /// Generate the welcome email HTML template
    ///
    /// # Arguments
    /// * `name` - The user's name
    ///
    /// # Returns
    /// The HTML content for the welcome email
    pub fn welcome_template(name: &str) -> String {
        format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Our Loyalty Program!</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h2 style="color: #4CAF50; margin-bottom: 20px;">Welcome to Our Loyalty Program!</h2>
        <p style="color: #666; line-height: 1.6;">
            Hi {name},
        </p>
        <p style="color: #666; line-height: 1.6;">
            Thank you for joining our loyalty program! We're excited to have you as a member.
        </p>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">What you can do now:</h3>
            <ul style="color: #666; line-height: 1.8;">
                <li>Earn points on every stay</li>
                <li>Unlock exclusive member benefits</li>
                <li>Track your rewards and tier progress</li>
                <li>Redeem points for free nights and upgrades</li>
            </ul>
        </div>
        <p style="color: #666; line-height: 1.6;">
            Start earning points today and work your way up to exclusive rewards!
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
            If you have any questions, please don't hesitate to contact our support team.
        </p>
    </div>
</body>
</html>"#,
            name = name
        )
    }

    /// Generate the email verification code template
    ///
    /// # Arguments
    /// * `code` - The verification code
    ///
    /// # Returns
    /// The HTML content for the verification email
    pub fn verification_template(code: &str) -> String {
        format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email Address</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h2 style="color: #333; margin-bottom: 20px;">Verify Your Email Address</h2>
        <p style="color: #666; line-height: 1.6;">
            Your verification code is:
        </p>
        <h1 style="font-size: 32px; letter-spacing: 4px; background: #f5f5f5; padding: 20px; text-align: center; font-family: monospace; border-radius: 5px;">
            {code}
        </h1>
        <p style="color: #666; line-height: 1.6;">
            This code expires in 1 hour.
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
            If you didn't request this verification, please ignore this email.
        </p>
    </div>
</body>
</html>"#,
            code = code
        )
    }

    /// Generate the registration verification email template
    ///
    /// # Arguments
    /// * `code` - The verification code
    ///
    /// # Returns
    /// The HTML content for the registration verification email
    pub fn registration_verification_template(code: &str) -> String {
        format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome! Verify Your Email Address</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h2 style="color: #4CAF50; margin-bottom: 20px;">Welcome to Our Loyalty Program!</h2>
        <p style="color: #666; line-height: 1.6;">
            Thank you for registering. Please verify your email address using the code below:
        </p>
        <h1 style="font-size: 32px; letter-spacing: 4px; background: #f5f5f5; padding: 20px; text-align: center; font-family: monospace; border-radius: 5px;">
            {code}
        </h1>
        <p style="color: #666; line-height: 1.6;">
            This code expires in 1 hour.
        </p>
        <p style="color: #666; line-height: 1.6;">
            Enter this code in your profile settings to complete verification.
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
            If you didn't create an account, please ignore this email.
        </p>
    </div>
</body>
</html>"#,
            code = code
        )
    }
}

/// SMTP email configuration
#[derive(Clone)]
pub struct EmailConfig {
    /// SMTP host
    pub host: String,
    /// SMTP port
    pub port: u16,
    /// SMTP username
    pub user: String,
    /// SMTP password
    pub pass: String,
    /// Sender email address
    pub from: String,
    /// Frontend URL for constructing links
    pub frontend_url: String,
}

impl EmailConfig {
    /// Create a new EmailConfig from environment variables
    ///
    /// Required environment variables:
    /// - SMTP_HOST: SMTP server hostname
    /// - SMTP_PORT: SMTP server port (default: 465)
    /// - SMTP_USER: SMTP username
    /// - SMTP_PASS: SMTP password
    /// - SMTP_FROM: Sender email address (defaults to SMTP_USER)
    /// - FRONTEND_URL: Frontend URL for links (default: http://localhost:3000)
    pub fn from_env() -> Option<Self> {
        let host = std::env::var("SMTP_HOST").ok()?;
        let port = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(465);
        let user = std::env::var("SMTP_USER").ok()?;
        let pass = std::env::var("SMTP_PASS").ok()?;
        let from = std::env::var("SMTP_FROM").unwrap_or_else(|_| user.clone());
        let frontend_url =
            std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());

        Some(Self {
            host,
            port,
            user,
            pass,
            from,
            frontend_url,
        })
    }

    /// Create a new EmailConfig from SmtpConfig
    pub fn from_smtp_config(smtp: &SmtpConfig, frontend_url: &str) -> Option<Self> {
        Some(Self {
            host: smtp.host.clone()?,
            port: smtp.port,
            user: smtp.user.clone()?,
            pass: smtp.pass.clone()?,
            from: smtp.user.clone()?,
            frontend_url: frontend_url.to_string(),
        })
    }
}

/// Email service trait defining email operations
#[async_trait]
pub trait EmailService: Send + Sync {
    /// Send an email with HTML content
    ///
    /// # Arguments
    /// * `to` - Recipient email address
    /// * `subject` - Email subject
    /// * `html_body` - HTML content of the email
    async fn send_email(&self, to: &str, subject: &str, html_body: &str) -> Result<(), AppError>;

    /// Send a password reset email
    ///
    /// # Arguments
    /// * `to` - Recipient email address
    /// * `reset_token` - The password reset token
    async fn send_password_reset_email(&self, to: &str, reset_token: &str)
        -> Result<(), AppError>;

    /// Send a welcome email
    ///
    /// # Arguments
    /// * `to` - Recipient email address
    /// * `name` - User's name
    async fn send_welcome_email(&self, to: &str, name: &str) -> Result<(), AppError>;

    /// Send a verification email
    ///
    /// # Arguments
    /// * `to` - Recipient email address
    /// * `code` - Verification code
    async fn send_verification_email(&self, to: &str, code: &str) -> Result<(), AppError>;

    /// Send a registration verification email
    ///
    /// # Arguments
    /// * `to` - Recipient email address
    /// * `code` - Verification code
    async fn send_registration_verification_email(
        &self,
        to: &str,
        code: &str,
    ) -> Result<(), AppError>;

    /// Check if email service is configured
    fn is_configured(&self) -> bool;

    /// Generate a verification code
    fn generate_verification_code(&self) -> String;
}

/// Implementation of the EmailService trait
pub struct EmailServiceImpl {
    config: Option<EmailConfig>,
    mailer: Option<Arc<AsyncSmtpTransport<Tokio1Executor>>>,
}

impl EmailServiceImpl {
    /// Create a new EmailServiceImpl instance
    pub fn new(config: Option<EmailConfig>) -> Self {
        let mailer = config.as_ref().and_then(|cfg| {
            let creds = Credentials::new(cfg.user.clone(), cfg.pass.clone());

            // Build the SMTP transport with TLS
            let transport = if cfg.port == 465 {
                // Port 465 uses implicit TLS (SMTPS)
                AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.host)
                    .ok()?
                    .credentials(creds)
                    .port(cfg.port)
                    .build()
            } else {
                // Port 587 uses STARTTLS
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.host)
                    .ok()?
                    .credentials(creds)
                    .port(cfg.port)
                    .build()
            };

            Some(Arc::new(transport))
        });

        Self { config, mailer }
    }

    /// Create a new EmailServiceImpl from environment variables
    pub fn from_env() -> Self {
        Self::new(EmailConfig::from_env())
    }

    /// Create a new EmailServiceImpl from SmtpConfig
    pub fn from_smtp_config(smtp: &SmtpConfig, frontend_url: &str) -> Self {
        Self::new(EmailConfig::from_smtp_config(smtp, frontend_url))
    }

    /// Get the frontend URL for link construction
    pub fn frontend_url(&self) -> &str {
        self.config
            .as_ref()
            .map(|c| c.frontend_url.as_str())
            .unwrap_or("http://localhost:3000")
    }

    /// Parse an email address to a Mailbox
    fn parse_mailbox(email: &str) -> Result<Mailbox, AppError> {
        email
            .parse()
            .map_err(|_| AppError::BadRequest(format!("Invalid email address: {}", email)))
    }
}

#[async_trait]
impl EmailService for EmailServiceImpl {
    async fn send_email(&self, to: &str, subject: &str, html_body: &str) -> Result<(), AppError> {
        let config = match &self.config {
            Some(c) => c,
            None => {
                warn!(
                    "SMTP not configured, skipping email to {} with subject: {}",
                    to, subject
                );
                return Ok(());
            }
        };

        let mailer = match &self.mailer {
            Some(m) => m,
            None => {
                warn!("SMTP mailer not initialized, skipping email to {}", to);
                return Ok(());
            }
        };

        let from_mailbox = Self::parse_mailbox(&config.from)?;
        let to_mailbox = Self::parse_mailbox(to)?;

        // Create plain text version by stripping HTML tags (simple approach)
        let plain_text = html_body
            .replace("<br>", "\n")
            .replace("<br/>", "\n")
            .replace("<br />", "\n")
            .replace("</p>", "\n\n")
            .replace("</li>", "\n")
            .replace("</h1>", "\n\n")
            .replace("</h2>", "\n\n")
            .replace("</h3>", "\n\n");
        // Remove remaining HTML tags
        let plain_text = regex_lite::Regex::new(r"<[^>]+>")
            .map(|re| re.replace_all(&plain_text, "").to_string())
            .unwrap_or_else(|_| plain_text);

        let email = Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(plain_text),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html_body.to_string()),
                    ),
            )
            .map_err(|e| AppError::Internal(format!("Failed to build email: {}", e)))?;

        mailer
            .send(email)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to send email: {}", e)))?;

        info!("Email sent to {} with subject: {}", to, subject);
        Ok(())
    }

    async fn send_password_reset_email(
        &self,
        to: &str,
        reset_token: &str,
    ) -> Result<(), AppError> {
        let frontend_url = self.frontend_url();
        let html_body = templates::password_reset_template(reset_token, frontend_url);
        self.send_email(to, "Reset Your Password", &html_body).await
    }

    async fn send_welcome_email(&self, to: &str, name: &str) -> Result<(), AppError> {
        let html_body = templates::welcome_template(name);
        self.send_email(to, "Welcome to Our Loyalty Program!", &html_body)
            .await
    }

    async fn send_verification_email(&self, to: &str, code: &str) -> Result<(), AppError> {
        let html_body = templates::verification_template(code);
        self.send_email(to, "Verify your new email address", &html_body)
            .await
    }

    async fn send_registration_verification_email(
        &self,
        to: &str,
        code: &str,
    ) -> Result<(), AppError> {
        let html_body = templates::registration_verification_template(code);
        self.send_email(to, "Welcome! Please verify your email address", &html_body)
            .await
    }

    fn is_configured(&self) -> bool {
        self.config.is_some() && self.mailer.is_some()
    }

    fn generate_verification_code(&self) -> String {
        // Use uppercase only - frontend normalizes input to uppercase for user convenience
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut rng = rand::thread_rng();
        let code: String = (0..8)
            .map(|_| {
                let idx = rng.gen_range(0..CHARS.len());
                CHARS[idx] as char
            })
            .collect();

        // Format as XXXX-XXXX
        format!("{}-{}", &code[0..4], &code[4..8])
    }
}

/// No-op email service for testing or when email is disabled
pub struct NoOpEmailService;

impl NoOpEmailService {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NoOpEmailService {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl EmailService for NoOpEmailService {
    async fn send_email(&self, to: &str, subject: &str, _html_body: &str) -> Result<(), AppError> {
        info!(
            "[NoOp] Would send email to {} with subject: {}",
            to, subject
        );
        Ok(())
    }

    async fn send_password_reset_email(
        &self,
        to: &str,
        _reset_token: &str,
    ) -> Result<(), AppError> {
        info!("[NoOp] Would send password reset email to {}", to);
        Ok(())
    }

    async fn send_welcome_email(&self, to: &str, name: &str) -> Result<(), AppError> {
        info!("[NoOp] Would send welcome email to {} ({})", to, name);
        Ok(())
    }

    async fn send_verification_email(&self, to: &str, _code: &str) -> Result<(), AppError> {
        info!("[NoOp] Would send verification email to {}", to);
        Ok(())
    }

    async fn send_registration_verification_email(
        &self,
        to: &str,
        _code: &str,
    ) -> Result<(), AppError> {
        info!(
            "[NoOp] Would send registration verification email to {}",
            to
        );
        Ok(())
    }

    fn is_configured(&self) -> bool {
        false
    }

    fn generate_verification_code(&self) -> String {
        // Still generate a valid code for testing
        "TEST-CODE".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_reset_template() {
        let template =
            templates::password_reset_template("abc123token", "https://example.com");
        assert!(template.contains("https://example.com/reset-password?token=abc123token"));
        assert!(template.contains("Reset Your Password"));
        assert!(template.contains("expires in 1 hour"));
    }

    #[test]
    fn test_welcome_template() {
        let template = templates::welcome_template("John");
        assert!(template.contains("Hi John"));
        assert!(template.contains("Welcome to Our Loyalty Program"));
        assert!(template.contains("Earn points"));
    }

    #[test]
    fn test_verification_template() {
        let template = templates::verification_template("ABCD-1234");
        assert!(template.contains("ABCD-1234"));
        assert!(template.contains("Verify Your Email"));
        assert!(template.contains("expires in 1 hour"));
    }

    #[test]
    fn test_registration_verification_template() {
        let template = templates::registration_verification_template("WXYZ-5678");
        assert!(template.contains("WXYZ-5678"));
        assert!(template.contains("Welcome to Our Loyalty Program"));
        assert!(template.contains("verify your email"));
    }

    #[test]
    fn test_email_service_not_configured() {
        let service = EmailServiceImpl::new(None);
        assert!(!service.is_configured());
    }

    #[test]
    fn test_verification_code_format() {
        let service = EmailServiceImpl::new(None);
        let code = service.generate_verification_code();
        assert_eq!(code.len(), 9); // XXXX-XXXX = 9 chars
        assert!(code.contains('-'));

        let parts: Vec<&str> = code.split('-').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 4);
        assert_eq!(parts[1].len(), 4);

        // All characters should be uppercase alphanumeric
        for c in code.chars() {
            assert!(c == '-' || c.is_ascii_uppercase() || c.is_ascii_digit());
        }
    }

    #[test]
    fn test_noop_email_service() {
        let service = NoOpEmailService::new();
        assert!(!service.is_configured());
        assert_eq!(service.generate_verification_code(), "TEST-CODE");
    }

    #[tokio::test]
    async fn test_noop_send_email() {
        let service = NoOpEmailService::new();
        let result = service
            .send_email("test@example.com", "Test Subject", "<p>Test</p>")
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_unconfigured_service_gracefully_skips() {
        let service = EmailServiceImpl::new(None);
        // Should not error when not configured - just logs and returns Ok
        let result = service
            .send_email("test@example.com", "Test", "<p>Test</p>")
            .await;
        assert!(result.is_ok());
    }
}
