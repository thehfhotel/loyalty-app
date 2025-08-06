-- Create notification center system for user notifications
-- This enables storing, managing, and displaying notifications to users

-- Create notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'info',
    data JSONB DEFAULT NULL,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Add constraints
ALTER TABLE notifications 
ADD CONSTRAINT chk_notification_type 
CHECK (type IN ('info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile'));

-- Add indexes for performance
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_expires_at ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- Add comments
COMMENT ON TABLE notifications IS 'User notification center - stores all notifications for users';
COMMENT ON COLUMN notifications.id IS 'Unique notification identifier';
COMMENT ON COLUMN notifications.user_id IS 'User who should receive this notification';
COMMENT ON COLUMN notifications.title IS 'Short notification title/subject';
COMMENT ON COLUMN notifications.message IS 'Full notification message content';
COMMENT ON COLUMN notifications.type IS 'Notification category for styling and filtering';
COMMENT ON COLUMN notifications.data IS 'Optional JSON data for rich notifications (links, actions, etc.)';
COMMENT ON COLUMN notifications.read_at IS 'When the user marked this notification as read (NULL = unread)';
COMMENT ON COLUMN notifications.created_at IS 'When the notification was created';
COMMENT ON COLUMN notifications.updated_at IS 'When the notification was last modified';
COMMENT ON COLUMN notifications.expires_at IS 'When the notification should be automatically removed (NULL = never expires)';

-- Create notification preferences table (for future use)
CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, type)
);

-- Add constraint for notification preferences
ALTER TABLE notification_preferences 
ADD CONSTRAINT chk_notification_preference_type 
CHECK (type IN ('info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile', 'email', 'push'));

-- Add indexes for notification preferences
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);
CREATE INDEX idx_notification_preferences_type ON notification_preferences(type);

-- Add comments for notification preferences
COMMENT ON TABLE notification_preferences IS 'User preferences for different types of notifications';
COMMENT ON COLUMN notification_preferences.user_id IS 'User whose preferences these are';
COMMENT ON COLUMN notification_preferences.type IS 'Type of notification this preference controls';
COMMENT ON COLUMN notification_preferences.enabled IS 'Whether this type of notification is enabled for the user';

-- Create function to automatically clean up expired notifications
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

-- Add comment for the cleanup function
COMMENT ON FUNCTION cleanup_expired_notifications() IS 'Removes expired notifications and returns count of deleted rows';

-- Create function to mark all notifications as read for a user
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

-- Add comment for the mark all read function
COMMENT ON FUNCTION mark_all_notifications_read(UUID) IS 'Marks all unread notifications as read for a specific user';

-- Create function to get unread notification count for a user
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

-- Add comment for the unread count function
COMMENT ON FUNCTION get_unread_notification_count(UUID) IS 'Returns count of unread, non-expired notifications for a user';

-- Insert default notification preferences for existing users
INSERT INTO notification_preferences (user_id, type, enabled)
SELECT 
    u.id as user_id,
    unnest(ARRAY['info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile']) as type,
    TRUE as enabled
FROM users u
ON CONFLICT (user_id, type) DO NOTHING;

-- Create trigger to automatically add default preferences for new users
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
        (NEW.id, 'profile', TRUE);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER trigger_create_default_notification_preferences
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_default_notification_preferences();

-- Add comment for the trigger function
COMMENT ON FUNCTION create_default_notification_preferences() IS 'Automatically creates default notification preferences when a new user is created';