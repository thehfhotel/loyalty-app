import { z } from 'zod';

export const UserRole = z.enum(['customer', 'admin', 'super_admin']);
export type UserRole = z.infer<typeof UserRole>;

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

export const resetPasswordRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export interface User {
  id: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: Date;
  avatarUrl?: string;
  membershipId?: string;
}

export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: Date;
  preferences: Record<string, unknown>;
  avatarUrl?: string;
  membershipId?: string;
  gender?: string;
  occupation?: string;
  profileCompleted?: boolean;
  profileCompletedAt?: Date;
  newMemberCouponAwarded?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JWTPayload {
  id: string;
  email: string | null;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}