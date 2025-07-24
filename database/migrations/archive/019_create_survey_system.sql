-- Migration: Create Survey & Feedback System
-- Created: January 2025
-- Version: v2.5.0

-- Surveys table
CREATE TABLE surveys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    questions JSONB NOT NULL,
    target_segment JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    scheduled_start TIMESTAMP,
    scheduled_end TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Survey responses table
CREATE TABLE survey_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID REFERENCES surveys(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    answers JSONB NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Survey invitations table (for targeted distribution)
CREATE TABLE survey_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID REFERENCES surveys(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'started', 'completed', 'expired')),
    sent_at TIMESTAMP,
    viewed_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_surveys_status ON surveys(status);
CREATE INDEX idx_surveys_created_by ON surveys(created_by);
CREATE INDEX idx_surveys_created_at ON surveys(created_at);
CREATE INDEX idx_survey_responses_survey_id ON survey_responses(survey_id);
CREATE INDEX idx_survey_responses_user_id ON survey_responses(user_id);
CREATE INDEX idx_survey_responses_completed ON survey_responses(is_completed);
CREATE INDEX idx_survey_invitations_survey_id ON survey_invitations(survey_id);
CREATE INDEX idx_survey_invitations_user_id ON survey_invitations(user_id);
CREATE INDEX idx_survey_invitations_status ON survey_invitations(status);

-- Unique constraint for one response per user per survey
CREATE UNIQUE INDEX idx_survey_responses_unique ON survey_responses(survey_id, user_id);

-- Unique constraint for one invitation per user per survey
CREATE UNIQUE INDEX idx_survey_invitations_unique ON survey_invitations(survey_id, user_id);

-- Comments for documentation
COMMENT ON TABLE surveys IS 'Survey definitions with questions and targeting criteria';
COMMENT ON TABLE survey_responses IS 'User responses to surveys with progress tracking';
COMMENT ON TABLE survey_invitations IS 'Survey distribution tracking and invitation status';

COMMENT ON COLUMN surveys.questions IS 'JSONB array of question objects with type, text, options, required fields';
COMMENT ON COLUMN surveys.target_segment IS 'JSONB object defining customer segmentation criteria (tier, registration_date, etc.)';
COMMENT ON COLUMN survey_responses.answers IS 'JSONB object mapping question IDs to user responses';
COMMENT ON COLUMN survey_responses.progress IS 'Completion percentage (0-100) for partial responses';