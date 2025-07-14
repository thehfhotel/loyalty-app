-- Survey definitions
CREATE TABLE IF NOT EXISTS surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    survey_type VARCHAR(50) NOT NULL CHECK (survey_type IN ('post_stay', 'periodic', 'nps', 'service_feedback', 'welcome', 'exit')),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    trigger_conditions JSONB DEFAULT '{}', -- conditions for automatic triggering
    questions JSONB NOT NULL DEFAULT '[]', -- array of question objects
    estimated_duration INTEGER DEFAULT 5, -- in minutes
    reward_points INTEGER DEFAULT 0, -- points awarded for completion
    target_criteria JSONB DEFAULT '{}', -- who should receive this survey
    is_required BOOLEAN DEFAULT FALSE,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_survey_dates CHECK (end_date IS NULL OR end_date > start_date),
    CONSTRAINT valid_reward_points CHECK (reward_points >= 0)
);

-- Survey responses
CREATE TABLE IF NOT EXISTS survey_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL, -- if triggered by a stay
    responses JSONB NOT NULL DEFAULT '{}', -- question_id -> answer mapping
    completion_status VARCHAR(20) DEFAULT 'started' CHECK (completion_status IN ('started', 'completed', 'abandoned')),
    completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    time_spent INTEGER, -- in seconds
    ip_address INET,
    user_agent TEXT,
    
    -- Prevent duplicate responses (one per user per survey)
    UNIQUE(survey_id, user_id)
);

-- Survey analytics and insights
CREATE TABLE IF NOT EXISTS survey_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    analysis_date DATE NOT NULL,
    total_sent INTEGER DEFAULT 0,
    total_started INTEGER DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    avg_completion_time INTEGER, -- in seconds
    avg_rating DECIMAL(3,2), -- for rating questions
    nps_score DECIMAL(4,1), -- Net Promoter Score
    response_rate DECIMAL(5,2), -- completion rate percentage
    insights JSONB DEFAULT '{}', -- AI-generated insights
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One record per survey per date
    UNIQUE(survey_id, analysis_date)
);

-- Question response analytics (for detailed analysis)
CREATE TABLE IF NOT EXISTS question_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    question_id VARCHAR(100) NOT NULL, -- question identifier from survey JSON
    question_type VARCHAR(50) NOT NULL, -- rating, multiple_choice, text, nps, etc.
    analysis_date DATE NOT NULL,
    response_count INTEGER DEFAULT 0,
    response_distribution JSONB DEFAULT '{}', -- for multiple choice/rating questions
    avg_rating DECIMAL(3,2), -- for rating questions
    sentiment_score DECIMAL(3,2), -- for text questions (-1 to 1)
    common_themes JSONB DEFAULT '[]', -- extracted themes from text responses
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One record per question per survey per date
    UNIQUE(survey_id, question_id, analysis_date)
);

-- Survey invitations/notifications
CREATE TABLE IF NOT EXISTS survey_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitation_method VARCHAR(20) NOT NULL CHECK (invitation_method IN ('email', 'push', 'in_app', 'sms')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'responded', 'expired', 'failed')),
    sent_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    reminder_count INTEGER DEFAULT 0,
    last_reminder_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate invitations
    UNIQUE(survey_id, user_id, invitation_method)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_surveys_type ON surveys(survey_type);
CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys(status);
CREATE INDEX IF NOT EXISTS idx_surveys_dates ON surveys(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_surveys_active ON surveys(status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_user_id ON survey_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_status ON survey_responses(completion_status);
CREATE INDEX IF NOT EXISTS idx_survey_responses_completed_at ON survey_responses(completed_at);
CREATE INDEX IF NOT EXISTS idx_survey_responses_booking_id ON survey_responses(booking_id) WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_survey_analytics_survey_id ON survey_analytics(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_analytics_date ON survey_analytics(analysis_date);

CREATE INDEX IF NOT EXISTS idx_question_analytics_survey_id ON question_analytics(survey_id);
CREATE INDEX IF NOT EXISTS idx_question_analytics_question_id ON question_analytics(question_id);
CREATE INDEX IF NOT EXISTS idx_question_analytics_date ON question_analytics(analysis_date);

CREATE INDEX IF NOT EXISTS idx_survey_invitations_survey_id ON survey_invitations(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_invitations_user_id ON survey_invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_invitations_status ON survey_invitations(status);
CREATE INDEX IF NOT EXISTS idx_survey_invitations_expires_at ON survey_invitations(expires_at);

-- Update triggers
CREATE TRIGGER update_surveys_updated_at 
    BEFORE UPDATE ON surveys 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_survey_analytics_updated_at 
    BEFORE UPDATE ON survey_analytics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_question_analytics_updated_at 
    BEFORE UPDATE ON question_analytics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate NPS score
CREATE OR REPLACE FUNCTION calculate_nps_score(survey_id_param UUID, analysis_date_param DATE)
RETURNS DECIMAL(4,1) AS $$
DECLARE
    promoters INTEGER;
    detractors INTEGER;
    total_responses INTEGER;
    nps_score DECIMAL(4,1);
BEGIN
    -- Count promoters (score 9-10), detractors (score 0-6), and total responses
    SELECT 
        COUNT(CASE WHEN (responses->>'nps_question')::INTEGER >= 9 THEN 1 END) as promoter_count,
        COUNT(CASE WHEN (responses->>'nps_question')::INTEGER <= 6 THEN 1 END) as detractor_count,
        COUNT(*) as total_count
    INTO promoters, detractors, total_responses
    FROM survey_responses sr
    JOIN surveys s ON sr.survey_id = s.id
    WHERE sr.survey_id = survey_id_param 
    AND sr.completion_status = 'completed'
    AND DATE(sr.completed_at) = analysis_date_param
    AND responses ? 'nps_question';
    
    -- Calculate NPS score
    IF total_responses > 0 THEN
        nps_score = ((promoters - detractors)::DECIMAL / total_responses) * 100;
    ELSE
        nps_score = 0;
    END IF;
    
    RETURN nps_score;
END;
$$ LANGUAGE plpgsql;

-- Insert default survey templates
INSERT INTO surveys (title, description, survey_type, status, questions, reward_points, created_by) VALUES
('Post-Stay Satisfaction Survey', 'Collect feedback after guest checkout', 'post_stay', 'active',
'[
  {
    "id": "overall_satisfaction",
    "type": "rating",
    "question": "How would you rate your overall stay experience?",
    "required": true,
    "scale": 5
  },
  {
    "id": "nps_question",
    "type": "nps",
    "question": "How likely are you to recommend our hotel to friends or colleagues?",
    "required": true
  },
  {
    "id": "room_quality",
    "type": "rating",
    "question": "How would you rate the quality of your room?",
    "required": true,
    "scale": 5
  },
  {
    "id": "staff_service",
    "type": "rating",
    "question": "How would you rate the service provided by our staff?",
    "required": true,
    "scale": 5
  },
  {
    "id": "value_for_money",
    "type": "rating",
    "question": "How would you rate the value for money?",
    "required": true,
    "scale": 5
  },
  {
    "id": "improvement_suggestions",
    "type": "text",
    "question": "What could we do to improve your experience?",
    "required": false,
    "max_length": 500
  }
]'::jsonb, 100, (SELECT id FROM users WHERE email = 'admin@saichon.com')),

('Welcome Survey', 'Welcome new loyalty members', 'welcome', 'active',
'[
  {
    "id": "travel_frequency",
    "type": "multiple_choice",
    "question": "How often do you travel for leisure?",
    "required": true,
    "options": ["Rarely", "1-2 times per year", "3-5 times per year", "More than 5 times per year"]
  },
  {
    "id": "preferred_amenities",
    "type": "multiple_choice",
    "question": "Which amenities are most important to you?",
    "required": true,
    "multiple": true,
    "options": ["Spa", "Fitness Center", "Pool", "Restaurant", "Business Center", "Concierge"]
  },
  {
    "id": "communication_preference",
    "type": "multiple_choice",
    "question": "How would you like to receive offers and updates?",
    "required": true,
    "multiple": true,
    "options": ["Email", "Push Notifications", "SMS", "In-app Messages"]
  },
  {
    "id": "additional_comments",
    "type": "text",
    "question": "Is there anything specific you would like us to know about your preferences?",
    "required": false,
    "max_length": 300
  }
]'::jsonb, 50, (SELECT id FROM users WHERE email = 'admin@saichon.com'))
ON CONFLICT (title) DO NOTHING;