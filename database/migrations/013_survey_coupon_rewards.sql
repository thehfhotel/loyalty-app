-- Migration: Survey Coupon Rewards System
-- Created: January 2025
-- Version: v2.6.0
-- Purpose: Allow admins to assign coupons that are automatically given to users upon survey completion

-- Survey coupon assignments table
-- This links surveys to coupons that should be awarded upon completion
CREATE TABLE survey_coupon_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    
    -- Assignment configuration
    is_active BOOLEAN DEFAULT TRUE,
    award_condition VARCHAR(50) DEFAULT 'completion' CHECK (award_condition IN ('completion', 'submission')),
    max_awards INTEGER, -- Optional limit on total awards for this survey-coupon pair
    awarded_count INTEGER DEFAULT 0, -- Track how many have been awarded
    
    -- Assignment metadata
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_reason TEXT DEFAULT 'Survey completion reward',
    custom_expiry_days INTEGER, -- Override coupon expiry with custom duration from award date
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one active assignment per survey-coupon pair
    UNIQUE(survey_id, coupon_id) DEFERRABLE INITIALLY DEFERRED
);

-- Survey reward history - tracks actual coupon awards
CREATE TABLE survey_reward_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_coupon_assignment_id UUID NOT NULL REFERENCES survey_coupon_assignments(id) ON DELETE CASCADE,
    survey_response_id UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
    user_coupon_id UUID NOT NULL REFERENCES user_coupons(id) ON DELETE CASCADE,
    
    -- Award details
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    award_condition_met VARCHAR(50) NOT NULL,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one reward per user per survey-coupon assignment
    UNIQUE(survey_coupon_assignment_id, user_id)
);

-- Indexes for performance
CREATE INDEX idx_survey_coupon_assignments_survey_id ON survey_coupon_assignments(survey_id);
CREATE INDEX idx_survey_coupon_assignments_coupon_id ON survey_coupon_assignments(coupon_id);
CREATE INDEX idx_survey_coupon_assignments_active ON survey_coupon_assignments(is_active);
CREATE INDEX idx_survey_reward_history_assignment_id ON survey_reward_history(survey_coupon_assignment_id);
CREATE INDEX idx_survey_reward_history_user_id ON survey_reward_history(user_id);
CREATE INDEX idx_survey_reward_history_awarded_at ON survey_reward_history(awarded_at);

-- Apply updated_at triggers
CREATE TRIGGER update_survey_coupon_assignments_updated_at 
    BEFORE UPDATE ON survey_coupon_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to assign coupon to survey
CREATE OR REPLACE FUNCTION assign_coupon_to_survey(
    p_survey_id UUID,
    p_coupon_id UUID,
    p_assigned_by UUID,
    p_award_condition VARCHAR(50) DEFAULT 'completion',
    p_max_awards INTEGER DEFAULT NULL,
    p_custom_expiry_days INTEGER DEFAULT NULL,
    p_assigned_reason TEXT DEFAULT 'Survey completion reward'
)
RETURNS UUID AS $$
DECLARE
    assignment_id UUID;
    survey_exists BOOLEAN := FALSE;
    coupon_exists BOOLEAN := FALSE;
BEGIN
    -- Validate survey exists and is accessible
    SELECT EXISTS(SELECT 1 FROM surveys WHERE id = p_survey_id) INTO survey_exists;
    IF NOT survey_exists THEN
        RAISE EXCEPTION 'Survey not found';
    END IF;
    
    -- Validate coupon exists and is active
    SELECT EXISTS(SELECT 1 FROM coupons WHERE id = p_coupon_id AND status = 'active') INTO coupon_exists;
    IF NOT coupon_exists THEN
        RAISE EXCEPTION 'Coupon not found or not active';
    END IF;
    
    -- Create or update assignment
    INSERT INTO survey_coupon_assignments (
        survey_id,
        coupon_id,
        assigned_by,
        award_condition,
        max_awards,
        custom_expiry_days,
        assigned_reason,
        is_active
    )
    VALUES (
        p_survey_id,
        p_coupon_id,
        p_assigned_by,
        p_award_condition,
        p_max_awards,
        p_custom_expiry_days,
        p_assigned_reason,
        TRUE
    )
    ON CONFLICT (survey_id, coupon_id) 
    DO UPDATE SET
        assigned_by = EXCLUDED.assigned_by,
        award_condition = EXCLUDED.award_condition,
        max_awards = EXCLUDED.max_awards,
        custom_expiry_days = EXCLUDED.custom_expiry_days,
        assigned_reason = EXCLUDED.assigned_reason,
        is_active = TRUE,
        updated_at = NOW()
    RETURNING id INTO assignment_id;
    
    RETURN assignment_id;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically award coupons when survey is completed
