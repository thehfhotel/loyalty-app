-- Migration: Add missing stored procedures
-- This migration adds stored procedures that were defined in 0_init but not applied to production
-- All functions use CREATE OR REPLACE for idempotency

-- ========================================
-- NIGHTS-BASED TIER SYSTEM STORED PROCEDURES
-- ========================================

CREATE OR REPLACE FUNCTION recalculate_user_tier_by_nights(p_user_id UUID)
RETURNS TABLE (
  new_tier_id UUID,
  new_tier_name VARCHAR(50),
  tier_changed BOOLEAN
) AS $$
DECLARE
  v_total_nights INTEGER;
  v_current_tier_id UUID;
  v_new_tier_id UUID;
  v_new_tier_name VARCHAR(50);
  v_tier_changed BOOLEAN := FALSE;
BEGIN
  SELECT ul.total_nights, ul.tier_id
  INTO v_total_nights, v_current_tier_id
  FROM user_loyalty ul
  WHERE ul.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User loyalty record not found for user_id: %', p_user_id;
  END IF;

  SELECT t.id, t.name
  INTO v_new_tier_id, v_new_tier_name
  FROM tiers t
  WHERE t.is_active = TRUE
    AND t.min_nights <= v_total_nights
  ORDER BY t.min_nights DESC, t.sort_order DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT t.id, t.name
    INTO v_new_tier_id, v_new_tier_name
    FROM tiers t
    WHERE t.is_active = TRUE
    ORDER BY t.sort_order ASC
    LIMIT 1;
  END IF;

  IF v_current_tier_id IS DISTINCT FROM v_new_tier_id THEN
    v_tier_changed := TRUE;

    UPDATE user_loyalty
    SET tier_id = v_new_tier_id,
        tier_updated_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_audit_log') THEN
      INSERT INTO user_audit_log (user_id, action, details, created_at)
      VALUES (
        p_user_id,
        'tier_upgrade_by_nights',
        jsonb_build_object(
          'old_tier_id', v_current_tier_id,
          'new_tier_id', v_new_tier_id,
          'new_tier_name', v_new_tier_name,
          'total_nights', v_total_nights,
          'upgrade_reason', 'nights_threshold_met'
        ),
        NOW()
      );
    END IF;
  END IF;

  RETURN QUERY SELECT v_new_tier_id, v_new_tier_name, v_tier_changed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_user_tier_by_nights IS 'Recalculates and updates user tier based on total_nights';

