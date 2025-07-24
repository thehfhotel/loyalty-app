-- Migration 014: Simplify coupon award conditions to always use completion
-- This removes the award_condition complexity and always awards on survey completion

-- First drop the view that depends on award_condition
DROP VIEW IF EXISTS survey_coupon_details;

-- Remove the award_condition column from survey_coupon_assignments
ALTER TABLE survey_coupon_assignments 
DROP COLUMN IF EXISTS award_condition;

-- Update the assign_coupon_to_survey function to remove award_condition parameter
DROP FUNCTION IF EXISTS assign_coupon_to_survey(UUID, UUID, UUID, VARCHAR, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION assign_coupon_to_survey(
    p_survey_id UUID,
    p_coupon_id UUID,
    p_assigned_by UUID,
    p_max_awards INTEGER DEFAULT NULL,
    p_custom_expiry_days INTEGER DEFAULT NULL,
    p_assigned_reason TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    assignment_id UUID;
    existing_assignment survey_coupon_assignments%ROWTYPE;
BEGIN
    -- Check if assignment already exists
    SELECT * INTO existing_assignment
    FROM survey_coupon_assignments 
    WHERE survey_id = p_survey_id AND coupon_id = p_coupon_id;
    
    IF FOUND THEN
        -- Update existing assignment
        UPDATE survey_coupon_assignments 
        SET 
            max_awards = COALESCE(p_max_awards, max_awards),
            custom_expiry_days = COALESCE(p_custom_expiry_days, custom_expiry_days),
            assigned_reason = COALESCE(p_assigned_reason, assigned_reason),
            assigned_by = p_assigned_by,
            updated_at = NOW(),
            is_active = TRUE
        WHERE survey_id = p_survey_id AND coupon_id = p_coupon_id
        RETURNING id INTO assignment_id;
    ELSE
        -- Create new assignment
        INSERT INTO survey_coupon_assignments (
            survey_id,
            coupon_id,
            assigned_by,
            max_awards,
            custom_expiry_days,
            assigned_reason,
            is_active,
            awarded_count
        ) VALUES (
            p_survey_id,
            p_coupon_id,
            p_assigned_by,
            p_max_awards,
            p_custom_expiry_days,
            p_assigned_reason,
            TRUE,
            0
        ) RETURNING id INTO assignment_id;
    END IF;
    
    RETURN assignment_id;
END;
$$ LANGUAGE plpgsql;

-- Update the award_condition_met column in survey_reward_history to always be 'completion'
-- For existing records, update any 'submission' to 'completion' since we're simplifying
UPDATE survey_reward_history 
SET award_condition_met = 'completion' 
WHERE award_condition_met = 'submission';

-- Recreate the survey_coupon_details view without award_condition
CREATE VIEW survey_coupon_details AS
SELECT 
    sca.id as assignment_id,
    sca.survey_id,
    s.title as survey_title,
    s.status as survey_status,
    sca.coupon_id,
    c.code as coupon_code,
    c.name as coupon_name,
    c.type as coupon_type,
    c.value as coupon_value,
    c.currency as coupon_currency,
    c.status as coupon_status,
    sca.is_active,
    sca.max_awards,
    sca.awarded_count,
    sca.custom_expiry_days,
    sca.assigned_reason,
    sca.assigned_by,
    u.email as assigned_by_email,
    sca.created_at as assigned_at,
    sca.updated_at
FROM survey_coupon_assignments sca
JOIN surveys s ON sca.survey_id = s.id
JOIN coupons c ON sca.coupon_id = c.id
LEFT JOIN users u ON sca.assigned_by = u.id;

-- Update comments
COMMENT ON FUNCTION assign_coupon_to_survey IS 'Assigns a coupon to be awarded automatically when users complete a survey';
COMMENT ON TABLE survey_reward_history IS 'History of coupon rewards given for survey completions';
COMMENT ON COLUMN survey_reward_history.award_condition_met IS 'Always "completion" - coupons are only awarded when surveys are completed';