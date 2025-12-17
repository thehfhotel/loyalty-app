/**
 * tRPC Survey Router
 * Type-safe survey endpoints
 */

import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { surveyService } from '../../services/surveyService';

export const surveyRouter = router({
  /**
   * Get active surveys available to user
   */
  getActiveSurveys: protectedProcedure.query(async ({ ctx }) => {
    return await surveyService.getAvailableSurveys(ctx.user.id);
  }),

  /**
   * Get public surveys available to user
   */
  getPublicSurveys: protectedProcedure.query(async ({ ctx }) => {
    return await surveyService.getPublicSurveys(ctx.user.id);
  }),

  /**
   * Get invited surveys for user
   */
  getInvitedSurveys: protectedProcedure.query(async ({ ctx }) => {
    return await surveyService.getInvitedSurveys(ctx.user.id);
  }),

  /**
   * Get survey by ID with questions
   */
  getSurveyById: protectedProcedure
    .input(z.object({
      surveyId: z.string().uuid(),
      language: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Check if user can access this survey
      const hasAccess = await surveyService.canUserAccessSurvey(ctx.user.id, input.surveyId);

      if (!hasAccess && ctx.user.role !== 'admin') {
        throw new Error('Access denied: You do not have permission to view this survey');
      }

      // Get survey with optional language translation
      const survey = input.language
        ? await surveyService.getSurveyWithTranslations(input.surveyId, input.language)
        : await surveyService.getSurveyById(input.surveyId);

      if (!survey) {
        throw new Error('Survey not found');
      }

      return survey;
    }),

  /**
   * Submit survey response
   */
  submitResponse: protectedProcedure
    .input(z.object({
      survey_id: z.string().uuid(),
      answers: z.record(z.string(), z.any()),
      is_completed: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user can access this survey
      const hasAccess = await surveyService.canUserAccessSurvey(ctx.user.id, input.survey_id);

      if (!hasAccess) {
        throw new Error('Access denied: You do not have permission to submit responses to this survey');
      }

      return await surveyService.submitResponse(ctx.user.id, input);
    }),

  /**
   * Get user's response for a specific survey
   */
  getUserResponse: protectedProcedure
    .input(z.object({
      surveyId: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const response = await surveyService.getUserResponse(ctx.user.id, input.surveyId);
      return response;
    }),

  /**
   * Get user's survey responses
   */
  getMyResponses: protectedProcedure
    .input(z.object({
      surveyId: z.string().uuid().optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      if (input.surveyId) {
        // Get response for specific survey
        const response = await surveyService.getUserResponse(ctx.user.id, input.surveyId);
        return {
          responses: response ? [response] : [],
          total: response ? 1 : 0,
          page: 1,
          pageSize: 1,
          totalPages: response ? 1 : 0,
        };
      }

      // Get all user's responses (would need a new service method for this)
      // For now, returning empty structure
      return {
        responses: [],
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: 0,
      };
    }),

  /**
   * Get survey analytics (admin only)
   */
  getSurveyAnalytics: adminProcedure
    .input(z.object({
      surveyId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      const analytics = await surveyService.getSurveyAnalytics(input.surveyId);

      if (!analytics) {
        throw new Error('Survey not found or analytics unavailable');
      }

      return analytics;
    }),
});
