-- Migration 014: Simplify coupon award conditions to always use completion
-- This removes the award_condition complexity and always awards on survey completion

-- Remove the award_condition column from survey_coupon_assignments
-- Since we're always using 'completion', we don't need this field
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

-- Update the survey_coupon_details view to remove award_condition
DROP VIEW IF EXISTS survey_coupon_details;

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

-- Update the award_survey_completion_coupons function to always use completion logic
-- The function should only award when is_completed = true
DROP FUNCTION IF EXISTS award_survey_completion_coupons(UUID, UUID);

CREATE OR REPLACE FUNCTION award_survey_completion_coupons(
    p_survey_id UUID,
    p_user_id UUID
) RETURNS INTEGER AS $$
DECLARE
    response_record RECORD;
    assignment_record RECORD;
    user_coupon_id UUID;
    custom_expiry TIMESTAMP WITH TIME ZONE;
    awards_given INTEGER := 0;
BEGIN
    -- Get the survey response - only process completed surveys
    SELECT sr.*, s.title as survey_title 
    INTO response_record
    FROM survey_responses sr
    JOIN surveys s ON sr.survey_id = s.id
    WHERE sr.survey_id = p_survey_id 
        AND sr.user_id = p_user_id
        AND sr.is_completed = TRUE  -- Only award on completion
    ORDER BY sr.updated_at DESC 
    LIMIT 1;
    
    -- Exit if no completed response found
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- Get all active coupon assignments for this survey
    FOR assignment_record IN
        SELECT sca.*, c.name as coupon_name, c.code as coupon_code
        FROM survey_coupon_assignments sca
        JOIN coupons c ON sca.coupon_id = c.id
        WHERE sca.survey_id = p_survey_id 
            AND sca.is_active = TRUE
            AND c.status = 'active'
            AND (sca.max_awards IS NULL OR sca.awarded_count < sca.max_awards)
    LOOP
        -- Check if user already received this coupon for this survey
        IF EXISTS(
            SELECT 1 FROM survey_reward_history 
            WHERE survey_coupon_assignment_id = assignment_record.id 
                AND user_id = p_user_id
        ) THEN
            CONTINUE; -- Skip if already awarded
        END IF;
        
        -- Calculate custom expiry if specified
        custom_expiry := NULL;
        IF assignment_record.custom_expiry_days IS NOT NULL THEN
            custom_expiry := NOW() + (assignment_record.custom_expiry_days || ' days')::INTERVAL;
        END IF;
        
        BEGIN
            -- Assign coupon to user
            SELECT assign_coupon_to_user(
                assignment_record.coupon_id,
                p_user_id,
                NULL, -- system assignment
                'Survey completion: ' || response_record.survey_title,
                custom_expiry
            ) INTO user_coupon_id;
            
            -- Record the reward in history (always 'completion' now)
            INSERT INTO survey_reward_history (
                survey_coupon_assignment_id,
                survey_response_id,
                user_coupon_id,
                user_id,
                award_condition_met,
                metadata
            ) VALUES (
                assignment_record.id,
                response_record.id,
                user_coupon_id,
                p_user_id,
                'completion',  -- Always completion
                jsonb_build_object(
                    'survey_title', response_record.survey_title,
                    'coupon_code', assignment_record.coupon_code,
                    'coupon_name', assignment_record.coupon_name,
                    'awarded_at', NOW(),
                    'custom_expiry', custom_expiry
                )
            );
            
            -- Increment awarded count
            UPDATE survey_coupon_assignments 
            SET awarded_count = awarded_count + 1,
                updated_at = NOW()
            WHERE id = assignment_record.id;
            
            awards_given := awards_given + 1;
            
        EXCEPTION WHEN OTHERS THEN
            -- Log error but continue with other assignments
            RAISE WARNING 'Failed to award coupon % to user %: %', 
                assignment_record.coupon_id, p_user_id, SQLERRM;
        END;
    END LOOP;
    
    RETURN awards_given;
END;
$$ LANGUAGE plpgsql;

-- Update comments
COMMENT ON FUNCTION assign_coupon_to_survey IS 'Assigns a coupon to be awarded automatically when users complete a survey';
COMMENT ON FUNCTION award_survey_completion_coupons IS 'Awards all assigned coupons to a user when they complete a survey';
COMMENT ON TABLE survey_reward_history IS 'History of coupon rewards given for survey completions';
COMMENT ON COLUMN survey_reward_history.award_condition_met IS 'Always "completion" - coupons are only awarded when surveys are completed';