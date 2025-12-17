/**
 * tRPC Notification Router
 * Type-safe notification endpoints
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { notificationService } from '../../services/notificationService';

export const notificationRouter = router({
  /**
   * Get user's notifications with pagination
   */
  getNotifications: protectedProcedure
    .input(z.object({
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(50).default(20),
      includeRead: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const result = await notificationService.getUserNotifications(
        ctx.user.id,
        input.page,
        input.limit,
        input.includeRead
      );

      return {
        notifications: result.notifications || [],
        total: result.total,
        unread: result.unread,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(result.total / input.limit),
      };
    }),

  /**
   * Get unread notification count
   */
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await notificationService.getUnreadCount(ctx.user.id);
    return { unreadCount: count };
  }),

  /**
   * Mark single notification as read
   */
  markAsRead: protectedProcedure
    .input(z.object({
      notificationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const markedCount = await notificationService.markNotificationsRead(
        ctx.user.id,
        [input.notificationId]
      );

      if (markedCount === 0) {
        throw new Error('Notification not found or already marked as read');
      }

      return { success: true, markedCount };
    }),

  /**
   * Mark multiple notifications as read
   */
  markMultipleAsRead: protectedProcedure
    .input(z.object({
      notificationIds: z.array(z.string().uuid()),
    }))
    .mutation(async ({ ctx, input }) => {
      const markedCount = await notificationService.markNotificationsRead(
        ctx.user.id,
        input.notificationIds
      );

      return { success: true, markedCount };
    }),

  /**
   * Mark all notifications as read
   */
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const markedCount = await notificationService.markAllNotificationsRead(ctx.user.id);
    return { success: true, markedCount };
  }),

  /**
   * Delete a notification
   */
  deleteNotification: protectedProcedure
    .input(z.object({
      notificationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const wasDeleted = await notificationService.deleteNotification(
        ctx.user.id,
        input.notificationId
      );

      if (!wasDeleted) {
        throw new Error('Notification not found or already deleted');
      }

      return { success: true };
    }),
});
