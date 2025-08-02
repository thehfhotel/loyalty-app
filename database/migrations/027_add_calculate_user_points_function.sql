-- Migration: Add missing calculate_user_points function
-- This function was originally in archive/005_loyalty_system.sql but wasn't applied

-- Function to calculate points balance including expiration
CREATE OR REPLACE FUNCTION calculate_user_points(p_user_id UUID)
RETURNS TABLE(
    current_points INTEGER,
    expiring_points INTEGER,
    next_expiry_date TIMESTAMP WITH TIME ZONE
) AS $$
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
$$ language 'plpgsql';