CREATE OR REPLACE FUNCTION award_survey_completion_coupons(
    p_survey_response_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    response_record RECORD;
    assignment_record RECORD;
    user_coupon_id UUID;
    awards_given INTEGER := 0;
    custom_expiry TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get survey response details
    SELECT sr.*, s.id as survey_id, s.title as survey_title
    INTO response_record
    FROM survey_responses sr
    JOIN surveys s ON sr.survey_id = s.id
    WHERE sr.id = p_survey_response_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Survey response not found';
    END IF;
    
    -- Only award if survey is completed
    IF NOT response_record.is_completed THEN
        RETURN 0;
    END IF;
    
    -- Get all active coupon assignments for this survey
    FOR assignment_record IN
        SELECT sca.*, c.name as coupon_name, c.code as coupon_code
        FROM survey_coupon_assignments sca
        JOIN coupons c ON sca.coupon_id = c.id
        WHERE sca.survey_id = response_record.survey_id 
            AND sca.is_active = TRUE
            AND c.status = 'active'
            AND (sca.max_awards IS NULL OR sca.awarded_count < sca.max_awards)
    LOOP
        -- Check if user already received this coupon for this survey
        IF EXISTS(
            SELECT 1 FROM survey_reward_history 
            WHERE survey_coupon_assignment_id = assignment_record.id 
                AND user_id = response_record.user_id
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
                response_record.user_id,
                NULL, -- system assignment
                'Survey completion: ' || response_record.survey_title,
                custom_expiry
            ) INTO user_coupon_id;
            
            -- Record the reward in history
            INSERT INTO survey_reward_history (
                survey_coupon_assignment_id,
                survey_response_id,
                user_coupon_id,
                user_id,
                award_condition_met,
                metadata
            )
            VALUES (
                assignment_record.id,
                p_survey_response_id,
                user_coupon_id,
                response_record.user_id,
                assignment_record.award_condition,
                jsonb_build_object(
                    'survey_title', response_record.survey_title,
                    'coupon_code', assignment_record.coupon_code,
                    'coupon_name', assignment_record.coupon_name,
                    'completion_date', response_record.completed_at
                )
            );
            
            -- Update awarded count
            UPDATE survey_coupon_assignments 
            SET awarded_count = awarded_count + 1 
            WHERE id = assignment_record.id;
            
            awards_given := awards_given + 1;
            
        EXCEPTION
            WHEN OTHERS THEN
                -- Log error but continue with other coupons
                RAISE WARNING 'Failed to award coupon % to user % for survey %: %', 
                    assignment_record.coupon_code, response_record.user_id, 
                    response_record.survey_title, SQLERRM;
        END;
    END LOOP;
    
    RETURN awards_given;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically award coupons when survey is completed
CREATE OR REPLACE FUNCTION trigger_award_survey_coupons()
RETURNS TRIGGER AS $$
BEGIN
    -- Only trigger when survey is being marked as completed
    IF NEW.is_completed = TRUE AND (OLD.is_completed IS NULL OR OLD.is_completed = FALSE) THEN
        -- Award coupons asynchronously (in background)
        PERFORM award_survey_completion_coupons(NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER survey_completion_reward_trigger
    AFTER UPDATE ON survey_responses
    FOR EACH ROW
    EXECUTE FUNCTION trigger_award_survey_coupons();

-- Function to remove coupon assignment from survey
CREATE OR REPLACE FUNCTION remove_coupon_from_survey(
    p_survey_id UUID,
    p_coupon_id UUID,
    p_removed_by UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    assignment_found BOOLEAN := FALSE;
BEGIN
    -- Deactivate the assignment instead of deleting to preserve history
    UPDATE survey_coupon_assignments 
    SET 
        is_active = FALSE,
        updated_at = NOW()
    WHERE survey_id = p_survey_id 
        AND coupon_id = p_coupon_id 
        AND is_active = TRUE
    RETURNING TRUE INTO assignment_found;
    
    RETURN COALESCE(assignment_found, FALSE);
END;
$$ LANGUAGE plpgsql;

-- View for survey coupon assignments with details
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
    sca.award_condition,
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
LEFT JOIN users u ON sca.assigned_by = u.id
WHERE sca.is_active = TRUE;

-- Comments for documentation
COMMENT ON TABLE survey_coupon_assignments IS 'Links surveys to coupons that should be awarded upon completion';
COMMENT ON TABLE survey_reward_history IS 'Tracks actual coupon awards given for survey completions';
COMMENT ON COLUMN survey_coupon_assignments.award_condition IS 'When to award: completion (100% done) or submission (any response)';
COMMENT ON COLUMN survey_coupon_assignments.max_awards IS 'Optional limit on total awards for this survey-coupon pair';
COMMENT ON COLUMN survey_coupon_assignments.custom_expiry_days IS 'Override coupon expiry with custom duration from award date';