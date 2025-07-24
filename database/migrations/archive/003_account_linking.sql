-- Account linking system for connecting multiple authentication methods to single user account

-- Account link requests table
CREATE TABLE account_link_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_email VARCHAR(255) NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('link_to_email', 'link_to_existing')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days'
);

-- Linked accounts table - tracks which accounts are linked together
CREATE TABLE linked_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    primary_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    linked_by UUID REFERENCES users(id),
    UNIQUE(primary_user_id, linked_user_id),
    -- Prevent circular linking
    CHECK (primary_user_id != linked_user_id)
);

-- Account linking audit log
CREATE TABLE account_linking_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    target_email VARCHAR(255),
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID REFERENCES account_link_requests(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_account_link_requests_requester ON account_link_requests(requester_user_id);
CREATE INDEX idx_account_link_requests_target ON account_link_requests(target_user_id);
CREATE INDEX idx_account_link_requests_target_email ON account_link_requests(target_email);
CREATE INDEX idx_account_link_requests_status ON account_link_requests(status);
CREATE INDEX idx_account_link_requests_expires ON account_link_requests(expires_at);

CREATE INDEX idx_linked_accounts_primary ON linked_accounts(primary_user_id);
CREATE INDEX idx_linked_accounts_linked ON linked_accounts(linked_user_id);

CREATE INDEX idx_account_linking_audit_user ON account_linking_audit(user_id);
CREATE INDEX idx_account_linking_audit_created ON account_linking_audit(created_at);

-- Function to get all linked accounts for a user (bidirectional)
CREATE OR REPLACE FUNCTION get_linked_accounts(user_uuid UUID)
RETURNS TABLE(linked_user_id UUID, email VARCHAR, oauth_provider VARCHAR, first_name VARCHAR, last_name VARCHAR) AS $$
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
$$ LANGUAGE plpgsql;

-- Function to check if two users are linked
CREATE OR REPLACE FUNCTION are_users_linked(user1_uuid UUID, user2_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS(
        SELECT 1 FROM linked_accounts 
        WHERE (primary_user_id = user1_uuid AND linked_user_id = user2_uuid)
           OR (primary_user_id = user2_uuid AND linked_user_id = user1_uuid)
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get primary user for any linked account
CREATE OR REPLACE FUNCTION get_primary_user(user_uuid UUID)
RETURNS UUID AS $$
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
$$ LANGUAGE plpgsql;