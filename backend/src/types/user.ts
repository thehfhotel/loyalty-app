import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid date format"
  }).optional(),
  preferences: z.record(z.unknown()).optional(),
});

export interface ProfileUpdate {
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  preferences?: Record<string, unknown>;
}

export interface UserMembershipInfo {
  userId: string;
  membershipId: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  isActive: boolean;
}