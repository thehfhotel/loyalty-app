-- Feature Toggles Schema
-- This migration creates the feature toggle system for managing feature flags

-- Create feature_toggles table
CREATE TABLE IF NOT EXISTS feature_toggles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feature_key VARCHAR(100) UNIQUE NOT NULL,
    feature_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

-- Create feature_toggle_audit table for tracking changes
CREATE TABLE IF NOT EXISTS feature_toggle_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feature_toggle_id UUID NOT NULL REFERENCES feature_toggles(id) ON DELETE CASCADE,
    previous_state BOOLEAN,
    new_state BOOLEAN NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reason TEXT,
    ip_address INET,
    user_agent TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_feature_toggles_key ON feature_toggles(feature_key);
CREATE INDEX IF NOT EXISTS idx_feature_toggles_enabled ON feature_toggles(is_enabled);
CREATE INDEX IF NOT EXISTS idx_feature_toggle_audit_feature_id ON feature_toggle_audit(feature_toggle_id);
CREATE INDEX IF NOT EXISTS idx_feature_toggle_audit_changed_at ON feature_toggle_audit(changed_at);

-- Insert initial feature toggles
INSERT INTO feature_toggles (feature_key, feature_name, description, is_enabled) VALUES 
    ('account_linking', 'Account Linking', 'Allow users to link multiple authentication methods to a single account', true),
    ('facebook_oauth', 'Facebook Social Login', 'Enable login and registration via Facebook OAuth', false)
ON CONFLICT (feature_key) DO NOTHING;

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_feature_toggle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic timestamp update
DROP TRIGGER IF EXISTS trigger_feature_toggle_updated_at ON feature_toggles;
CREATE TRIGGER trigger_feature_toggle_updated_at
    BEFORE UPDATE ON feature_toggles
    FOR EACH ROW
    EXECUTE FUNCTION update_feature_toggle_updated_at();

-- Create function to automatically create audit entries
CREATE OR REPLACE FUNCTION audit_feature_toggle_changes()
RETURNS TRIGGER AS $$
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
$$ language 'plpgsql';

-- Create trigger for automatic audit logging
DROP TRIGGER IF EXISTS trigger_feature_toggle_audit ON feature_toggles;
CREATE TRIGGER trigger_feature_toggle_audit
    AFTER UPDATE ON feature_toggles
    FOR EACH ROW
    EXECUTE FUNCTION audit_feature_toggle_changes();