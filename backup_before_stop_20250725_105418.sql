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
-- Name: assign_coupon_to_survey(uuid, uuid, integer, integer, uuid); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.assign_coupon_to_survey(p_survey_id uuid, p_coupon_id uuid, p_award_limit integer DEFAULT NULL::integer, p_custom_expiry_days integer DEFAULT NULL::integer, p_created_by uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    assignment_id UUID;
BEGIN
    INSERT INTO survey_coupon_assignments (
        survey_id,
        coupon_id,
        award_limit,
        custom_expiry_days,
        created_by
    ) VALUES (
        p_survey_id,
        p_coupon_id,
        p_award_limit,
        p_custom_expiry_days,
        p_created_by
    )
    ON CONFLICT (survey_id, coupon_id) 
    DO UPDATE SET
        award_limit = EXCLUDED.award_limit,
        custom_expiry_days = EXCLUDED.custom_expiry_days,
        is_active = true,
        updated_at = NOW()
    RETURNING id INTO assignment_id;
    
    RETURN assignment_id;
END;
$$;


ALTER FUNCTION public.assign_coupon_to_survey(p_survey_id uuid, p_coupon_id uuid, p_award_limit integer, p_custom_expiry_days integer, p_created_by uuid) OWNER TO loyalty;

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
-- Name: award_points(uuid, integer, public.points_transaction_type, text, character varying, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.award_points(p_user_id uuid, p_points integer, p_type public.points_transaction_type, p_description text DEFAULT NULL::text, p_reference_id character varying DEFAULT NULL::character varying, p_admin_user_id uuid DEFAULT NULL::uuid, p_admin_reason text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    transaction_id UUID;
    current_total INTEGER;
BEGIN
    -- Insert the points transaction (ignoring p_expires_at per migration 016)
    INSERT INTO points_transactions (
        user_id, points, type, description, reference_id, 
        admin_user_id, admin_reason
    )
    VALUES (
        p_user_id, p_points, p_type, p_description, p_reference_id,
        p_admin_user_id, p_admin_reason
    )
    RETURNING id INTO transaction_id;
    
    -- Calculate new total (no lifetime points per migration 017)
    SELECT COALESCE(SUM(points), 0) INTO current_total
    FROM points_transactions 
    WHERE user_id = p_user_id;
    
    -- Update or insert user loyalty record (no lifetime_points per migration 017)
    INSERT INTO user_loyalty (user_id, current_points)
    VALUES (p_user_id, current_total)
    ON CONFLICT (user_id) 
    DO UPDATE SET current_points = EXCLUDED.current_points;
    
    RETURN transaction_id;
END;
$$;


ALTER FUNCTION public.award_points(p_user_id uuid, p_points integer, p_type public.points_transaction_type, p_description text, p_reference_id character varying, p_admin_user_id uuid, p_admin_reason text, p_expires_at timestamp with time zone) OWNER TO loyalty;

--
-- Name: award_survey_completion_coupons(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.award_survey_completion_coupons() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    assignment_record RECORD;
    user_coupon_id UUID;
    custom_expiry TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Only process if survey was just completed
    IF NEW.is_completed = true AND (OLD.is_completed IS NULL OR OLD.is_completed = false) THEN
        
        -- Find all active coupon assignments for this survey
        FOR assignment_record IN 
            SELECT * FROM survey_coupon_assignments 
            WHERE survey_id = NEW.survey_id 
            AND is_active = true 
            AND (award_limit IS NULL OR awards_given < award_limit)
        LOOP
            -- Calculate custom expiry if specified
            IF assignment_record.custom_expiry_days IS NOT NULL THEN
                custom_expiry := NOW() + (assignment_record.custom_expiry_days || ' days')::INTERVAL;
            ELSE
                custom_expiry := NULL;
            END IF;
            
            -- Generate QR code and assign coupon to user
            INSERT INTO user_coupons (
                user_id,
                coupon_id,
                qr_code,
                assigned_by,
                assigned_reason,
                expires_at
            ) VALUES (
                NEW.user_id,
                assignment_record.coupon_id,
                generate_qr_code(),
                assignment_record.created_by,
                'Survey completion reward',
                custom_expiry
            ) RETURNING id INTO user_coupon_id;
            
            -- Record the reward in history
            INSERT INTO survey_reward_history (
                survey_response_id,
                user_id,
                coupon_id,
                user_coupon_id,
                assignment_id
            ) VALUES (
                NEW.id,
                NEW.user_id,
                assignment_record.coupon_id,
                user_coupon_id,
                assignment_record.id
            );
            
            -- Update the awards counter
            UPDATE survey_coupon_assignments 
            SET awards_given = awards_given + 1,
                updated_at = NOW()
            WHERE id = assignment_record.id;
        END LOOP;
        
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.award_survey_completion_coupons() OWNER TO loyalty;

--
-- Name: generate_qr_code(); Type: FUNCTION; Schema: public; Owner: loyalty
--

CREATE FUNCTION public.generate_qr_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    qr_code TEXT;
    exists_check INTEGER;
BEGIN
    LOOP
        -- Generate 16-character alphanumeric code
        qr_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16));
        
        -- Check if it already exists
        SELECT COUNT(*) INTO exists_check FROM user_coupons WHERE qr_code = qr_code;
        
        -- Exit loop if unique
        EXIT WHEN exists_check = 0;
    END LOOP;
    
    RETURN qr_code;
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
    created_at timestamp with time zone DEFAULT now()
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
    award_limit integer,
    awards_given integer DEFAULT 0,
    custom_expiry_days integer,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.survey_coupon_assignments OWNER TO loyalty;

--
-- Name: survey_invitations; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_invitations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_id uuid NOT NULL,
    user_id uuid NOT NULL,
    invitation_token character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    invited_by uuid,
    invited_at timestamp with time zone DEFAULT now(),
    responded_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT survey_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying, 'expired'::character varying])::text[])))
);


