-- Seed Data for Hotel Loyalty App

-- Insert default loyalty tiers
INSERT INTO tiers (id, name, description, min_points, max_points, benefits, color, icon, is_active) VALUES
(
    uuid_generate_v4(),
    'Bronze',
    'Welcome tier for new members',
    0,
    999,
    '["5% discount on dining", "Early check-in (subject to availability)", "Welcome bonus points"]',
    '#CD7F32',
    'bronze-medal',
    TRUE
),
(
    uuid_generate_v4(),
    'Silver',
    'Tier for regular guests',
    1000,
    2999,
    '["10% discount on dining", "Free WiFi", "Late check-out until 2 PM", "Priority customer service"]',
    '#C0C0C0',
    'silver-medal',
    TRUE
),
(
    uuid_generate_v4(),
    'Gold',
    'Tier for valued guests',
    3000,
    7999,
    '["15% discount on dining", "Room upgrade (subject to availability)", "Free breakfast", "Welcome amenity"]',
    '#FFD700',
    'gold-medal',
    TRUE
),
(
    uuid_generate_v4(),
    'Platinum',
    'Tier for VIP guests',
    8000,
    NULL,
    '["20% discount on dining", "Suite upgrade (subject to availability)", "Free breakfast", "Concierge service", "Airport transfer"]',
    '#E5E4E2',
    'platinum-medal',
    TRUE
);

-- Insert default points earning rules
INSERT INTO points_rules (id, name, description, type, points_per_unit, multiplier, conditions, is_active) VALUES
(
    uuid_generate_v4(),
    'Base Spending',
    'Earn 1 point per dollar spent on room bookings',
    'spend',
    1.0,
    1.0,
    '{"category": "room", "min_amount": 1}',
    TRUE
),
(
    uuid_generate_v4(),
    'Dining Spending',
    'Earn 2 points per dollar spent on dining',
    'spend',
    2.0,
    1.0,
    '{"category": "dining", "min_amount": 1}',
    TRUE
),
(
    uuid_generate_v4(),
    'Spa Spending',
    'Earn 3 points per dollar spent on spa services',
    'spend',
    3.0,
    1.0,
    '{"category": "spa", "min_amount": 1}',
    TRUE
),
(
    uuid_generate_v4(),
    'Stay Bonus',
    'Earn 100 bonus points per completed stay',
    'stay',
    100.0,
    1.0,
    '{}',
    TRUE
),
(
    uuid_generate_v4(),
    'Survey Completion',
    'Earn 50 points for completing guest satisfaction survey',
    'activity',
    50.0,
    1.0,
    '{"activity_type": "survey_completion"}',
    TRUE
),
(
    uuid_generate_v4(),
    'Social Media Share',
    'Earn 25 points for sharing on social media',
    'activity',
    25.0,
    1.0,
    '{"activity_type": "social_share"}',
    TRUE
),
(
    uuid_generate_v4(),
    'Referral Bonus',
    'Earn 500 points for successful referral',
    'activity',
    500.0,
    1.0,
    '{"activity_type": "referral"}',
    TRUE
),
(
    uuid_generate_v4(),
    'Birthday Bonus',
    'Earn 200 points on your birthday',
    'activity',
    200.0,
    1.0,
    '{"activity_type": "birthday"}',
    TRUE
);

-- Insert default redemption options
INSERT INTO redemption_options (id, name, description, category, points_cost, cash_value, availability, terms, is_active) VALUES
(
    uuid_generate_v4(),
    'Free Night Stay',
    'Redeem for one free night stay (standard room)',
    'room',
    5000,
    150.00,
    NULL,
    'Valid for standard room category only. Subject to availability. Blackout dates may apply.',
    TRUE
),
(
    uuid_generate_v4(),
    'Room Upgrade',
    'Upgrade to next room category',
    'room',
    2000,
    75.00,
    NULL,
    'Subject to availability at check-in. Valid for one category upgrade only.',
    TRUE
),
(
    uuid_generate_v4(),
    'Dining Credit $25',
    '$25 credit for hotel restaurant',
    'dining',
    1500,
    25.00,
    NULL,
    'Valid at hotel restaurant only. Cannot be combined with other offers.',
    TRUE
),
(
    uuid_generate_v4(),
    'Dining Credit $50',
    '$50 credit for hotel restaurant',
    'dining',
    2800,
    50.00,
    NULL,
    'Valid at hotel restaurant only. Cannot be combined with other offers.',
    TRUE
),
(
    uuid_generate_v4(),
    'Spa Treatment $100',
    '$100 credit for spa services',
    'spa',
    3500,
    100.00,
    NULL,
    'Valid for spa services only. Advance booking required.',
    TRUE
),
(
    uuid_generate_v4(),
    'Late Checkout',
    'Late checkout until 4 PM',
    'experience',
    800,
    20.00,
    NULL,
    'Subject to availability. Must be requested at least 24 hours in advance.',
    TRUE
),
(
    uuid_generate_v4(),
    'Welcome Amenity',
    'Fruit basket and welcome bottle of wine',
    'experience',
    1200,
    35.00,
    NULL,
    'Delivered to room upon arrival. Valid for stays of 2 nights or more.',
    TRUE
),
(
    uuid_generate_v4(),
    'Airport Transfer',
    'One-way airport transfer service',
    'experience',
    2500,
    80.00,
    NULL,
    'Advance booking required. Valid for airport transfers only.',
    TRUE
);

