import { 
  LoginRequest, 
  RegisterRequest, 
  AuthResponse, 
  PasswordResetRequest,
  PasswordReset,
  User 
} from '@hotel-loyalty/shared/types/auth';
import { ApiResponse } from '@hotel-loyalty/shared/types/api';

class AuthService {
  private readonly baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  private readonly storageKeys = {
    accessToken: 'loyalty_access_token',
    refreshToken: 'loyalty_refresh_token',
    user: 'loyalty_user',
  } as const;

  /**
   * Register new user
   */
  async register(userData: RegisterRequest): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userData),
    });

    const result: ApiResponse<AuthResponse> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Registration failed');
    }

    // Store auth data
    this.storeAuthData(result.data);

    return result.data;
  }

  /**
   * Login user
   */
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    const result: ApiResponse<AuthResponse> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Login failed');
    }

    // Store auth data
    this.storeAuthData(result.data);

    return result.data;
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    const token = this.getAccessToken();
    
    if (token) {
      try {
        await fetch(`${this.baseUrl}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        console.error('Logout request failed:', error);
        // Continue with local logout even if request fails
      }
    }

    // Clear local storage
    this.clearAuthData();
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<string | null> {
    const refreshToken = this.getRefreshToken();
    
    if (!refreshToken) {
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      const result: ApiResponse<{ token: string; expiresIn: number }> = await response.json();

      if (!result.success) {
        this.clearAuthData();
        return null;
      }

      // Store new access token
      localStorage.setItem(this.storageKeys.accessToken, result.data.token);

      return result.data.token;

    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearAuthData();
      return null;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/password-reset/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email } as PasswordResetRequest),
    });

    const result: ApiResponse<void> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Password reset request failed');
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/password-reset/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, password } as PasswordReset),
    });

    const result: ApiResponse<void> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Password reset failed');
    }
  }

  /**
   * Get current user profile
   */
  async getProfile(): Promise<User> {
    const token = this.getAccessToken();
    
    if (!token) {
      throw new Error('No access token available');
    }

    const response = await fetch(`${this.baseUrl}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const result: ApiResponse<User> = await response.json();

    if (!result.success) {
      if (response.status === 401) {
        // Try to refresh token
        const newToken = await this.refreshToken();
        if (newToken) {
          // Retry with new token
          return this.getProfile();
        }
      }
      throw new Error(result.message || 'Failed to get profile');
    }

    // Update stored user data
    localStorage.setItem(this.storageKeys.user, JSON.stringify(result.data));

    return result.data;
  }

  /**
   * Verify email address
   */
  async verifyEmail(email: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/verify-email?email=${encodeURIComponent(email)}&token=${token}`);

    const result: ApiResponse<void> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Email verification failed');
    }
  }

  /**
   * Get OAuth URLs
   */
  async getOAuthUrls(): Promise<{ google: string; facebook: string }> {
    const response = await fetch(`${this.baseUrl}/auth/oauth/urls`);

    const result: ApiResponse<{ google: string; facebook: string }> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Failed to get OAuth URLs');
    }

    return result.data;
  }

  /**
   * Handle OAuth callback
   */
  async handleOAuthCallback(provider: 'google' | 'facebook', code: string, state?: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/auth/oauth/${provider}/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider, code, state }),
    });

    const result: ApiResponse<AuthResponse> = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'OAuth authentication failed');
    }

    // Store auth data
    this.storeAuthData(result.data);

    return result.data;
  }

  /**
   * Get stored access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem(this.storageKeys.accessToken);
  }

  /**
   * Get stored refresh token
   */
  getRefreshToken(): string | null {
    return localStorage.getItem(this.storageKeys.refreshToken);
  }

  /**
   * Get stored user data
   */
  getStoredUser(): User | null {
    const userData = localStorage.getItem(this.storageKeys.user);
    if (!userData) return null;

    try {
      return JSON.parse(userData) as User;
    } catch (error) {
      console.error('Failed to parse stored user data:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getAccessToken();
    const user = this.getStoredUser();
    return !!(token && user);
  }

  /**
   * Make authenticated request with automatic token refresh
   */
  async makeAuthenticatedRequest<T>(
    url: string, 
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = this.getAccessToken();
    
    if (!token) {
      throw new Error('No access token available');
    }

    const requestOptions: RequestInit = {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    let response = await fetch(url, requestOptions);

    // If unauthorized, try to refresh token
    if (response.status === 401) {
      const newToken = await this.refreshToken();
      
      if (newToken) {
        // Retry with new token
        requestOptions.headers = {
          ...requestOptions.headers,
          'Authorization': `Bearer ${newToken}`,
        };
        response = await fetch(url, requestOptions);
      } else {
        throw new Error('Authentication failed');
      }
    }

    return response.json();
  }

  /**
   * Store authentication data
   */
  private storeAuthData(authData: AuthResponse): void {
    localStorage.setItem(this.storageKeys.accessToken, authData.token);
    localStorage.setItem(this.storageKeys.refreshToken, authData.refreshToken);
    localStorage.setItem(this.storageKeys.user, JSON.stringify(authData.user));
  }

  /**
   * Clear all authentication data
   */
  private clearAuthData(): void {
    localStorage.removeItem(this.storageKeys.accessToken);
    localStorage.removeItem(this.storageKeys.refreshToken);
    localStorage.removeItem(this.storageKeys.user);
  }
}

export const authService = new AuthService();