ALTER TABLE public.survey_invitations OWNER TO loyalty;

--
-- Name: survey_responses; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_responses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_id uuid NOT NULL,
    user_id uuid,
    responses jsonb NOT NULL,
    is_completed boolean DEFAULT false,
    progress_percentage integer DEFAULT 0,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT survey_responses_progress_percentage_check CHECK (((progress_percentage >= 0) AND (progress_percentage <= 100)))
);


ALTER TABLE public.survey_responses OWNER TO loyalty;

--
-- Name: survey_reward_history; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.survey_reward_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    survey_response_id uuid NOT NULL,
    user_id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    user_coupon_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    awarded_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.survey_reward_history OWNER TO loyalty;

--
-- Name: surveys; Type: TABLE; Schema: public; Owner: loyalty
--

CREATE TABLE public.surveys (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    questions jsonb NOT NULL,
    target_segment jsonb DEFAULT '{}'::jsonb,
    access_type character varying(20) DEFAULT 'public'::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT surveys_access_type_check CHECK (((access_type)::text = ANY ((ARRAY['public'::character varying, 'invite_only'::character varying])::text[]))),
    CONSTRAINT surveys_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'paused'::character varying, 'closed'::character varying])::text[])))
);


ALTER TABLE public.surveys OWNER TO loyalty;

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
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_loyalty OWNER TO loyalty;

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
    reception_id character varying(8) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_profiles OWNER TO loyalty;

--
-- Name: user_tier_info; Type: VIEW; Schema: public; Owner: loyalty
--

CREATE VIEW public.user_tier_info AS
 SELECT ul.user_id,
    ul.current_points,
    t.name AS tier_name,
    t.color AS tier_color,
    t.benefits AS tier_benefits,
    t.sort_order AS tier_level,
        CASE
            WHEN (next_tier.min_points IS NOT NULL) THEN round(((((ul.current_points - t.min_points))::numeric / ((next_tier.min_points - t.min_points))::numeric) * (100)::numeric), 2)
            ELSE 100.0
        END AS progress_percentage,
    next_tier.min_points AS next_tier_points,
    next_tier.name AS next_tier_name,
    (next_tier.min_points - ul.current_points) AS points_to_next_tier
   FROM ((public.user_loyalty ul
     LEFT JOIN public.tiers t ON ((ul.tier_id = t.id)))
     LEFT JOIN public.tiers next_tier ON (((next_tier.sort_order = (t.sort_order + 1)) AND (next_tier.is_active = true))))
  WHERE ((t.is_active = true) OR (t.is_active IS NULL));


