const API_URL = import.meta.env.VITE_API_URL;

export interface AccountLinkRequest {
  id: string;
  requesterUserId: string;
  targetEmail: string;
  targetUserId?: string;
  requestType: 'link_to_email' | 'link_to_existing';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  message?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface LinkedUserInfo {
  linkedUserId: string;
  email: string;
  oauthProvider?: string;
  firstName?: string;
  lastName?: string;
}

export interface LinkRequestsResponse {
  sent: AccountLinkRequest[];
  received: AccountLinkRequest[];
}

export interface LinkStatusResponse {
  canLink: boolean;
  reason?: string;
  targetExists?: boolean;
  targetOAuthProvider?: string;
}

class AccountLinkingService {
  private async getAuthHeaders(): Promise<HeadersInit> {
    const token = localStorage.getItem('auth-storage');
    if (!token) {
      throw new Error('No authentication token found');
    }

    const authData = JSON.parse(token);
    if (!authData.state?.accessToken) {
      throw new Error('No access token found');
    }

    return {
      'Authorization': `Bearer ${authData.state.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  async createLinkRequest(targetEmail: string, message?: string): Promise<AccountLinkRequest> {
    const response = await fetch(`${API_URL}/account-linking/request`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ targetEmail, message })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create link request');
    }

    return data.data;
  }

  async getLinkRequests(): Promise<LinkRequestsResponse> {
    const response = await fetch(`${API_URL}/account-linking/requests`, {
      method: 'GET',
      headers: await this.getAuthHeaders()
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get link requests');
    }

    return data.data;
  }

  async approveLinkRequest(requestId: string): Promise<void> {
    const response = await fetch(`${API_URL}/account-linking/approve`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ requestId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to approve link request');
    }
  }

  async rejectLinkRequest(requestId: string): Promise<void> {
    const response = await fetch(`${API_URL}/account-linking/reject`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ requestId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to reject link request');
    }
  }

  async getLinkedAccounts(): Promise<LinkedUserInfo[]> {
    const response = await fetch(`${API_URL}/account-linking/linked-accounts`, {
      method: 'GET',
      headers: await this.getAuthHeaders()
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get linked accounts');
    }

    return data.data;
  }

  async unlinkAccount(targetUserId: string): Promise<void> {
    const response = await fetch(`${API_URL}/account-linking/unlink`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ targetUserId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to unlink account');
    }
  }

  async checkLinkStatus(email: string): Promise<LinkStatusResponse> {
    const response = await fetch(`${API_URL}/account-linking/status/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: await this.getAuthHeaders()
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to check link status');
    }

    return data.data;
  }
}

export const accountLinkingService = new AccountLinkingService();