//! PromptPay QR code generation service
//!
//! Generates EMVCo-compliant PromptPay QR codes with embedded payment amounts.
//! Uses promptpay-rs for payload generation and qrcode for SVG rendering.

use crate::error::AppError;
use promptpay_rs::PromptPayQR;
use qrcode::render::svg;
use qrcode::QrCode;

/// Service for generating PromptPay QR codes
pub struct PromptPayService {
    tax_id: String,
}

impl PromptPayService {
    /// Create a new PromptPayService with a 13-digit Tax ID
    pub fn new(tax_id: String) -> Result<Self, AppError> {
        // Validate Tax ID format (13 digits)
        let cleaned = tax_id.replace("-", "");
        if cleaned.len() != 13 || !cleaned.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::Configuration(
                "PromptPay Tax ID must be exactly 13 digits".to_string(),
            ));
        }
        Ok(Self { tax_id: cleaned })
    }

    /// Generate a PromptPay QR code as SVG string with the specified amount
    pub fn generate_qr_svg(&self, amount: f64) -> Result<String, AppError> {
        // Validate amount range
        if !(0.01..=999_999.99).contains(&amount) {
            return Err(AppError::Validation(
                "Amount must be between 0.01 and 999,999.99 THB".to_string(),
            ));
        }

        // Generate EMVCo payload using promptpay-rs
        let mut qr = PromptPayQR::new(&self.tax_id);
        qr.set_amount(amount);
        let payload = qr
            .create()
            .map_err(|e| {
                AppError::Internal(format!("Failed to generate PromptPay payload: {}", e))
            })?
            .to_string();

        // Render payload as SVG QR code
        let code = QrCode::new(payload.as_bytes())
            .map_err(|e| AppError::Internal(format!("Failed to create QR code: {}", e)))?;

        let svg_string = code
            .render::<svg::Color>()
            .min_dimensions(200, 200)
            .quiet_zone(true)
            .build();

        Ok(svg_string)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_valid_tax_id() {
        let service = PromptPayService::new("0105556176009".to_string());
        assert!(service.is_ok());
    }

    #[test]
    fn test_new_tax_id_with_dashes() {
        let service = PromptPayService::new("0-1055-56176-00-9".to_string());
        assert!(service.is_ok());
    }

    #[test]
    fn test_new_invalid_tax_id_too_short() {
        let service = PromptPayService::new("12345".to_string());
        assert!(service.is_err());
    }

    #[test]
    fn test_new_invalid_tax_id_non_numeric() {
        let service = PromptPayService::new("0105556176ABC".to_string());
        assert!(service.is_err());
    }

    #[test]
    fn test_generate_qr_svg_valid() {
        let service = PromptPayService::new("0105556176009".to_string()).unwrap();
        let svg = service.generate_qr_svg(1500.0);
        assert!(svg.is_ok());
        let svg_str = svg.unwrap();
        assert!(svg_str.contains("<svg"));
        assert!(svg_str.contains("</svg>"));
    }

    #[test]
    fn test_generate_qr_svg_min_amount() {
        let service = PromptPayService::new("0105556176009".to_string()).unwrap();
        let svg = service.generate_qr_svg(0.01);
        assert!(svg.is_ok());
    }

    #[test]
    fn test_generate_qr_svg_max_amount() {
        let service = PromptPayService::new("0105556176009".to_string()).unwrap();
        let svg = service.generate_qr_svg(999_999.99);
        assert!(svg.is_ok());
    }

    #[test]
    fn test_generate_qr_svg_amount_too_low() {
        let service = PromptPayService::new("0105556176009".to_string()).unwrap();
        let result = service.generate_qr_svg(0.0);
        assert!(result.is_err());
    }

    #[test]
    fn test_generate_qr_svg_amount_too_high() {
        let service = PromptPayService::new("0105556176009".to_string()).unwrap();
        let result = service.generate_qr_svg(1_000_000.0);
        assert!(result.is_err());
    }
}
