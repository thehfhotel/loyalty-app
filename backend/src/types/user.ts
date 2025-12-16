import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string()
    .transform(val => val === '' ? undefined : val)
    .refine((date) => date === undefined || !isNaN(Date.parse(date)), {
      message: "Invalid date format"
    })
    .optional(),
  preferences: z.record(z.unknown()).optional(),
  // Additional profile fields stored in preferences JSON
  gender: z.string().optional(),
  occupation: z.string().optional(),
  interests: z.array(z.string()).optional(),
});

export interface ProfileUpdate {
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  preferences?: Record<string, unknown>;
  gender?: string;
  occupation?: string;
  interests?: string[];
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