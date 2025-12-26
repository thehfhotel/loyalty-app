-- Migration: Improve QR code generation trigger with better logging and error handling
-- Created: 2025-12-26
-- Description: Adds max attempts limit, warning logs for retries, and exception handling

-- Drop and recreate the set_qr_code() function with improvements
CREATE OR REPLACE FUNCTION set_qr_code()
RETURNS TRIGGER AS $$
DECLARE
    v_qr_code VARCHAR(16);
    v_attempts INTEGER := 0;
    v_max_attempts INTEGER := 100;
BEGIN
    -- Only generate QR code if it's not already set
    IF NEW.qr_code IS NULL OR NEW.qr_code = '' THEN
        LOOP
            v_attempts := v_attempts + 1;

            -- Generate a new QR code candidate
            v_qr_code := generate_qr_code();

            -- Check if QR code is unique
            IF NOT EXISTS (SELECT 1 FROM user_coupons WHERE qr_code = v_qr_code) THEN
                NEW.qr_code := v_qr_code;

                -- Log if it took multiple attempts (helps identify collision issues)
                IF v_attempts > 1 THEN
                    RAISE WARNING 'QR code generation took % attempts for coupon', v_attempts;
                END IF;

                -- Successfully generated unique QR code, exit loop
                EXIT;
            END IF;

            -- Prevent infinite loop in case of extreme collision rate
            IF v_attempts >= v_max_attempts THEN
                RAISE EXCEPTION 'Failed to generate unique QR code after % attempts. This may indicate a QR code space exhaustion issue.', v_max_attempts;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_qr_code() IS 'Trigger function to automatically generate unique QR codes for new user coupons with collision detection and retry logic';

-- Note: The trigger itself (generate_qr_code_trigger) does not need to be recreated
-- as it already references the function which we just updated
