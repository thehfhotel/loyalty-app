-- Fix the ambiguous column reference in generate_qr_code function
CREATE OR REPLACE FUNCTION generate_qr_code()
RETURNS TEXT AS $$
DECLARE
    generated_qr_code TEXT;
    exists_check INTEGER;
BEGIN
    LOOP
        -- Generate 16-character alphanumeric code
        generated_qr_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16));
        
        -- Check if it already exists (fix the ambiguous reference)
        SELECT COUNT(*) INTO exists_check FROM user_coupons WHERE qr_code = generated_qr_code;
        
        -- Exit loop if unique
        EXIT WHEN exists_check = 0;
    END LOOP;
    
    RETURN generated_qr_code;
END;
$$ language 'plpgsql';