-- ========================================
-- AWARD POINTS FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION award_points(
    p_user_id UUID,
    p_points INTEGER,
    p_transaction_type VARCHAR(50),
    p_description TEXT DEFAULT NULL,
    p_reference_id VARCHAR(100) DEFAULT NULL,
    p_admin_user_id UUID DEFAULT NULL,
    p_admin_reason TEXT DEFAULT NULL,
    p_nights_stayed INTEGER DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
    v_new_points INTEGER;
    v_transaction_id UUID;
BEGIN
    INSERT INTO points_transactions (
        user_id, points, type, description, reference_id,
        admin_user_id, admin_reason, nights_stayed, created_at
    ) VALUES (
        p_user_id, p_points, p_transaction_type::points_transaction_type,
        p_description, p_reference_id, p_admin_user_id, p_admin_reason,
        p_nights_stayed, NOW()
    ) RETURNING id INTO v_transaction_id;

    UPDATE user_loyalty
    SET current_points = current_points + p_points,
        total_nights = COALESCE(total_nights, 0) + p_nights_stayed,
        points_updated_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING current_points INTO v_new_points;

    IF p_nights_stayed > 0 THEN
        PERFORM recalculate_user_tier_by_nights(p_user_id);
    END IF;

    RETURN jsonb_build_object(
        'transaction_id', v_transaction_id,
        'new_points_balance', v_new_points,
        'nights_added', p_nights_stayed
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION award_points IS 'Awards points to a user and updates their total_nights';

-- ========================================
-- NOTIFICATION FUNCTIONS
-- ========================================

CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications
    WHERE expires_at IS NOT NULL AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_notifications() IS 'Removes expired notifications';

CREATE OR REPLACE FUNCTION mark_all_notifications_read(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE notifications
    SET read_at = NOW(), updated_at = NOW()
    WHERE user_id = target_user_id AND read_at IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_all_notifications_read(UUID) IS 'Marks all unread notifications as read';

CREATE OR REPLACE FUNCTION get_unread_notification_count(target_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM notifications
        WHERE user_id = target_user_id
        AND read_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_unread_notification_count(UUID) IS 'Returns count of unread notifications';

CREATE OR REPLACE FUNCTION create_default_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notification_preferences (user_id, type, enabled)
    VALUES
        (NEW.id, 'info', TRUE),
        (NEW.id, 'success', TRUE),
        (NEW.id, 'warning', TRUE),
        (NEW.id, 'error', TRUE),
        (NEW.id, 'system', TRUE),
        (NEW.id, 'reward', TRUE),
        (NEW.id, 'coupon', TRUE),
        (NEW.id, 'survey', TRUE),
        (NEW.id, 'profile', TRUE),
        (NEW.id, 'tier_change', TRUE),
        (NEW.id, 'points', TRUE);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_default_notification_preferences() IS 'Creates default notification preferences for new users';

-- ========================================
-- COUPON SYSTEM FUNCTIONS
-- ========================================

CREATE OR REPLACE FUNCTION generate_qr_code()
RETURNS TEXT AS $$
DECLARE
    qr_code TEXT;
    exists_check INTEGER;
BEGIN
    LOOP
        qr_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16));
        SELECT COUNT(*) INTO exists_check FROM user_coupons WHERE qr_code = qr_code;
        EXIT WHEN exists_check = 0;
    END LOOP;
    RETURN qr_code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_qr_code() IS 'Generates a unique 16-character QR code';

CREATE OR REPLACE FUNCTION set_qr_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.qr_code IS NULL OR NEW.qr_code = '' THEN
        NEW.qr_code := generate_qr_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_qr_code() IS 'Trigger function to auto-generate QR code';

CREATE OR REPLACE FUNCTION assign_coupon_to_user(
    p_coupon_id UUID,
    p_user_id UUID,
    p_assigned_by UUID DEFAULT NULL,
    p_assigned_reason TEXT DEFAULT NULL,
    p_custom_expiry TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    user_coupon_id UUID;
    coupon_record RECORD;
    user_usage_count INTEGER;
    expiry_date TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT * INTO coupon_record FROM coupons WHERE id = p_coupon_id AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon not found or not active';
    END IF;

    IF coupon_record.valid_until IS NOT NULL AND coupon_record.valid_until < NOW() THEN
        RAISE EXCEPTION 'Coupon has expired';
    END IF;

    IF coupon_record.usage_limit IS NOT NULL AND coupon_record.used_count >= coupon_record.usage_limit THEN
        RAISE EXCEPTION 'Coupon usage limit exceeded';
    END IF;

    SELECT COUNT(*) INTO user_usage_count
    FROM user_coupons
    WHERE coupon_id = p_coupon_id AND user_id = p_user_id AND status != 'revoked';

    IF coupon_record.usage_limit_per_user IS NOT NULL AND user_usage_count >= coupon_record.usage_limit_per_user THEN
        RAISE EXCEPTION 'User usage limit exceeded for this coupon';
    END IF;

    expiry_date := COALESCE(p_custom_expiry, coupon_record.valid_until);

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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assign_coupon_to_user(UUID, UUID, UUID, TEXT, TIMESTAMP WITH TIME ZONE) IS 'Assigns a coupon to a user with validation';

CREATE OR REPLACE FUNCTION redeem_coupon(
    p_qr_code TEXT,
    p_original_amount DECIMAL(10,2),
    p_redeemed_by_admin UUID DEFAULT NULL,
    p_transaction_reference VARCHAR(255) DEFAULT NULL,
    p_location VARCHAR(255) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    discount_amount DECIMAL(10,2),
    final_amount DECIMAL(10,2),
    user_coupon_id UUID
) AS $$
DECLARE
    user_coupon_record RECORD;
    calculated_discount DECIMAL(10,2);
    final_amount_calc DECIMAL(10,2);
    redemption_id UUID;
BEGIN
    SELECT uc.id as uc_id, uc.status as uc_status, uc.expires_at as uc_expires_at,
           c.type, c.value, c.currency, c.minimum_spend, c.maximum_discount, c.id as coupon_id
    INTO user_coupon_record
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.qr_code = p_qr_code;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Invalid QR code'::TEXT, 0.00::DECIMAL(10,2), p_original_amount, NULL::UUID;
        RETURN;
    END IF;

    IF user_coupon_record.uc_status != 'available' THEN
        RETURN QUERY SELECT false, 'Coupon is not available for use'::TEXT, 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.uc_id;
        RETURN;
    END IF;

    IF user_coupon_record.uc_expires_at IS NOT NULL AND user_coupon_record.uc_expires_at < NOW() THEN
        UPDATE user_coupons SET status = 'expired' WHERE id = user_coupon_record.uc_id;
        RETURN QUERY SELECT false, 'Coupon has expired'::TEXT, 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.uc_id;
        RETURN;
    END IF;

    IF user_coupon_record.minimum_spend IS NOT NULL AND p_original_amount < user_coupon_record.minimum_spend THEN
        RETURN QUERY SELECT false, format('Minimum spend of %s required', user_coupon_record.minimum_spend)::TEXT, 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.uc_id;
        RETURN;
    END IF;

    CASE user_coupon_record.type
        WHEN 'percentage' THEN
            calculated_discount := p_original_amount * (user_coupon_record.value / 100);
            IF user_coupon_record.maximum_discount IS NOT NULL AND calculated_discount > user_coupon_record.maximum_discount THEN
                calculated_discount := user_coupon_record.maximum_discount;
            END IF;
        WHEN 'fixed_amount' THEN
            calculated_discount := LEAST(user_coupon_record.value, p_original_amount);
        WHEN 'bogo' THEN
            calculated_discount := p_original_amount * 0.5;
        ELSE
            calculated_discount := p_original_amount * (user_coupon_record.value / 100);
    END CASE;

    final_amount_calc := GREATEST(0, p_original_amount - calculated_discount);

    UPDATE user_coupons
    SET
        status = 'used',
        used_at = NOW(),
        used_by_admin = p_redeemed_by_admin,
        redemption_location = p_location
    WHERE id = user_coupon_record.uc_id;

    UPDATE coupons
    SET used_count = used_count + 1
    WHERE id = user_coupon_record.coupon_id;

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
        user_coupon_record.uc_id,
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

    RETURN QUERY SELECT true, 'Coupon redeemed successfully'::TEXT, calculated_discount, final_amount_calc, user_coupon_record.uc_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION redeem_coupon(TEXT, DECIMAL, UUID, VARCHAR, VARCHAR, JSONB) IS 'Redeems a coupon by QR code';

CREATE OR REPLACE FUNCTION update_coupon_analytics(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
DECLARE
    processed_count INTEGER := 0;
    coupon_record RECORD;
BEGIN
    FOR coupon_record IN SELECT id FROM coupons LOOP
        INSERT INTO coupon_analytics (
            coupon_id,
            analytics_date,
            total_assigned,
            total_used,
            total_expired,
            unique_users_assigned,
            unique_users_redeemed,
            conversion_rate
        )
        SELECT
            coupon_record.id,
            p_date,
            COUNT(*) FILTER (WHERE DATE(uc.created_at) <= p_date),
            COUNT(*) FILTER (WHERE uc.status = 'used' AND DATE(uc.used_at) <= p_date),
            COUNT(*) FILTER (WHERE uc.status = 'expired' AND DATE(uc.updated_at) <= p_date),
            COUNT(DISTINCT uc.user_id) FILTER (WHERE DATE(uc.created_at) <= p_date),
            COUNT(DISTINCT uc.user_id) FILTER (WHERE uc.status = 'used' AND DATE(uc.used_at) <= p_date),
            CASE
                WHEN COUNT(*) FILTER (WHERE DATE(uc.created_at) <= p_date) > 0 THEN
                    ROUND(
                        (COUNT(*) FILTER (WHERE uc.status = 'used' AND DATE(uc.used_at) <= p_date)::DECIMAL /
                         COUNT(*) FILTER (WHERE DATE(uc.created_at) <= p_date) * 100),
                        2
                    )
                ELSE 0
            END
        FROM user_coupons uc
        WHERE uc.coupon_id = coupon_record.id
        ON CONFLICT (coupon_id, analytics_date)
        DO UPDATE SET
            total_assigned = EXCLUDED.total_assigned,
            total_used = EXCLUDED.total_used,
            total_expired = EXCLUDED.total_expired,
            unique_users_assigned = EXCLUDED.unique_users_assigned,
            unique_users_redeemed = EXCLUDED.unique_users_redeemed,
            conversion_rate = EXCLUDED.conversion_rate;

        processed_count := processed_count + 1;
    END LOOP;

    RETURN processed_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_coupon_analytics(DATE) IS 'Updates daily analytics for all coupons';

-- ========================================
-- SURVEY COUPON REWARD FUNCTIONS
-- ========================================

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
    SELECT EXISTS(SELECT 1 FROM surveys WHERE id = p_survey_id) INTO survey_exists;
    IF NOT survey_exists THEN
        RAISE EXCEPTION 'Survey not found';
    END IF;

    SELECT EXISTS(SELECT 1 FROM coupons WHERE id = p_coupon_id AND status = 'active') INTO coupon_exists;
    IF NOT coupon_exists THEN
        RAISE EXCEPTION 'Coupon not found or not active';
    END IF;

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

COMMENT ON FUNCTION assign_coupon_to_survey(UUID, UUID, UUID, VARCHAR, INTEGER, INTEGER, TEXT) IS 'Assigns a coupon to be awarded upon survey completion';

CREATE OR REPLACE FUNCTION remove_coupon_from_survey(
    p_survey_id UUID,
    p_coupon_id UUID,
    p_removed_by UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    assignment_found BOOLEAN := FALSE;
BEGIN
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

COMMENT ON FUNCTION remove_coupon_from_survey(UUID, UUID, UUID) IS 'Deactivates a coupon assignment from a survey';

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
    SELECT sr.*, s.id as survey_id, s.title as survey_title
    INTO response_record
    FROM survey_responses sr
    JOIN surveys s ON sr.survey_id = s.id
    WHERE sr.id = p_survey_response_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Survey response not found';
    END IF;

    IF NOT response_record.is_completed THEN
        RETURN 0;
    END IF;

    FOR assignment_record IN
        SELECT sca.*, c.name as coupon_name, c.code as coupon_code
        FROM survey_coupon_assignments sca
        JOIN coupons c ON sca.coupon_id = c.id
        WHERE sca.survey_id = response_record.survey_id
            AND sca.is_active = TRUE
            AND c.status = 'active'
            AND (sca.max_awards IS NULL OR sca.awarded_count < sca.max_awards)
    LOOP
        IF EXISTS(
            SELECT 1 FROM survey_reward_history
            WHERE survey_coupon_assignment_id = assignment_record.id
                AND user_id = response_record.user_id
        ) THEN
            CONTINUE;
        END IF;

        custom_expiry := NULL;
        IF assignment_record.custom_expiry_days IS NOT NULL THEN
            custom_expiry := NOW() + (assignment_record.custom_expiry_days || ' days')::INTERVAL;
        END IF;

        BEGIN
            SELECT assign_coupon_to_user(
                assignment_record.coupon_id,
                response_record.user_id,
                NULL,
                'Survey completion: ' || response_record.survey_title,
                custom_expiry
            ) INTO user_coupon_id;

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

            UPDATE survey_coupon_assignments
            SET awarded_count = awarded_count + 1
            WHERE id = assignment_record.id;

            awards_given := awards_given + 1;

        EXCEPTION
            WHEN OTHERS THEN
                RAISE WARNING 'Failed to award coupon % to user %: %',
                    assignment_record.coupon_code, response_record.user_id, SQLERRM;
        END;
    END LOOP;

    RETURN awards_given;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION award_survey_completion_coupons(UUID) IS 'Awards coupons when a survey is completed';

CREATE OR REPLACE FUNCTION trigger_award_survey_coupons()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_completed = TRUE AND (OLD.is_completed IS NULL OR OLD.is_completed = FALSE) THEN
        PERFORM award_survey_completion_coupons(NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_award_survey_coupons() IS 'Trigger function to award coupons on survey completion';

-- ========================================
-- UTILITY FUNCTIONS
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 'Generic trigger to update updated_at timestamp';

-- ========================================
-- CREATE TRIGGERS (if not exist)
-- ========================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'generate_qr_code_trigger') THEN
        CREATE TRIGGER generate_qr_code_trigger
            BEFORE INSERT ON user_coupons
            FOR EACH ROW
            EXECUTE FUNCTION set_qr_code();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_create_default_notification_preferences') THEN
        CREATE TRIGGER trigger_create_default_notification_preferences
            AFTER INSERT ON users
            FOR EACH ROW
            EXECUTE FUNCTION create_default_notification_preferences();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'survey_completion_reward_trigger') THEN
        CREATE TRIGGER survey_completion_reward_trigger
            AFTER UPDATE ON survey_responses
            FOR EACH ROW
            EXECUTE FUNCTION trigger_award_survey_coupons();
    END IF;
END $$;
