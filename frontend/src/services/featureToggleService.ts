const API_URL = import.meta.env.VITE_API_URL;

export interface FeatureToggle {
  id: string;
  featureKey: string;
  featureName: string;
  description?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface FeatureToggleAudit {
  id: string;
  featureToggleId: string;
  previousState?: boolean;
  newState: boolean;
  changedBy: string;
  changedAt: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

class FeatureToggleService {
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

  /**
   * Get all feature toggles (admin only)
   */
  async getAllFeatureToggles(): Promise<FeatureToggle[]> {
    const response = await fetch(`${API_URL}/feature-toggles`, {
      method: 'GET',
      headers: await this.getAuthHeaders()
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get feature toggles');
    }

    return data.data;
  }

  /**
   * Get public feature flags (no auth required)
   */
  async getPublicFeatures(): Promise<Record<string, boolean>> {
    const response = await fetch(`${API_URL}/feature-toggles/public`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get public features');
    }

    return data.data;
  }

  /**
   * Toggle a feature on/off (admin only)
   */
  async toggleFeature(featureKey: string, isEnabled: boolean, reason?: string): Promise<FeatureToggle> {
    const response = await fetch(`${API_URL}/feature-toggles/toggle`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ featureKey, isEnabled, reason })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to toggle feature');
    }

    return data.data;
  }

  /**
   * Create a new feature toggle (admin only)
   */
  async createFeatureToggle(
    featureKey: string,
    featureName: string,
    description: string,
    isEnabled: boolean = false
  ): Promise<FeatureToggle> {
    const response = await fetch(`${API_URL}/feature-toggles`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ featureKey, featureName, description, isEnabled })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create feature toggle');
    }

    return data.data;
  }

  /**
   * Get audit history for a feature toggle (admin only)
   */
  async getFeatureToggleAudit(featureKey: string): Promise<FeatureToggleAudit[]> {
    const response = await fetch(`${API_URL}/feature-toggles/${featureKey}/audit`, {
      method: 'GET',
      headers: await this.getAuthHeaders()
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get feature toggle audit');
    }

    return data.data;
  }

  /**
   * Check if a specific feature is enabled
   */
  async isFeatureEnabled(featureKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_URL}/feature-toggles/check/${featureKey}`, {
        method: 'GET',
        headers: await this.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        console.warn(`Failed to check feature ${featureKey}:`, data.error);
        return false; // Default to false on error
      }

      return data.data.isEnabled;
    } catch (error) {
      console.warn(`Failed to check feature ${featureKey}:`, error);
      return false; // Default to false on error
    }
  }
}

export const featureToggleService = new FeatureToggleService();