-- Insert sample coupons
INSERT INTO coupons (id, code, name, description, type, value, category, conditions, usage, validity, is_active) VALUES
(
    uuid_generate_v4(),
    'WELCOME20',
    'Welcome Discount',
    '20% off your first stay',
    'percentage',
    20.0,
    'room',
    '{"min_spend": 100, "max_discount": 100, "first_stay_only": true}',
    '{"max_uses": 1000, "max_uses_per_customer": 1, "current_uses": 0}',
    '{"valid_from": "2024-01-01T00:00:00Z", "valid_to": "2024-12-31T23:59:59Z"}',
    TRUE
),
(
    uuid_generate_v4(),
    'DINING15',
    'Dining Discount',
    '15% off dining',
    'percentage',
    15.0,
    'dining',
    '{"min_spend": 50}',
    '{"max_uses": 500, "max_uses_per_customer": 3, "current_uses": 0}',
    '{"valid_from": "2024-01-01T00:00:00Z", "valid_to": "2024-12-31T23:59:59Z"}',
    TRUE
),
(
    uuid_generate_v4(),
    'SPA25OFF',
    'Spa Special',
    '$25 off spa services',
    'fixed_amount',
    25.0,
    'spa',
    '{"min_spend": 100}',
    '{"max_uses": 200, "max_uses_per_customer": 2, "current_uses": 0}',
    '{"valid_from": "2024-01-01T00:00:00Z", "valid_to": "2024-12-31T23:59:59Z"}',
    TRUE
),
(
    uuid_generate_v4(),
    'FREEWIFI',
    'Free WiFi',
    'Complimentary WiFi upgrade',
    'free_item',
    0.0,
    'general',
    '{}',
    '{"max_uses": 1000, "max_uses_per_customer": 1, "current_uses": 0}',
    '{"valid_from": "2024-01-01T00:00:00Z", "valid_to": "2024-12-31T23:59:59Z"}',
    TRUE
);

-- Insert sample customer segments
INSERT INTO customer_segments (id, name, description, criteria, is_active, created_by) VALUES
(
    uuid_generate_v4(),
    'High Value Customers',
    'Customers with high lifetime value',
    '{"total_spent": {"min": 1000}, "tier": ["Gold", "Platinum"]}',
    TRUE,
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
),
(
    uuid_generate_v4(),
    'Frequent Guests',
    'Customers with multiple stays',
    '{"stay_count": {"min": 5}, "last_stay_days": {"max": 90}}',
    TRUE,
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
),
(
    uuid_generate_v4(),
    'Inactive Customers',
    'Customers who haven\'t stayed recently',
    '{"last_stay_days": {"min": 180}}',
    TRUE,
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
),
(
    uuid_generate_v4(),
    'New Members',
    'Recently joined loyalty program members',
    '{"member_since_days": {"max": 30}}',
    TRUE,
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
),
(
    uuid_generate_v4(),
    'Survey Responders',
    'Customers who actively complete surveys',
    '{"survey_completion_rate": {"min": 0.8}}',
    TRUE,
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
);

-- Insert sample survey
INSERT INTO surveys (id, title, description, questions, targeting, settings, status, created_by) VALUES
(
    uuid_generate_v4(),
    'Guest Satisfaction Survey',
    'Help us improve your experience',
    '[
        {
            "id": "overall_satisfaction",
            "type": "rating",
            "question": "How would you rate your overall experience?",
            "required": true,
            "minValue": 1,
            "maxValue": 5,
            "order": 1
        },
        {
            "id": "room_quality",
            "type": "rating",
            "question": "How would you rate the quality of your room?",
            "required": true,
            "minValue": 1,
            "maxValue": 5,
            "order": 2
        },
        {
            "id": "staff_service",
            "type": "rating",
            "question": "How would you rate the service provided by our staff?",
            "required": true,
            "minValue": 1,
            "maxValue": 5,
            "order": 3
        },
        {
            "id": "dining_experience",
            "type": "single_choice",
            "question": "Did you dine at our hotel restaurant?",
            "required": false,
            "options": ["Yes", "No"],
            "order": 4
        },
        {
            "id": "dining_satisfaction",
            "type": "rating",
            "question": "If yes, how would you rate your dining experience?",
            "required": false,
            "minValue": 1,
            "maxValue": 5,
            "order": 5
        },
        {
            "id": "recommendations",
            "type": "text",
            "question": "Any suggestions for improvement?",
            "required": false,
            "order": 6
        },
        {
            "id": "recommend_hotel",
            "type": "rating",
            "question": "How likely are you to recommend our hotel to others?",
            "required": true,
            "minValue": 1,
            "maxValue": 10,
            "order": 7
        }
    ]',
    '{"recent_stay_days": 7}',
    '{"allow_anonymous": false, "show_progress": true, "points_reward": 50, "max_responses": 1000}',
    'active',
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
);

