import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import { API_BASE_URL } from '../utils/apiConfig';
import type {
  LoginResponse,
  RegisterResponse,
  RefreshTokenResponse,
  LogoutResponse,
  ApiResponse,
  User,
  UserProfile,
} from '../types/api';
import { logger } from '../utils/logger';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Required for CSRF cookies
});

// Use the unified auth token interceptor
addAuthTokenInterceptor(api);

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export const authService = {
  async login(email: string, password: string, rememberMe?: boolean): Promise<LoginResponse> {
    logger.log('[Auth Debug] Login attempt', { email, rememberMe });
    const response = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
      rememberMe: rememberMe ?? false
    });
    logger.log('[Auth Debug] Login response', {
      success: response.data.success,
      hasUser: !!response.data.user,
      hasTokens: !!response.data.tokens,
      rememberMe: rememberMe
    });
    return response.data;
  },

  async register(data: RegisterData): Promise<RegisterResponse> {
    const response = await api.post<RegisterResponse>('/auth/register', data);
    return response.data;
  },

  async logout(): Promise<void> {
    // Phase 2: refresh token lives in the HttpOnly `refresh_token` cookie
    // (set by Phase 1 backend, PR #194). The browser sends it automatically
    // because `api` is configured with `withCredentials: true`. The body is
    // intentionally empty — the backend reads the token from the cookie and
    // also clears it via `Set-Cookie: refresh_token=; Max-Age=0`.
    await api.post<LogoutResponse>('/auth/logout', {});
  },

  async refreshToken(): Promise<RefreshTokenResponse> {
    logger.log('[Auth Debug] Token refresh attempt');
    // Phase 2: empty body — backend reads `refresh_token` from the HttpOnly
    // cookie (Phase 1 backend supports body OR cookie; sending no body forces
    // the cookie path). The cookie travels because `api` uses
    // `withCredentials: true`.
    const response = await api.post<RefreshTokenResponse>('/auth/refresh', {});
    logger.log('[Auth Debug] Token refresh response', {
      success: !!response.data.tokens,
      hasNewAccessToken: !!response.data.tokens?.accessToken
    });
    return response.data;
  },

  async resetPasswordRequest(email: string): Promise<ApiResponse> {
    const response = await api.post<ApiResponse>('/auth/reset-password/request', { email });
    return response.data;
  },

  async resetPassword(token: string, password: string): Promise<ApiResponse> {
    const response = await api.post<ApiResponse>('/auth/reset-password', { token, password });
    return response.data;
  },

  async getCurrentUser(): Promise<ApiResponse<User & { profile?: UserProfile }>> {
    const response = await api.get<ApiResponse<User & { profile?: UserProfile }>>('/auth/me');
    return response.data;
  },

  async getMe(): Promise<ApiResponse<User & { profile?: UserProfile }>> {
    const response = await api.get<ApiResponse<User & { profile?: UserProfile }>>('/auth/me');
    return response.data;
  },

  async apiCall<T = unknown>(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data?: unknown): Promise<T> {
    try {
      let response;
      switch (method) {
        case 'GET':
          response = await api.get<T>(url);
          break;
        case 'POST':
          response = await api.post<T>(url, data);
          break;
        case 'PUT':
          response = await api.put<T>(url, data);
          break;
        case 'DELETE':
          response = await api.delete<T>(url);
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${method}`);
      }
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[Auth Debug] API call failed: ${method} ${url}`, error.message);
      } else {
        logger.error(`[Auth Debug] API call failed: ${method} ${url}`, String(error));
      }
      throw error;
    }
  },
};

export default api;