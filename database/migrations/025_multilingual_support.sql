-- Add multi-language support for surveys and coupons

-- Translation jobs table to track translation progress
CREATE TABLE IF NOT EXISTS translation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('survey', 'coupon')),
    entity_id UUID NOT NULL,
    source_language VARCHAR(10) NOT NULL,
    target_languages JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    characters_translated INTEGER DEFAULT 0,
    provider VARCHAR(20) NOT NULL DEFAULT 'azure' CHECK (provider IN ('azure', 'google', 'libretranslate')),
    error TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Survey translations table
CREATE TABLE IF NOT EXISTS survey_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    language VARCHAR(10) NOT NULL CHECK (language IN ('th', 'en', 'zh-CN')),
    title TEXT NOT NULL,
    description TEXT,
    questions JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(survey_id, language)
);

-- Coupon translations table  
CREATE TABLE IF NOT EXISTS coupon_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    language VARCHAR(10) NOT NULL CHECK (language IN ('th', 'en', 'zh-CN')),
    name TEXT NOT NULL,
    description TEXT,
    terms_and_conditions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(coupon_id, language)
);

-- Add original language and translation metadata to surveys
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS original_language VARCHAR(10) DEFAULT 'th';
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS available_languages JSONB DEFAULT '["th"]'::jsonb;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS last_translated TIMESTAMP WITH TIME ZONE;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS translation_status VARCHAR(20) DEFAULT 'none' CHECK (translation_status IN ('none', 'pending', 'completed', 'error'));

-- Add original language and translation metadata to coupons
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS original_language VARCHAR(10) DEFAULT 'th';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS available_languages JSONB DEFAULT '["th"]'::jsonb;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS last_translated TIMESTAMP WITH TIME ZONE;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS translation_status VARCHAR(20) DEFAULT 'none' CHECK (translation_status IN ('none', 'pending', 'completed', 'error'));

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_translation_jobs_entity ON translation_jobs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_translation_jobs_status ON translation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_translation_jobs_created_by ON translation_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_survey_translations_survey_lang ON survey_translations(survey_id, language);
CREATE INDEX IF NOT EXISTS idx_coupon_translations_coupon_lang ON coupon_translations(coupon_id, language);

-- Update trigger for translation tables
CREATE OR REPLACE FUNCTION update_translation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers
DROP TRIGGER IF EXISTS trigger_survey_translations_updated_at ON survey_translations;
CREATE TRIGGER trigger_survey_translations_updated_at
    BEFORE UPDATE ON survey_translations
    FOR EACH ROW
    EXECUTE FUNCTION update_translation_updated_at();

DROP TRIGGER IF EXISTS trigger_coupon_translations_updated_at ON coupon_translations;
CREATE TRIGGER trigger_coupon_translations_updated_at
    BEFORE UPDATE ON coupon_translations
    FOR EACH ROW
    EXECUTE FUNCTION update_translation_updated_at();

DROP TRIGGER IF EXISTS trigger_translation_jobs_updated_at ON translation_jobs;
CREATE TRIGGER trigger_translation_jobs_updated_at
    BEFORE UPDATE ON translation_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_translation_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON translation_jobs TO loyalty_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_translations TO loyalty_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON coupon_translations TO loyalty_app_role;