-- Insert sample campaign
INSERT INTO campaigns (id, name, description, type, content, targeting, delivery, status, created_by) VALUES
(
    uuid_generate_v4(),
    'Welcome Campaign',
    'Welcome new loyalty members',
    'welcome',
    '{
        "title": "Welcome to our Loyalty Program!",
        "message": "Thank you for joining our loyalty program. Enjoy exclusive benefits and earn points with every stay.",
        "imageUrl": "/images/welcome-banner.jpg",
        "actionUrl": "/loyalty/benefits",
        "actionText": "View Benefits"
    }',
    '{"member_since_days": {"max": 3}}',
    '{
        "channels": ["push", "email"],
        "priority": "normal",
        "timezone": "UTC"
    }',
    'active',
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
),
(
    uuid_generate_v4(),
    'Birthday Special',
    'Birthday celebration offer',
    'promotional',
    '{
        "title": "Happy Birthday!",
        "message": "Celebrate your special day with us! Get 200 bonus points and a special birthday offer.",
        "imageUrl": "/images/birthday-banner.jpg",
        "actionUrl": "/offers/birthday",
        "actionText": "Claim Offer"
    }',
    '{"birthday_month": true}',
    '{
        "channels": ["push", "email"],
        "priority": "high",
        "timezone": "UTC"
    }',
    'active',
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
);

-- Insert sample A/B experiment
INSERT INTO ab_experiments (id, name, description, hypothesis, variants, traffic_allocation, success_metrics, status, created_by) VALUES
(
    uuid_generate_v4(),
    'Loyalty Dashboard Layout',
    'Test different layouts for the loyalty dashboard',
    'A more visual layout will increase engagement with loyalty features',
    '{
        "control": {
            "name": "Current Layout",
            "description": "Current text-based layout"
        },
        "variant_a": {
            "name": "Visual Layout",
            "description": "Image-rich visual layout with progress bars"
        }
    }',
    '{
        "control": 50,
        "variant_a": 50
    }',
    '[
        {
            "name": "points_redemption_rate",
            "description": "Percentage of users who redeem points",
            "target": "increase"
        },
        {
            "name": "time_on_dashboard",
            "description": "Average time spent on loyalty dashboard",
            "target": "increase"
        }
    ]',
    'active',
    (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1)
);

-- Function to create a demo admin user (run this separately with actual admin user)
CREATE OR REPLACE FUNCTION create_demo_admin()
RETURNS VOID AS $$
DECLARE
    admin_user_id UUID;
BEGIN
    -- Insert demo admin user
    INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, email_verified)
    VALUES (
        uuid_generate_v4(),
        'admin@hotel.com',
        crypt('admin123', gen_salt('bf')),
        'Admin',
        'User',
        TRUE,
        TRUE
    )
    RETURNING id INTO admin_user_id;
    
    -- Create admin profile
    INSERT INTO admin_users (user_id, role, permissions, is_active)
    VALUES (
        admin_user_id,
        'super_admin',
        '["manage_users", "manage_campaigns", "manage_surveys", "manage_coupons", "manage_loyalty", "view_analytics"]',
        TRUE
    );
END;
$$ LANGUAGE plpgsql;

-- Create demo customer function
CREATE OR REPLACE FUNCTION create_demo_customer(
    customer_email VARCHAR(255),
    customer_first_name VARCHAR(100),
    customer_last_name VARCHAR(100)
)
RETURNS UUID AS $$
DECLARE
    customer_user_id UUID;
    customer_profile_id UUID;
    bronze_tier_id UUID;
BEGIN
    -- Get bronze tier ID
    SELECT id INTO bronze_tier_id FROM tiers WHERE name = 'Bronze' LIMIT 1;
    
    -- Insert demo customer user
    INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, email_verified)
    VALUES (
        uuid_generate_v4(),
        customer_email,
        crypt('customer123', gen_salt('bf')),
        customer_first_name,
        customer_last_name,
        TRUE,
        TRUE
    )
    RETURNING id INTO customer_user_id;
    
    -- Create customer profile
    INSERT INTO customer_profiles (id, user_id, tier_id, points_balance, lifetime_points, total_spent, stay_count)
    VALUES (
        uuid_generate_v4(),
        customer_user_id,
        bronze_tier_id,
        250,
        250,
        150.00,
        1
    )
    RETURNING id INTO customer_profile_id;
    
    -- Add some sample points transactions
    INSERT INTO points_transactions (customer_profile_id, type, amount, description, reference_type)
    VALUES
    (customer_profile_id, 'earned', 150, 'Room booking points', 'spend'),
    (customer_profile_id, 'earned', 100, 'Stay completion bonus', 'stay');
    
    RETURN customer_profile_id;
END;
$$ LANGUAGE plpgsql;

-- Create some demo customers
-- SELECT create_demo_customer('john.doe@example.com', 'John', 'Doe');
-- SELECT create_demo_customer('jane.smith@example.com', 'Jane', 'Smith');
-- SELECT create_demo_customer('mike.johnson@example.com', 'Mike', 'Johnson');