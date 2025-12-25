/**
 * tRPC User Router
 * Type-safe user profile, settings, and email verification endpoints
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { userService } from '../../services/userService';

export const userRouter = router({
  /**
   * Get user's full profile
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return await userService.getProfile(ctx.user.id);
  }),

  /**
   * Update user profile fields
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        dateOfBirth: z
          .string()
          .transform((val) => (val === '' ? undefined : val))
          .refine((date) => date === undefined || !isNaN(Date.parse(date)), {
            message: 'Invalid date format',
          })
          .optional(),
        preferences: z.record(z.unknown()).optional(),
        gender: z.string().optional(),
        occupation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userService.updateProfile(ctx.user.id, input);
    }),

  /**
   * Complete user profile with potential coupon reward
   */
  completeProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        dateOfBirth: z.string().optional(),
        gender: z.string().optional(),
        occupation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userService.completeProfile(ctx.user.id, input);
    }),

  /**
   * Get profile completion status
   */
  getProfileCompletionStatus: protectedProcedure.query(async ({ ctx }) => {
    return await userService.getProfileCompletionStatus(ctx.user.id);
  }),

  /**
   * Initiate email change - sends verification code to new email
   */
  updateEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().email('Invalid email address'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await userService.initiateEmailChange(ctx.user.id, input.email);
      return {
        success: true,
        message: 'Verification code sent to new email address',
        pendingVerification: true,
      };
    }),

  /**
   * Verify email change with code
   */
  verifyEmail: protectedProcedure
    .input(
      z.object({
        code: z
          .string()
          .regex(/^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/, 'Invalid code format'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const newEmail = await userService.verifyEmailChange(
        ctx.user.id,
        input.code
      );
      return { success: true, email: newEmail };
    }),

  /**
   * Resend verification code for pending email change
   */
  resendVerificationCode: protectedProcedure.mutation(async ({ ctx }) => {
    await userService.resendVerificationCode(ctx.user.id);
    return { success: true, message: 'Verification code resent' };
  }),

  /**
   * Get pending email change status
   */
  getPendingEmailChange: protectedProcedure.query(async ({ ctx }) => {
    return await userService.getPendingEmailChange(ctx.user.id);
  }),

  /**
   * Update emoji avatar
   */
  updateEmojiAvatar: protectedProcedure
    .input(
      z.object({
        emoji: z.string().min(1, 'Emoji is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userService.updateEmojiAvatar(ctx.user.id, input.emoji);
    }),

  /**
   * Get user settings/preferences
   */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const profile = await userService.getProfile(ctx.user.id);
    return {
      preferences: profile.preferences,
      gender: profile.gender,
      occupation: profile.occupation,
    };
  }),

  /**
   * Update user settings/preferences
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        preferences: z.record(z.unknown()).optional(),
        gender: z.string().optional(),
        occupation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userService.updateProfile(ctx.user.id, input);
    }),

  /**
   * Update user avatar URL
   */
  updateAvatar: protectedProcedure
    .input(
      z.object({
        avatarUrl: z.string().min(1, 'Avatar URL is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await userService.updateAvatar(ctx.user.id, input.avatarUrl);
      return await userService.getProfile(ctx.user.id);
    }),

  /**
   * Remove user avatar
   */
  deleteAvatar: protectedProcedure.mutation(async ({ ctx }) => {
    await userService.deleteAvatar(ctx.user.id);
    return { success: true };
  }),
});