ALTER TABLE public.user_tier_info OWNER TO loyalty;

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
-- Data for Name: coupon_redemptions; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.coupon_redemptions (id, user_coupon_id, original_amount, discount_amount, final_amount, currency, transaction_reference, redemption_channel, staff_member_id, location, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: coupons; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.coupons (id, code, name, description, terms_and_conditions, type, value, currency, minimum_spend, maximum_discount, valid_from, valid_until, usage_limit, usage_limit_per_user, used_count, tier_restrictions, customer_segment, status, created_by, created_at, updated_at) FROM stdin;
ca835ce4-924a-46e6-bea8-a6a1766371f6	WELCOME10	Welcome 10% Off	Get 10% off your first stay	Valid for first-time guests only. Cannot be combined with other offers.	percentage	10.00	USD	100.00	50.00	2025-07-24 21:01:56.56607+00	2026-01-24 21:01:56.56607+00	1000	1	0	[]	{}	active	\N	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
1604a1f4-5d7a-44b0-a1c0-62eab347bcb9	LOYALTY50	Loyalty $50 Off	Loyalty members get $50 off	Valid for stays of 2 nights or more. Available to Silver tier and above.	fixed_amount	50.00	USD	200.00	\N	2025-07-24 21:01:56.56607+00	2025-10-24 21:01:56.56607+00	500	2	0	[]	{}	active	\N	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
0e8c85ca-c622-4284-bf7c-61b778f3ee71	UPGRADE	Free Room Upgrade	Complimentary room upgrade	Subject to availability. Valid for Gold and Platinum members only.	free_upgrade	0.00	USD	\N	\N	2025-07-24 21:01:56.56607+00	2026-07-24 21:01:56.56607+00	100	1	0	[]	{}	active	\N	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
\.


--
-- Data for Name: feature_toggle_audit; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.feature_toggle_audit (id, feature_toggle_id, previous_state, new_state, changed_by, changed_at, reason, ip_address, user_agent) FROM stdin;
\.


--
-- Data for Name: feature_toggles; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.feature_toggles (id, feature_key, feature_name, description, is_enabled, created_at, updated_at, created_by, updated_by) FROM stdin;
0bcdaf26-99ae-4db5-80bf-60e6eba87272	account_linking	Account Linking	Allow users to link multiple authentication methods to a single account	t	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00	\N	\N
f438e6ce-afa0-4139-ad15-a7c2d406f133	facebook_oauth	Facebook Social Login	Enable login and registration via Facebook OAuth	f	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00	\N	\N
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
7cde3e7f-8487-4585-a2b8-9f8dcc4d7031	Standard Earning	Standard points earning rate for hotel stays	10.00	currency	{"Gold": 1.5, "Bronze": 1.0, "Silver": 1.25, "Platinum": 2.0}	t	2025-07-24 21:01:56.56607+00	\N	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
\.


--
-- Data for Name: points_transactions; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.points_transactions (id, user_id, points, type, description, reference_id, admin_user_id, admin_reason, created_at) FROM stdin;
\.


--
-- Data for Name: reception_id_sequence; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.reception_id_sequence (id, current_user_count, created_at, updated_at) FROM stdin;
1	2	2025-07-24 21:01:56.56607+00	2025-07-25 01:19:55.221077+00
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.refresh_tokens (id, user_id, token, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: survey_coupon_assignments; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_coupon_assignments (id, survey_id, coupon_id, award_limit, awards_given, custom_expiry_days, is_active, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: survey_invitations; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_invitations (id, survey_id, user_id, invitation_token, status, invited_by, invited_at, responded_at, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: survey_responses; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_responses (id, survey_id, user_id, responses, is_completed, progress_percentage, started_at, completed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: survey_reward_history; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.survey_reward_history (id, survey_response_id, user_id, coupon_id, user_coupon_id, assignment_id, awarded_at, created_at) FROM stdin;
\.


--
-- Data for Name: surveys; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.surveys (id, title, description, questions, target_segment, access_type, status, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tiers; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.tiers (id, name, min_points, benefits, color, sort_order, is_active, created_at, updated_at) FROM stdin;
9438eb3a-ce14-41c5-8a5f-a6acde8ee6f6	Bronze	0	{"perks": ["Free WiFi", "Welcome drink", "Priority check-in"], "description": "Welcome to our loyalty program"}	#CD7F32	1	t	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
f7993239-396e-4672-a915-70f4a45d0092	Silver	5000	{"perks": ["All Bronze benefits", "Room upgrade (subject to availability)", "Late checkout until 2 PM", "10% discount on dining"], "description": "Enjoy enhanced benefits"}	#C0C0C0	2	t	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
64cbc3f6-7428-4da8-8e22-7626aeff8bc0	Gold	15000	{"perks": ["All Silver benefits", "Guaranteed room upgrade", "Late checkout until 4 PM", "15% discount on dining", "Access to executive lounge"], "description": "Premium experiences await"}	#FFD700	3	t	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
67537525-e089-4a7d-a772-75bb8507b9b7	Platinum	35000	{"perks": ["All Gold benefits", "Suite upgrade (subject to availability)", "24-hour late checkout", "20% discount on dining", "Priority restaurant reservations", "Complimentary breakfast", "Personal concierge service"], "description": "Ultimate luxury and exclusivity"}	#E5E4E2	4	t	2025-07-24 21:01:56.56607+00	2025-07-24 21:01:56.56607+00
\.


--
-- Data for Name: user_audit_log; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_audit_log (id, user_id, action, details, ip_address, user_agent, created_at) FROM stdin;
9d7db171-e08e-4ce5-a221-0644ee774c5d	51e98f63-66e3-4b1a-b08f-cfa728c59683	register	{"email": "nut.winut@gmail.com"}	\N	\N	2025-07-25 01:19:55.129778+00
b87f8c2b-0048-4610-8f2a-20b1bd497be2	51e98f63-66e3-4b1a-b08f-cfa728c59683	logout	{}	\N	\N	2025-07-25 01:19:57.870095+00
de8eaa1d-2436-4969-af5e-6ff59bf9e093	51e98f63-66e3-4b1a-b08f-cfa728c59683	login	{"email": "nut.winut@gmail.com"}	\N	\N	2025-07-25 01:20:12.925441+00
8b51fe8b-d97a-49e2-bafc-dce00c0346cc	51e98f63-66e3-4b1a-b08f-cfa728c59683	logout	{}	\N	\N	2025-07-25 01:20:14.697137+00
9302b94b-f921-438f-a9a0-63de06d0f346	51e98f63-66e3-4b1a-b08f-cfa728c59683	login	{"email": "nut.winut@gmail.com"}	\N	\N	2025-07-25 03:10:14.749521+00
68b95888-81ff-4486-9ae5-e2673465f591	51e98f63-66e3-4b1a-b08f-cfa728c59683	logout	{}	\N	\N	2025-07-25 03:10:41.237531+00
\.


--
-- Data for Name: user_coupons; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_coupons (id, user_id, coupon_id, status, qr_code, used_at, used_by_admin, redemption_location, redemption_details, assigned_by, assigned_reason, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_loyalty; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_loyalty (user_id, current_points, tier_id, tier_updated_at, points_updated_at, created_at, updated_at) FROM stdin;
51e98f63-66e3-4b1a-b08f-cfa728c59683	0	9438eb3a-ce14-41c5-8a5f-a6acde8ee6f6	2025-07-25 01:19:55.245267+00	2025-07-25 01:19:55.245267+00	2025-07-25 01:19:55.245267+00	2025-07-25 01:19:55.245267+00
\.


--
-- Data for Name: user_profiles; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.user_profiles (user_id, first_name, last_name, phone, date_of_birth, preferences, avatar_url, reception_id, created_at, updated_at) FROM stdin;
288c01d0-8876-4fee-a5d2-a447dd093842	winut	j	\N	\N	{}	\N	00000001	2025-07-24 21:15:36.809311+00	2025-07-24 21:15:36.809311+00
51e98f63-66e3-4b1a-b08f-cfa728c59683	Winut	Jiraruekmongkol	nut.winut@gmail.com	\N	{}	\N	26900021	2025-07-25 01:19:55.129778+00	2025-07-25 01:19:55.129778+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: loyalty
--

COPY public.users (id, email, password_hash, role, is_active, email_verified, created_at, updated_at, oauth_provider, oauth_provider_id) FROM stdin;
288c01d0-8876-4fee-a5d2-a447dd093842	winut.hf@gmail.com		customer	t	t	2025-07-24 21:11:56.540458+00	2025-07-24 21:11:56.540458+00	google	118027276707295271060
51e98f63-66e3-4b1a-b08f-cfa728c59683	nut.winut@gmail.com	$2a$10$eWLT0fgz7c7yInfQzxfXT.x0e7MjWkr2AGb1w1UxXoH/t6D.RAJoe	customer	t	f	2025-07-25 01:19:55.129778+00	2025-07-25 01:19:55.129778+00	\N	\N
\.


--
-- Name: reception_id_sequence_id_seq; Type: SEQUENCE SET; Schema: public; Owner: loyalty
--

SELECT pg_catalog.setval('public.reception_id_sequence_id_seq', 33, true);


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
    ADD CONSTRAINT survey_coupon_assignments_survey_id_coupon_id_key UNIQUE (survey_id, coupon_id);


--
-- Name: survey_invitations survey_invitations_invitation_token_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_invitation_token_key UNIQUE (invitation_token);


--
-- Name: survey_invitations survey_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_pkey PRIMARY KEY (id);


--
-- Name: survey_invitations survey_invitations_survey_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_survey_id_user_id_key UNIQUE (survey_id, user_id);


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
-- Name: user_profiles user_profiles_reception_id_key; Type: CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_reception_id_key UNIQUE (reception_id);


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
-- Name: idx_survey_coupon_assignments_survey_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_coupon_assignments_survey_id ON public.survey_coupon_assignments USING btree (survey_id);


--
-- Name: idx_survey_invitations_survey_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_invitations_survey_id ON public.survey_invitations USING btree (survey_id);


--
-- Name: idx_survey_invitations_token; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_invitations_token ON public.survey_invitations USING btree (invitation_token);


--
-- Name: idx_survey_invitations_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_invitations_user_id ON public.survey_invitations USING btree (user_id);


--
-- Name: idx_survey_responses_survey_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_responses_survey_id ON public.survey_responses USING btree (survey_id);


--
-- Name: idx_survey_responses_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_responses_user_id ON public.survey_responses USING btree (user_id);


--
-- Name: idx_survey_reward_history_user_id; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_survey_reward_history_user_id ON public.survey_reward_history USING btree (user_id);


--
-- Name: idx_surveys_access_type; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_access_type ON public.surveys USING btree (access_type);


--
-- Name: idx_surveys_status; Type: INDEX; Schema: public; Owner: loyalty
--

CREATE INDEX idx_surveys_status ON public.surveys USING btree (status);


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

CREATE INDEX idx_user_profiles_reception_id ON public.user_profiles USING btree (reception_id);


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
-- Name: survey_responses survey_completion_coupon_award; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER survey_completion_coupon_award AFTER UPDATE ON public.survey_responses FOR EACH ROW EXECUTE FUNCTION public.award_survey_completion_coupons();


--
-- Name: feature_toggles trigger_feature_toggle_audit; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER trigger_feature_toggle_audit AFTER UPDATE ON public.feature_toggles FOR EACH ROW EXECUTE FUNCTION public.audit_feature_toggle_changes();


--
-- Name: account_link_requests update_account_link_requests_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_account_link_requests_updated_at BEFORE UPDATE ON public.account_link_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: coupons update_coupons_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: feature_toggles update_feature_toggles_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_feature_toggles_updated_at BEFORE UPDATE ON public.feature_toggles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: points_earning_rules update_points_earning_rules_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_points_earning_rules_updated_at BEFORE UPDATE ON public.points_earning_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reception_id_sequence update_reception_id_sequence_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_reception_id_sequence_updated_at BEFORE UPDATE ON public.reception_id_sequence FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: survey_coupon_assignments update_survey_coupon_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_survey_coupon_assignments_updated_at BEFORE UPDATE ON public.survey_coupon_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: survey_invitations update_survey_invitations_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_survey_invitations_updated_at BEFORE UPDATE ON public.survey_invitations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: survey_responses update_survey_responses_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_survey_responses_updated_at BEFORE UPDATE ON public.survey_responses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: surveys update_surveys_updated_at; Type: TRIGGER; Schema: public; Owner: loyalty
--

CREATE TRIGGER update_surveys_updated_at BEFORE UPDATE ON public.surveys FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


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
-- Name: survey_coupon_assignments survey_coupon_assignments_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: survey_coupon_assignments survey_coupon_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: survey_coupon_assignments survey_coupon_assignments_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_coupon_assignments
    ADD CONSTRAINT survey_coupon_assignments_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON DELETE CASCADE;


--
-- Name: survey_invitations survey_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_invitations
    ADD CONSTRAINT survey_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


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
    ADD CONSTRAINT survey_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: survey_reward_history survey_reward_history_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.survey_coupon_assignments(id) ON DELETE CASCADE;


--
-- Name: survey_reward_history survey_reward_history_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: loyalty
--

ALTER TABLE ONLY public.survey_reward_history
    ADD CONSTRAINT survey_reward_history_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


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

