--
-- PostgreSQL database dump
--

-- Dumped from database version 15.13
-- Dumped by pg_dump version 15.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: coupon_status; Type: TYPE; Schema: public; Owner: loyalty
--

CREATE TYPE public.coupon_status AS ENUM (
    'draft',
    'active',
    'paused',
    'expired',
    'exhausted'
);


ALTER TYPE public.coupon_status OWNER TO loyalty;

--
-- Name: coupon_type; Type: TYPE; Schema: public; Owner: loyalty
--

CREATE TYPE public.coupon_type AS ENUM (
    'percentage',
    'fixed_amount',
    'bogo',
    'free_upgrade',
    'free_service'
);


ALTER TYPE public.coupon_type OWNER TO loyalty;

--
-- Name: points_transaction_type; Type: TYPE; Schema: public; Owner: loyalty
--

CREATE TYPE public.points_transaction_type AS ENUM (
    'earned_stay',
    'earned_bonus',
    'redeemed',
    'expired',
    'admin_adjustment',
    'admin_award',
    'admin_deduction'
);


ALTER TYPE public.points_transaction_type OWNER TO loyalty;

--
-- Name: user_coupon_status; Type: TYPE; Schema: public; Owner: loyalty
--

CREATE TYPE public.user_coupon_status AS ENUM (
    'available',
    'used',
    'expired',
    'revoked'
);


ALTER TYPE public.user_coupon_status OWNER TO loyalty;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: loyalty
--

CREATE TYPE public.user_role AS ENUM (
    'customer',
    'admin',
    'super_admin'
);


ALTER TYPE public.user_role OWNER TO loyalty;

--
-- Name: add_stay_nights_and_points(uuid, integer, numeric, text, text); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.add_stay_nights_and_points(p_user_id uuid, p_nights integer, p_amount_spent numeric, p_reference_id text DEFAULT NULL::text, p_description text DEFAULT NULL::text) RETURNS TABLE(transaction_id uuid, points_earned integer, new_total_nights integer, new_tier_name text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_transaction_id UUID;
    v_points_earned INTEGER;
    v_new_total_nights INTEGER;
    v_new_tier_name TEXT;
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Calculate points earned (10 points per THB)
    v_points_earned := FLOOR(p_amount_spent * 10);
    
    -- Insert points transaction with NO expiration (expires_at = NULL)
    INSERT INTO points_transactions (
        id, user_id, points, type, description, reference_id, 
        nights_stayed, expires_at, created_at
    ) VALUES (
        v_transaction_id, p_user_id, v_points_earned, 'earned_stay', 
        COALESCE(p_description, 'Hotel stay with nights'), p_reference_id,
        p_nights, NULL, NOW()
    );
    
    -- Update user loyalty totals (remove lifetime_points reference)
    UPDATE user_loyalty 
    SET 
        current_points = current_points + v_points_earned,
        total_nights = total_nights + p_nights,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Get updated values from recreated view
    SELECT 
        ul.total_nights,
        COALESCE(t.name, 'New Member') as tier_name
    INTO v_new_total_nights, v_new_tier_name
    FROM user_loyalty ul
    LEFT JOIN tiers t ON ul.total_nights >= t.min_points AND t.is_active = true
    WHERE ul.user_id = p_user_id
    ORDER BY t.sort_order DESC
    LIMIT 1;
    
    -- Return results
    RETURN QUERY SELECT 
        v_transaction_id,
        v_points_earned,
        v_new_total_nights,
        COALESCE(v_new_tier_name, 'New Member');
END;
$$;


ALTER FUNCTION public.add_stay_nights_and_points(p_user_id uuid, p_nights integer, p_amount_spent numeric, p_reference_id text, p_description text) OWNER TO loyalty;

--
-- Name: are_users_linked(uuid, uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.are_users_linked(user1_uuid uuid, user2_uuid uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN EXISTS(
        SELECT 1 FROM linked_accounts 
        WHERE (primary_user_id = user1_uuid AND linked_user_id = user2_uuid)
           OR (primary_user_id = user2_uuid AND linked_user_id = user1_uuid)
    );
END;
$$;


ALTER FUNCTION public.are_users_linked(user1_uuid uuid, user2_uuid uuid) OWNER TO loyalty;

--
-- Name: assign_coupon_to_survey(uuid, uuid, uuid, integer, integer, text); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.assign_coupon_to_survey(p_survey_id uuid, p_coupon_id uuid, p_assigned_by uuid, p_max_awards integer DEFAULT NULL::integer, p_custom_expiry_days integer DEFAULT NULL::integer, p_assigned_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.assign_coupon_to_survey(p_survey_id uuid, p_coupon_id uuid, p_assigned_by uuid, p_max_awards integer, p_custom_expiry_days integer, p_assigned_reason text) OWNER TO loyalty;

--
-- Name: FUNCTION assign_coupon_to_survey(p_survey_id uuid, p_coupon_id uuid, p_assigned_by uuid, p_max_awards integer, p_custom_expiry_days integer, p_assigned_reason text); Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON FUNCTION public.assign_coupon_to_survey(p_survey_id uuid, p_coupon_id uuid, p_assigned_by uuid, p_max_awards integer, p_custom_expiry_days integer, p_assigned_reason text) IS 'Assigns a coupon to be awarded automatically when users complete a survey';


--
-- Name: assign_coupon_to_user(uuid, uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.assign_coupon_to_user(p_coupon_id uuid, p_user_id uuid, p_assigned_by uuid DEFAULT NULL::uuid, p_assigned_reason text DEFAULT NULL::text, p_custom_expiry timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    user_coupon_id UUID;
    coupon_record RECORD;
    current_usage INTEGER;
    user_usage_count INTEGER;
    expiry_date TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get coupon details and validate
    SELECT * INTO coupon_record FROM coupons WHERE id = p_coupon_id AND status = 'active';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon not found or not active';
    END IF;
    
    -- Check if coupon is still valid
    IF coupon_record.valid_until IS NOT NULL AND coupon_record.valid_until < NOW() THEN
        RAISE EXCEPTION 'Coupon has expired';
    END IF;
    
    -- Check total usage limit
    IF coupon_record.usage_limit IS NOT NULL AND coupon_record.used_count >= coupon_record.usage_limit THEN
        RAISE EXCEPTION 'Coupon usage limit exceeded';
    END IF;
    
    -- Check per-user usage limit
    SELECT COUNT(*) INTO user_usage_count 
    FROM user_coupons 
    WHERE coupon_id = p_coupon_id AND user_id = p_user_id AND status <> 'revoked';
    
    IF coupon_record.usage_limit_per_user IS NOT NULL AND user_usage_count >= coupon_record.usage_limit_per_user THEN
        RAISE EXCEPTION 'User usage limit exceeded for this coupon';
    END IF;
    
    -- Determine expiry date
    expiry_date := COALESCE(p_custom_expiry, coupon_record.valid_until);
    
    -- Create user coupon
    INSERT INTO user_coupons (
        user_id, 
        coupon_id, 
        assigned_by, 
        assigned_reason, 
        expires_at
    )
    VALUES (
        p_user_id, 
        p_coupon_id, 
        p_assigned_by, 
        p_assigned_reason, 
        expiry_date
    )
    RETURNING id INTO user_coupon_id;
    
    RETURN user_coupon_id;
END;
$$;


ALTER FUNCTION public.assign_coupon_to_user(p_coupon_id uuid, p_user_id uuid, p_assigned_by uuid, p_assigned_reason text, p_custom_expiry timestamp with time zone) OWNER TO loyalty;

--
-- Name: audit_feature_toggle_changes(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.audit_feature_toggle_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only insert audit record on updates (not inserts)
    IF TG_OP = 'UPDATE' AND OLD.is_enabled != NEW.is_enabled THEN
        INSERT INTO feature_toggle_audit (
            feature_toggle_id,
            previous_state,
            new_state,
            changed_by,
            reason
        ) VALUES (
            NEW.id,
            OLD.is_enabled,
            NEW.is_enabled,
            NEW.updated_by,
            CASE 
                WHEN NEW.is_enabled THEN 'Feature enabled'
                ELSE 'Feature disabled'
            END
        );
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.audit_feature_toggle_changes() OWNER TO loyalty;

--
-- Name: award_points(uuid, integer, public.points_transaction_type, text, text, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.award_points(p_user_id uuid, p_points integer, p_type public.points_transaction_type, p_description text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_admin_user_id uuid DEFAULT NULL::uuid, p_admin_reason text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(transaction_id uuid, new_current_points integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_transaction_id UUID;
    v_current_points INTEGER;
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Insert transaction with NO expiration (ignore p_expires_at parameter since points never expire)
    INSERT INTO points_transactions (
        id, user_id, points, type, description, reference_id,
        admin_user_id, admin_reason, expires_at
    ) VALUES (
        v_transaction_id, p_user_id, p_points, p_type, p_description, p_reference_id,
        p_admin_user_id, p_admin_reason, NULL  -- Always NULL since points never expire
    );
    
    -- Update user totals (only current_points, no lifetime_points)
    UPDATE user_loyalty 
    SET 
        current_points = current_points + p_points,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING current_points 
    INTO v_current_points;
    
    RETURN QUERY SELECT v_transaction_id, v_current_points;
END;
$$;


ALTER FUNCTION public.award_points(p_user_id uuid, p_points integer, p_type public.points_transaction_type, p_description text, p_reference_id text, p_admin_user_id uuid, p_admin_reason text, p_expires_at timestamp with time zone) OWNER TO loyalty;

--
-- Name: award_survey_completion_coupons(uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.award_survey_completion_coupons(p_survey_response_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.award_survey_completion_coupons(p_survey_response_id uuid) OWNER TO loyalty;

--
-- Name: award_survey_completion_coupons(uuid, uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.award_survey_completion_coupons(p_survey_id uuid, p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.award_survey_completion_coupons(p_survey_id uuid, p_user_id uuid) OWNER TO loyalty;

--
-- Name: calculate_user_points(uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.calculate_user_points(p_user_id uuid) RETURNS TABLE(current_points integer, expiring_points integer, next_expiry_date timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH valid_points AS (
        SELECT 
            pt.points,
            pt.expires_at
        FROM points_transactions pt
        WHERE pt.user_id = p_user_id
        AND pt.points > 0
        AND (pt.expires_at IS NULL OR pt.expires_at > NOW())
    ),
    expiring_soon AS (
        SELECT 
            SUM(vp.points) as points,
            MIN(vp.expires_at) as next_expiry
        FROM valid_points vp
        WHERE vp.expires_at IS NOT NULL 
        AND vp.expires_at <= NOW() + INTERVAL '30 days'
    )
    SELECT 
        COALESCE((
            SELECT SUM(pt.points) 
            FROM points_transactions pt 
            WHERE pt.user_id = p_user_id
        ), 0)::INTEGER as current_points,
        COALESCE(es.points, 0)::INTEGER as expiring_points,
        es.next_expiry as next_expiry_date
    FROM expiring_soon es;
END;
$$;


ALTER FUNCTION public.calculate_user_points(p_user_id uuid) OWNER TO loyalty;

--
-- Name: generate_qr_code(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.generate_qr_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.generate_qr_code() OWNER TO loyalty;

--
-- Name: generate_reception_id_sequential(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.generate_reception_id_sequential() RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
    current_count INTEGER;
    new_count INTEGER;
    block_number INTEGER;
    random_within_block INTEGER;
    new_id VARCHAR(8);
    id_exists BOOLEAN;
    attempt_count INTEGER := 0;
    max_attempts INTEGER := 100;
BEGIN
    -- Get and increment the current user count atomically
    UPDATE reception_id_sequence 
    SET current_user_count = current_user_count + 1,
        updated_at = NOW()
    RETURNING current_user_count INTO new_count;
    
    -- Calculate which block (1-100, 101-200, 201-300, etc.) this user belongs to
    block_number := FLOOR((new_count - 1) / 100);
    
    -- Generate random number within the block range
    -- Block 0: 1-100, Block 1: 101-200, Block 2: 201-300, etc.
    LOOP
        random_within_block := (block_number * 100) + FLOOR(RANDOM() * 100) + 1;
        
        -- Format as 8-digit ID: 269 + 5-digit padded number
        new_id := '269' || LPAD(random_within_block::TEXT, 5, '0');
        
        -- Check if this ID already exists
        SELECT EXISTS(SELECT 1 FROM user_profiles WHERE reception_id = new_id) INTO id_exists;
        
        -- If ID doesn't exist, return it
        IF NOT id_exists THEN
            RETURN new_id;
        END IF;
        
        -- Increment attempt counter to prevent infinite loops
        attempt_count := attempt_count + 1;
        
        -- If we've tried too many times within this block, raise an exception
        IF attempt_count >= max_attempts THEN
            RAISE EXCEPTION 'Unable to generate unique reception ID in block % after % attempts. Block may be full.', block_number, max_attempts;
        END IF;
    END LOOP;
END;
$$;


ALTER FUNCTION public.generate_reception_id_sequential() OWNER TO loyalty;

--
-- Name: get_linked_accounts(uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.get_linked_accounts(user_uuid uuid) RETURNS TABLE(linked_user_id uuid, email character varying, oauth_provider character varying, first_name character varying, last_name character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id as linked_user_id,
        u.email,
        u.oauth_provider,
        p.first_name,
        p.last_name
    FROM users u
    LEFT JOIN user_profiles p ON u.id = p.user_id
    WHERE u.id IN (
        -- Users linked to this user as primary
        SELECT la.linked_user_id FROM linked_accounts la WHERE la.primary_user_id = user_uuid
        UNION
        -- Users where this user is linked to them
        SELECT la.primary_user_id FROM linked_accounts la WHERE la.linked_user_id = user_uuid
        UNION
        -- Users linked to the same primary as this user
        SELECT la2.linked_user_id 
        FROM linked_accounts la1 
        JOIN linked_accounts la2 ON la1.primary_user_id = la2.primary_user_id 
        WHERE la1.linked_user_id = user_uuid AND la2.linked_user_id != user_uuid
    )
    AND u.id != user_uuid
    AND u.is_active = true;
END;
$$;


ALTER FUNCTION public.get_linked_accounts(user_uuid uuid) OWNER TO loyalty;

--
-- Name: get_primary_user(uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.get_primary_user(user_uuid uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    primary_id UUID;
BEGIN
    -- Check if this user is a primary user
    SELECT user_uuid INTO primary_id 
    WHERE EXISTS(SELECT 1 FROM linked_accounts WHERE primary_user_id = user_uuid);
    
    IF primary_id IS NOT NULL THEN
        RETURN primary_id;
    END IF;
    
    -- Check if this user is linked to a primary user
    SELECT primary_user_id INTO primary_id 
    FROM linked_accounts 
    WHERE linked_user_id = user_uuid 
    LIMIT 1;
    
    IF primary_id IS NOT NULL THEN
        RETURN primary_id;
    END IF;
    
    -- User is not linked, return themselves
    RETURN user_uuid;
END;
$$;


ALTER FUNCTION public.get_primary_user(user_uuid uuid) OWNER TO loyalty;

--
-- Name: redeem_coupon(text, numeric, uuid, character varying, character varying, jsonb); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.redeem_coupon(p_qr_code text, p_original_amount numeric, p_redeemed_by_admin uuid DEFAULT NULL::uuid, p_transaction_reference character varying DEFAULT NULL::character varying, p_location character varying DEFAULT NULL::character varying, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(success boolean, message text, discount_amount numeric, final_amount numeric, user_coupon_id uuid)
    LANGUAGE plpgsql
    AS $$
DECLARE
    user_coupon_record RECORD;
    coupon_record RECORD;
    calculated_discount DECIMAL(10,2);
    final_amount_calc DECIMAL(10,2);
    redemption_id UUID;
BEGIN
    -- Find user coupon by QR code
    SELECT uc.*, c.*
    INTO user_coupon_record
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.qr_code = p_qr_code;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Invalid QR code', 0.00::DECIMAL(10,2), p_original_amount, NULL::UUID;
        RETURN;
    END IF;
    
    -- Validate coupon status
    IF user_coupon_record.status <> 'available' THEN
        RETURN QUERY SELECT false, 'Coupon is not available for use', 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.id;
        RETURN;
    END IF;
    
    -- Check expiry
    IF user_coupon_record.expires_at IS NOT NULL AND user_coupon_record.expires_at < NOW() THEN
        -- Update status to expired
        UPDATE user_coupons SET status = 'expired' WHERE id = user_coupon_record.id;
        RETURN QUERY SELECT false, 'Coupon has expired', 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.id;
        RETURN;
    END IF;
    
    -- Check minimum spend
    IF user_coupon_record.minimum_spend IS NOT NULL AND p_original_amount < user_coupon_record.minimum_spend THEN
        RETURN QUERY SELECT false, format('Minimum spend of %s required', user_coupon_record.minimum_spend), 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.id;
        RETURN;
    END IF;
    
    -- Calculate discount
    CASE user_coupon_record.type
        WHEN 'percentage' THEN
            calculated_discount := p_original_amount * (user_coupon_record.value / 100);
            -- Apply maximum discount if set
            IF user_coupon_record.maximum_discount IS NOT NULL AND calculated_discount > user_coupon_record.maximum_discount THEN
                calculated_discount := user_coupon_record.maximum_discount;
            END IF;
        WHEN 'fixed_amount' THEN
            calculated_discount := LEAST(user_coupon_record.value, p_original_amount);
        WHEN 'bogo' THEN
            -- For BOGO, assume 50% discount (can be customized)
            calculated_discount := p_original_amount * 0.5;
        ELSE
            -- For other types, treat as percentage with value as discount
            calculated_discount := p_original_amount * (COALESCE(user_coupon_record.value, 0) / 100);
    END CASE;
    
    final_amount_calc := GREATEST(0, p_original_amount - calculated_discount);
    
    -- Mark coupon as used
    UPDATE user_coupons 
    SET 
        status = 'used',
        used_at = NOW(),
        used_by_admin = p_redeemed_by_admin,
        redemption_location = p_location
    WHERE id = user_coupon_record.id;
    
    -- Update coupon usage count
    UPDATE coupons 
    SET used_count = used_count + 1 
    WHERE id = user_coupon_record.coupon_id;
    
    -- Record redemption history
    INSERT INTO coupon_redemptions (
        user_coupon_id,
        original_amount,
        discount_amount,
        final_amount,
        currency,
        transaction_reference,
        staff_member_id,
        location,
        metadata
    )
    VALUES (
        user_coupon_record.id,
        p_original_amount,
        calculated_discount,
        final_amount_calc,
        user_coupon_record.currency,
        p_transaction_reference,
        p_redeemed_by_admin,
        p_location,
        p_metadata
    )
    RETURNING id INTO redemption_id;
    
    RETURN QUERY SELECT true, 'Coupon redeemed successfully', calculated_discount, final_amount_calc, user_coupon_record.id;
END;
$$;


ALTER FUNCTION public.redeem_coupon(p_qr_code text, p_original_amount numeric, p_redeemed_by_admin uuid, p_transaction_reference character varying, p_location character varying, p_metadata jsonb) OWNER TO loyalty;

--
-- Name: remove_coupon_from_survey(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.remove_coupon_from_survey(p_survey_id uuid, p_coupon_id uuid, p_removed_by uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.remove_coupon_from_survey(p_survey_id uuid, p_coupon_id uuid, p_removed_by uuid) OWNER TO loyalty;

--
-- Name: set_qr_code(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.set_qr_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.qr_code IS NULL OR NEW.qr_code = '' THEN
        NEW.qr_code := generate_qr_code();
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_qr_code() OWNER TO loyalty;

--
-- Name: trigger_award_survey_coupons(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.trigger_award_survey_coupons() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only trigger when survey is being marked as completed
    IF NEW.is_completed = TRUE AND (OLD.is_completed IS NULL OR OLD.is_completed = FALSE) THEN
        -- Award coupons asynchronously (in background)
        PERFORM award_survey_completion_coupons(NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.trigger_award_survey_coupons() OWNER TO loyalty;

--
-- Name: update_feature_toggle_updated_at(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.update_feature_toggle_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_feature_toggle_updated_at() OWNER TO loyalty;

--
-- Name: update_reception_sequence_updated_at(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.update_reception_sequence_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_reception_sequence_updated_at() OWNER TO loyalty;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO loyalty;

--
-- Name: update_user_tier(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.update_user_tier() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    -- Find the appropriate tier based on current points
    SELECT id INTO new_tier_id
    FROM tiers 
    WHERE is_active = true 
    AND min_points <= NEW.current_points
    ORDER BY min_points DESC
    LIMIT 1;
    
    -- Update tier if it changed
    IF new_tier_id IS DISTINCT FROM NEW.tier_id THEN
        NEW.tier_id = new_tier_id;
        NEW.tier_updated_at = NOW();
    END IF;
    
    NEW.points_updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_user_tier() OWNER TO loyalty;

--
-- Name: update_user_tier_by_nights(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.update_user_tier_by_nights() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    -- Find the appropriate tier based on total nights
    SELECT id INTO new_tier_id
    FROM tiers 
    WHERE is_active = true 
    AND min_points <= NEW.total_nights
    ORDER BY min_points DESC, sort_order DESC
    LIMIT 1;
    
    -- Update the user's tier if found
    IF new_tier_id IS NOT NULL THEN
        NEW.tier_id := new_tier_id;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_user_tier_by_nights() OWNER TO loyalty;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_link_requests; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.account_link_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    requester_user_id uuid NOT NULL,
    target_email character varying(255) NOT NULL,
    target_user_id uuid,
    request_type character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    CONSTRAINT account_link_requests_request_type_check CHECK (((request_type)::text = ANY ((ARRAY['link_to_email'::character varying, 'link_to_existing'::character varying])::text[]))),
    CONSTRAINT account_link_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'expired'::character varying])::text[])))
);


ALTER TABLE public.account_link_requests OWNER TO loyalty;

--
-- Name: account_linking_audit; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.account_linking_audit (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    action character varying(50) NOT NULL,
    target_email character varying(255),
    target_user_id uuid,
    request_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.account_linking_audit OWNER TO loyalty;

--
-- Name: coupon_analytics; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.coupon_analytics (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    coupon_id uuid NOT NULL,
    analytics_date date NOT NULL,
    total_assigned integer DEFAULT 0,
    total_used integer DEFAULT 0,
    total_expired integer DEFAULT 0,
    total_revenue_impact numeric(12,2) DEFAULT 0.00,
    unique_users_assigned integer DEFAULT 0,
    unique_users_redeemed integer DEFAULT 0,
    average_time_to_redemption interval,
    conversion_rate numeric(5,2),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.coupon_analytics OWNER TO loyalty;

--
-- Name: coupon_redemptions; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.coupon_redemptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_coupon_id uuid NOT NULL,
    original_amount numeric(10,2),
    discount_amount numeric(10,2),
    final_amount numeric(10,2),
    currency character varying(3) DEFAULT 'USD'::character varying,
    transaction_reference character varying(255),
    redemption_channel character varying(50) DEFAULT 'mobile_app'::character varying,
    staff_member_id uuid,
    location character varying(255),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.coupon_redemptions OWNER TO loyalty;

--
-- Name: coupons; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.coupons (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    terms_and_conditions text,
    type public.coupon_type NOT NULL,
    value numeric(10,2),
    currency character varying(3) DEFAULT 'USD'::character varying,
    minimum_spend numeric(10,2),
    maximum_discount numeric(10,2),
    valid_from timestamp with time zone DEFAULT now(),
    valid_until timestamp with time zone,
    usage_limit integer,
    usage_limit_per_user integer DEFAULT 1,
    used_count integer DEFAULT 0,
    tier_restrictions jsonb DEFAULT '[]'::jsonb,
    customer_segment jsonb DEFAULT '{}'::jsonb,
    status public.coupon_status DEFAULT 'draft'::public.coupon_status,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.coupons OWNER TO loyalty;

--
-- Name: feature_toggle_audit; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.feature_toggle_audit (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    feature_toggle_id uuid NOT NULL,
    previous_state boolean,
    new_state boolean NOT NULL,
    changed_by uuid NOT NULL,
    changed_at timestamp with time zone DEFAULT now(),
    reason text,
    ip_address inet,
    user_agent text
);


ALTER TABLE public.feature_toggle_audit OWNER TO loyalty;

--
-- Name: feature_toggles; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.feature_toggles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    feature_key character varying(100) NOT NULL,
    feature_name character varying(255) NOT NULL,
    description text,
    is_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid
);


ALTER TABLE public.feature_toggles OWNER TO loyalty;

--
-- Name: linked_accounts; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.linked_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    primary_user_id uuid NOT NULL,
    linked_user_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now(),
    linked_by uuid,
    CONSTRAINT linked_accounts_check CHECK ((primary_user_id <> linked_user_id))
);


ALTER TABLE public.linked_accounts OWNER TO loyalty;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.password_reset_tokens OWNER TO loyalty;

--
-- Name: points_earning_rules; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.points_earning_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    points_per_unit numeric(10,2) NOT NULL,
    unit_type character varying(50) DEFAULT 'currency'::character varying,
    multiplier_by_tier jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    valid_from timestamp with time zone DEFAULT now(),
    valid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.points_earning_rules OWNER TO loyalty;

--
-- Name: points_transactions; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.points_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    points integer NOT NULL,
    type public.points_transaction_type NOT NULL,
    description text,
    reference_id character varying(100),
    admin_user_id uuid,
    admin_reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    nights_stayed integer DEFAULT 0
);


ALTER TABLE public.points_transactions OWNER TO loyalty;

--
-- Name: reception_id_sequence; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.reception_id_sequence (
    id integer NOT NULL,
    current_user_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.reception_id_sequence OWNER TO loyalty;

--
-- Name: TABLE reception_id_sequence; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.reception_id_sequence IS 'Tracks user registration sequence for block-based reception ID generation';


--
-- Name: COLUMN reception_id_sequence.current_user_count; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.reception_id_sequence.current_user_count IS 'Current count of users with reception IDs, used for block calculation';


--
-- Name: reception_id_sequence_id_seq; Type: SEQUENCE; Schema: public; Owner: loyalty
--

CREATE SEQUENCE public.reception_id_sequence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.reception_id_sequence_id_seq OWNER TO loyalty;

--
-- Name: reception_id_sequence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: loyalty
--

ALTER SEQUENCE public.reception_id_sequence_id_seq OWNED BY public.reception_id_sequence.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(500) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.refresh_tokens OWNER TO loyalty;

--
-- Name: survey_coupon_assignments; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_coupon_assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    is_active boolean DEFAULT true,
    max_awards integer,
    awarded_count integer DEFAULT 0,
    assigned_by uuid,
    assigned_reason text DEFAULT 'Survey completion reward'::text,
    custom_expiry_days integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.survey_coupon_assignments OWNER TO loyalty;

--
-- Name: TABLE survey_coupon_assignments; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.survey_coupon_assignments IS 'Links surveys to coupons that should be awarded upon completion';


--
-- Name: COLUMN survey_coupon_assignments.max_awards; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.survey_coupon_assignments.max_awards IS 'Optional limit on total awards for this survey-coupon pair';


--
-- Name: COLUMN survey_coupon_assignments.custom_expiry_days; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.survey_coupon_assignments.custom_expiry_days IS 'Override coupon expiry with custom duration from award date';


--
-- Name: surveys; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.surveys (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    questions jsonb NOT NULL,
    target_segment jsonb DEFAULT '{}'::jsonb,
    status character varying(50) DEFAULT 'draft'::character varying,
    scheduled_start timestamp without time zone,
    scheduled_end timestamp without time zone,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    access_type character varying(20) DEFAULT 'public'::character varying NOT NULL,
    CONSTRAINT surveys_access_type_check CHECK (((access_type)::text = ANY ((ARRAY['public'::character varying, 'invite_only'::character varying])::text[]))),
    CONSTRAINT surveys_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'paused'::character varying, 'completed'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.surveys OWNER TO loyalty;

--
-- Name: TABLE surveys; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.surveys IS 'Survey definitions with questions and targeting criteria';


--
-- Name: COLUMN surveys.questions; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.surveys.questions IS 'JSONB array of question objects with type, text, options, required fields';


--
-- Name: COLUMN surveys.target_segment; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.surveys.target_segment IS 'JSONB object defining customer segmentation criteria (tier, registration_date, etc.)';


--
-- Name: users; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    role public.user_role DEFAULT 'customer'::public.user_role,
    is_active boolean DEFAULT true,
    email_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    oauth_provider character varying(50),
    oauth_provider_id character varying(255)
);


ALTER TABLE public.users OWNER TO loyalty;

--
-- Name: survey_coupon_details; Type: VIEW; Schema: public; Owner: loyalty
--

CREATE VIEW public.survey_coupon_details AS
 SELECT sca.id AS assignment_id,
    sca.survey_id,
    s.title AS survey_title,
    s.status AS survey_status,
    sca.coupon_id,
    c.code AS coupon_code,
    c.name AS coupon_name,
    c.type AS coupon_type,
    c.value AS coupon_value,
    c.currency AS coupon_currency,
    c.status AS coupon_status,
    sca.is_active,
    sca.max_awards,
    sca.awarded_count,
    sca.custom_expiry_days,
    sca.assigned_reason,
    sca.assigned_by,
    u.email AS assigned_by_email,
    sca.created_at AS assigned_at,
    sca.updated_at
   FROM (((public.survey_coupon_assignments sca
     JOIN public.surveys s ON ((sca.survey_id = s.id)))
     JOIN public.coupons c ON ((sca.coupon_id = c.id)))
     LEFT JOIN public.users u ON ((sca.assigned_by = u.id)));


ALTER TABLE public.survey_coupon_details OWNER TO loyalty;

--
-- Name: survey_invitations; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_invitations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_id uuid,
    user_id uuid,
    status character varying(50) DEFAULT 'pending'::character varying,
    sent_at timestamp without time zone,
    viewed_at timestamp without time zone,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT survey_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'viewed'::character varying, 'started'::character varying, 'completed'::character varying, 'expired'::character varying])::text[])))
);


ALTER TABLE public.survey_invitations OWNER TO loyalty;

--
-- Name: TABLE survey_invitations; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.survey_invitations IS 'Survey distribution tracking and invitation status';


--
-- Name: survey_responses; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_id uuid,
    user_id uuid,
    answers jsonb NOT NULL,
    is_completed boolean DEFAULT false,
    progress integer DEFAULT 0,
    started_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT survey_responses_progress_check CHECK (((progress >= 0) AND (progress <= 100)))
);


ALTER TABLE public.survey_responses OWNER TO loyalty;

--
-- Name: TABLE survey_responses; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.survey_responses IS 'User responses to surveys with progress tracking';


--
-- Name: COLUMN survey_responses.answers; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.survey_responses.answers IS 'JSONB object mapping question IDs to user responses';


--
-- Name: COLUMN survey_responses.progress; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.survey_responses.progress IS 'Completion percentage (0-100) for partial responses';


--
-- Name: survey_reward_history; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_reward_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_coupon_assignment_id uuid NOT NULL,
    survey_response_id uuid NOT NULL,
    user_coupon_id uuid NOT NULL,
    user_id uuid NOT NULL,
    awarded_at timestamp with time zone DEFAULT now(),
    award_condition_met character varying(50) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.survey_reward_history OWNER TO loyalty;

--
-- Name: TABLE survey_reward_history; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.survey_reward_history IS 'History of coupon rewards given for survey completions';


--
-- Name: COLUMN survey_reward_history.award_condition_met; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.survey_reward_history.award_condition_met IS 'Always "completion" - coupons are only awarded when surveys are completed';


--
-- Name: tiers; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.tiers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(50) NOT NULL,
    min_points integer NOT NULL,
    benefits jsonb DEFAULT '{}'::jsonb,
    color character varying(7) NOT NULL,
    sort_order integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.tiers OWNER TO loyalty;

--
-- Name: user_coupons; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.user_coupons (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    status public.user_coupon_status DEFAULT 'available'::public.user_coupon_status,
    qr_code text NOT NULL,
    used_at timestamp with time zone,
    used_by_admin uuid,
    redemption_location character varying(255),
    redemption_details jsonb DEFAULT '{}'::jsonb,
    assigned_by uuid,
    assigned_reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_coupons OWNER TO loyalty;

--
-- Name: TABLE user_coupons; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON TABLE public.user_coupons IS 'User coupon assignments. Multiple instances of the same coupon are allowed for the same user to enable multiple redemptions of campaigns.';


--
-- Name: user_active_coupons; Type: VIEW; Schema: public; Owner: loyalty
--

CREATE VIEW public.user_active_coupons AS
 SELECT uc.id AS user_coupon_id,
    uc.user_id,
    uc.status,
    uc.qr_code,
    uc.expires_at,
    uc.created_at AS assigned_at,
    c.id AS coupon_id,
    c.code,
    c.name,
    c.description,
    c.terms_and_conditions,
    c.type,
    c.value,
    c.currency,
    c.minimum_spend,
    c.maximum_discount,
    c.valid_until AS coupon_expires_at,
        CASE
            WHEN ((uc.expires_at IS NOT NULL) AND (c.valid_until IS NOT NULL)) THEN LEAST(uc.expires_at, c.valid_until)
            ELSE COALESCE(uc.expires_at, c.valid_until)
        END AS effective_expiry,
        CASE
            WHEN ((uc.expires_at IS NOT NULL) AND (c.valid_until IS NOT NULL)) THEN (LEAST(uc.expires_at, c.valid_until) <= (now() + '7 days'::interval))
            ELSE (COALESCE(uc.expires_at, c.valid_until) <= (now() + '7 days'::interval))
        END AS expiring_soon
   FROM (public.user_coupons uc
     JOIN public.coupons c ON ((uc.coupon_id = c.id)))
  WHERE ((uc.status = 'available'::public.user_coupon_status) AND (c.status = 'active'::public.coupon_status) AND ((uc.expires_at IS NULL) OR (uc.expires_at > now())) AND ((c.valid_until IS NULL) OR (c.valid_until > now())));


ALTER TABLE public.user_active_coupons OWNER TO loyalty;

--
-- Name: user_audit_log; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.user_audit_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_audit_log OWNER TO loyalty;

--
-- Name: user_loyalty; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.user_loyalty (
    user_id uuid NOT NULL,
    current_points integer DEFAULT 0,
    tier_id uuid,
    tier_updated_at timestamp with time zone DEFAULT now(),
    points_updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    total_nights integer DEFAULT 0
);


ALTER TABLE public.user_loyalty OWNER TO loyalty;

--
-- Name: user_points_calculation; Type: VIEW; Schema: public; Owner: loyalty
--

CREATE VIEW public.user_points_calculation AS
 SELECT ul.user_id,
    ul.current_points,
    0 AS expiring_points,
    NULL::timestamp without time zone AS next_expiry_date
   FROM public.user_loyalty ul;


ALTER TABLE public.user_points_calculation OWNER TO loyalty;

--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.user_profiles (
    user_id uuid NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    phone character varying(20),
    date_of_birth date,
    preferences jsonb DEFAULT '{}'::jsonb,
    avatar_url character varying(500),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reception_id character varying(8) NOT NULL
);


ALTER TABLE public.user_profiles OWNER TO loyalty;

--
-- Name: COLUMN user_profiles.reception_id; Type: COMMENT; Schema: public; Owner: loyalty
--

COMMENT ON COLUMN public.user_profiles.reception_id IS 'Unique 8-digit numeric ID in format 269XXXXX with sequential block-based generation for reception communication';


--
-- Name: user_tier_info; Type: VIEW; Schema: public; Owner: loyalty
--

CREATE VIEW public.user_tier_info AS
 SELECT ul.user_id,
    ul.current_points,
    ul.total_nights,
    t.id AS tier_id,
    t.name AS tier_name,
    t.color AS tier_color,
    t.benefits AS tier_benefits,
    t.sort_order AS tier_level,
        CASE
            WHEN (next_tier.min_points IS NOT NULL) THEN round((((ul.total_nights)::numeric / (next_tier.min_points)::numeric) * (100)::numeric), 2)
            ELSE 100.0
        END AS progress_percentage,
    next_tier.min_points AS next_tier_nights,
    next_tier.name AS next_tier_name,
        CASE
            WHEN (next_tier.min_points IS NOT NULL) THEN GREATEST(0, (next_tier.min_points - ul.total_nights))
            ELSE NULL::integer
        END AS nights_to_next_tier,
    next_tier.min_points AS next_tier_points,
        CASE
            WHEN (next_tier.min_points IS NOT NULL) THEN GREATEST(0, (next_tier.min_points - ul.total_nights))
            ELSE NULL::integer
        END AS points_to_next_tier
   FROM ((public.user_loyalty ul
     LEFT JOIN public.tiers t ON (((ul.total_nights >= t.min_points) AND (t.is_active = true))))
     LEFT JOIN public.tiers next_tier ON ((next_tier.sort_order = ( SELECT min(t2.sort_order) AS min
           FROM public.tiers t2
          WHERE ((t2.sort_order > COALESCE(t.sort_order, '-1'::integer)) AND (t2.is_active = true))))))
  WHERE ((t.id IS NULL) OR (t.sort_order = ( SELECT max(t3.sort_order) AS max
           FROM public.tiers t3
          WHERE ((ul.total_nights >= t3.min_points) AND (t3.is_active = true)))));


ALTER TABLE public.user_tier_info OWNER TO loyalty;

--
-- Name: valid_points; Type: VIEW; Schema: public; Owner: loyalty
--

CREATE VIEW public.valid_points AS
 SELECT pt.id,
    pt.user_id,
    pt.points,
    pt.type,
    pt.description,
    pt.reference_id,
    pt.nights_stayed,
    pt.admin_user_id,
    pt.admin_reason,
    pt.expires_at,
    pt.created_at
   FROM public.points_transactions pt
  WHERE (pt.points <> 0);


ALTER TABLE public.valid_points OWNER TO loyalty;

--
-- Name: reception_id_sequence id; Type: DEFAULT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.reception_id_sequence ALTER COLUMN id SET DEFAULT nextval('public.reception_id_sequence_id_seq'::regclass);


--
-- Data for Name: account_link_requests; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.account_link_requests (id, requester_user_id, target_email, target_user_id, request_type, status, message, created_at, updated_at, expires_at) FROM stdin;
\.


--
-- Data for Name: account_linking_audit; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.account_linking_audit (id, user_id, action, target_email, target_user_id, request_id, details, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: coupon_analytics; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.coupon_analytics (id, coupon_id, analytics_date, total_assigned, total_used, total_expired, total_revenue_impact, unique_users_assigned, unique_users_redeemed, average_time_to_redemption, conversion_rate, created_at) FROM stdin;
\.


--
-- Data for Name: coupon_redemptions; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.coupon_redemptions (id, user_coupon_id, original_amount, discount_amount, final_amount, currency, transaction_reference, redemption_channel, staff_member_id, location, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: coupons; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.coupons (id, code, name, description, terms_and_conditions, type, value, currency, minimum_spend, maximum_discount, valid_from, valid_until, usage_limit, usage_limit_per_user, used_count, tier_restrictions, customer_segment, status, created_by, created_at, updated_at) FROM stdin;
e9d238d9-62a1-48de-880c-35e184d4a2e2	TEST1753110370269	Test Coupon 1753110370269	Test coupon created for troubleshooting	\N	percentage	10.00	THB	\N	\N	2025-07-21 15:06:10.339+00	\N	100	1	0	[]	{}	expired	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-21 15:06:10.333051+00	2025-07-23 03:34:06.755694+00
302cf891-a674-4cf6-816c-731f416daa96	TRANSLATE10	Translation Test Coupon	Testing coupon for translation feature	\N	percentage	10.00	USD	\N	\N	2025-07-23 16:01:07.774+00	\N	\N	1	0	[]	{}	draft	\N	2025-07-23 16:01:07.758207+00	2025-07-24 05:37:22.727295+00
856c2afa-996f-46f2-a87f-68a7d85d0840	TEST511019	Translation Test Coupon	Testing coupon for translation feature	\N	percentage	10.00	USD	\N	\N	2025-07-23 16:01:51.02+00	\N	\N	1	0	[]	{}	draft	\N	2025-07-23 16:01:51.019782+00	2025-07-24 05:37:22.727295+00
063ecb4e-be48-486c-a96a-e959e70283ba	TEST520032	Translation Test Coupon	Testing coupon for translation feature	\N	percentage	10.00	USD	\N	\N	2025-07-23 16:02:00.033+00	\N	\N	1	0	[]	{}	draft	\N	2025-07-23 16:02:00.033478+00	2025-07-24 05:37:22.727295+00
c5cef2e6-cc75-49fa-bc0a-a05d8d670005	TEST528567	Translation Test Coupon	Testing coupon for translation feature	\N	percentage	10.00	USD	\N	\N	2025-07-23 16:02:08.569+00	\N	\N	1	0	[]	{}	expired	\N	2025-07-23 16:02:08.56924+00	2025-07-24 05:37:22.727295+00
6f13628f-afcc-4dcd-bf32-bb6bc390cb23	1FREE1	1แถม1	\N	\N	bogo	\N	USD	\N	\N	2025-07-21 00:00:00+00	2025-07-21 23:59:59.999+00	100	5	0	[]	{}	expired	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-21 09:24:36.026951+00	2025-07-24 22:31:09.915341+00
891f5412-a810-4186-a022-285ae143cb44	TESTTTTT	testt	\N	\N	free_service	\N	USD	\N	\N	2025-07-21 00:00:00+00	2025-07-21 23:59:59.999+00	100	1	0	[]	{}	expired	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-21 06:04:11.310868+00	2025-07-21 06:22:18.211003+00
cfafbdfc-3036-48e4-8384-65356bcdb7b2	UPGRADE	Free Room Upgrade	Complimentary room upgrade	Subject to availability. Valid for Gold and Platinum members only.	free_upgrade	0.00	USD	\N	\N	2025-07-20 18:06:19.802191+00	2026-07-20 18:06:19.802191+00	100	1	0	[]	{}	expired	\N	2025-07-20 18:06:19.802191+00	2025-07-21 06:56:08.219005+00
341c57ab-9b96-4416-9dd6-d28da2b4db1d	WELCOME10	Welcome 10% Off	Get 10% off your first stay	Valid for first-time guests only. Cannot be combined with other offers.	percentage	10.00	USD	100.00	50.00	2025-07-20 18:06:19.802191+00	2026-01-20 18:06:19.802191+00	1000	1	0	[]	{}	expired	\N	2025-07-20 18:06:19.802191+00	2025-07-21 06:56:11.188979+00
10a6d1a9-3237-4ebf-a386-27eab55e2b3e	LOYALTY50	Loyalty $50 Off	Loyalty members get $50 off	Valid for stays of 2 nights or more. Available to Silver tier and above.	fixed_amount	50.00	USD	200.00	\N	2025-07-20 18:06:19.802191+00	2025-10-20 18:06:19.802191+00	500	2	0	[]	{}	expired	\N	2025-07-20 18:06:19.802191+00	2025-07-21 06:56:13.674393+00
239b5ffd-9fff-4346-893f-3be8b7b0d5de	10FREE1	พัก 10 คืนฟรี 1 คืน	ห้องพักฟรี 1 คืน	ลูกค้าพักสะสม 10 คืน	free_service	\N	THB	\N	\N	2025-07-21 00:00:00+00	2025-12-31 23:59:59.999+00	9999	9999	0	[]	{}	active	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-21 10:02:33.433969+00	2025-07-21 15:10:22.718055+00
1d14fbf8-79f3-44ed-a670-c0e6c7c83b78	TEST123	Test Coupon for Deletion	This coupon is for testing token refresh on deletion	\N	percentage	10.00	USD	\N	\N	2025-01-20 00:00:00+00	2025-12-31 23:59:59.999+00	100	1	0	[]	{}	expired	\N	2025-07-21 04:00:49.465749+00	2025-07-22 23:10:00.062949+00
9a1b807c-af0e-48dd-99a4-16a15722acb6	ACTIVATE123	Test Activation Coupon	This coupon tests the activation fix	\N	percentage	25.00	USD	\N	\N	2025-01-20 00:00:00+00	2025-12-31 23:59:59.999+00	50	1	0	[]	{}	expired	\N	2025-07-21 05:59:57.109978+00	2025-07-22 23:10:00.062949+00
729cdbe4-f4de-4851-aab1-7dde63618129	FRESH1753047080508	Fresh Test Coupon 1753047080508	Fresh coupon for testing complete workflow	\N	percentage	25.00	USD	\N	\N	2025-07-20 21:31:20.508+00	2025-08-19 21:31:20.509+00	100	3	0	[]	{}	expired	\N	2025-07-20 21:31:20.511411+00	2025-07-22 23:10:31.929806+00
b8b86aa4-1f56-4bdc-9858-9940c32c468b	FRESH1753044195572	Fresh Test Coupon 1753044195572	Fresh coupon for testing complete workflow	\N	percentage	25.00	USD	\N	\N	2025-07-20 20:43:15.572+00	2025-08-19 20:43:15.574+00	100	3	1	[]	{}	expired	\N	2025-07-20 20:00:28.238008+00	2025-07-22 23:10:31.929806+00
66d189a5-3a3f-480c-9b13-52704cfae5a2	FINAL1753041529573	Final Test Coupon	Testing complete workflow	\N	percentage	15.00	USD	\N	\N	2025-07-20 19:58:49.573+00	2025-08-19 19:58:49.574+00	100	1	0	[]	{}	expired	\N	2025-07-20 19:58:49.57597+00	2025-07-22 23:10:31.929806+00
47d901a7-b626-483c-bbee-c68087e25407	TEST459292	Test Coupon TEST459292	Test coupon for activation troubleshooting	\N	percentage	20.00	USD	\N	\N	2025-07-20 00:00:00+00	2025-08-19 23:59:59.999+00	100	1	0	[]	{}	expired	\N	2025-07-20 19:57:39.389938+00	2025-07-22 23:10:31.929806+00
f5ef310c-2bfb-48e2-ab15-ea394f4d939d	TEST865679	Test Coupon TEST865679	Test coupon for activation troubleshooting	\N	percentage	20.00	USD	\N	\N	2025-07-20 00:00:00+00	2025-08-19 23:59:59.999+00	100	1	1	[]	{}	expired	\N	2025-07-20 19:47:45.760273+00	2025-07-22 23:10:31.929806+00
11033d00-15be-4110-aa79-b81432e7ccae	TEST783346	Test TEST783346	Test coupon created at 7/21/2025, 2:29:43 AM	\N	percentage	15.00	USD	\N	\N	2025-07-20 00:00:00+00	2025-08-19 23:59:59.999+00	100	1	0	[]	{}	expired	\N	2025-07-20 19:29:43.949374+00	2025-07-22 23:10:31.929806+00
20e10a08-5dce-4148-ad31-bed6d33158e2	TEST763484	Test TEST763484	Test coupon created at 7/21/2025, 2:29:23 AM	\N	percentage	15.00	USD	\N	\N	2025-07-20 00:00:00+00	2025-08-19 23:59:59.999+00	100	1	0	[]	{}	expired	\N	2025-07-20 19:29:24.103643+00	2025-07-22 23:10:31.929806+00
c5f43d2c-fbd6-43ea-8e17-9572218c3508	SAVE20	20% ส่วนลด	ส่วนลด 20% สำหรับการใช้งานครั้งต่อไป	ไม่สามารถใช้ร่วมกับโปรโมชั่นอื่นได้	percentage	20.00	THB	100.00	500.00	2025-07-21 10:52:22.017+00	2025-10-19 10:52:22.017+00	1000	3	0	[]	{}	active	\N	2025-07-21 10:52:22.016547+00	2025-07-22 23:10:31.929806+00
\.


--
-- Data for Name: feature_toggle_audit; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.feature_toggle_audit (id, feature_toggle_id, previous_state, new_state, changed_by, changed_at, reason, ip_address, user_agent) FROM stdin;
e8cb662b-7c37-48da-9033-10f71572b501	515f4a64-5fad-4805-b360-f2ec5c92a305	t	f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-19 19:56:50.89127+00	Feature disabled	\N	\N
6ac39eb6-6e73-4ca4-a9d4-9ed0e6c1b409	515f4a64-5fad-4805-b360-f2ec5c92a305	t	f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-19 19:56:50.89127+00	disable	::ffff:192.168.65.1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36
\.


--
-- Data for Name: feature_toggles; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.feature_toggles (id, feature_key, feature_name, description, is_enabled, created_at, updated_at, created_by, updated_by) FROM stdin;
cadbfb92-1593-44dc-89a4-3ac1a2d85da1	facebook_oauth	Facebook Social Login	Enable login and registration via Facebook OAuth	f	2025-07-19 19:41:59.083835+00	2025-07-19 19:41:59.083835+00	\N	\N
515f4a64-5fad-4805-b360-f2ec5c92a305	account_linking	Account Linking	Allow users to link multiple authentication methods to a single account	f	2025-07-19 19:41:59.083835+00	2025-07-19 19:56:50.89127+00	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf
\.


--
-- Data for Name: linked_accounts; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.linked_accounts (id, primary_user_id, linked_user_id, linked_at, linked_by) FROM stdin;
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.password_reset_tokens (id, user_id, token, expires_at, used, created_at) FROM stdin;
\.


--
-- Data for Name: points_earning_rules; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.points_earning_rules (id, name, description, points_per_unit, unit_type, multiplier_by_tier, is_active, valid_from, valid_until, created_at, updated_at) FROM stdin;
937ace1b-6c77-418d-9253-302d670b21d2	Standard Earning	Standard points earning rate for hotel stays	10.00	currency	{"Gold": 1.5, "Bronze": 1.0, "Silver": 1.25, "Platinum": 2.0}	t	2025-07-20 16:06:13.03607+00	\N	2025-07-20 16:06:13.03607+00	2025-07-20 16:06:13.03607+00
\.


--
-- Data for Name: points_transactions; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.points_transactions (id, user_id, points, type, description, reference_id, admin_user_id, admin_reason, expires_at, created_at, nights_stayed) FROM stdin;
cb9ce019-7d97-4b3b-941a-4132f386df21	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	200	admin_award	Points awarded by admin	\N	\N	\N	\N	2025-07-20 19:11:24.566025+00	0
94645539-acef-4145-adb3-62b7f8526fe3	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	200	admin_award	Points awarded by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	\N	\N	2025-07-24 06:46:54.921621+00	0
451cf26c-5c07-4b57-8591-a34e439a4ab1	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	-400	admin_deduction	Points deducted by admin: Points deducted by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Points deducted by admin	\N	2025-07-24 06:46:59.118054+00	0
2e1f4059-c09e-4514-8a37-7d52f8f0180d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	6900	admin_award	Spending points: 690 THB (Check-in: test)	test	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Spending points: 690 THB (Check-in: test)	\N	2025-07-24 07:54:31.233213+00	0
57f1cfb5-779b-491b-a1e2-eb9cfd8aa686	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	10000	earned_stay	Test spending award	test-ref-123	\N	\N	\N	2025-07-24 09:06:34.026706+00	2
fd7f816a-3bd7-4664-af80-70204667083c	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	10000	earned_stay	Spending points: 1000 THB, 5 nights (Check-in: test)	test	\N	\N	\N	2025-07-24 09:08:54.999886+00	5
a56c8429-6aba-4290-98a1-ed4d395ff887	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	1000	earned_stay	Test non-expiring points	test-no-expiry	\N	\N	\N	2025-07-24 09:15:16.270514+00	1
2f4fbda3-43e0-4ef7-9281-e1a139f13458	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	1000	earned_stay	Test non-expiring points	test-no-expiry	\N	\N	\N	2025-07-24 09:15:36.772811+00	1
3131171e-a8d7-40c9-afcc-7d5cc023d8c0	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	1000	earned_stay	Test function without lifetime_points	test-removal	\N	\N	\N	2025-07-24 09:27:29.967675+00	1
a0775869-235e-4a0a-82a2-8c6a23bf40f7	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	1000	earned_stay	Test function without lifetime_points	test-removal	\N	\N	\N	2025-07-24 09:28:18.594686+00	1
99667c64-e89e-4ce4-bb06-88e0e49426a8	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	50	admin_award	Test award without lifetime_points	\N	\N	\N	\N	2025-07-24 09:28:18.786399+00	0
25104963-f35a-4b55-9ccf-9a86a8ed3b6b	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	100	admin_award	Test admin award	test-ref	\N	Testing function fix	\N	2025-07-24 09:35:47.218757+00	0
c7dfabcf-bc28-4bfd-b4af-593789996bc2	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	200	admin_award	Points awarded by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Points awarded by admin user 59d2f833-a118-4a43-a1d1-73a7f5119ddf	\N	2025-07-24 09:38:23.483376+00	0
08b21e9f-2d20-4e8b-a253-9d60f1a8257d	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	-12300	admin_deduction	Points deducted by admin: Points deducted by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Points deducted by admin	\N	2025-07-24 09:38:33.230639+00	0
59333d17-4618-4b9b-bacb-c12902051e82	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	-12050	admin_deduction	Points deducted by admin: Points deducted by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Points deducted by admin	\N	2025-07-24 09:38:45.297129+00	0
52906517-7986-4f54-a4ef-e8ab68cf90a7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	-6900	admin_deduction	Points deducted by admin: Points deducted by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Points deducted by admin	\N	2025-07-24 09:38:49.279308+00	0
c14fb7f8-7448-42c3-9aca-c295f18d35c1	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	800	admin_award	Points awarded by admin	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Points awarded by admin user 59d2f833-a118-4a43-a1d1-73a7f5119ddf	\N	2025-07-24 10:04:25.433302+00	0
fa6f2bda-5a5f-4d14-a8d8-d61d927f60f3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	90000	earned_stay	Spending points: 9000 THB, 5 nights (Check-in: test)	test	\N	\N	\N	2025-07-24 10:04:38.948947+00	5
\.


--
-- Data for Name: reception_id_sequence; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.reception_id_sequence (id, current_user_count, created_at, updated_at) FROM stdin;
1	24	2025-07-24 05:03:46.91677+00	2025-07-25 16:29:50.160731+00
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.refresh_tokens (id, user_id, token, expires_at, created_at) FROM stdin;
c431a1b3-968b-4d7f-ac70-4d6e9c0b477e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzI1NDg3LCJleHAiOjE3NTM5MzAyODd9.d8sNQita2UvyzQ5fkVkb9eY-jBQO3kv0PFDh8u_Uz8A	2025-07-31 02:51:27.335345+00	2025-07-24 02:51:27.335345+00
1cf11684-5d3e-412f-9c05-c70da90681a3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjQxOTg5LCJleHAiOjE3NTM4NDY3ODl9.Qqw70H6nvKLCVEsncRcdbSRMTUR1Tc4RFxzOh-gbnE0	2025-07-30 03:39:49.146031+00	2025-07-23 03:39:49.146031+00
bca6894b-ee38-4669-b865-515213da127e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzI1NDkxLCJleHAiOjE3NTM5MzAyOTF9.zA7_kKYa8eI2k5HmqxiYCMONk8eczkXTS3rjLnsMtA8	2025-07-31 02:51:31.877065+00	2025-07-24 02:51:31.877065+00
d791d8ed-77ba-4942-9570-be6f6d91e8c5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc1Mjk0MzgwNywiZXhwIjoxNzUzNTQ4NjA3fQ.BjwomrkVCbADX0w2g_TTqwksFhCuUp8xdABwDha0DXs	2025-07-26 16:50:07.473601+00	2025-07-19 16:50:07.473601+00
c396fc3c-e2c6-4105-91dc-a7138faf15ff	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzM1OTk5LCJleHAiOjE3NTM5NDA3OTl9.nXDFY2igGDRmvPbIeHMsMZjjmffGNxL1tx34CS1VtHc	2025-07-31 05:46:39.210534+00	2025-07-24 05:46:39.210534+00
73089cd5-817d-4948-996d-7387de76f03e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDg4LCJleHAiOjE3NTM4NjgyODh9.rrHZEWKTzd7i5lvQRr5Yz_XDrqug4tg9tqbFj9BcrrU	2025-07-30 09:38:08.595404+00	2025-07-23 09:38:08.595404+00
b8f13fa9-22c8-4e3f-a053-7a908fe58711	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzk5MTU0LCJleHAiOjE3NTQwMDM5NTR9.aRSjp36YzH07T-3tvDwFBqTegqgYkQQFpT1bHQxjwMY	2025-07-31 23:19:14.187489+00	2025-07-24 23:19:14.187489+00
60202b4f-8d95-4940-97be-6c029e63b4db	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzQxNzE1LCJleHAiOjE3NTM5NDY1MTV9.DRC5qCogtbIvS_fbTz2aEjcOZ0SDFsYw6Vji1bQxr5c	2025-07-31 07:21:55.425299+00	2025-07-24 07:21:55.425299+00
7ef1f9fe-ca0b-4bb6-8b65-b3fa69a6655b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzQ1ODM4LCJleHAiOjE3NTM5NTA2Mzh9.fOryKzx1I-Pd26x5wib7nNCH7StqJSL3KLj2o93ABbo	2025-07-31 08:30:38.701896+00	2025-07-24 08:30:38.701896+00
e6ecc301-d50b-49ee-b20f-7cf678df5dc1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzkzNzM3LCJleHAiOjE3NTM5OTg1Mzd9.TkZNjBzaA6GKa-hrvAWalOaP6MKywkbvsUEXLo-m6Mw	2025-07-31 21:48:57.562834+00	2025-07-24 21:48:57.562834+00
2845d690-1154-4e92-bcf7-2cb01e73754a	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTI5NDgyOTksImV4cCI6MTc1MzU1MzA5OX0.AYUOyJQSnwTE5E16PR9ZWguIVX14EgWCpHuG13JN_u0	2025-07-26 18:04:59.217672+00	2025-07-19 18:04:59.217672+00
42d7a860-05e9-4035-aa44-b8027ae1a3e8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1Mjk1NDk5MywiZXhwIjoxNzUzNTU5NzkzfQ.D6IM-P4sDDB2z1WT8vSmPzCUDoiGnE61zj31zKc-V3U	2025-07-26 19:56:33.386191+00	2025-07-19 19:56:33.386191+00
ac0dc546-87e5-4189-8dfc-3aadc486f968	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyMzY1OSwiZXhwIjoxNzUzNjI4NDU5fQ.TnS5ua2fnvwhgeRf8LthRXb99FT75xQImquZhFdsVmw	2025-07-27 15:00:59.443034+00	2025-07-20 15:00:59.443034+00
04385622-4a5e-408e-8f38-cefc83099ef5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyNjU3MSwiZXhwIjoxNzUzNjMxMzcxfQ.ecweLTqBlr1VVwCGs35P3GJWIXhE98hPXsSSFnVeSSw	2025-07-27 15:49:31.382968+00	2025-07-20 15:49:31.382968+00
f01c05d4-ece0-48b3-a48c-ac7a51d7734c	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTMwMjY1NzcsImV4cCI6MTc1MzYzMTM3N30.rZUSrgPxw3x8bn9WiLFcTzhsFLYQfMnSpFhmQs01l-0	2025-07-27 15:49:37.092204+00	2025-07-20 15:49:37.092204+00
f9cba7ce-de2f-40bd-a2c4-adfd1e35332e	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTMwMjgwMTYsImV4cCI6MTc1MzYzMjgxNn0.TycW5P8cBdHpE2sVB_nCMwRL0A1iU9g1bDQFJRAxjqw	2025-07-27 16:13:36.880742+00	2025-07-20 16:13:36.880742+00
e675728a-8d59-44ed-918e-5faac84cffdb	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTMwMjgwMjQsImV4cCI6MTc1MzYzMjgyNH0.3ZoeVwlAYxgWYk8LOpKTVbGQqoVTWxy7uu2-1QEOHPM	2025-07-27 16:13:44.617944+00	2025-07-20 16:13:44.617944+00
496417a0-be38-475c-801b-454882b53b14	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyODA4NSwiZXhwIjoxNzUzNjMyODg1fQ.0sPbej3y-Xep3gV59LbnGUBUViDoy04gA3xXSpsF_O8	2025-07-27 16:14:45.336649+00	2025-07-20 16:14:45.336649+00
68c875b8-b9f5-464c-ab33-8646fbf328e3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjI3MzgxLCJleHAiOjE3NTM4MzIxODF9.Bi3X-hdVApIjVY6lEbiKwZoopCjENSaQGyGwhfThH4k	2025-07-29 23:36:21.076368+00	2025-07-22 23:36:21.076368+00
708ea0e6-805a-4a46-9424-18331c1ca01d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyODA5NSwiZXhwIjoxNzUzNjMyODk1fQ.odRWFHPDbFUsW8zUXRIk-Nv-6mTyXrtINyA6-mYvssI	2025-07-27 16:14:55.941464+00	2025-07-20 16:14:55.941464+00
e649a44b-77a7-4935-8cb5-94f2246a0508	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyODM5NiwiZXhwIjoxNzUzNjMzMTk2fQ.3MZ1c_ysC-Lf7ikU6-nxXs_mCP_mASxHBlGTzUhdzGQ	2025-07-27 16:19:56.903952+00	2025-07-20 16:19:56.903952+00
96f6fa8f-4c57-487c-a6dd-aff21294900e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyODQwOSwiZXhwIjoxNzUzNjMzMjA5fQ.s_Sw_E_y5DwjfJQF046dDRM7gVk8Hiq-L8Y9b_G256M	2025-07-27 16:20:09.822722+00	2025-07-20 16:20:09.822722+00
9b43b905-421d-42b7-936f-0f865662e232	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5NjU2YmRjLTVlM2UtNDVlOS1iOWYwLTI1NWNiNWJiMDgyYyIsImVtYWlsIjoibGluZV9VYTc0NDhmOWViMDY4YmI0YzdkNDgwZTJmMGFlZDNjMjFAbGluZS5vYXV0aCIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc1MzQwNTUyNywiZXhwIjoxNzU0MDEwMzI3fQ.65cLGdCcUvVxA6XU02Sq124WLjH4PODshKkz8Z9kvLk	2025-08-01 01:05:27.519676+00	2025-07-25 01:05:27.519676+00
bb0250e3-ff71-427e-a3f9-fa47d1247341	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDg5LCJleHAiOjE3NTM4NjgyODl9.dhxTFU0HygHr0XuWmhoLfJkkAWgRmo9pTiC9nT3kE-s	2025-07-30 09:38:09.642623+00	2025-07-23 09:38:09.642623+00
4cb2931c-e2cc-40c0-8f4e-d6145b8c8b6f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAyOTA2NywiZXhwIjoxNzUzNjMzODY3fQ.itMTbdlMv58T9Nsn2YxpBhKi6KhEHfKtE3WCvIZLlA8	2025-07-27 16:31:07.430495+00	2025-07-20 16:31:07.430495+00
f9eeae03-7e96-4fab-bc18-955b4e245861	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTMwMzA2NTQsImV4cCI6MTc1MzYzNTQ1NH0.6ZBlpxnukncnsNoLFLioduuDWGpnGcVA9FUjyBODPRI	2025-07-27 16:57:34.483173+00	2025-07-20 16:57:34.483173+00
0ef58133-d73b-42bd-9fdd-a0cc20872dae	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzQ4MDg1LCJleHAiOjE3NTM5NTI4ODV9.GlmOjYvSGqwqI0oxw8Qv2REPU9BS720Lfn-7Cp_QKZE	2025-07-31 09:08:05.696066+00	2025-07-24 09:08:05.696066+00
6afe6c2f-14fd-476b-b870-f499d159ed80	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjg0MTY4LCJleHAiOjE3NTM4ODg5Njh9.kkP1FzydA7OLEiS2IKpyJPuew3S134XVnukOPC0QY7s	2025-07-30 15:22:48.684678+00	2025-07-23 15:22:48.684678+00
42ba6632-bc61-4166-bd1c-a21993fa9751	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAzNTA5MCwiZXhwIjoxNzUzNjM5ODkwfQ.9jLCN4B2Darp8iL0NxV4hd4AB3KRRAO4FjIYNIwml6M	2025-07-27 18:11:30.064713+00	2025-07-20 18:11:30.064713+00
c92a8acf-56d0-4db4-a042-2b0e6f50118a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAzNTgwNSwiZXhwIjoxNzUzNjQwNjA1fQ.mUYj79hzKDCVGAXej-w0s0GTA4xukthTNLr5pK0ZtHk	2025-07-27 18:23:25.440474+00	2025-07-20 18:23:25.440474+00
9a2f4989-6a9b-4975-bb88-d8b1aded02b7	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTMwMzU4MTcsImV4cCI6MTc1MzY0MDYxN30.qNQ-1izZRdjIyD0Hu4qohEQgnkFkQqn9UU_IwkH8YXA	2025-07-27 18:23:37.5797+00	2025-07-20 18:23:37.5797+00
088f5845-50ad-439d-be7c-b24eed41c8d5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYyNzY5LCJleHAiOjE3NTM4Njc1Njl9.Xu2sSHlX3svLOEvwoGroAJC7QnIS3h0NZl8EkOhIB-g	2025-07-30 09:26:09.699362+00	2025-07-23 09:26:09.699362+00
7eeb0d66-2969-4b6c-8cc5-66c4f71bbeae	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzODMyLCJleHAiOjE3NTM4Njg2MzJ9.NRv6Y5f1wXlIJcPsxyAcV7Cb28-3dtc0ooEZAyOpsCA	2025-07-30 09:43:52.830302+00	2025-07-23 09:43:52.830302+00
0deffc07-459d-4d6b-a025-489e07b02863	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzODM5LCJleHAiOjE3NTM4Njg2Mzl9.cgCmdCZ0XLoxF-B3U2DmJt7UQWlRKKILEpk2GljT428	2025-07-30 09:43:59.256094+00	2025-07-23 09:43:59.256094+00
dc5058e0-d167-4131-944d-9daa70f308ce	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjM1ZDRkOWIzLTlhZGQtNGQxYi05Y2M5LTBhODM2ZjUyZDBiYiIsImVtYWlsIjoibnV0LndpbnV0QGdtYWlsLmNvbSIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc1MzM4MjA0MCwiZXhwIjoxNzUzOTg2ODQwfQ.X0ahSag1GUANBE8QzhxnjtA-ptObSDeZ_c4A2aUmPqs	2025-07-31 18:34:00.529332+00	2025-07-24 18:34:00.529332+00
4f74b6a8-b217-431a-b0c4-158fe28e3421	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMDI3NywiZXhwIjoxNzUzNzE1MDc3fQ.PK1_We4B3C-1BZ5cl2MgdU9LvpGWwdjtWZ17BwQxCkc	2025-07-28 15:04:37.348346+00	2025-07-21 15:04:37.348346+00
eaf9a958-cdf6-4cb8-a620-bf230e24e51b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjI4Mzc1LCJleHAiOjE3NTM4MzMxNzV9.xokd0sexl_2qTdizkiVJ0JEMoZUYhxlqjMuMJ3W-SoE	2025-07-29 23:52:55.214457+00	2025-07-22 23:52:55.214457+00
3a1ff0b8-e617-4830-bb5d-c066ce59ae7b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYyMTIwLCJleHAiOjE3NTM4NjY5MjB9.Kx1CGRNGAsWCfixtna5HizpVUaeIAwpu50C0oLbepv8	2025-07-30 09:15:20.334335+00	2025-07-23 09:15:20.334335+00
7cf43de7-14bc-4650-939f-875abdf0ee5c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYyNzcwLCJleHAiOjE3NTM4Njc1NzB9.-Ow64rDaSqJCheA9Uwiu6nte2fXl53TjXth0t6Ehj_c	2025-07-30 09:26:10.077943+00	2025-07-23 09:26:10.077943+00
9d50689e-10d2-4907-89c8-4796f811fdfe	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjY0MTc3LCJleHAiOjE3NTM4Njg5Nzd9.SgbkuvVqUCpobmI33SdHByHMfWsQ7XteXfaUYeIn6eI	2025-07-30 09:49:37.230602+00	2025-07-23 09:49:37.230602+00
d8b11d0b-39ba-48d0-a38e-8f802d4cf00e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjg1MDgzLCJleHAiOjE3NTM4ODk4ODN9.bt8V0fHzTt75gLNizsnUEDlOgXbqwOIZnRQEe_o4sOI	2025-07-30 15:38:03.414172+00	2025-07-23 15:38:03.414172+00
ed812d3b-ea46-4399-be3f-659bab79f936	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzAzOTgxMywiZXhwIjoxNzUzNjQ0NjEzfQ.CscOUQUFF_uUy-y-OwKBaMdB9L1nYbPlDgAN_gZ1Wy8	2025-07-27 19:30:13.439907+00	2025-07-20 19:30:13.439907+00
ae727ef9-e8af-40d8-9ca7-bb3909ff1a9b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzc1OTU0LCJleHAiOjE3NTM5ODA3NTR9.F2Ylg9QdLKPq1TWyyvv__QTuOSCD0IaNBP5m-vR6PQs	2025-07-31 16:52:34.61374+00	2025-07-24 16:52:34.61374+00
359f0454-caf8-43dd-83fa-4041288daf51	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjkzNTEzLCJleHAiOjE3NTM4OTgzMTN9.8xsi22_IS2Y2x8tg8hZnUEJpGQuvPIKqRsoSaILBC_Y	2025-07-30 17:58:33.888049+00	2025-07-23 17:58:33.888049+00
14e623e1-e171-43f0-bff3-e901ce8f4b57	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMDM0NiwiZXhwIjoxNzUzNzE1MTQ2fQ.T44VjQ8g2sRsPCvIwtV0c0DxS-C4Ea40V8vQSa3wnmQ	2025-07-28 15:05:47.000216+00	2025-07-21 15:05:47.000216+00
0c31c207-9c5d-4e13-b352-9aae6a2d1f94	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzI3NDI1LCJleHAiOjE3NTM5MzIyMjV9.mgFF5_wCnw_cT1kOStP2jVOXr8Pqm47Fwd5eCwZhYYE	2025-07-31 03:23:45.173605+00	2025-07-24 03:23:45.173605+00
d2ee59d9-8296-42b5-adcb-153bb7cbe919	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA0MTI3OCwiZXhwIjoxNzUzNjQ2MDc4fQ.r9P_yXvfijcUUhV8JAaMidTkpeBrq8Y4M-q_3fJiyqE	2025-07-27 19:54:38.489036+00	2025-07-20 19:54:38.489036+00
43dd4ff4-98db-417f-a4e8-bc1b0ff3c416	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5NjU2YmRjLTVlM2UtNDVlOS1iOWYwLTI1NWNiNWJiMDgyYyIsImVtYWlsIjoibGluZV9VYTc0NDhmOWViMDY4YmI0YzdkNDgwZTJmMGFlZDNjMjFAbGluZS5vYXV0aCIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc1MzI3MzgwNSwiZXhwIjoxNzUzODc4NjA1fQ.Jhi4tF1J1HIjNhuO_gfH-Zb6AiOXfWjzr00T2eA3ey0	2025-07-30 12:30:05.95188+00	2025-07-23 12:30:05.95188+00
f1bc3500-848e-461d-8c44-bded12d25ca0	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzNWQ0ZDliMy05YWRkLTRkMWItOWNjOS0wYTgzNmY1MmQwYmIiLCJlbWFpbCI6Im51dC53aW51dEBnbWFpbC5jb20iLCJyb2xlIjoiY3VzdG9tZXIiLCJpYXQiOjE3NTMwNjY5MjQsImV4cCI6MTc1MzY3MTcyNH0.Pj1W-QQWDPKm5eHv__U86JlS8Tbcr3VH5cJ7xjtdjQs	2025-07-28 03:02:04.746892+00	2025-07-21 03:02:04.746892+00
b6131673-16de-48fa-bba8-cb446bfb00ac	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA2NzUwNCwiZXhwIjoxNzUzNjcyMzA0fQ.H5hX8xVtHF18oI-yHyDTIQ6BARuC11ilINd6hBiNvkM	2025-07-28 03:11:44.729134+00	2025-07-21 03:11:44.729134+00
e465788b-aa64-48ee-89ab-fd09d899cd64	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzM4Mzk5LCJleHAiOjE3NTM5NDMxOTl9.I07wIvtb_lsxyP_NcyvxC_JqopSHehmduma4pm3bA7Q	2025-07-31 06:26:39.369874+00	2025-07-24 06:26:39.369874+00
3d894d1b-0b68-410c-adf9-456c65abd8b4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjY1NTQwLCJleHAiOjE3NTM4NzAzNDB9.L-F4zzduiMl5n1CQfnQLQGFDqnD2GiCn7r7tsOQ7HQo	2025-07-30 10:12:20.15894+00	2025-07-23 10:12:20.15894+00
093c0436-dcc6-4d4e-aab1-6c5eef0fef98	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMDQxNSwiZXhwIjoxNzUzNzE1MjE1fQ.hBFgngtOzFxD1w0UHZN3P-pLnvEkWSWQHK0E3JCgNTk	2025-07-28 15:06:55.922748+00	2025-07-21 15:06:55.922748+00
7f504ba6-55e7-4a0b-a012-13568ee28682	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA3MjMyNywiZXhwIjoxNzUzNjc3MTI3fQ.FfNPPdMs_xWCQSIXIz3sk6tpX3qSFwdNiHG5twRtpZw	2025-07-28 04:32:07.152756+00	2025-07-21 04:32:07.152756+00
6fc4f4e1-9916-475c-bf2f-80acc60eb32d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzQ5ODg4LCJleHAiOjE3NTM5NTQ2ODh9.2guLz2lNRLdDhLEzyopQv064Ktd2Mg9aLQh70YmwoEA	2025-07-31 09:38:08.062276+00	2025-07-24 09:38:08.062276+00
acaceb3a-e273-4f23-a47b-78a7f978f344	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA3NzE2OSwiZXhwIjoxNzUzNjgxOTY5fQ.GphNQsfgnuAUw6870vxgMwdS08-LgmoUowOMRzoYZ-o	2025-07-28 05:52:49.793403+00	2025-07-21 05:52:49.793403+00
2e65749f-1fbb-410f-bad6-b7e34838742d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMTA4NiwiZXhwIjoxNzUzNzE1ODg2fQ.8hXTB38AwbimirmCOeWfvV-xBJlYiZUlJy4Sy3wVums	2025-07-28 15:18:06.89328+00	2025-07-21 15:18:06.89328+00
d8f8a6a4-76d6-45df-8a58-e20acffa1977	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzI0OTU3LCJleHAiOjE3NTM5Mjk3NTd9.3B5OGFyKJJEKkAmgZzAFFk9hsycE8bdddzDWo1KZeAs	2025-07-31 02:42:37.19617+00	2025-07-24 02:42:37.19617+00
3d51cc48-1dcd-4e73-8530-6d3c610607e5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMzUwNSwiZXhwIjoxNzUzNzE4MzA1fQ.6QlUEG5h5IhVB_y8P6eQjVpAdTPS2P9bi9kRyJ6JZzw	2025-07-28 15:58:25.045642+00	2025-07-21 15:58:25.045642+00
372bfe12-6922-4358-a622-31dda8d91a85	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA3ODQ0NiwiZXhwIjoxNzUzNjgzMjQ2fQ.yUi85AXe1iAVTLU5NtoTQFCwPrGiprYuUHjMGvP4-Ng	2025-07-28 06:14:06.052214+00	2025-07-21 06:14:06.052214+00
2ad8dddf-c737-4505-b5be-a88e2dbcf4ae	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjY2NjE3LCJleHAiOjE3NTM4NzE0MTd9.reiTQlHif1U2FZN7kjNRskaxbqVAZaiku8heptpFkuI	2025-07-30 10:30:17.741219+00	2025-07-23 10:30:17.741219+00
80638863-16c4-43eb-b833-9ed3a379246c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMDE2NywiZXhwIjoxNzUzNzE0OTY3fQ.rfWsvsPFKc6Cv0jTwQ5FSqcTR3Diyf6IML-kZAkIG_o	2025-07-28 15:02:47.142801+00	2025-07-21 15:02:47.142801+00
53fd5b93-28fe-4ea9-89de-59d7487cf123	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA3OTg2OCwiZXhwIjoxNzUzNjg0NjY4fQ.cvec906ChtXnxMFrkiVMs9xliUFAyVyyz83nKaAYHbU	2025-07-28 06:37:48.871186+00	2025-07-21 06:37:48.871186+00
0bf8c01b-d2a4-405c-952b-3a64a6b87eb7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjgwNjI0LCJleHAiOjE3NTM4ODU0MjR9.uoee4cqPlT6JiIoL4PWYKz0CavBPn_rM1UNFr9fEL1g	2025-07-30 14:23:44.552795+00	2025-07-23 14:23:44.552795+00
c1b98783-4e50-494d-9ef6-665d26e8f45d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA4MDk0MywiZXhwIjoxNzUzNjg1NzQzfQ.oSYKgqAdGVvgw6Do9Z8u6tVhRn09rkwy5uFJgIATLlM	2025-07-28 06:55:43.066853+00	2025-07-21 06:55:43.066853+00
b4ad08c0-5eca-4689-8820-8dcf58caf59e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA4MzE2MCwiZXhwIjoxNzUzNjg3OTYwfQ.N5Pvm91ESFuoQSLd9NqfbAz_MLHGDiQv-poLTWH89cw	2025-07-28 07:32:40.492115+00	2025-07-21 07:32:40.492115+00
92d32e13-90a3-4fb4-a297-9f8515fc1de8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjAxNywiZXhwIjoxNzUzNzk2ODE3fQ.4hPKc9Sz8HfXl8q9rKPvy5GYtuFY71tibJsTmrpfe20	2025-07-29 13:46:57.344437+00	2025-07-22 13:46:57.344437+00
66d3b363-f779-4f29-8acd-db119ca9b96a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA5MzM4NiwiZXhwIjoxNzUzNjk4MTg2fQ.afepEhOEM-mr9mrJva3rdBH_5oqmh5dLhVNPl3-SVAU	2025-07-28 10:23:06.235576+00	2025-07-21 10:23:06.235576+00
1088337f-db18-4ccc-a025-faf585fce20b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA5NDY2NCwiZXhwIjoxNzUzNjk5NDY0fQ.sU8n6vVwMvzwUG-FYVI9siTgz0AJOIYA-Zlgip3ZjLs	2025-07-28 10:44:24.93267+00	2025-07-21 10:44:24.93267+00
d010c3c3-1339-41f0-be7d-c77875450aa5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA5NTY4MywiZXhwIjoxNzUzNzAwNDgzfQ.B1jZN4mzRoWkLFaLpkj25epMkP3NBF8TXDGxL1Wz6tk	2025-07-28 11:01:23.329599+00	2025-07-21 11:01:23.329599+00
c47c43e7-7164-4f9e-8855-612f75305842	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzA5NzEyNiwiZXhwIjoxNzUzNzAxOTI2fQ.i_-bY41iMUk4wlWbqn-fg-L0tYYc1T5RHEP72lVOsm4	2025-07-28 11:25:26.04444+00	2025-07-21 11:25:26.04444+00
15b982f3-1fdd-4bc9-a085-3b751028b933	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDIzLCJleHAiOjE3NTM4NjgyMjN9.U-Pr_2aUyRUvnG5t-WT9VmWAFeq2cy39trDjYF5tL94	2025-07-30 09:37:03.925819+00	2025-07-23 09:37:03.925819+00
bbb149ec-8938-4464-bb7a-e392979cc750	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzM5NTk4LCJleHAiOjE3NTM5NDQzOTh9.2onw_ZWHQJm6hcwSO01j8gwSCDUBTkM_RwMUlY-I2-4	2025-07-31 06:46:38.141167+00	2025-07-24 06:46:38.141167+00
2a27251c-4647-4fa1-935c-f2728e18dbdc	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzEwNzk0OCwiZXhwIjoxNzUzNzEyNzQ4fQ.EMGr8qRLnDK4z7ljVNJQbO4_8lICzU6i23U7PClMTpY	2025-07-28 14:25:48.213429+00	2025-07-21 14:25:48.213429+00
96b61bd3-50a0-4fd4-b0a2-abfbdb0d9cbb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzExMDIwOCwiZXhwIjoxNzUzNzE1MDA4fQ.ePhH58jvkHegOlrlaY8HgwdHm-6TvNmS0cJUPu4JfRA	2025-07-28 15:03:28.367155+00	2025-07-21 15:03:28.367155+00
193d4227-48e7-4fdd-9cf6-0e53e0a62384	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjg3NzY5LCJleHAiOjE3NTM4OTI1Njl9.sF4nRttUCcBzN9dhy8U8qqcoOHDF1pkAKQR7i6vnyjU	2025-07-30 16:22:49.96513+00	2025-07-23 16:22:49.96513+00
a2edf17f-3d52-451a-a9a4-38a501cb375d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE4NzU3NiwiZXhwIjoxNzUzNzkyMzc2fQ.KNonEBVtQrl26qei-eFubQ89Uan85oH2hQNlEiG2kfY	2025-07-29 12:32:56.156263+00	2025-07-22 12:32:56.156263+00
fd43d002-5798-455d-a34b-6be90b02c2de	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE4OTM4NSwiZXhwIjoxNzUzNzk0MTg1fQ.Ny35U9s5izwkvRkVMiG4IRAJ6XPRVniYh26rZKjl16Q	2025-07-29 13:03:05.912821+00	2025-07-22 13:03:05.912821+00
78dda762-eec5-4a50-8705-05dd3220b0c6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MTg1MSwiZXhwIjoxNzUzNzk2NjUxfQ.vZMbBSDOAo4HN_nPOinqvX-dJn1hQZfhMqKEzLIDXqw	2025-07-29 13:44:11.94715+00	2025-07-22 13:44:11.94715+00
ddfa686c-c230-4187-8568-e2dba43a9dcf	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjEzNiwiZXhwIjoxNzUzNzk2OTM2fQ.1i1ErH5XWDLrTH66lIiCkGgF0ti7zi_kEDEBX0lBCl0	2025-07-29 13:48:56.521196+00	2025-07-22 13:48:56.521196+00
3647418d-b0b3-483e-a6bf-49f7b41359d5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjE5OCwiZXhwIjoxNzUzNzk2OTk4fQ.iiX25N35Ba4F3h6unn0nDeiEBEm3eMBV8o-1O4FFBd4	2025-07-29 13:49:58.246561+00	2025-07-22 13:49:58.246561+00
6b5566ee-3867-4ddb-880a-ee80bff4489a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjMwNSwiZXhwIjoxNzUzNzk3MTA1fQ.Jkxv9dCWn-dXRAZck22ekRf93fy4UNZ2DID1gwyI2NI	2025-07-29 13:51:45.983199+00	2025-07-22 13:51:45.983199+00
c6f49480-039d-4c13-bf71-2c16f56d3a32	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjMxMSwiZXhwIjoxNzUzNzk3MTExfQ.1olDCqnTCzC5QcB9x-lDhy7j9Ca4KuU6bcFqACjuDiQ	2025-07-29 13:51:51.822514+00	2025-07-22 13:51:51.822514+00
3712b197-b453-4f46-8fa9-99298e602db6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjMxNiwiZXhwIjoxNzUzNzk3MTE2fQ.1dGxm8jn-oNnSK8tX6GfO9X2s3bQXMhsRK_4iUhZVo0	2025-07-29 13:51:56.806914+00	2025-07-22 13:51:56.806914+00
a695b3a0-7614-4ffd-8bb9-c32b5976a547	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjMyMSwiZXhwIjoxNzUzNzk3MTIxfQ.0IRH6RUAs27iORTauP1RTcLec7eySscrYA1RjB6R-UE	2025-07-29 13:52:01.56022+00	2025-07-22 13:52:01.56022+00
2edb27e0-0247-44f1-be9f-27211798c655	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjMyNiwiZXhwIjoxNzUzNzk3MTI2fQ.kx-Rm9YMdmMNJMqK5T8RW7QIPYZEj4YDDO4gZv70D7g	2025-07-29 13:52:06.917774+00	2025-07-22 13:52:06.917774+00
adb3fa99-4aff-431b-894b-dbfdd6fe310a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjM3MywiZXhwIjoxNzUzNzk3MTczfQ.AQE-dmFBw_CVX-Y2EwNrQ9vGo5ntBB45euRGrrI8dhM	2025-07-29 13:52:53.636531+00	2025-07-22 13:52:53.636531+00
24c2d4bc-3aa4-4c76-9a19-75156cc92cc4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjM3NiwiZXhwIjoxNzUzNzk3MTc2fQ.M31F_d5EVZ2bIgpaOo_HZxINHylbzVnF7dYLoZLg7C8	2025-07-29 13:52:56.753445+00	2025-07-22 13:52:56.753445+00
155a0226-1f85-455d-82f0-ac670a9285d6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MjcwMiwiZXhwIjoxNzUzNzk3NTAyfQ.9rVk6yTH8e7rDpT3XuU9YMU3pIiFAA6ABmYCjo4mtmU	2025-07-29 13:58:22.900208+00	2025-07-22 13:58:22.900208+00
c40074e9-a70f-419a-aadf-70c1afc9de04	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzM0NTQyLCJleHAiOjE3NTM5MzkzNDJ9.IizEhxpEgg8XoYkWo8PdAEsE1BDRnYU2Gop1wmHpMnE	2025-07-31 05:22:22.228574+00	2025-07-24 05:22:22.228574+00
1abb34a8-c7ce-45a1-b2c0-4ebd978fe059	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDI0LCJleHAiOjE3NTM4NjgyMjR9.eszcx9qyzvo0CEaMvbZ_KWZD3qVWnrWpdKw8nf_fOlQ	2025-07-30 09:37:04.9097+00	2025-07-23 09:37:04.9097+00
27c02521-3168-4058-b0ce-0e3301466f7c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MzQ1MywiZXhwIjoxNzUzNzk4MjUzfQ.FCwqtQIcfLld-g_r4g6VRXcXGUNGiX5_jTQD4GuU4sw	2025-07-29 14:10:53.425205+00	2025-07-22 14:10:53.425205+00
c266f8d0-b80f-469a-aff9-e347f02b903b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MzU1MywiZXhwIjoxNzUzNzk4MzUzfQ.w-wy41oMY99iqzDzckWlNbPGr8BkyqdfEAAR9lO9bqY	2025-07-29 14:12:33.404635+00	2025-07-22 14:12:33.404635+00
e5683103-61ba-47c3-abb6-96118de34a67	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MzcyNywiZXhwIjoxNzUzNzk4NTI3fQ._7rvKj3NmXqUsbwkUsg21wPLVVGbDxO8ToUGfPucji0	2025-07-29 14:15:27.693389+00	2025-07-22 14:15:27.693389+00
2655e435-eafb-4d7d-8e72-62c80b2edb70	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MzczMSwiZXhwIjoxNzUzNzk4NTMxfQ.XMKTcU9US5i6vA49NG9ZImeQzYUouKiWhLcS2Xyfp1c	2025-07-29 14:15:31.495414+00	2025-07-22 14:15:31.495414+00
af8687d0-1878-4f96-b457-06aefd22a2e3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Mzg2NywiZXhwIjoxNzUzNzk4NjY3fQ.zvSBtb0Qp4w7UlnPrTfNBOG2Trtdd7L5rT7uoA_S8tU	2025-07-29 14:17:47.112509+00	2025-07-22 14:17:47.112509+00
b3b74c67-ad6f-4c25-8330-c823a0b2b281	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5MzkwMiwiZXhwIjoxNzUzNzk4NzAyfQ.jdA5bgCOm6eiy3Mhv6phWQc11-1QkPYg1Xi_gOIy1Us	2025-07-29 14:18:22.184827+00	2025-07-22 14:18:22.184827+00
5fffc6fa-5ed4-4473-8171-8f7187daa508	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Mzk4MCwiZXhwIjoxNzUzNzk4NzgwfQ.Jwx3SH-gTyeYIvL50vq-nkD8oRq2LMq3QzXoANmgF2s	2025-07-29 14:19:40.209822+00	2025-07-22 14:19:40.209822+00
67d63776-bbaf-4a5c-b6d3-c4a1a72542de	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Mzk4MSwiZXhwIjoxNzUzNzk4NzgxfQ.ZpoUlnfLEUA8hvcYSgQaKtn4F8MI6pnW2fR6H98rYrg	2025-07-29 14:19:41.673192+00	2025-07-22 14:19:41.673192+00
2f8daf34-de8a-4e9d-bfd0-cd2d89c8472b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NDAyNSwiZXhwIjoxNzUzNzk4ODI1fQ._2En1CMZFIKmGnWQBow1ZZvlhFt7aQ9g7evQsbPAkiE	2025-07-29 14:20:25.661077+00	2025-07-22 14:20:25.661077+00
bf9c1e17-9f43-4ad7-a0b0-721a192d3e4c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NDEwNiwiZXhwIjoxNzUzNzk4OTA2fQ.nK-rGiUexyWr1MZzVQvBk_LkYVitc18y63aMSY-qMgM	2025-07-29 14:21:46.327853+00	2025-07-22 14:21:46.327853+00
810af968-5748-40cb-a872-91f6e84e3b1f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NDE4MywiZXhwIjoxNzUzNzk4OTgzfQ.MIxF29fBZLcwqh-3zrjuZ5osIszqHgO_sKK5ZDqJ5Fk	2025-07-29 14:23:03.332283+00	2025-07-22 14:23:03.332283+00
2d081060-05c5-4d24-8ba1-53bcab14bdc5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NDM0MCwiZXhwIjoxNzUzNzk5MTQwfQ.JjNFZYthFABupOLAgP3i5zjM4nAVwT8YReBuFuXC5BE	2025-07-29 14:25:40.836244+00	2025-07-22 14:25:40.836244+00
94d06ecf-d6cd-459a-9273-4f0f18ef52e9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NDM0MiwiZXhwIjoxNzUzNzk5MTQyfQ.C2-stKrAzOKV1Bj-ETYn1PSSWh7wuMlQKzcZYOtVRFg	2025-07-29 14:25:42.8478+00	2025-07-22 14:25:42.8478+00
7c55c2db-92a6-436c-be1b-dbad76642a00	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMzQwNTM5LCJleHAiOjE3NTM5NDUzMzl9.REGsT-OHdnxiSSgCf71NaQqb2nWqq_fvhRE0YjJZXig	2025-07-31 07:02:19.417879+00	2025-07-24 07:02:19.417879+00
f575624a-7a06-4644-a162-0ace7e0398d0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NTE5NiwiZXhwIjoxNzUzNzk5OTk2fQ.-uYy0wOII0vVVNkRFYgRXjigZgCFMULj2W4-arRGKgo	2025-07-29 14:39:56.928119+00	2025-07-22 14:39:56.928119+00
b7a4abbd-7cc2-4c41-a8ca-2ff434e3e6f7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NTI0MywiZXhwIjoxNzUzODAwMDQzfQ.PUJBfFs3E_hbPCpiHT4wYkvJEadDWKb7a3jvvDA02Ds	2025-07-29 14:40:43.827359+00	2025-07-22 14:40:43.827359+00
028202be-24f4-4cc4-97b0-bc1a56aef568	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NTc4MywiZXhwIjoxNzUzODAwNTgzfQ._FrK7I6LVjhbudUDotqRRvvFizYquEwF_MI8-6s14Zc	2025-07-29 14:49:43.502839+00	2025-07-22 14:49:43.502839+00
cbc4f27c-2bd1-4c2c-a7db-e831171ead2c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NTg2MSwiZXhwIjoxNzUzODAwNjYxfQ.9KOuGGDQDut9UTPGXcLFpyukKYwl9cF9HCJMHKDwqJA	2025-07-29 14:51:01.178417+00	2025-07-22 14:51:01.178417+00
d0323e2c-be95-4a9d-b880-795d21d11816	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjM3NTEyLCJleHAiOjE3NTM4NDIzMTJ9.adUtskGphbopAguVW8PN1WTSLQPopY08vTsNVa5dgcg	2025-07-30 02:25:12.985973+00	2025-07-23 02:25:12.985973+00
05c020d3-cdf1-4028-b894-c11e2a6d4580	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDMwLCJleHAiOjE3NTM4NjgyMzB9.byL29QFkb0DhRQfGFkuxVlFHwirfVfgBdcUUghgL41o	2025-07-30 09:37:10.22224+00	2025-07-23 09:37:10.22224+00
64348c39-b86e-4457-97db-d1d2c0eef998	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjY4NjQ0LCJleHAiOjE3NTM4NzM0NDR9.S1P4LO8D0Y3h4blBkkSkc1ImK8gsT1LIfIghudl4Pkg	2025-07-30 11:04:04.150942+00	2025-07-23 11:04:04.150942+00
bf39d681-3cfb-4642-837f-079abb4af036	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjQ1MywiZXhwIjoxNzUzODAxMjUzfQ.gLjyljlmmQm7gcTtaKTKuQWSMOIzdv4QfLRgAc3rhRs	2025-07-29 15:00:53.550875+00	2025-07-22 15:00:53.550875+00
ce0a7e01-8c5f-48ac-a95e-c3a3e4d04875	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjQ4MiwiZXhwIjoxNzUzODAxMjgyfQ.aoKPPqvvqQuNWTeddTuTLd8uFIzwFreQEXei73Y9Frw	2025-07-29 15:01:22.489288+00	2025-07-22 15:01:22.489288+00
de6be308-ff53-4766-b14f-158d40c03e4f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjU0OCwiZXhwIjoxNzUzODAxMzQ4fQ.gRGgC77mqyCrennFyVBr0fwxyy77da7-evCuanP1ltQ	2025-07-29 15:02:28.446985+00	2025-07-22 15:02:28.446985+00
c38ed81b-c896-4eb0-893f-f18ad8a3d7c7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjU4NCwiZXhwIjoxNzUzODAxMzg0fQ.EfuM7S93JVYOqz0kBkWye7DuwWnH0kKu7dhg3mbOO28	2025-07-29 15:03:04.17144+00	2025-07-22 15:03:04.17144+00
09459c25-b5f8-4d8d-adc3-749aebf8b825	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njg3MywiZXhwIjoxNzUzODAxNjczfQ.GbjEnSi-pzrNalDdK-lsfFlQBg1XiNSZzEevlbpukRA	2025-07-29 15:07:53.706542+00	2025-07-22 15:07:53.706542+00
c0f595ff-e229-4ef2-9ea2-f00b7a71b157	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njg3OSwiZXhwIjoxNzUzODAxNjc5fQ.GsomHBYx9SP39wdcQx_EEm-MbeQy8CFqJ6Tac0z-MM0	2025-07-29 15:07:59.050101+00	2025-07-22 15:07:59.050101+00
4b85515d-0a2e-4165-b140-275dd77c47cd	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njg4NiwiZXhwIjoxNzUzODAxNjg2fQ.34iJYH1XVEjXvXjZSlTEMg-YP6yOXod561_kxA62mV4	2025-07-29 15:08:06.60196+00	2025-07-22 15:08:06.60196+00
6351d28f-f26b-46c1-bfa7-50c0d7d50f1d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjkyMiwiZXhwIjoxNzUzODAxNzIyfQ.fcr8VR8umn7t3R6ZFAV77I19OoO4kdeIN7wX4P_FosQ	2025-07-29 15:08:42.704556+00	2025-07-22 15:08:42.704556+00
2f0b49bd-2717-44f1-ae85-d5f7e8cba5e9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjkyOSwiZXhwIjoxNzUzODAxNzI5fQ.8ZP62srdcqanw0H5RwiXq9s8ofNTfsUpHBdvWEDERBw	2025-07-29 15:08:49.058452+00	2025-07-22 15:08:49.058452+00
f151ce8c-2e60-40bd-b3e3-1292646a189c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjkzNCwiZXhwIjoxNzUzODAxNzM0fQ.8AUlJ2WZRVFjifOc0wAD3jDC17WbrM-rA3K3tC18Izs	2025-07-29 15:08:54.042381+00	2025-07-22 15:08:54.042381+00
77ba7f15-edb0-4233-930b-25a3c2a53d96	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5NjkzOSwiZXhwIjoxNzUzODAxNzM5fQ.kYzZzyLlctVv3NorkjDZqmINpxfexe6dhS5L19yPSxc	2025-07-29 15:08:59.066092+00	2025-07-22 15:08:59.066092+00
e96e15db-84e9-4b46-8528-fe55f19aa285	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njk0MywiZXhwIjoxNzUzODAxNzQzfQ.xEFmoCInhmNZSYA-8RRUZvLweAtM21XkOiaGjfVxezs	2025-07-29 15:09:03.933654+00	2025-07-22 15:09:03.933654+00
e58fa64d-4324-48d8-83d5-aa7b512cb6be	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njk1MCwiZXhwIjoxNzUzODAxNzUwfQ.41rG-VxMoXT0IyTQ0eqFK_cbQ23Vf5tuFGUdWbeP_M8	2025-07-29 15:09:10.599509+00	2025-07-22 15:09:10.599509+00
8268a053-faed-40af-9469-fd73030c9b9e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njk1NiwiZXhwIjoxNzUzODAxNzU2fQ.Ow7q0LdCtiK1h8jbKoluJG_Ok4RnhUKmKh31YbEOf3E	2025-07-29 15:09:16.424579+00	2025-07-22 15:09:16.424579+00
d4c87eb5-f88a-4ffa-be9c-2495c27dbcc5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njk2MSwiZXhwIjoxNzUzODAxNzYxfQ.lqHF5Nk3rY4gBLu6yCvmH0g4p3nKzAwPJiHzwr3Zxyo	2025-07-29 15:09:21.82285+00	2025-07-22 15:09:21.82285+00
79608d8b-ed2c-4bf9-9e5b-3dd7feb65ef8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzE5Njk2NywiZXhwIjoxNzUzODAxNzY3fQ.MiEpJzWZxPh3NxVKm3Q2HGxoLvHPsrA_G42GPuSpiGs	2025-07-29 15:09:27.120969+00	2025-07-22 15:09:27.120969+00
2c18bf61-f8cf-4c08-9935-e06b4691c6fa	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIwMjE3MSwiZXhwIjoxNzUzODA2OTcxfQ.AlnayU0hU-340g53cL0TiXq9cd2jAYQaq5vDdH4tE3I	2025-07-29 16:36:11.712795+00	2025-07-22 16:36:11.712795+00
5851f375-f46b-42da-a8d1-d97f4e962c1d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIwNTYzNiwiZXhwIjoxNzUzODEwNDM2fQ.ja9cDSIx7yfgMtRotdJnH3STjpKxuoFaaiR143yP8-g	2025-07-29 17:33:56.848473+00	2025-07-22 17:33:56.848473+00
1f9d4f4b-88b9-4d89-bc3b-975bf07a5cce	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIwNzEzNCwiZXhwIjoxNzUzODExOTM0fQ.s380_-fYGFYMiA3mpS-6_x2VQ5a8KEB6nPVjL1xgXuM	2025-07-29 17:58:54.078245+00	2025-07-22 17:58:54.078245+00
5d39c434-2dc6-4b87-a83d-86ed4056e33d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIwOTUzNywiZXhwIjoxNzUzODE0MzM3fQ.mwBJ-peqN1uU1YJ3qad-3HE2-8QEElVgazggH2BvQWU	2025-07-29 18:38:57.89599+00	2025-07-22 18:38:57.89599+00
540d04be-df95-43fe-85f1-809e9391ef8c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDYyLCJleHAiOjE3NTM4NjgyNjJ9.iW2pOfFsf3ug30PbeOUeu8Pm3Fsw_cJc8SYQ8N74aNg	2025-07-30 09:37:42.263207+00	2025-07-23 09:37:42.263207+00
8b53aa44-b2bc-4e05-a236-fe467b9ca813	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxMDc4MCwiZXhwIjoxNzUzODE1NTgwfQ.SU485c-te-1_f5HfzmrHHK2PGSj_I3TnccfywMg9Os0	2025-07-29 18:59:40.578988+00	2025-07-22 18:59:40.578988+00
1a5f8492-2d27-4e3e-ad28-9112ad2ccdd7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxMDc4NSwiZXhwIjoxNzUzODE1NTg1fQ.Sa2tV-9RD5zuplG9tMPL6D413OtsnXxEqzbNTYqziu4	2025-07-29 18:59:45.613357+00	2025-07-22 18:59:45.613357+00
aa437edd-af1a-4b7e-8df1-47a30e765d77	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDcyLCJleHAiOjE3NTM4NjgyNzJ9.hdfAwOMESTmd_TvL4uHqi2n2ClQsmbANep3X3ZSn-1s	2025-07-30 09:37:52.365751+00	2025-07-23 09:37:52.365751+00
84d23f46-2b9f-4b27-8338-d01ec18e7f43	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxMjEyNiwiZXhwIjoxNzUzODE2OTI2fQ.MrBaSzWrmtHmPYl1SxiBdZLwbixucu5ytMdUUw5BXc0	2025-07-29 19:22:06.569393+00	2025-07-22 19:22:06.569393+00
78d2b872-651e-424a-8002-2d4303eab8d4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxMjE3MywiZXhwIjoxNzUzODE2OTczfQ.lfyS-6zwv5d2dExkh27N2BCAAvKc-M8vXj23QAUuvsg	2025-07-29 19:22:53.398539+00	2025-07-22 19:22:53.398539+00
aa6706a4-b879-4d60-90bf-5890bdf10d36	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDMwNSwiZXhwIjoxNzUzODE5MTA1fQ.buxsJCQRF8h9xCKJ7unQRvw8_pjC5z6Ou-ly7glnixk	2025-07-29 19:58:25.459204+00	2025-07-22 19:58:25.459204+00
bab5860a-ebe6-4dc7-a0b6-db264fd61d22	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDMyMywiZXhwIjoxNzUzODE5MTIzfQ.C7IH2wtjynt6WmZPFkzh9KuUx6UuXMZpZ3qhxI1Xeo0	2025-07-29 19:58:43.875331+00	2025-07-22 19:58:43.875331+00
79658801-fdfa-4702-802e-272d1a491c0f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDU0MSwiZXhwIjoxNzUzODE5MzQxfQ.jJEpQi-qfIKlorA6C7lSHIJ1TSa2mKlbU3AnmWYshbA	2025-07-29 20:02:21.224148+00	2025-07-22 20:02:21.224148+00
a159c8ad-bc3a-4dd7-889e-5c4b994381ce	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDU4NSwiZXhwIjoxNzUzODE5Mzg1fQ.6LeJERKtA_ijkogfMCGWy1QC287NeHRmDS2Pfdi-akU	2025-07-29 20:03:05.358448+00	2025-07-22 20:03:05.358448+00
ee2f5f4c-37ed-4ce9-adcc-d416be36c31c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDY2OSwiZXhwIjoxNzUzODE5NDY5fQ.vtZpeAgx0y2jmv2akqrK1Qdi0lEgIZStVc2JGAba4Ao	2025-07-29 20:04:29.523125+00	2025-07-22 20:04:29.523125+00
4621cf73-69d0-4b2d-9c81-f5cfe921bed2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDY4NCwiZXhwIjoxNzUzODE5NDg0fQ.Qes8xIa9yDa48YrB0O5QI8KPfLRLqAfiTjwtXbJD9X0	2025-07-29 20:04:44.159877+00	2025-07-22 20:04:44.159877+00
69167309-59cd-42bd-8f3c-edf16d218aeb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDY5OCwiZXhwIjoxNzUzODE5NDk4fQ.JXDvRUUGJgbLJ4ndt5_SVedXsNnfayyWFNEL-a8Ymx0	2025-07-29 20:04:58.430239+00	2025-07-22 20:04:58.430239+00
fb8fffb0-50f3-4df0-a252-de00df4c9efb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDc3NiwiZXhwIjoxNzUzODE5NTc2fQ.8MKfCqRKOIgCYPAyt4uy6VRhdl8otpvAVKvmeSE_Xi4	2025-07-29 20:06:16.009097+00	2025-07-22 20:06:16.009097+00
91f0852f-aa2d-4cc6-8f21-fe25f45f6615	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDc5NCwiZXhwIjoxNzUzODE5NTk0fQ.G2E6RwoZ8ybSiDUmp6T6qU1Mya31TSBrysR-W2VqMN0	2025-07-29 20:06:34.370662+00	2025-07-22 20:06:34.370662+00
23ac7813-4bb2-4808-b057-2138c7f8b095	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNDgxMCwiZXhwIjoxNzUzODE5NjEwfQ.ZmXz4NUVRGjlbDWQuZ_DdGBDFQQ0R66r9MCScdsAodA	2025-07-29 20:06:50.214007+00	2025-07-22 20:06:50.214007+00
c01b3394-76f7-4ad2-ab6b-9e650d12cb14	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNTQ4NCwiZXhwIjoxNzUzODIwMjg0fQ.ORmA7tfFyphxJCba1s36nG8w42J51nkjOfZqobIVOM0	2025-07-29 20:18:04.347599+00	2025-07-22 20:18:04.347599+00
3eb41ab5-03a8-4c3e-98bf-d74d9862822d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNTUyMywiZXhwIjoxNzUzODIwMzIzfQ._Mj-VyJjBTTGOI5QPIF40fZlHG2Nza7IFAx6SQcF7N0	2025-07-29 20:18:43.00123+00	2025-07-22 20:18:43.00123+00
df12c204-ad52-4868-8570-016601bf2461	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNTk4MSwiZXhwIjoxNzUzODIwNzgxfQ.Bez9nuja7Flg5y_43Q9JqeG_PGBcezdD_8n6X6Hk-mA	2025-07-29 20:26:21.916542+00	2025-07-22 20:26:21.916542+00
380ec630-d99d-4a29-a7ff-a438bac7e73c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU5ZDJmODMzLWExMTgtNGE0My1hMWQxLTczYTdmNTExOWRkZiIsImVtYWlsIjoid2ludXQuaGZAZ21haWwuY29tIiwicm9sZSI6InN1cGVyX2FkbWluIiwiaWF0IjoxNzUzMjYzNDczLCJleHAiOjE3NTM4NjgyNzN9.4G-L8djLbCel74oOx_gxxm_cRWeRxctcIv1H9tOPg_I	2025-07-30 09:37:53.450105+00	2025-07-23 09:37:53.450105+00
5ae72343-857a-414e-82c4-0195b5328f77	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIxNjQyNiwiZXhwIjoxNzUzODIxMjI2fQ.wNqnqjbuyj8JX8cj3ONgp0uazY-ngG9RSjXCz6EsBqA	2025-07-29 20:33:46.44557+00	2025-07-22 20:33:46.44557+00
08f325cd-5ede-4304-be3d-a6a456b5ef4c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIyMTkyMiwiZXhwIjoxNzUzODI2NzIyfQ.hIpeuImwv9hwyfJrR7ou66P9ZJveAI-WjsrQPrUrPfw	2025-07-29 22:05:22.764423+00	2025-07-22 22:05:22.764423+00
30a7161c-dfd5-4ac0-b047-126a8f133a16	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIyMjk4NywiZXhwIjoxNzUzODI3Nzg3fQ.1RYFpHFkXneb6wg7hf8zovy_8DH6uc0ZQJDZ8gZH0PY	2025-07-29 22:23:07.202217+00	2025-07-22 22:23:07.202217+00
5f5c53a5-6946-40bb-90fa-ac76c77b6927	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIyMzIwMywiZXhwIjoxNzUzODI4MDAzfQ.YvIdalyuTPk8ENcslLaipre3PIRx4vc9QfSVhPW1fGo	2025-07-29 22:26:43.982135+00	2025-07-22 22:26:43.982135+00
8d76d04f-8579-4e41-a52e-5d79043e9b07	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIyMzYzMywiZXhwIjoxNzUzODI4NDMzfQ.cwposhNLT3oA2z0K6UKe_gNq_e-x5i993pIToznLMqU	2025-07-29 22:33:53.78257+00	2025-07-22 22:33:53.78257+00
b01b46aa-876a-4c96-aef1-8a13ad0961c0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIyMzk2MCwiZXhwIjoxNzUzODI4NzYwfQ.-8nS5l1MDDdqTwarWDhS1DWSqNWr_nRqe-nwCX1YsM4	2025-07-29 22:39:20.038495+00	2025-07-22 22:39:20.038495+00
76ad3a88-c89f-43d4-b747-1a95545062da	59d2f833-a118-4a43-a1d1-73a7f5119ddf	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OWQyZjgzMy1hMTE4LTRhNDMtYTFkMS03M2E3ZjUxMTlkZGYiLCJlbWFpbCI6IndpbnV0LmhmQGdtYWlsLmNvbSIsInJvbGUiOiJzdXBlcl9hZG1pbiIsImlhdCI6MTc1MzIyNDI5MywiZXhwIjoxNzUzODI5MDkzfQ.FM6zr2Q4EiVIVW2DDaBjDfffv8Kkb8L398FKdfyxYWE	2025-07-29 22:44:53.613202+00	2025-07-22 22:44:53.613202+00
\.


--
-- Data for Name: survey_coupon_assignments; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_coupon_assignments (id, survey_id, coupon_id, is_active, max_awards, awarded_count, assigned_by, assigned_reason, custom_expiry_days, created_at, updated_at) FROM stdin;
7cd98ab3-98a2-4987-bf15-8472ad93ea0d	2ef6d5f2-39a1-4dcf-861c-7ae671a1491e	c5f43d2c-fbd6-43ea-8e17-9572218c3508	t	\N	0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Survey completion reward	\N	2025-07-23 16:37:14.613612+00	2025-07-23 16:37:14.613612+00
4fe9ead3-a74c-4425-945c-fbcf72095552	60da319c-b7e5-4451-a37e-0f82fc78109c	6f13628f-afcc-4dcd-bf32-bb6bc390cb23	t	\N	0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Survey completion reward	\N	2025-07-24 02:42:09.568964+00	2025-07-24 02:42:09.568964+00
\.


--
-- Data for Name: survey_invitations; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_invitations (id, survey_id, user_id, status, sent_at, viewed_at, expires_at, created_at, updated_at) FROM stdin;
a8fa8ee9-18f7-496b-938d-7decf938e05a	35b6cf9c-b935-45be-9d29-92f1d14045d6	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	sent	\N	\N	\N	2025-07-22 22:39:26.514947	2025-07-22 22:39:26.514947
f2186771-5511-4e95-89c3-51a224000878	279b0dd1-26cc-4054-a792-1948d6769204	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	sent	\N	\N	\N	2025-07-22 22:45:31.405542	2025-07-22 22:45:31.405542
\.


--
-- Data for Name: survey_responses; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_responses (id, survey_id, user_id, answers, is_completed, progress, started_at, completed_at, created_at, updated_at) FROM stdin;
8146c2f5-01c1-4f1b-9c5a-c9267243c5a3	279b0dd1-26cc-4054-a792-1948d6769204	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	{"q1": "2"}	t	100	2025-07-22 23:55:58.53284	2025-07-22 23:56:57.969	2025-07-22 23:55:58.53284	2025-07-22 23:56:57.969444
a9ff45fa-eaa1-439a-8eb6-b7906d82e03b	35b6cf9c-b935-45be-9d29-92f1d14045d6	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	{"q_o62xuqk5o": "option1"}	t	100	2025-07-23 00:37:49.628616	2025-07-23 00:37:49.628	2025-07-23 00:37:49.628616	2025-07-23 00:37:49.628616
ceeae62a-7e39-4e88-ba7e-1306c7a7ef68	5eb4165b-7e38-439c-9936-db47b454a7e5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	{"q_rating": 5, "q_recommend": "no"}	t	100	2025-07-23 03:21:31.412827	2025-07-23 03:21:34.024	2025-07-23 03:21:31.412827	2025-07-23 03:21:34.02524
9d03ce9e-7a54-4cce-a577-3d0cd2bc122c	cf11979b-62e1-40d9-8738-0457a17bb3fb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	{"q_rotkesu1h": "option1"}	t	100	2025-07-23 11:44:02.748025	2025-07-23 11:44:02.747	2025-07-23 11:44:02.748025	2025-07-23 11:44:02.748025
17ea9460-ede3-4b2c-af0f-8d360158237e	c5824262-bcba-489e-ab48-5c720ff3dbb4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	{"q_service_rating": 8}	t	100	2025-07-23 11:44:07.854191	2025-07-23 11:44:07.854	2025-07-23 11:44:07.854191	2025-07-23 11:44:07.854191
8ed90e53-8f34-4016-adc9-9f6b1d298974	c5824262-bcba-489e-ab48-5c720ff3dbb4	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	{"q_service_rating": 6}	t	100	2025-07-23 12:06:48.863205	2025-07-23 12:06:48.863	2025-07-23 12:06:48.863205	2025-07-23 12:06:48.863205
4424ffe4-9c84-4f29-a917-15e9182953ea	2ef6d5f2-39a1-4dcf-861c-7ae671a1491e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	{"q1": "5"}	t	100	2025-07-24 22:30:59.178729	2025-07-24 22:30:59.178	2025-07-24 22:30:59.178729	2025-07-24 22:30:59.178729
\.


--
-- Data for Name: survey_reward_history; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_reward_history (id, survey_coupon_assignment_id, survey_response_id, user_coupon_id, user_id, awarded_at, award_condition_met, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: surveys; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.surveys (id, title, description, questions, target_segment, status, scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type) FROM stdin;
49d50c45-b235-4e77-a952-4b53edce213a	ทดสอบ		[{"id": "q_mkavo7y2x", "text": "คำถามทดสอบ", "type": "single_choice", "order": 1, "options": [{"id": "opt_u0wrdz69p", "text": "Option 1", "value": "option1"}, {"id": "opt_saf3lltfa", "text": "Option 2", "value": "option2"}], "required": true}]	{}	active	\N	\N	\N	2025-07-22 22:19:06.337292	2025-07-22 22:19:20.131208	public
b5cbde95-7faf-4268-b3e3-7047a1e4e17b	Public Test Survey	This is a public survey for testing the surveys page	[{"id": "q_1", "text": "How satisfied are you with our service?", "type": "single_choice", "order": 1, "options": [{"id": "opt_1", "text": "Very Satisfied", "value": 5}, {"id": "opt_2", "text": "Satisfied", "value": 4}, {"id": "opt_3", "text": "Neutral", "value": 3}, {"id": "opt_4", "text": "Dissatisfied", "value": 2}, {"id": "opt_5", "text": "Very Dissatisfied", "value": 1}], "required": true}, {"id": "q_2", "text": "Please provide any additional feedback", "type": "text", "order": 2, "required": false}]	{}	active	\N	\N	\N	2025-07-22 22:26:31.115699	2025-07-22 22:26:31.115699	public
5eb4165b-7e38-439c-9936-db47b454a7e5	Customer Satisfaction Survey	Tell us about your experience with our hotel services	[{"id": "q_rating", "text": "How would you rate your overall experience?", "type": "rating_5", "order": 1, "required": true}, {"id": "q_recommend", "text": "Would you recommend us to others?", "type": "yes_no", "order": 2, "required": true}]	{}	active	\N	\N	\N	2025-07-22 22:26:31.1167	2025-07-22 22:26:31.1167	public
c5824262-bcba-489e-ab48-5c720ff3dbb4	Service Quality Assessment	Help us improve our service quality	[{"id": "q_service_rating", "text": "Rate the quality of our customer service (1-10)", "type": "rating_10", "order": 1, "required": true}]	{}	active	\N	\N	\N	2025-07-22 22:26:31.117371	2025-07-22 22:26:31.117371	public
279b0dd1-26cc-4054-a792-1948d6769204	Test Active Survey Creation	Testing that status is properly set	[{"id": "q1", "text": "Test question", "type": "single_choice", "order": 1, "options": [{"id": "opt1", "text": "Option 1", "value": "1"}, {"id": "opt2", "text": "Option 2", "value": "2"}], "required": true}]	{}	active	\N	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-22 22:45:07.275871	2025-07-22 22:45:07.275871	invite_only
35b6cf9c-b935-45be-9d29-92f1d14045d6	ทดสอบ invite survey		[{"id": "q_o62xuqk5o", "text": "test", "type": "single_choice", "order": 1, "options": [{"id": "opt_4mwqsgf7c", "text": "Option 1", "value": "option1"}, {"id": "opt_owq8f38lt", "text": "Option 2", "value": "option2"}], "required": true}]	{}	active	\N	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-22 22:37:42.634633	2025-07-22 23:08:52.392853	invite_only
cf11979b-62e1-40d9-8738-0457a17bb3fb	ยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมาก	ยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมาก	[{"id": "q_rotkesu1h", "text": "ยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมากยาวมาก", "type": "single_choice", "order": 1, "options": [{"id": "opt_hl2wiwf1s", "text": "Option 1", "value": "option1"}, {"id": "opt_qwk2z207u", "text": "Option 2", "value": "option2"}], "required": true}]	{}	active	\N	\N	59d2f833-a118-4a43-a1d1-73a7f5119ddf	2025-07-23 07:55:25.600765	2025-07-23 07:55:50.797947	public
e80a9db0-edff-47a2-9eac-57aeb973055a	Translation Test Survey	Testing coupon assignment translations	[{"id": "q1", "text": "How do you rate our service?", "type": "single_choice", "order": 1, "options": [{"id": "opt1", "text": "Excellent", "value": "5"}, {"id": "opt2", "text": "Good", "value": "4"}], "required": true}]	{}	active	\N	\N	\N	2025-07-23 16:01:07.744077	2025-07-23 16:01:07.744077	public
b85b76a7-b420-4068-900b-d166f9dc2cea	Translation Test Survey	Testing coupon assignment translations	[{"id": "q1", "text": "How do you rate our service?", "type": "single_choice", "order": 1, "options": [{"id": "opt1", "text": "Excellent", "value": "5"}, {"id": "opt2", "text": "Good", "value": "4"}], "required": true}]	{}	active	\N	\N	\N	2025-07-23 16:01:34.075415	2025-07-23 16:01:34.075415	public
dab7788a-eb97-4e76-a0ae-6a1fb1f22fae	Translation Test Survey	Testing coupon assignment translations	[{"id": "q1", "text": "How do you rate our service?", "type": "single_choice", "order": 1, "options": [{"id": "opt1", "text": "Excellent", "value": "5"}, {"id": "opt2", "text": "Good", "value": "4"}], "required": true}]	{}	active	\N	\N	\N	2025-07-23 16:01:42.069564	2025-07-23 16:01:42.069564	public
60da319c-b7e5-4451-a37e-0f82fc78109c	Translation Test Survey	Testing coupon assignment translations	[{"id": "q1", "text": "How do you rate our service?", "type": "single_choice", "order": 1, "options": [{"id": "opt1", "text": "Excellent", "value": "5"}, {"id": "opt2", "text": "Good", "value": "4"}], "required": true}]	{}	active	\N	\N	\N	2025-07-23 16:01:51.015879	2025-07-23 16:01:51.015879	public
2ef6d5f2-39a1-4dcf-861c-7ae671a1491e	Translation Test Survey	Testing coupon assignment translations	[{"id": "q1", "text": "How do you rate our service?", "type": "single_choice", "order": 1, "options": [{"id": "opt1", "text": "Excellent", "value": "5"}, {"id": "opt2", "text": "Good", "value": "4"}], "required": true}]	{}	active	\N	\N	\N	2025-07-23 16:02:00.030373	2025-07-23 16:02:00.030373	public
\.


--
-- Data for Name: tiers; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.tiers (id, name, min_points, benefits, color, sort_order, is_active, created_at, updated_at) FROM stdin;
8a6a84a2-6b99-48cf-9c7d-fe6bc78ff7b1	New Member	0	{"perks": ["Member exclusive rates", "Free WiFi", "Welcome amenity"], "description": "Welcome to our loyalty program"}	#808080	1	t	2025-07-24 08:45:22.51383+00	2025-07-24 08:45:22.51383+00
07b290a7-4ef7-457f-b36f-941ea21ac88e	Silver	1	{"perks": ["All New Member benefits", "Room upgrade (subject to availability)", "Late checkout until 2 PM", "10% discount on dining", "Priority check-in"], "description": "Thank you for staying with us"}	#C0C0C0	2	t	2025-07-24 08:45:22.51383+00	2025-07-24 08:45:22.51383+00
496f4f39-5d13-463d-bbb8-85f91182dbd5	Gold	10	{"perks": ["All Silver benefits", "Guaranteed room upgrade", "Late checkout until 4 PM", "20% discount on dining", "Complimentary breakfast", "Executive lounge access", "Free laundry service (3 pieces per stay)"], "description": "Our valued frequent guest"}	#FFD700	3	t	2025-07-24 08:45:22.51383+00	2025-07-24 08:45:22.51383+00
\.


--
-- Data for Name: user_audit_log; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_audit_log (id, user_id, action, details, ip_address, user_agent, created_at) FROM stdin;
6a431b92-df0d-4b35-9399-2fc90380db23	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 23:11:04.47754+00
a7e57536-25da-452f-9a59-91eeed3be1ab	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:11:10.434411+00
916c978e-cf21-431a-a419-fe46e9fb8358	59d2f833-a118-4a43-a1d1-73a7f5119ddf	register	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-19 16:50:07.473601+00
63878554-e324-435f-8fe8-9365dc6e6f66	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-23 00:37:53.336996+00
e823e181-841f-4010-94ac-1af39e0ed898	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-19 16:55:44.304646+00
2cfdbd72-730f-4a48-a743-3ba600d2340b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 16:56:20.243089+00
7e7e47f7-3e35-486f-af5d-8d69404cba40	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-19 16:56:23.250283+00
5b439c59-1ff0-4dc4-a1c3-6d4c83209b50	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 16:57:36.963111+00
006e7d99-1e9b-4d79-bbc5-23d40a1a17ad	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 00:37:57.548946+00
ea7c4235-ff14-45cc-8ca8-94373d3c7333	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:37:42.26565+00
22082295-2e23-4986-8beb-8b3370b5f62a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:37:52.367372+00
70e988fd-2c36-4ced-a04c-f6c51de3d50d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 10:12:29.633689+00
7a99028f-7116-4ca7-ab63-c7665321ed45	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 11:49:16.192715+00
f613e669-88b1-4fe8-9968-dc6a3d744a81	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": true}	\N	\N	2025-07-23 11:49:21.374469+00
eff46424-e488-46a6-bd38-35e6da3be9cb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	role_upgrade	{"reason": "admin_config_match", "newRole": "admin", "oldRole": "customer"}	\N	\N	2025-07-19 17:03:35.903651+00
bead48e3-7839-4734-a4c9-c992b2df81bf	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-19 17:03:35.908175+00
512077e8-33e6-43d6-9394-cbe49569370e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 17:14:51.8963+00
97e9e45b-dca3-407a-8ce8-f7448833d831	59d2f833-a118-4a43-a1d1-73a7f5119ddf	role_upgrade	{"reason": "admin_config_precedence", "newRole": "super_admin", "oldRole": "admin"}	\N	\N	2025-07-19 17:14:56.491126+00
6613dc79-0c3a-44ca-84a6-23daf58c2fe8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-19 17:14:56.493656+00
98e4f053-81d1-42b9-87c7-cad723c9d136	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 17:15:08.608743+00
f21273e9-86e5-44b4-a2c6-7ac07d13dfea	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": true}	\N	\N	2025-07-19 18:04:59.220967+00
86b17c2a-7527-4532-b32d-6616950f732d	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 18:09:53.197756+00
7bde1288-fbfa-4a6a-a9bb-aa13bb3b9de9	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-19 18:10:04.994879+00
f50ab774-8444-4e6b-84de-a16f6b3c02d1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 18:10:12.421222+00
046c840b-e59d-43e9-abf7-2748f5e78524	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 18:10:19.592631+00
e918d681-e0dd-4324-a9d6-c35e8053dac3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 18:10:24.372354+00
c9d8b450-f264-4eef-9c4d-bfe57217671a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 18:10:28.902417+00
d8d86e0d-9315-4e6b-8820-8df09c3e13c0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 19:35:55.325761+00
3bf5ede7-4417-4208-a646-58edc7d1c33b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 19:36:16.16695+00
ec5a415c-43a6-4521-b1a9-49d95970a339	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 19:36:20.187497+00
41adb650-417d-44ac-9979-22572d983c78	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-19 19:36:46.684531+00
af8dd978-af39-4545-9463-f5b045d49624	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 19:36:51.14093+00
a4672125-11f1-47da-b8f6-e00ea9cc7986	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 19:36:57.668473+00
3d71fa6c-33c6-497e-bc0a-0ec679eebdf0	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 19:37:20.849392+00
a61692c7-37ea-463e-a6cd-1eb7d0a283cc	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-19 19:37:26.753595+00
fbf33d4f-d10b-4927-b63a-151c4c68b0e1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-19 19:37:30.037743+00
938b3338-eefc-4c4c-8f6f-aa8394ae5de5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-19 19:56:33.396165+00
ec483b2c-62ce-470b-9c44-36268399f890	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-19 19:56:38.892787+00
97025eb0-b846-4b56-bb3e-026e06d3a605	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 15:00:59.4569+00
1e2776a3-72e4-4a2d-9489-c233b0c6f387	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 15:01:04.195124+00
2234b6b0-3f5c-4e07-a158-233fd96db62a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 15:01:19.516923+00
d57be2d6-f4e1-4e74-8527-8dac032cd32d	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 15:01:23.993587+00
af8e76bd-bda1-45b2-a435-43b6ca9e2b9f	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-20 15:01:29.731533+00
5f5beb05-5d78-4137-96d7-bcd607cbd8dd	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 15:33:25.865357+00
a6dfdd7f-c1cf-466c-9956-73ba41110e35	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 15:49:31.391282+00
8d15ca9f-4e30-449a-b526-300621dfad55	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 15:49:37.094793+00
7ea4613b-94b0-40be-859a-a459e1b346ee	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 16:13:36.885581+00
9ad4fea7-7a9b-4617-a233-99d2af6d306f	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 16:13:44.620322+00
f423c169-453c-49d4-a175-3eb11eacd147	\N	logout	{}	\N	\N	2025-07-19 18:46:00.024073+00
e9edf953-3f4a-42d4-9280-9f4a86bd5b22	\N	register	{"email": "support@hotel.com"}	\N	\N	2025-07-19 17:11:48.537824+00
8a6e2005-0c2a-4ff4-b198-495ef332ec79	\N	role_upgrade	{"reason": "admin_config_match", "newRole": "admin", "oldRole": "customer"}	\N	\N	2025-07-19 17:11:55.075396+00
dcc869b4-2b42-46ea-9821-69e49d068fa7	\N	login	{"email": "support@hotel.com"}	\N	\N	2025-07-19 17:11:55.077218+00
1e9ea874-3568-4794-98e8-40c1076970e4	\N	register	{"email": "test.superadmin@hotel.com"}	\N	\N	2025-07-19 17:10:56.212835+00
3f8aa26a-5904-4cff-94ef-52e078749604	\N	role_upgrade	{"reason": "admin_config_match", "newRole": "super_admin", "oldRole": "customer"}	\N	\N	2025-07-19 17:11:15.341887+00
9914fba8-9688-4953-a714-c6ddb93bbb47	\N	login	{"email": "test.superadmin@hotel.com"}	\N	\N	2025-07-19 17:11:15.345819+00
b25fe319-517e-4fc5-a553-259bbe29cd00	\N	register	{"email": "customer@hotel.com"}	\N	\N	2025-07-19 17:02:15.864163+00
110ce485-3e81-4440-91bb-5a6e8e3a19ef	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-19 17:02:21.710593+00
71ac5a7f-3010-46e6-a2a2-9b9a0281d797	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-19 17:06:06.586739+00
08f682a5-9eba-4f6e-82f4-a5f42a8bf485	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-19 17:11:59.98034+00
35885df8-051d-414e-86e2-4d0c5027822a	\N	register	{"email": "manager@hotel.com"}	\N	\N	2025-07-19 17:01:55.281193+00
b31ea521-cc1e-4f5a-9d85-afd2666aa4e0	\N	role_upgrade	{"reason": "admin_config_match", "newRole": "admin", "oldRole": "customer"}	\N	\N	2025-07-19 17:02:02.022309+00
c9b3cb74-1695-4656-a084-0e578ac8c42f	\N	login	{"email": "manager@hotel.com"}	\N	\N	2025-07-19 17:02:02.023974+00
ce86b63e-392b-476a-aff4-0a859daf6303	\N	login	{"email": "manager@hotel.com"}	\N	\N	2025-07-19 17:06:02.083744+00
8a844ef2-9b3b-44de-996f-da66eeca81f1	\N	role_upgrade	{"reason": "admin_config_precedence", "newRole": "super_admin", "oldRole": "admin"}	\N	\N	2025-07-19 17:11:34.062631+00
c0333411-2fe3-4b9a-9582-dc3ceafb2c35	\N	login	{"email": "manager@hotel.com"}	\N	\N	2025-07-19 17:11:34.066395+00
b1d282cf-183c-45d3-beef-cbb8dd3bb96b	\N	register	{"email": "admin@hotel.com"}	\N	\N	2025-07-19 16:48:36.582391+00
9f932ebf-48be-4521-88cf-50e3cd318abf	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-19 16:48:56.094931+00
5d3cd94a-4484-4157-8546-ccf90f2c2197	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-19 16:54:05.225574+00
b3f2c8ed-b339-4944-a3f2-4454ba8a7254	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-19 16:58:08.718858+00
99df0cf0-4796-4321-8e90-7b7c61427506	\N	logout	{}	\N	\N	2025-07-19 16:58:21.412548+00
d6739051-7288-47e0-ae1d-1a9399321ab5	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-19 17:02:27.121686+00
735f85f9-a57a-4d34-9d60-b4a2314df5ec	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-19 17:05:57.365476+00
2d8c1976-c685-47b9-817b-9c618e2eee09	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 16:14:45.340662+00
0f50323d-8b05-4b94-9951-efba0b0fcd71	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-22 23:14:31.189944+00
347c5919-3815-4013-bb5a-3709c1f014c7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 16:14:55.944096+00
f07048b2-ebfe-45ba-ad81-3126bbf67a19	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 16:15:14.092892+00
bf498218-bc95-4042-b22b-cb60cada62d2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 16:19:54.587888+00
6fc40b57-29c3-4298-b11f-c04ebf1ef13b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 16:19:56.90709+00
d5ac0672-757b-46a6-936f-76a734882ac7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 16:20:09.825009+00
5eea1e8c-fe2a-448a-b434-323cd0a4dbca	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:14:38.497106+00
02e766a2-5339-4f31-bb55-56dde8ccbdc9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 03:21:06.045043+00
d02bdb94-041f-4a13-9190-8b691db73516	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 09:20:43.899508+00
3f5d31a3-1c1a-441c-bd08-48186ac332eb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:20:49.627824+00
b4c910c0-2eb5-4d99-b679-182c8503965e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 16:31:07.43592+00
94063b93-01d4-4511-bc4e-4244e1e71569	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 16:57:34.49302+00
c47c9a32-3cf2-450c-bee4-5676dbee5184	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-20 17:12:08.734002+00
78e1a993-4fb3-42e7-81b0-d7d7b6e17b58	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 17:18:04.705305+00
7838f2a3-e8f5-4489-884c-d99760565267	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-20 17:20:42.472796+00
672a2e77-3031-4d53-a442-a27a030b8fa2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 17:20:46.703036+00
1c5e50c5-f242-4dd4-b57c-93b4902ea8e0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 17:21:00.14269+00
261ae5f7-dd18-4869-b6c0-395273cd59d7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:26:09.701307+00
d2c1937f-5c7e-4a5c-bc14-73212bca15ea	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:37:53.454145+00
1b089a2f-a834-4df7-bfe3-38fbdb0e375e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 17:21:58.776938+00
c672191b-a993-4e8d-9985-ddf1d078ff51	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 10:42:27.102823+00
c16ed53f-cbef-4820-9e66-3f6e3e79b13f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 10:42:39.676446+00
70609067-e6ce-428a-a547-b66f190dd12d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 10:42:44.200549+00
faafb172-937b-40e0-9c1a-8065c03c63a1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 12:40:16.99606+00
bfd1cbee-d4d2-4657-9afd-93df20731994	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-20 18:23:25.44395+00
cf45cf32-95f3-4cdc-abcd-af4e9bc0dc23	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 18:23:37.581802+00
1044bff5-5996-45c4-93c5-b92e677c8f23	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 02:51:27.344913+00
451fcbb0-ae63-42bc-b089-aba9dd1400b4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 02:51:31.878265+00
504ab3c5-d5a5-40f7-a077-0c83f0ec9089	\N	register	{"email": "blocktest5@example.com"}	\N	\N	2025-07-24 05:05:10.195228+00
0e2e370e-5da2-4894-997d-9220605a56b8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 19:11:01.536715+00
20b19bdf-9229-490b-b4fa-ff0be95bdf3a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 19:11:51.306562+00
5bc1f82c-5a00-491a-845b-1884e734856c	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 19:11:56.594164+00
37bae9b5-4c75-42ff-90ad-6eced138b25f	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-20 19:12:21.287351+00
b1055a2b-006c-40a8-a9de-6867c5f0549f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 19:12:25.265196+00
054fcca7-8309-4a59-a496-ac9b42ed86bb	\N	register	{"email": "blocktest4@example.com"}	\N	\N	2025-07-24 05:05:10.017284+00
fbbeada1-2ce9-4caa-a138-2dd0d263d53e	\N	register	{"email": "blocktest3@example.com"}	\N	\N	2025-07-24 05:05:09.839579+00
0cf77e0c-51de-4083-9429-a8df02e35a70	\N	register	{"email": "blocktest2@example.com"}	\N	\N	2025-07-24 05:05:09.662351+00
559e815e-9d78-4c01-b457-580397a0059a	\N	register	{"email": "blocktest1@example.com"}	\N	\N	2025-07-24 05:05:09.445027+00
2c97241c-df7f-43ae-9079-7f2af46164ce	\N	register	{"email": "user002@example.com"}	\N	\N	2025-07-24 05:04:21.161688+00
2cfbfeab-1b21-48bc-941c-8bc7b950a11e	\N	register	{"email": "user001@example.com"}	\N	\N	2025-07-24 05:04:13.427244+00
ccc6bc1f-3f8d-429f-883c-081904ebd788	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:00:48.168853+00
7b6426cb-0e32-44d4-98f0-aafd7b3709da	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:00:57.863563+00
4bd57a86-9c12-4e11-b519-c0b9a4cd0f93	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:01:07.725938+00
48f12983-975c-4482-a268-e2d8296d8e83	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 19:30:18.878455+00
a1b8a1ca-f85a-45f2-adc1-cf2d7b7799c2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-20 19:30:50.867149+00
80e5767d-67c9-470b-b78e-602411befcec	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 19:30:58.453235+00
d674bb36-712a-4a74-b31c-562119eccf34	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-20 19:31:14.907141+00
42e9fa98-7cdd-4c12-a0b6-ed2f7eff8dac	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-20 19:31:20.106037+00
5bd9dc29-8955-4225-b924-48da8edcedb7	\N	register	{"email": "test.autoenroll@example.com"}	\N	\N	2025-07-20 17:35:50.540763+00
9661414b-0992-4ce9-9d64-873190c2ba8a	\N	login	{"email": "test.autoenroll@example.com"}	\N	\N	2025-07-20 17:36:09.881379+00
b7f6bc5e-d0ea-4ccc-ada9-dad5b1cbff80	\N	register	{"email": "test.1753028830633@example.com"}	\N	\N	2025-07-20 16:27:15.7953+00
8d8193a1-cce5-4398-8aac-f615caaeaedf	\N	register	{"email": "test.1753028723962@example.com"}	\N	\N	2025-07-20 16:25:29.177922+00
697b398f-bb80-488f-abe1-6c50d52120a1	\N	register	{"email": "test.1753028620924@example.com"}	\N	\N	2025-07-20 16:23:46.029427+00
6291fc7c-55eb-44d3-b0ed-07d0453d4af1	\N	register	{"email": "test.user@example.com"}	\N	\N	2025-07-20 16:21:26.278471+00
85234110-16ad-437e-8beb-29bfd7dbd6cf	\N	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-20 17:21:04.655438+00
f57db9a1-cde5-4ffa-9914-128ed8371c01	\N	logout	{}	\N	\N	2025-07-20 17:21:56.007246+00
f8f8496c-8d8a-4aa5-a7a2-38da3edea2bf	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 16:14:47.563358+00
54b7249e-52db-4cc9-8b3e-330d5ca1ca62	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 18:17:00.748366+00
7c57e87b-d994-4ec0-bda6-1eee93a47e1c	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 18:17:32.986343+00
b471d533-9808-4317-8177-e11f4416ba06	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 18:18:04.316602+00
c7cf1a20-d346-4562-8fbc-635406e3a633	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:03:41.834538+00
f3aca732-f241-491b-8218-d0337ff7774e	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:04:13.97646+00
5a1813e2-87d5-4a97-8ed3-d2e120c28306	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:05:02.145013+00
c4dedc9b-2dfb-47c4-8d0c-a03f4605fae2	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:05:51.169018+00
7e9a6d08-8196-4bd0-bd49-1bf29b6a8935	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:06:42.92721+00
5eeced7a-2568-45b2-a39d-d492b38b3bb4	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:08:15.909794+00
111a91a6-b225-43e3-8585-d0b6d49bcc50	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:36:25.712605+00
7cc7c640-680c-4ed7-9c97-dbf35592db23	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 07:54:36.482282+00
246a9538-3ab6-45c1-a5b7-48f93abd3ed6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:26:15.89385+00
888b9410-3a98-455f-a810-ba06312c64c5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 09:26:34.832158+00
be7ec3c3-b5a2-438c-9d71-be44977660da	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:26:39.141616+00
56d1cb77-19ae-4eca-a83d-ae8cb9b332b7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:38:08.599414+00
9c52a1b9-1930-4265-b525-a7cc7aee82c2	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:20:16.776131+00
f48bc285-da6f-4a65-b071-3935b8dd9924	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-23 11:20:29.006277+00
9c00a853-3bbc-4bd0-a64b-aba3376a3445	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:20:33.472566+00
03f65340-a685-4c59-87d2-10812d3c1841	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-23 11:20:50.084534+00
1724b51f-5104-4726-81ef-f26015050724	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:20:54.048034+00
7152c774-210c-4ebf-b413-8b81aa0d95f1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 11:21:06.076742+00
df47abaa-7e5d-4ba7-aea9-304166266682	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:21:10.454394+00
80b76581-5709-49e5-afc6-13376e368443	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 14:28:11.110704+00
ca191c17-b4b7-434f-b599-b639f946d340	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 16:05:27.853901+00
579d1792-518c-43f5-9935-78e410afca38	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 16:35:48.586861+00
630b483e-6c9c-41dd-8c1f-004052dd8996	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 16:35:59.43738+00
3d4cf8d7-f715-46bc-885f-a38680a262ac	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 16:48:51.654151+00
cf5ba3fc-fc65-4d92-9e4f-da5352afe56a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 16:49:02.458115+00
118bf01f-caea-4ac9-bd56-6c374523ad37	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 05:06:06.282104+00
89715802-b971-4d21-86e5-14357d01c5c9	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 02:44:16.529631+00
91e7b6e4-3b71-4742-bbbc-3675588f8b6a	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-21 02:44:31.260122+00
312fd0cf-2af4-4870-b45c-548309f16d5f	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-21 02:44:31.28795+00
5abec84c-e383-4627-b6da-f4fcbf781719	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 02:44:40.417411+00
cd92e6b4-e030-4348-a276-ede84a3713d6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 02:44:42.012385+00
6f4f79b2-84e5-4d3d-8419-d86cf98d7605	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 02:44:48.094617+00
cf2f2cfe-cde1-4cbe-b158-d65a01724bba	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-21 02:45:28.222488+00
8c80810d-800a-4618-bd38-0c97e7e9eb1c	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 02:45:33.017124+00
e4303d4a-9a1a-4a39-9c65-16dd329f687e	\N	register	{"email": "testuser2@example.com"}	\N	\N	2025-07-24 03:04:42.16582+00
e6b0c036-5acb-455e-aa5d-880b047d0d6d	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 03:02:10.915363+00
1bc2ba3c-d0f1-48b9-be62-db0484608044	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-21 03:02:16.909515+00
f02f2251-ddd6-4aef-9bbd-13a7c61c0339	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 03:02:20.989012+00
92b24598-9c10-430a-8e7e-587d72b61489	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 03:05:28.473477+00
6d5e3301-7a9d-453c-8a89-7ff60fee4721	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 03:05:31.114626+00
8887ff69-5946-4280-96c9-26e490f7489c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 03:05:46.070503+00
6cc6ff8f-e62d-4c36-b4d1-117bea546bca	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 03:05:58.626097+00
94069df6-a5c4-4933-9acd-7515fc48fb33	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-21 03:11:42.380589+00
982cd175-e3ea-45a3-9cab-9934b6d24d9e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 03:11:44.733078+00
b939af45-bb75-4083-9e64-aa8602924eef	\N	register	{"email": "testuser@example.com"}	\N	\N	2025-07-24 03:04:28.885533+00
fd3710ff-af8d-4845-ae15-33fab5d12000	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 05:50:52.782452+00
eb049c1b-6cef-4c6c-9748-f8d5670d72b9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 07:21:55.438439+00
aae5ac44-4fb7-443b-ad6b-3cd05826e507	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 07:22:00.626469+00
68fd0845-5d84-4ab5-ad9a-2f21db9adf99	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 03:31:34.463898+00
d023490b-26d0-4a93-a67c-0b480f33b904	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-21 03:31:41.314279+00
75d41ead-cf3a-4dc9-a4ea-4745bda34e1a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 03:31:44.390026+00
0e0d84b6-609a-4ad5-ba23-886bd8d3f8e4	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-24 07:36:10.986256+00
e09a366b-be36-4e5c-887d-a16635045c51	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 03:38:10.327823+00
32fe4354-515f-4c0b-bf8d-e7df5e99134a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 03:38:12.860478+00
857e71a3-5bdc-4ef6-95c8-005056d7a937	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-24 07:36:20.863077+00
d4726d79-8ca9-45bb-9ac1-ede16fe0e778	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-24 09:18:42.976115+00
f4e7b304-727b-429b-9cbf-b47f2b045546	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:18:47.403928+00
ce0559fe-c4d5-4cf8-a6e1-a67626e622e1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 04:32:07.178172+00
153bf464-6946-4043-9bf7-82bbf19be75a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 05:34:50.711885+00
652cb1c6-1d35-4263-927b-291cd509ff38	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:49:51.327347+00
911cd375-e416-4c47-ad58-24097391abb7	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:51:37.276818+00
54d0225a-b418-4982-9281-6252843a0ed1	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:52:10.058244+00
4251e223-06e9-45eb-b444-0d408b2a878c	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:53:25.449466+00
157088a6-d20a-42ee-9ee2-f270b129304a	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:55:33.990883+00
bfac4e8b-5a21-4570-a28f-900db8dc4a26	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:55:59.705545+00
e6a7830e-eb2d-4d89-b30f-d9bf11183efe	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:57:22.255258+00
953f64e2-8364-4a5c-8202-9c5fe23cb55b	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 19:58:49.64928+00
a28e3b46-6dd0-49b0-ab9b-7d32dcfb3930	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 20:00:28.337892+00
945a0bb8-fc09-4848-b1b0-11887baf2963	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-20 21:31:20.585702+00
d4bdb2f2-87f0-4551-9557-37819299d778	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-21 02:57:38.020805+00
bc390296-9d7b-4225-92d7-f56f46856e78	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:49:16.633864+00
61cd6f4a-2012-4d09-aee9-1439a259804f	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:49:50.973629+00
91166414-633e-4598-9901-dc6b5731d749	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:51:27.001995+00
a1db5b87-2e8d-4c5a-a2ff-8dda540af202	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:51:37.204005+00
468abc69-25a7-4eab-bf3c-c1d3b17c1532	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:52:09.986471+00
71de6818-dbda-458b-ac6c-b3502bde18ea	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:53:25.377413+00
0cb42fe9-61a5-44d0-889d-cd3b03a26ca6	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:55:33.91383+00
1c38e87f-1670-4bb0-b0a1-540deaa4f9c7	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:55:59.771618+00
508e0605-df8d-40cd-be7e-bb51e8586394	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:57:37.297487+00
ae6f68fa-d5c6-41a8-90c0-ecb8d3b2640d	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:58:49.56786+00
da4c5ccf-0c6f-4cd0-826c-ffb19734d7e2	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 20:00:28.226923+00
70d7f17d-28c7-4cb1-ab3d-bc2f8e7f6461	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 21:31:20.501228+00
e840c916-472c-4072-b240-ec2fadaecbf2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:53:01.572914+00
abbd3a86-e0f1-4404-838f-2ee09b986e09	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:16:14.185465+00
a732f066-207c-4e56-9953-6e21d8f54f1b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 09:16:49.377672+00
945206bc-0d61-4fa8-8c96-6ecc152f0403	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:16:53.603025+00
75c3c0ec-8f1f-4d32-8fa9-1cdda81c0785	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 05:56:59.943834+00
370e4f63-940a-42c3-a88c-04ce5910fad8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:37:03.929905+00
2cb712d2-22ff-450e-9fff-f14189b64a5e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:38:09.644184+00
b1e5e12b-6b82-4033-9c35-51d1a47867ee	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 11:30:32.629519+00
30500153-7d22-4f5e-bc43-fedaa7da1e24	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:31:38.995747+00
8b24dc56-521f-422e-84eb-d372cd5d01a7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 15:03:55.219379+00
37e7fbd2-b505-4f10-826c-bfe0d54490bd	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 15:03:59.331793+00
dfa2f340-15aa-4139-a6a4-8d3dc5179e15	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 16:22:54.647895+00
85763d43-8a18-4ee9-a783-baf63541aedf	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 16:56:05.294345+00
8fea24b1-41cb-4607-87a5-8776e8b65e84	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 16:56:10.441154+00
1e537c7d-349f-4db9-ab70-4a3d650afd55	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 03:07:10.551359+00
1d15df11-2e1a-4eac-9035-cc8b8686f291	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 05:22:28.184087+00
0158864a-8ec2-4e30-8685-a45ad38bb89c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 06:21:19.91547+00
6d7cecdc-282a-4c77-ac6e-64e7767367fc	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 06:40:22.421954+00
ab9d9ff4-a8da-49ed-b2c1-42762e1285ca	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 06:55:43.077189+00
3239c7ed-d2f8-4c31-91b9-350943e1ec4a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 06:55:48.613877+00
3103141a-e380-4183-ab7f-09f1f88b83d4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 09:18:59.542966+00
65e2ea82-1894-4fb5-9dec-62010328d6ff	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 06:28:03.652337+00
c6e721eb-3c11-422c-a032-b254a5951b7b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 07:22:58.043977+00
b8b14b19-a29d-4949-a6f8-fd1ed3a686d4	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-24 07:36:45.244762+00
68f91632-1298-4d6b-8d67-f5fe8d06ce98	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-24 07:36:48.0061+00
ee9c74bf-94d0-49a6-9c9a-bcd16a9db09d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 10:23:39.548958+00
1d4b0dd7-2212-4d97-b5c2-82f12414d5db	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 08:30:45.319378+00
6b4f4bc6-4a68-4543-8937-f6f8ca5dc1fc	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-24 08:38:31.133146+00
d2182136-0a4e-46aa-92a9-dc652846ab9e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 10:44:24.946713+00
77f30656-33fe-4186-8240-6fdd585321d2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 10:44:30.329591+00
907d7c79-02e0-4e30-ac87-2089ef369452	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 08:38:36.469792+00
aaf3493a-109c-43e5-bea2-18efb5b28f4a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 08:47:24.654136+00
f533b848-b4ca-487e-b8b2-b201651838be	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 11:06:48.64056+00
db689867-9669-4107-8163-6116960de442	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 13:48:11.48029+00
b8aac094-43a3-42ca-9a50-80f3694b16f6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 08:47:36.961838+00
dfdf4f10-ad53-44df-b2dc-d8f4b7bf3eec	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:38:12.969184+00
00e9a292-11e6-44eb-800d-6c18543b48e3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 14:25:52.972746+00
895c1331-c52b-4739-924d-988c728ba09f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 09:48:30.139199+00
62405924-3060-4759-90af-60429d94eeb6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 14:59:28.350712+00
c94e944a-bbd9-4507-a8be-959b73ecbe26	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 14:59:32.833124+00
209c8067-6e28-4ec5-ad87-d63667f54588	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-21 14:59:42.496638+00
05cb8d04-aabb-43b5-81cc-61c2b2828076	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 15:00:03.649995+00
f5e23213-e5f0-4726-aa6c-72b6a2deadea	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 15:02:47.148033+00
46a02aa6-c94c-4aab-89ee-543e1b214ff2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 15:03:28.370487+00
2f7d6765-7800-432a-a301-fc740275d6d6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 15:04:37.35241+00
624e852a-761d-4ca1-88ec-a1677a4778e1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 15:05:47.00414+00
62dad6c0-65b0-479d-ae67-4e2ee49dd6ca	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-21 15:06:55.933788+00
0f5abf2d-823d-43f1-89d9-0f162e9bd158	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 15:19:06.12343+00
7ad6033a-d96f-4023-b711-46f4a0820740	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-21 16:56:35.705006+00
84deca35-8f74-4c5d-b9c6-6ad6e1e288c6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 12:44:26.463906+00
d1dde765-7a99-4032-bce7-cec9f0d0ee17	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 13:22:04.565053+00
4b0b315c-2fd1-42e7-a0de-abaddc45dc07	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 13:22:09.67674+00
d0706b09-1256-41e1-ae9d-085379c00b0d	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 13:22:15.686959+00
dc7b2378-31e9-445d-917a-36f8389609ff	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-22 13:36:56.783745+00
89399b44-7a0a-4e1f-956e-d41707021ecf	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 13:37:02.123069+00
0c597220-1b7a-46c9-92d7-d3b509399724	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:44:11.960294+00
05afc8d2-9aa1-4cc5-91cf-87407f40dfc9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:46:57.410061+00
0084e851-2073-4271-97c1-950a696c73bb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:48:56.53108+00
19740520-88a5-4b8a-90d7-444bac1b9266	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:49:15.696972+00
ed97d90b-0a13-44dc-8ed3-02eb65a76751	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:49:54.732384+00
050bf090-c5ff-46a7-bb52-ce49043a73c1	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:58:13.168656+00
250fe533-25a5-441a-aae5-1fc6cb1b0931	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:59:02.399967+00
7383b450-8b9d-4537-bdcb-b5a3275063be	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:59:32.008946+00
4f555ce3-5317-4310-9c12-93a8c32294b3	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:59:48.586625+00
3dc684e6-5ee9-4590-bde1-b40e6516a243	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:59:57.096856+00
104d1619-228b-4216-843b-2828ad3f8007	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 06:00:06.325321+00
de01d7bf-9bec-4c20-b5b9-b92a669c8446	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 06:00:28.570741+00
e05146c5-df81-41d2-81f5-dcb566c9cf3f	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 06:08:35.32243+00
1721ff20-a8bf-452f-9051-6ccb12dc34d5	\N	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-21 05:55:45.213473+00
0ba88e52-5bc2-4b58-a7c1-7082105fe8ed	\N	logout	{}	\N	\N	2025-07-21 05:56:55.09619+00
a85a1e73-4ebc-4e55-a8df-afba2df033a6	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-21 16:26:54.595785+00
ab38f252-49ce-4bc0-9ff9-c672f033dac5	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-21 16:28:32.974295+00
044b0bba-3911-4474-abd2-ef7158bf9683	\N	login	{"email": "customer@hotel.com"}	\N	\N	2025-07-21 16:29:28.14144+00
259802ce-d957-45c1-a9fa-4b2b0249f116	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-21 16:26:29.951889+00
cf4f7147-25f0-4a54-ad96-91215ff25e49	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:49:58.25061+00
83361f57-e81c-415c-9751-7a2b2e659a18	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:51:45.98748+00
dbdabac1-8cc7-471a-8e5a-9d23d5cc4f30	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:51:51.825303+00
0dee1e84-f5d5-4dbf-8ef8-f919ab0b51a8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:51:56.808246+00
d9113407-e5ef-4cd8-96f4-f21887d967d6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:52:01.561635+00
f5a8671a-19b1-46d7-84f4-c7868a86cd23	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:52:06.920288+00
2e441963-cd3b-4ff9-ab49-3ca8822a6d64	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:52:53.639769+00
569b1752-b8ae-4930-bb35-80542d4d9949	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 13:52:56.755651+00
2ac678e7-5249-4e0b-b46d-a39e68355e9a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:10:53.432488+00
d82d6e9c-b062-4c64-8d93-29c0324bb33f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:12:33.410557+00
ced65b4f-7c21-4e7a-8d8b-90df1037905e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:15:27.722+00
8d023cfb-40fe-4605-993a-0c64cdd9fb44	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:15:31.500358+00
1341451b-f2fb-4349-ad6d-2b170c967da9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:17:47.12081+00
91a4d0b4-e049-4f0a-882f-332262028b04	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:18:22.188862+00
f67cdc5b-0067-4036-af10-a39344f71689	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:19:40.249662+00
ba36750a-8b82-46e5-851b-c027a439ea74	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:19:41.747128+00
64ba8038-22fb-4a93-8cbd-463d91be8e58	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:20:25.671862+00
a3a24dc3-6eb6-4d3f-9b1c-06b193b0a73e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:21:46.332283+00
0d877a2c-760a-4272-ad7c-805bd7089e7c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:23:03.338119+00
e61b35d4-431e-4ecc-a7fa-c174381a65e4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:25:40.842707+00
ff1d405f-831c-40bc-b2bd-15d63c20c8eb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:25:42.848932+00
ccd23d94-5a6f-49bf-9bc4-98f96c375607	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 14:29:50.267559+00
7e41621f-4560-4fe2-8b33-62af722392f4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:39:56.948981+00
3007ca1c-eba3-45f3-a10a-3d9278fdfe93	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:40:43.835507+00
572e9de1-55f6-4c95-b2ea-e5c7d8000036	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:49:43.519823+00
6b753235-e401-4bd4-b638-d69e10383cd5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 14:51:01.187291+00
e061a82a-55ac-4a95-b26c-022a218865d4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:01:22.494561+00
44d034eb-02ef-498e-b5aa-7c1fb70a7d40	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:02:28.453069+00
8537d94d-e24a-400c-bfd9-b13b12419461	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:03:04.174001+00
637ee227-17a5-4d6d-8d70-580a9fac7537	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:07:53.883863+00
1318f158-7230-4942-8140-1052afd2ba79	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:07:59.052557+00
9d21d2bf-22fb-4426-832e-cc136879164e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:08:06.608252+00
c14d5eb2-69d4-46dc-b737-347fa1d4b175	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:08:42.707679+00
f82259bf-acd6-481c-8d1a-6e4d0c7a43bf	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:08:49.060258+00
f6e88800-3279-46b6-83a5-e47a4b399a23	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:08:54.043459+00
37db1359-134a-480f-a64a-b93c7d55a974	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:08:59.068214+00
534f06f8-5ba9-43ee-b558-eb88c5a8891b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:09:03.934576+00
79f6641a-550e-44f1-8198-5014236155dc	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:09:10.603859+00
c9bb2c52-ad5c-4841-9223-aac2a82994cf	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:09:16.425982+00
49ed6246-a7a8-459a-b48f-77ce5fe28afb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:09:21.824252+00
9dd109fa-5875-4ea7-9690-1ff2cc664260	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 15:09:27.123091+00
e28dc667-7351-4e9d-95a0-323f0fdfb840	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 15:10:58.689349+00
e12badff-a40b-45c1-826c-1a783688db3f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 15:47:18.864177+00
e0673331-abb4-4008-8334-5969e24ccd2c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 15:47:23.404932+00
800097a4-bfba-41ec-8709-6849552b069f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 16:36:11.734367+00
05698ce4-6080-404d-a7d3-e89eb6290180	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 17:07:19.301255+00
c77fa420-c4b1-4c83-9af5-466f5ff6a5b5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 17:38:40.629689+00
430310c5-355d-4d50-a11a-b81126a2f317	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 17:38:59.197847+00
7da31dda-2e3d-45fa-9044-0353af3bbbe6	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 17:39:04.253207+00
a685beb9-7b34-4e6f-9049-df859f1a85b6	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-22 17:42:32.610969+00
9a3b3c55-5dee-43e3-b21a-c46dd4a70fd3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 17:42:37.07545+00
10b34d52-74a8-4bac-9b15-1f60546e2312	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 18:07:55.931535+00
1a704bb3-d987-42fb-b451-bc7a70d6f256	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 18:44:27.037647+00
91f0eb70-1521-4192-b5dc-30b496a56216	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 18:59:40.60746+00
9d47f94e-e8fa-42e8-8705-b1fc976d5aa5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 18:59:45.617785+00
438de027-319e-4e50-b2b1-9e8315a48449	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 19:22:06.578781+00
a8410478-20b6-4004-8676-d71b4ff556d1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 19:22:53.403107+00
64915d17-b90b-4ebd-96fd-add7f5a0f173	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 19:58:25.467463+00
7268f45a-8c3b-4be0-8ea2-656ced0cdac7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 19:58:43.879036+00
6a013106-1904-4d8f-9f48-1e34829afdd2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:02:21.228227+00
5b368d7e-d42b-4b8e-8ec1-24fa2600c0f6	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:03:05.361724+00
c2f8ad56-beec-4076-a695-0f4ac03a9a68	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:04:29.527114+00
c030384c-6397-4eab-adfa-a76c236cb65f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:04:44.161469+00
1b288039-ffc8-48be-a216-dd46fcb4fee8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:04:58.433663+00
6e7733e0-2a98-48b2-ba21-70c751eaa3c2	\N	register	{"email": "testuser1753211513901@example.com"}	\N	\N	2025-07-22 19:11:54.003213+00
319724d3-4f03-4e6a-81ee-26ca51250fef	\N	register	{"email": "testuser1753211465163@example.com"}	\N	\N	2025-07-22 19:11:05.32525+00
98dc886c-435b-427a-a189-2f4373bc503e	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-22 18:31:13.351635+00
c736d436-dc83-46be-9846-0e7e4d0fd513	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-22 19:08:40.454958+00
61d99e11-859f-4f21-ae13-40be08067b6e	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:08:45.29225+00
545e7231-b723-4569-aae7-43673bcca58d	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:09:08.371963+00
4861e23f-1c76-4bd2-8417-ba91044b659d	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:09:20.172763+00
cf609ec0-8d8d-4e0e-97b0-b42b4135356a	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:09:51.348728+00
329cd01b-6560-47ec-98be-f054f1bd2d19	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:06:16.012594+00
c4400731-4892-425a-b649-f1d1e7c03456	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:06:34.372207+00
e65ba430-8dd5-4c00-9bd6-145e10bdc5eb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:06:50.216046+00
004b6c24-3684-4004-81fa-90f492cc6b21	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 20:08:11.683276+00
fbd92e3d-aed2-4ccb-a0e8-748e6fca9cf2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:18:04.355204+00
c33574fd-8393-4df5-aaa1-5ddb62c697df	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:18:43.006913+00
083c3955-23b7-4a84-88f2-dfc32ba07e12	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 20:33:46.458946+00
b0226403-d26e-4d28-8ef8-33bf5b0c3f8e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 20:41:49.171917+00
bd97c811-c2ec-4060-a501-789b6ed0f8a3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 22:18:31.739285+00
214728ff-d42a-4dd0-ae89-24f8f1072503	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 22:23:07.205358+00
d1c6a909-5fdb-42ac-b3bb-83fe07e15596	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 22:26:43.984558+00
5d150709-4ed5-4191-9b58-aac86cd2de3a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 22:39:20.04106+00
f5964156-c86b-4fe5-b552-e715ea4f2062	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-22 22:44:53.615154+00
2bf4c998-7a48-4008-a2af-6649f5c5e7ef	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:08:20.383954+00
aec3dcc4-482e-4e71-9bf5-3c399443faaf	\N	register	{"email": "admin1753211580837@example.com"}	\N	\N	2025-07-22 19:13:00.940812+00
ce823fe4-67bc-409c-9df5-cdb9477beaa2	\N	register	{"email": "test-user@example.com"}	\N	\N	2025-07-21 09:50:17.783897+00
f0c71df5-007f-48cb-bccb-9a94b2dca523	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 09:54:51.80001+00
bba53389-a5bf-4270-8faf-09a7dfacc527	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 09:58:09.524579+00
26c59231-2dd0-4845-aa71-0f0f5afc977a	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 10:05:30.289386+00
0242b643-fd7a-4cb7-a276-335439ffae34	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 10:35:45.349879+00
cecf201a-9fb1-49c1-8b81-e5ba349b1a1d	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 10:36:35.625765+00
8dc1df1b-494e-4ed4-a999-24e4ecc8e6e9	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 10:46:00.364142+00
38f9fef1-d60a-4599-b3fb-baeb3ba2dd8d	\N	login	{"email": "test-user@example.com"}	\N	\N	2025-07-21 10:53:09.185236+00
7277b126-d71f-4500-a0c3-a2b2459d07d6	\N	register	{"email": "test@example.com"}	\N	\N	2025-07-21 03:28:03.193957+00
3ba03b6d-7df5-4f0e-8860-8d658dc6bf51	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:28:24.167769+00
873c1647-0f5f-4d0c-bbeb-42840b9b4044	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:28:56.713428+00
70f84991-66e1-4b9a-9f45-eca7e1a583b1	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:30:26.607871+00
f928a356-d9f3-442e-9690-c8142b0fcb7c	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:37:20.417464+00
2f3c1d7e-7767-488c-a8f7-3606cbb4d326	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:40:22.314082+00
dcdc1aa2-9315-4567-8975-9cac805633a6	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:40:34.618803+00
cd6b2522-df24-4100-837e-1d0434eaa72e	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:46:11.448421+00
ac2285a6-95d5-495a-a5df-50af81d5e4e2	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:46:33.187052+00
97d092e4-b595-4d8b-87d2-7849bcb93418	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:47:13.802875+00
7d3cfe26-9c21-442d-8ae5-f85aa163ff95	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:51:56.082956+00
5ea1a45a-03ae-4b03-ae20-88fb4030f54e	\N	role_upgrade	{"reason": "admin_config_match", "newRole": "super_admin", "oldRole": "customer"}	\N	\N	2025-07-21 03:53:15.670773+00
b2a34728-dcf7-480d-a3c2-dc24590df6c9	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:53:15.678425+00
30502f86-fad1-4fb3-96d0-162ab06aaa24	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:54:00.003415+00
25519c6e-a9c7-475b-9f46-f1d773570139	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:56:11.800676+00
605dc74a-cb6b-42ba-bdf6-c2413c66bbe1	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:57:44.257811+00
464e5ff3-3905-414c-9d07-e9abe70bfe72	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 03:59:38.702403+00
1b00c100-301c-427d-a2a4-336ffe1e198d	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 04:00:33.045143+00
29121cfd-7c4d-45d9-9e74-4698d8e4532f	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 04:00:39.260412+00
fafb5ab5-a75e-443d-bf5e-4f2678dc5538	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 04:01:26.424696+00
3d747598-9f23-4b89-a0ef-9fa84311fee6	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 04:02:26.134889+00
5fdf0d30-e1aa-4f2a-b1d2-475c1378ffd8	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:45:49.927513+00
4f626e9f-6914-43e0-8143-c49ca90681a8	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:46:02.087914+00
35453a9c-ed4a-4669-a85b-3bd4ddfe873b	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:46:53.853545+00
5a65f978-b132-4891-8405-5cfb9d239703	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:48:29.685953+00
dbd9729b-3a89-4f8c-8580-490465e54e69	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:48:36.558249+00
aded9ae8-40d0-4201-97b7-066bf65e02ff	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:48:42.461782+00
97159687-6a5a-467c-afc7-46d23c46aed9	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 05:48:47.455162+00
78e438ef-e52c-4200-aa5f-0280271f7cb9	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 06:14:40.314732+00
b1dfab3e-5f91-4ccf-84c4-acd312f4d03c	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 06:19:28.095182+00
a69e9aba-dafc-4c33-af5c-f8cc007db727	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 06:20:07.13248+00
3c9cd007-8857-4306-b9ea-b1c148856792	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:20:45.365821+00
cf93498a-2be3-4b12-a380-a7096e3f82c1	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:21:42.865222+00
db614aac-c35b-4519-81da-a43408bcef69	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:37:57.425983+00
220b84b6-ea78-4874-93f7-f518914afe84	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:38:40.629024+00
e7ed43db-0894-4be4-a627-8993887059c4	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:41:04.743238+00
587f0d32-ed1b-4bb0-a9d0-f50ce3ce3bcc	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:43:52.912461+00
c0f1582b-b9d1-4c21-98d4-f463155d5f0d	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:44:41.230306+00
a121d8da-f894-4ed4-b3ed-27623ed162af	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:45:29.633801+00
bb210504-1aaf-4f5c-8fbc-2d6d8e03a4c2	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:51:36.194734+00
48f0a27c-e47e-436a-ad14-030f5b8d7abf	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:51:37.142731+00
04f464f9-62d6-46d5-bb02-eeb7c3fa384c	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:54:29.796885+00
fd16bab0-b406-4e06-b911-7a10721a0e56	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:57:00.56573+00
37a36f75-3248-42bb-9a96-05cea7281fb7	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-21 14:57:01.08431+00
41754530-7be6-4227-b12a-5fefbca9c133	\N	login	{"email": "test@example.com"}	\N	\N	2025-07-22 19:14:37.942546+00
92b53ce1-946d-432e-af93-6910914eeb01	\N	register	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 18:07:12.445856+00
826ad071-1aae-4029-b840-18186eadf828	\N	login	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 18:07:44.975493+00
a78acb09-eca9-4a74-a465-3848757353aa	\N	login	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 18:16:19.882943+00
c6576031-a3d1-48ab-aa68-82446037537e	\N	login	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 18:17:47.120297+00
477433bd-cbb3-4bbe-88b0-253329a513d6	\N	login	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 19:03:56.821838+00
c58383ee-ee23-40a1-8e8a-be6b2550ff20	\N	login	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 19:04:44.971936+00
f67f62d6-46d0-48e9-b10e-9a8df2b6c41a	\N	login	{"email": "coupon-admin@test.com"}	\N	\N	2025-07-20 19:09:34.172773+00
b66afb56-3bd4-4562-9661-3107eb8e671a	\N	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": true}	\N	\N	2025-07-19 18:40:44.986993+00
b1dd4709-bbdb-45e7-ab60-3d6317999ffa	\N	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-19 18:46:07.806331+00
af8dde6c-8780-4c33-9dfb-47d368e00f0f	\N	logout	{}	\N	\N	2025-07-19 18:46:20.635713+00
2852d974-e3a0-4767-937e-695cda3a7948	\N	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-19 18:47:45.985719+00
9e677cef-b1fe-49cb-a8ce-ce2e9e3ac138	\N	logout	{}	\N	\N	2025-07-19 19:35:47.658187+00
79c210c3-245b-4179-8c7a-96a3a0ec6934	\N	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-19 19:37:03.922198+00
8eaafba2-df5e-4d3f-981e-2641008a551b	\N	logout	{}	\N	\N	2025-07-19 19:37:16.667658+00
4e658a0a-f35c-42eb-b331-b191339e11cb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 23:53:07.362431+00
fe2b6ee8-2edc-4f64-9ebb-3ed8aac886b6	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:53:11.901076+00
5e014a78-fc67-4d2d-ae1c-041c230378f4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:37:04.911793+00
da3b752c-eb3c-42ea-b9fd-0d8165eff8cd	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:43:52.838144+00
d90c4bfa-cd19-40bb-b594-94facf5759c1	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:43:59.25891+00
c8bd7689-c5f6-4edc-bb17-d01bbd38b54b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 11:39:09.339367+00
22ec099a-7526-45b3-b3b1-7a010949ed38	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:39:17.316377+00
c52702a5-b7d0-47d9-94d0-49abf96bc89c	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-23 11:39:31.877252+00
c7b62621-60ff-4810-8f32-299296cd4ef9	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:39:36.213231+00
bd41c039-c0bb-442b-ba0a-35e68e773efe	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-23 11:39:41.339123+00
36577e0f-dc23-4593-b5db-f568d7fede75	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:39:46.596088+00
64cdb835-6030-4bc9-8b36-8ae0bf1417f7	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 15:22:53.446023+00
01a46872-0419-43de-a43f-e6090cb475fa	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 02:16:40.576547+00
b7758afc-08fd-4efa-8d90-13426383e3de	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 05:30:44.633801+00
1b6532a0-160b-40a1-8edd-a68a2c3a4618	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 05:30:50.143913+00
8a913253-ca15-4f31-821d-eb3f32b319a8	\N	register	{"email": "testuser3@example.com"}	\N	\N	2025-07-24 03:17:03.095318+00
cb9385f6-062c-43ab-bc04-3cae05ba80b2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 06:46:38.152534+00
6bc59c19-4333-48bd-865c-f6cdf589911d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 06:46:43.158451+00
bf7b90a1-c718-47cf-8dcc-2c021b75f7a4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 07:26:54.593815+00
946a1e4a-c7ee-4c58-8f4e-99dbd9674f61	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 07:45:25.09662+00
b0ed4bcd-82d1-44dc-9466-a5e89c3e1b6a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 07:45:29.283264+00
03983df6-8123-4df9-9b86-41370f8025be	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 08:33:37.896803+00
40412e5c-39c5-4c5c-9bc1-6ec76ab159a6	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 08:33:47.686975+00
735fce7e-3ae4-4869-be3b-aa549a769e83	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:08:28.417304+00
186ef8fe-0db0-4156-a22a-8fa2bda283c3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 09:39:01.354484+00
fbbd3967-d325-404b-9242-625248f1c361	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:39:05.310942+00
1fd721e0-c8ff-48a3-999f-d2f331d5e3f0	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:48:34.80859+00
a8a0d44c-d4cb-4e5b-afa2-a73295a15fc5	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 18:03:09.397762+00
3336e023-6d43-4822-9f7b-130391b9d38f	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 18:03:16.117852+00
c559d01a-e808-4e77-92ce-9012486135a8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 21:11:22.41471+00
2567c329-cc20-4df8-b8f8-fbb0c17e3856	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-24 21:57:44.821572+00
97831940-4703-486c-95d4-1ddc94f530b2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 21:59:04.735626+00
a7820371-36e1-421f-b79b-56eaacf7980b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 21:59:09.212508+00
38202e0b-7ab6-4734-b601-84b3d942277a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 21:59:18.27292+00
5239042b-224c-475a-8f97-df6dedf65924	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 21:59:20.933003+00
527832da-1e40-49c8-83ba-76080e3fe496	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-24 22:24:01.230414+00
af983af9-880a-4710-b676-466a5ec90233	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-24 22:24:02.813522+00
93e5c164-9b4e-4fe9-8601-4893e4e7d654	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 22:30:33.121191+00
8fa960a5-f307-4c8b-98cd-cf28066113aa	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 22:30:38.596705+00
12cc5de8-0b25-4595-a273-a5e4ddd5106e	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-24 22:30:43.366224+00
f727818a-ffc7-4eb5-bdee-db38e93ed1de	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-24 22:30:51.461725+00
59f044e0-fde6-4363-9c68-5528793a3401	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-24 22:30:54.541648+00
2c4a5118-dfac-4ddb-8ece-fc807ecd6d2c	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-24 23:43:54.785608+00
61f506df-a087-4f95-8631-9a13b3caa4a3	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-24 23:43:57.152203+00
a5da61d4-f928-4e01-a682-fe10a74cb97d	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-25 01:05:27.535475+00
fa10d8a4-bb9c-474a-bcb8-9ad0358b8588	485fea49-4660-4313-84df-c4c5d64b0275	logout	{}	\N	\N	2025-07-25 09:09:31.045922+00
68a1103f-3ed6-4716-b3fd-e78c8a9a00ee	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-25 09:09:40.768614+00
928e1e1e-155e-4b1e-ac90-c426bd2cc774	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-25 09:32:15.356653+00
c525fa5e-92a0-46d9-94a4-f503083ef499	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-25 09:32:19.03473+00
7b9aca23-731e-4769-ba5b-e3a93bf5aca2	dbdf6c3e-b1b8-4e2a-895d-8a0e6cba9008	logout	{}	\N	\N	2025-07-25 16:30:02.713315+00
3d5f6fbf-6c2c-4fb5-903e-87f30cec0e9c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-25 16:30:10.103008+00
8d3e4208-84cc-4481-9b30-3431f104b3eb	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-25 16:31:55.73023+00
c44310e0-e75f-4334-98c2-03cc1a37e488	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:15:35.201269+00
ba00fa3c-292a-42eb-ac6a-32790888a285	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:16:33.288869+00
f9acc594-1395-40a1-8bbb-9be52fd8db1d	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:17:27.534707+00
0ae14c73-d4ed-47eb-bf2f-880ff8736cde	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:17:53.467255+00
97197308-5c1c-4bb4-b22f-efe8853402b0	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:18:54.693811+00
58d1d52c-6c38-4bf1-8557-1c0d1e859c59	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:20:16.998294+00
da4b8e33-0dd3-4e9d-8c93-b699c7056ccf	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:20:26.315236+00
526ccc94-ec96-4d1d-b220-fbac6495639e	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:21:49.668701+00
94ed1489-9946-4029-a2c9-bb70d973655f	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:22:48.228314+00
4fe502cd-2cba-4291-9a99-3a6480f196b4	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:27:27.907124+00
f3462631-a30e-4150-8fb1-3b5f9fefc1aa	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:27:38.747812+00
4d9ba189-147d-4a00-954d-64283f8dcab7	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:28:08.068514+00
d1137def-35b1-4fac-bee5-13c2680bda22	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:28:40.171626+00
168da696-3d30-42d3-a337-9f7c1717b90a	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:29:21.520445+00
04f99c27-24a6-44bb-b4a7-84367ce752b5	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:29:41.355678+00
13cda7df-740a-4a61-b5b7-af16719e30d2	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:36:55.503004+00
1d9ab2af-4443-4d04-9015-673b5539954d	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:38:26.427056+00
0079843c-6e5a-4cdc-9666-09222380a1dc	\N	login	{"email": "admin@hotel.com"}	\N	\N	2025-07-20 19:47:43.600269+00
d97b93f1-29f8-480b-9653-a0a9dde2fbcf	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-22 23:56:02.48484+00
0f285528-c609-4838-8cea-376c95f93c1c	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:56:06.484755+00
9cc18363-3570-4334-9461-9c4eb2a305f4	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-22 23:56:45.790063+00
0281c51e-e671-4095-80a8-be496df29ddd	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-22 23:56:50.937813+00
7c9549e3-b19d-41a5-8e0d-66308ef15e7a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-23 09:37:10.224884+00
2cda442e-e309-4e0f-8977-41d405845f64	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:53:31.847963+00
1773e2a9-e446-473d-9208-3a02dfc65ff0	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 09:53:44.16477+00
084bf303-c941-4bdd-8662-33a4a0a40482	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 09:53:48.790581+00
3e087b91-c678-4803-a44c-21678356b10b	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-23 11:47:16.574053+00
8da6d833-d0aa-4c0f-92c8-448d70fe3474	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:47:21.040174+00
2ff8f9c7-4115-40d2-977a-e54743ef1121	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-23 11:47:28.637424+00
4fb19e6a-eb14-4712-b926-a62f11b8a67a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-23 11:47:32.907035+00
53524a88-d3ef-4fc4-8695-95c6c520e4c2	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 02:32:30.182487+00
26e5adc8-3dc6-4502-b00b-dae3c5910fcf	\N	register	{"email": "testuser4@example.com"}	\N	\N	2025-07-24 04:58:47.422271+00
b4e5be93-fa1f-484a-a03c-00b5923ae0a0	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:00:25.762211+00
98803b25-4645-477d-a130-902bbf954e12	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:00:36.851397+00
ee1a9361-ec4f-4379-9bae-f9dd5dbccbd7	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:01:34.066533+00
32ca5d2d-a3ef-4638-86d3-d5ea092a5bfb	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:01:42.062906+00
c14614ce-2bd2-4e46-aa73-f040050472df	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:01:51.009554+00
d703661e-9670-4bab-a600-4b305a49695a	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:02:00.023253+00
ea0fc9d5-fc43-4602-a8dd-830e515777e7	\N	login	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:02:08.558082+00
e74ada9c-b1c8-4390-b67e-d96c2497e68f	\N	register	{"email": "admin@example.com"}	\N	\N	2025-07-23 16:00:04.687336+00
4a0a8101-2f61-41e7-ab1e-120d375ea572	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 07:06:12.658109+00
a2ae9512-7540-4cda-99df-bc062b1597b3	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 07:35:57.657724+00
cc6a67b5-aa73-4676-a23b-4ddec85c44bb	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 07:36:03.923211+00
ae37efff-a75a-4bb8-8e57-ac6850761a11	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 09:09:07.10647+00
05b372f4-243c-4b6f-ba75-07fd4a881543	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:09:11.538776+00
cd260164-9dea-43a9-b7b6-4a28e0584a0c	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-24 09:39:50.533446+00
49d17a48-8fd7-4cf6-8400-fb55ac8ddf68	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 09:39:54.574169+00
0d648a33-ba8a-4657-83ee-d4bda63f1679	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-24 10:03:48.102584+00
30d65827-ff8d-4aa7-a49a-5c5be917ca4d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 10:03:54.329547+00
7529947c-0fe3-4adb-b0a7-69e9c42ea2e9	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 17:43:57.697919+00
734a18e6-9b7e-4050-885c-f4abc11605ac	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 17:44:04.228632+00
aef0f87b-2337-4e56-8a03-0b134dca7c41	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 18:00:53.485316+00
4baaec62-95d2-4d6a-8988-194dd093e620	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	logout	{}	\N	\N	2025-07-24 18:34:00.543841+00
0bd62b6f-a3dc-4f40-b960-d05a60c11996	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 21:48:57.5876+00
9c009958-be2b-4ccf-8313-dec5cbce3cf7	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-24 21:57:53.455392+00
e854f275-bc65-4505-9a1e-422d5f9c4134	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-24 21:58:00.637408+00
fdbf0f1c-c4e6-46dc-a478-507ea15c9f5d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 21:58:06.244886+00
798be6cd-78ea-4222-986b-9989a62fcdeb	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 21:58:23.901331+00
8b9b9e97-0626-4cde-9e41-3dff698ea362	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 21:58:32.19212+00
bb0caa9b-649e-40e4-ad70-718d5ab0c46f	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 22:23:15.697176+00
77103df7-3101-42fb-93bb-b417f7e48f7e	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 22:23:18.698905+00
9c2360d4-76c6-4ae2-9553-a8a7dc50ff11	59d2f833-a118-4a43-a1d1-73a7f5119ddf	login	{"email": "winut.hf@gmail.com"}	\N	\N	2025-07-24 22:27:25.411453+00
f6920fbb-24c3-4309-91f8-bb3c8931b003	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 22:27:30.121259+00
aa80e572-a69f-4ac7-9264-71db5b279d5c	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-24 22:27:34.889239+00
a1274b74-8ffb-492c-aa92-d07f5327c100	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-24 22:27:45.303285+00
c9b6cab1-eb1d-46fc-b1ba-aafa1e083073	59d2f833-a118-4a43-a1d1-73a7f5119ddf	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-24 23:41:53.063656+00
9164aa39-8d62-4704-9048-58a17dd57544	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-24 23:41:54.715958+00
8d7f4e05-c869-4b8a-8336-aa0a755e45bd	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-25 00:07:40.863244+00
0e1f50f3-16bb-4014-adce-f01c5cbdb4a4	485fea49-4660-4313-84df-c4c5d64b0275	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-25 09:09:15.383288+00
5402f396-af83-40ae-a551-d463a4f351f7	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	logout	{}	\N	\N	2025-07-25 09:09:48.328143+00
ff5b987c-3423-41dc-b43d-add73b617283	485fea49-4660-4313-84df-c4c5d64b0275	oauth_login	{"provider": "google", "isNewUser": false}	\N	\N	2025-07-25 09:25:05.762546+00
94932b86-5901-4af6-9b84-f1382c411fa4	485fea49-4660-4313-84df-c4c5d64b0275	logout	{}	\N	\N	2025-07-25 09:25:14.777523+00
d7c9ff91-49c3-465e-ab5d-1e882839cb21	dbdf6c3e-b1b8-4e2a-895d-8a0e6cba9008	oauth_login	{"provider": "google", "isNewUser": true}	\N	\N	2025-07-25 16:29:50.18798+00
ca5be7bb-cd24-4d34-89cb-d61c071fe5f8	59d2f833-a118-4a43-a1d1-73a7f5119ddf	logout	{}	\N	\N	2025-07-25 16:30:40.701488+00
ae0dcd0d-423d-4665-98f2-63b746b8e521	59656bdc-5e3e-45e9-b9f0-255cb5bb082c	oauth_login	{"lineId": "Ua7448f9eb068bb4c7d480e2f0aed3c21", "provider": "line", "isNewUser": false}	\N	\N	2025-07-25 16:30:46.021066+00
\.


--
-- Data for Name: user_coupons; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_coupons (id, user_id, coupon_id, status, qr_code, used_at, used_by_admin, redemption_location, redemption_details, assigned_by, assigned_reason, expires_at, created_at, updated_at) FROM stdin;
744403e1-9b4f-4e41-922c-f4fadff02bde	35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	239b5ffd-9fff-4346-893f-3be8b7b0d5de	available	667AE5DF30DD9797	\N	\N	\N	{}	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Admin assignment	2025-12-31 23:59:59.999+00	2025-07-21 10:02:43.31621+00	2025-07-21 10:02:43.31621+00
2004a8cf-08e4-4587-b3a1-3a95bb9cca2a	59d2f833-a118-4a43-a1d1-73a7f5119ddf	6f13628f-afcc-4dcd-bf32-bb6bc390cb23	available	6AF0463CE27D5644	\N	\N	\N	{}	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Admin assignment	2025-07-21 23:59:59.999+00	2025-07-21 11:19:26.744564+00	2025-07-21 11:19:26.744564+00
768691ee-94f7-44e9-9795-30eec8493bcd	59d2f833-a118-4a43-a1d1-73a7f5119ddf	239b5ffd-9fff-4346-893f-3be8b7b0d5de	revoked	4A79DC7231E904CF	\N	\N	\N	{"reason": "Removed by admin from assignment management", "revokedAt": "2025-07-21T14:58:21.511Z", "revokedBy": "59d2f833-a118-4a43-a1d1-73a7f5119ddf"}	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Admin assignment	2025-12-31 23:59:59.999+00	2025-07-21 10:03:13.016133+00	2025-07-21 14:58:21.512712+00
f29c1d07-3ec8-462b-80f0-668ab8a4f67d	59d2f833-a118-4a43-a1d1-73a7f5119ddf	239b5ffd-9fff-4346-893f-3be8b7b0d5de	revoked	8D15106ABA42DEE4	\N	\N	\N	{"reason": "Removed by admin from assignment management", "revokedAt": "2025-07-21T14:58:21.511Z", "revokedBy": "59d2f833-a118-4a43-a1d1-73a7f5119ddf"}	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Admin assignment	2025-12-31 23:59:59.999+00	2025-07-21 11:19:14.091716+00	2025-07-21 14:58:21.512712+00
20820399-a607-4da6-8119-b6f42dbc8986	59d2f833-a118-4a43-a1d1-73a7f5119ddf	e9d238d9-62a1-48de-880c-35e184d4a2e2	available	F1EB16DC79649128	\N	\N	\N	{}	59d2f833-a118-4a43-a1d1-73a7f5119ddf	Testing coupon visibility	\N	2025-07-21 15:06:23.599292+00	2025-07-21 15:06:23.599292+00
f18de7bf-08bb-405f-bcdc-cc13c2860168	59d2f833-a118-4a43-a1d1-73a7f5119ddf	6f13628f-afcc-4dcd-bf32-bb6bc390cb23	available	78B8F8AA3FB15C70	\N	\N	\N	{}	\N	Manual assignment for testing	2025-07-21 23:59:59.999+00	2025-07-21 09:30:31.710176+00	2025-07-22 23:10:31.929806+00
\.


--
-- Data for Name: user_loyalty; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_loyalty (user_id, current_points, tier_id, tier_updated_at, points_updated_at, created_at, updated_at, total_nights) FROM stdin;
59656bdc-5e3e-45e9-b9f0-255cb5bb082c	0	8a6a84a2-6b99-48cf-9c7d-fe6bc78ff7b1	2025-07-24 09:38:33.230639+00	2025-07-24 09:38:33.230639+00	2025-07-23 11:49:21.377068+00	2025-07-24 09:38:33.230639+00	4
35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	800	496f4f39-5d13-463d-bbb8-85f91182dbd5	2025-07-24 10:04:25.433302+00	2025-07-24 10:04:25.433302+00	2025-07-20 16:57:38.717408+00	2025-07-24 10:04:25.433302+00	7
59d2f833-a118-4a43-a1d1-73a7f5119ddf	90000	496f4f39-5d13-463d-bbb8-85f91182dbd5	2025-07-24 10:04:38.948947+00	2025-07-24 10:04:38.948947+00	2025-07-20 16:31:07.50203+00	2025-07-24 10:04:38.948947+00	5
485fea49-4660-4313-84df-c4c5d64b0275	0	8a6a84a2-6b99-48cf-9c7d-fe6bc78ff7b1	2025-07-25 09:09:15.392754+00	2025-07-25 09:09:15.392754+00	2025-07-25 09:09:15.392754+00	2025-07-25 09:09:15.392754+00	0
dbdf6c3e-b1b8-4e2a-895d-8a0e6cba9008	0	8a6a84a2-6b99-48cf-9c7d-fe6bc78ff7b1	2025-07-25 16:29:50.19573+00	2025-07-25 16:29:50.19573+00	2025-07-25 16:29:50.19573+00	2025-07-25 16:29:50.19573+00	0
\.


--
-- Data for Name: user_profiles; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_profiles (user_id, first_name, last_name, phone, date_of_birth, preferences, avatar_url, created_at, updated_at, reception_id) FROM stdin;
35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	วิณัฐ	จิรฤกษ์มงคล	\N	\N	{}	/storage/avatars/35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb_avatar.jpg	2025-07-19 18:04:59.206183+00	2025-07-25 09:32:15.33665+00	26900066
dbdf6c3e-b1b8-4e2a-895d-8a0e6cba9008	วิณัฐ	จิรฤกษ์มงคล	\N	\N	{}	https://lh3.googleusercontent.com/a/ACg8ocJ8awODrn8EejXojlukTzdzOqBxoavh30V8_FkyiBkrHFMAX5U=s96-c	2025-07-25 16:29:50.174428+00	2025-07-25 16:29:50.174428+00	26900021
59656bdc-5e3e-45e9-b9f0-255cb5bb082c	นัท		\N	\N	{}	https://profile.line-scdn.net/0hhNqeL_7_N2FcHB6t4SJJHixMNAt_bW5zJ3krD2gaYAE2KXhldSktBGBLawFgKnEyJHt-A2obOwJQD0AHQkrLVVssalBgKnY-c357hQ	2025-07-23 11:49:21.36592+00	2025-07-25 16:30:46.005341+00	26900095
59d2f833-a118-4a43-a1d1-73a7f5119ddf	winut	j	333333333	1995-02-24	{}	/storage/avatars/59d2f833-a118-4a43-a1d1-73a7f5119ddf_avatar.jpg	2025-07-19 16:50:07.473601+00	2025-07-25 16:30:10.09312+00	26900081
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.users (id, email, password_hash, role, is_active, email_verified, created_at, updated_at, oauth_provider, oauth_provider_id) FROM stdin;
35d4d9b3-9add-4d1b-9cc9-0a836f52d0bb	nut.winut@gmail.com		customer	t	t	2025-07-19 18:04:59.200051+00	2025-07-19 18:04:59.200051+00	\N	\N
59d2f833-a118-4a43-a1d1-73a7f5119ddf	winut.hf@gmail.com	$2a$10$GcErwwWSvcfWJLqWZ4d90u2knjQwmFNo5739vgiNTHkhu0I6CYFAi	super_admin	t	t	2025-07-19 16:50:07.473601+00	2025-07-19 18:10:12.41564+00	\N	\N
485fea49-4660-4313-84df-c4c5d64b0275	nut.winut.byd@gmail.com		customer	t	t	2025-07-25 06:33:03.20082+00	2025-07-25 06:33:03.20082+00	google	102572652519417465373
dbdf6c3e-b1b8-4e2a-895d-8a0e6cba9008	winut.nut@gmail.com		customer	t	t	2025-07-25 16:29:50.152331+00	2025-07-25 16:29:50.152331+00	google	107404658926866611088
59656bdc-5e3e-45e9-b9f0-255cb5bb082c	line_Ua7448f9eb068bb4c7d480e2f0aed3c21@line.oauth		customer	t	f	2025-07-23 11:49:21.359528+00	2025-07-25 16:30:46.01174+00	line	Ua7448f9eb068bb4c7d480e2f0aed3c21
\.


--
-- Name: reception_id_sequence_id_seq; Type: SEQUENCE SET; Schema: public; Owner: loyalty
--

SELECT pg_catalog.setval('public.reception_id_sequence_id_seq', 1, true);


--
-- Name: account_link_requests account_link_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_link_requests
    ADD CONSTRAINT account_link_requests_pkey PRIMARY KEY (id);


--
-- Name: account_linking_audit account_linking_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_linking_audit
    ADD CONSTRAINT account_linking_audit_pkey PRIMARY KEY (id);


--
-- Name: coupon_analytics coupon_analytics_coupon_id_analytics_date_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupon_analytics
    ADD CONSTRAINT coupon_analytics_coupon_id_analytics_date_key UNIQUE (coupon_id, analytics_date);


--
-- Name: coupon_analytics coupon_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupon_analytics
    ADD CONSTRAINT coupon_analytics_pkey PRIMARY KEY (id);


--
-- Name: coupon_redemptions coupon_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: feature_toggle_audit feature_toggle_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggle_audit
    ADD CONSTRAINT feature_toggle_audit_pkey PRIMARY KEY (id);


--
-- Name: feature_toggles feature_toggles_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggles
    ADD CONSTRAINT feature_toggles_feature_key_key UNIQUE (feature_key);


--
-- Name: feature_toggles feature_toggles_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggles
    ADD CONSTRAINT feature_toggles_pkey PRIMARY KEY (id);


--
-- Name: linked_accounts linked_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_pkey PRIMARY KEY (id);


--
-- Name: linked_accounts linked_accounts_primary_user_id_linked_user_id_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_primary_user_id_linked_user_id_key UNIQUE (primary_user_id, linked_user_id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: points_earning_rules points_earning_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.points_earning_rules
    ADD CONSTRAINT points_earning_rules_pkey PRIMARY KEY (id);


--
-- Name: points_transactions points_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_pkey PRIMARY KEY (id);


--
-- Name: reception_id_sequence reception_id_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.reception_id_sequence
    ADD CONSTRAINT reception_id_sequence_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);


--
-- Name: survey_coupon_assignments survey_coupon_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_pkey PRIMARY KEY (id);


--
-- Name: survey_coupon_assignments survey_coupon_assignments_survey_id_coupon_id_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_survey_id_coupon_id_key UNIQUE (survey_id, coupon_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: survey_invitations survey_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_pkey PRIMARY KEY (id);


--
-- Name: survey_responses survey_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);


--
-- Name: survey_reward_history survey_reward_history_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_pkey PRIMARY KEY (id);


--
-- Name: survey_reward_history survey_reward_history_survey_coupon_assignment_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_survey_coupon_assignment_id_user_id_key UNIQUE (survey_coupon_assignment_id, user_id);


--
-- Name: surveys surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);


--
-- Name: tiers tiers_name_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_name_key UNIQUE (name);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (id);


--
-- Name: user_audit_log user_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_audit_log
    ADD CONSTRAINT user_audit_log_pkey PRIMARY KEY (id);


--
-- Name: user_coupons user_coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_pkey PRIMARY KEY (id);


--
-- Name: user_coupons user_coupons_qr_code_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_qr_code_key UNIQUE (qr_code);


--
-- Name: user_loyalty user_loyalty_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_loyalty
    ADD CONSTRAINT user_loyalty_pkey PRIMARY KEY (user_id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_account_link_requests_expires; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_link_requests_expires ON public.account_link_requests USING btree (expires_at);


--
-- Name: idx_account_link_requests_requester; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_link_requests_requester ON public.account_link_requests USING btree (requester_user_id);


--
-- Name: idx_account_link_requests_status; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_link_requests_status ON public.account_link_requests USING btree (status);


--
-- Name: idx_account_link_requests_target; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_link_requests_target ON public.account_link_requests USING btree (target_user_id);


--
-- Name: idx_account_link_requests_target_email; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_link_requests_target_email ON public.account_link_requests USING btree (target_email);


--
-- Name: idx_account_linking_audit_created; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_linking_audit_created ON public.account_linking_audit USING btree (created_at);


--
-- Name: idx_account_linking_audit_user; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_account_linking_audit_user ON public.account_linking_audit USING btree (user_id);


--
-- Name: idx_coupon_analytics_coupon_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupon_analytics_coupon_id ON public.coupon_analytics USING btree (coupon_id);


--
-- Name: idx_coupon_analytics_date; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupon_analytics_date ON public.coupon_analytics USING btree (analytics_date);


--
-- Name: idx_coupon_redemptions_created_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupon_redemptions_created_at ON public.coupon_redemptions USING btree (created_at);


--
-- Name: idx_coupon_redemptions_transaction_ref; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupon_redemptions_transaction_ref ON public.coupon_redemptions USING btree (transaction_reference);


--
-- Name: idx_coupon_redemptions_user_coupon_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupon_redemptions_user_coupon_id ON public.coupon_redemptions USING btree (user_coupon_id);


--
-- Name: idx_coupons_code; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupons_code ON public.coupons USING btree (code);


--
-- Name: idx_coupons_created_by; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupons_created_by ON public.coupons USING btree (created_by);


--
-- Name: idx_coupons_status; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupons_status ON public.coupons USING btree (status);


--
-- Name: idx_coupons_type; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupons_type ON public.coupons USING btree (type);


--
-- Name: idx_coupons_valid_dates; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_coupons_valid_dates ON public.coupons USING btree (valid_from, valid_until);


--
-- Name: idx_feature_toggle_audit_changed_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_feature_toggle_audit_changed_at ON public.feature_toggle_audit USING btree (changed_at);


--
-- Name: idx_feature_toggle_audit_feature_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_feature_toggle_audit_feature_id ON public.feature_toggle_audit USING btree (feature_toggle_id);


--
-- Name: idx_feature_toggles_enabled; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_feature_toggles_enabled ON public.feature_toggles USING btree (is_enabled);


--
-- Name: idx_feature_toggles_key; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_feature_toggles_key ON public.feature_toggles USING btree (feature_key);


--
-- Name: idx_linked_accounts_linked; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_linked_accounts_linked ON public.linked_accounts USING btree (linked_user_id);


--
-- Name: idx_linked_accounts_primary; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_linked_accounts_primary ON public.linked_accounts USING btree (primary_user_id);


--
-- Name: idx_password_reset_tokens_token; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_password_reset_tokens_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_password_reset_tokens_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_password_reset_tokens_user_id ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_points_earning_rules_active; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_points_earning_rules_active ON public.points_earning_rules USING btree (is_active);


--
-- Name: idx_points_transactions_created_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_points_transactions_created_at ON public.points_transactions USING btree (created_at);


--
-- Name: idx_points_transactions_expires_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_points_transactions_expires_at ON public.points_transactions USING btree (expires_at);


--
-- Name: idx_points_transactions_type; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_points_transactions_type ON public.points_transactions USING btree (type);


--
-- Name: idx_points_transactions_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_points_transactions_user_id ON public.points_transactions USING btree (user_id);


--
-- Name: idx_refresh_tokens_token; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_refresh_tokens_token ON public.refresh_tokens USING btree (token);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_survey_coupon_assignments_active; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_coupon_assignments_active ON public.survey_coupon_assignments USING btree (is_active);


--
-- Name: idx_survey_coupon_assignments_coupon_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_coupon_assignments_coupon_id ON public.survey_coupon_assignments USING btree (coupon_id);


--
-- Name: idx_survey_coupon_assignments_survey_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_coupon_assignments_survey_id ON public.survey_coupon_assignments USING btree (survey_id);


--
-- Name: idx_survey_invitations_status; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_invitations_status ON public.survey_invitations USING btree (status);


--
-- Name: idx_survey_invitations_survey_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_invitations_survey_id ON public.survey_invitations USING btree (survey_id);


--
-- Name: idx_survey_invitations_unique; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE UNIQUE INDEX idx_survey_invitations_unique ON public.survey_invitations USING btree (survey_id, user_id);


--
-- Name: idx_survey_invitations_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_invitations_user_id ON public.survey_invitations USING btree (user_id);


--
-- Name: idx_survey_responses_completed; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_responses_completed ON public.survey_responses USING btree (is_completed);


--
-- Name: idx_survey_responses_survey_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_responses_survey_id ON public.survey_responses USING btree (survey_id);


--
-- Name: idx_survey_responses_unique; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE UNIQUE INDEX idx_survey_responses_unique ON public.survey_responses USING btree (survey_id, user_id);


--
-- Name: idx_survey_responses_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_responses_user_id ON public.survey_responses USING btree (user_id);


--
-- Name: idx_survey_reward_history_assignment_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_reward_history_assignment_id ON public.survey_reward_history USING btree (survey_coupon_assignment_id);


--
-- Name: idx_survey_reward_history_awarded_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_reward_history_awarded_at ON public.survey_reward_history USING btree (awarded_at);


--
-- Name: idx_survey_reward_history_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_reward_history_user_id ON public.survey_reward_history USING btree (user_id);


--
-- Name: idx_surveys_access_type; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_access_type ON public.surveys USING btree (access_type);


--
-- Name: idx_surveys_created_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_created_at ON public.surveys USING btree (created_at);


--
-- Name: idx_surveys_created_by; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_created_by ON public.surveys USING btree (created_by);


--
-- Name: idx_surveys_status; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_status ON public.surveys USING btree (status);


--
-- Name: idx_surveys_status_access_type; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_status_access_type ON public.surveys USING btree (status, access_type);


--
-- Name: idx_tiers_min_points; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_tiers_min_points ON public.tiers USING btree (min_points);


--
-- Name: idx_tiers_sort_order; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_tiers_sort_order ON public.tiers USING btree (sort_order);


--
-- Name: idx_user_audit_log_created_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_audit_log_created_at ON public.user_audit_log USING btree (created_at);


--
-- Name: idx_user_audit_log_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_audit_log_user_id ON public.user_audit_log USING btree (user_id);


--
-- Name: idx_user_coupons_coupon_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_coupons_coupon_id ON public.user_coupons USING btree (coupon_id);


--
-- Name: idx_user_coupons_expires_at; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_coupons_expires_at ON public.user_coupons USING btree (expires_at);


--
-- Name: idx_user_coupons_qr_code; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_coupons_qr_code ON public.user_coupons USING btree (qr_code);


--
-- Name: idx_user_coupons_status; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_coupons_status ON public.user_coupons USING btree (status);


--
-- Name: idx_user_coupons_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_coupons_user_id ON public.user_coupons USING btree (user_id);


--
-- Name: idx_user_loyalty_current_points; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_loyalty_current_points ON public.user_loyalty USING btree (current_points);


--
-- Name: idx_user_loyalty_tier_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_loyalty_tier_id ON public.user_loyalty USING btree (tier_id);


--
-- Name: idx_user_profiles_reception_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE UNIQUE INDEX idx_user_profiles_reception_id ON public.user_profiles USING btree (reception_id);


--
-- Name: idx_user_profiles_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_user_profiles_user_id ON public.user_profiles USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_oauth_provider_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_users_oauth_provider_id ON public.users USING btree (oauth_provider, oauth_provider_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: user_coupons generate_qr_code_trigger; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER generate_qr_code_trigger BEFORE INSERT ON public.user_coupons FOR EACH ROW EXECUTE FUNCTION public.set_qr_code();


--
-- Name: reception_id_sequence reception_id_sequence_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER reception_id_sequence_updated_at BEFORE UPDATE ON public.reception_id_sequence FOR EACH ROW EXECUTE FUNCTION public.update_reception_sequence_updated_at();


--
-- Name: survey_responses survey_completion_reward_trigger; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER survey_completion_reward_trigger AFTER UPDATE ON public.survey_responses FOR EACH ROW EXECUTE FUNCTION public.trigger_award_survey_coupons();


--
-- Name: feature_toggles trigger_feature_toggle_audit; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER trigger_feature_toggle_audit AFTER UPDATE ON public.feature_toggles FOR EACH ROW EXECUTE FUNCTION public.audit_feature_toggle_changes();


--
-- Name: feature_toggles trigger_feature_toggle_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER trigger_feature_toggle_updated_at BEFORE UPDATE ON public.feature_toggles FOR EACH ROW EXECUTE FUNCTION public.update_feature_toggle_updated_at();


--
-- Name: coupons update_coupons_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: points_earning_rules update_points_earning_rules_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_points_earning_rules_updated_at BEFORE UPDATE ON public.points_earning_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: survey_coupon_assignments update_survey_coupon_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_survey_coupon_assignments_updated_at BEFORE UPDATE ON public.survey_coupon_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_loyalty update_tier_on_nights_change; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_tier_on_nights_change BEFORE UPDATE OF total_nights ON public.user_loyalty FOR EACH ROW EXECUTE FUNCTION public.update_user_tier_by_nights();


--
-- Name: tiers update_tiers_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_tiers_updated_at BEFORE UPDATE ON public.tiers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_coupons update_user_coupons_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_user_coupons_updated_at BEFORE UPDATE ON public.user_coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_loyalty update_user_loyalty_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_user_loyalty_updated_at BEFORE UPDATE ON public.user_loyalty FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_profiles update_user_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_loyalty update_user_tier_on_points_change; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_user_tier_on_points_change BEFORE UPDATE OF current_points ON public.user_loyalty FOR EACH ROW EXECUTE FUNCTION public.update_user_tier();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: account_link_requests account_link_requests_requester_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_link_requests
    ADD CONSTRAINT account_link_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: account_link_requests account_link_requests_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_link_requests
    ADD CONSTRAINT account_link_requests_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: account_linking_audit account_linking_audit_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_linking_audit
    ADD CONSTRAINT account_linking_audit_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.account_link_requests(id) ON DELETE SET NULL;


--
-- Name: account_linking_audit account_linking_audit_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_linking_audit
    ADD CONSTRAINT account_linking_audit_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: account_linking_audit account_linking_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.account_linking_audit
    ADD CONSTRAINT account_linking_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: coupon_analytics coupon_analytics_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupon_analytics
    ADD CONSTRAINT coupon_analytics_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: coupon_redemptions coupon_redemptions_staff_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_staff_member_id_fkey FOREIGN KEY (staff_member_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: coupon_redemptions coupon_redemptions_user_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_user_coupon_id_fkey FOREIGN KEY (user_coupon_id) REFERENCES public.user_coupons(id) ON DELETE CASCADE;


--
-- Name: coupons coupons_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: feature_toggle_audit feature_toggle_audit_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggle_audit
    ADD CONSTRAINT feature_toggle_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: feature_toggle_audit feature_toggle_audit_feature_toggle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggle_audit
    ADD CONSTRAINT feature_toggle_audit_feature_toggle_id_fkey FOREIGN KEY (feature_toggle_id) REFERENCES public.feature_toggles(id) ON DELETE CASCADE;


--
-- Name: feature_toggles feature_toggles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggles
    ADD CONSTRAINT feature_toggles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: feature_toggles feature_toggles_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.feature_toggles
    ADD CONSTRAINT feature_toggles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: linked_accounts linked_accounts_linked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES public.users(id);


--
-- Name: linked_accounts linked_accounts_linked_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_linked_user_id_fkey FOREIGN KEY (linked_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: linked_accounts linked_accounts_primary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.linked_accounts
    ADD CONSTRAINT linked_accounts_primary_user_id_fkey FOREIGN KEY (primary_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: points_transactions points_transactions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: points_transactions points_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: survey_coupon_assignments survey_coupon_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: survey_coupon_assignments survey_coupon_assignments_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: survey_coupon_assignments survey_coupon_assignments_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON DELETE CASCADE;


--
-- Name: survey_invitations survey_invitations_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON DELETE CASCADE;


--
-- Name: survey_invitations survey_invitations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: survey_responses survey_responses_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON DELETE CASCADE;


--
-- Name: survey_responses survey_responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: survey_reward_history survey_reward_history_survey_coupon_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_survey_coupon_assignment_id_fkey FOREIGN KEY (survey_coupon_assignment_id) REFERENCES public.survey_coupon_assignments(id) ON DELETE CASCADE;


--
-- Name: survey_reward_history survey_reward_history_survey_response_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_survey_response_id_fkey FOREIGN KEY (survey_response_id) REFERENCES public.survey_responses(id) ON DELETE CASCADE;


--
-- Name: survey_reward_history survey_reward_history_user_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_user_coupon_id_fkey FOREIGN KEY (user_coupon_id) REFERENCES public.user_coupons(id) ON DELETE CASCADE;


--
-- Name: survey_reward_history survey_reward_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: surveys surveys_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_audit_log user_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_audit_log
    ADD CONSTRAINT user_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_coupons user_coupons_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_coupons user_coupons_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: user_coupons user_coupons_used_by_admin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_used_by_admin_fkey FOREIGN KEY (used_by_admin) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_coupons user_coupons_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_loyalty user_loyalty_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_loyalty
    ADD CONSTRAINT user_loyalty_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.tiers(id) ON DELETE SET NULL;


--
-- Name: user_loyalty user_loyalty_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_loyalty
    ADD CONSTRAINT user_loyalty_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

