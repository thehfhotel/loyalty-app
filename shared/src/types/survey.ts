import { z } from 'zod';

// Survey Question Schema
export const SurveyQuestionSchema = z.object({
  id: z.string().uuid(),
  surveyId: z.string().uuid(),
  type: z.enum(['text', 'number', 'single_choice', 'multiple_choice', 'rating', 'boolean']),
  title: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().default(false),
  order: z.number().int().min(0),
  options: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.date(),
});

export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

// Base Survey Schema
export const SurveySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  code: z.string(),
  isActive: z.boolean().default(true),
  startDate: z.date(),
  endDate: z.date(),
  maxResponses: z.number().int().min(1).optional(),
  responseCount: z.number().int().min(0).default(0),
  pointsReward: z.number().int().min(0).default(0),
  targetAudience: z.string().optional(),
  estimatedTime: z.number().int().min(0).default(5),
  qrCode: z.string().optional(),
  questions: z.array(SurveyQuestionSchema).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Survey = z.infer<typeof SurveySchema>;

// Question Answer Schema
export const QuestionAnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.unknown(),
  answeredAt: z.date().optional(),
});

export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

// Survey Response Schema
export const SurveyResponseSchema = z.object({
  id: z.string().uuid(),
  surveyId: z.string().uuid(),
  customerId: z.string().uuid(),
  answers: z.array(QuestionAnswerSchema).default([]),
  responses: z.array(z.object({
    questionId: z.string().uuid(),
    answer: z.unknown(),
    answeredAt: z.date(),
  })).optional(),
  startedAt: z.date(),
  completedAt: z.date().optional(),
  isCompleted: z.boolean().default(false),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  pointsAwarded: z.number().int().min(0).default(0),
  createdAt: z.date(),
});

export type SurveyResponse = z.infer<typeof SurveyResponseSchema>;

// Survey with Progress Schema
export const SurveyWithProgressSchema = SurveySchema.extend({
  questionCount: z.number().int().optional(),
  isStarted: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  progress: z.number().min(0).max(100).optional(),
});

export type SurveyWithProgress = z.infer<typeof SurveyWithProgressSchema>;

// Create Survey Schema
export const CreateSurveySchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  code: z.string().min(1),
  startDate: z.date(),
  endDate: z.date(),
  maxResponses: z.number().int().min(1).optional(),
  pointsReward: z.number().int().min(0).default(0),
  targetAudience: z.string().optional(),
  estimatedTime: z.number().int().min(1).default(5),
  questions: z.array(z.object({
    type: z.enum(['text', 'number', 'single_choice', 'multiple_choice', 'rating', 'boolean']),
    title: z.string(),
    description: z.string().optional(),
    isRequired: z.boolean().default(false),
    order: z.number().int().min(0),
    options: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).default({}),
  })).default([]),
});

export type CreateSurvey = z.infer<typeof CreateSurveySchema>;

// Update Survey Schema
export const UpdateSurveySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  maxResponses: z.number().int().min(1).optional(),
  pointsReward: z.number().int().min(0).optional(),
  targetAudience: z.string().optional(),
  estimatedTime: z.number().int().min(1).optional(),
});

export type UpdateSurvey = z.infer<typeof UpdateSurveySchema>;

// Start Survey Response Request Schema
export const StartSurveyResponseRequestSchema = z.object({
  surveyId: z.string().uuid(),
});

export type StartSurveyResponseRequest = z.infer<typeof StartSurveyResponseRequestSchema>;

// Submit Answer Request Schema
export const SubmitAnswerRequestSchema = z.object({
  responseId: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: z.unknown(),
});

export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;

// Complete Survey Response Request Schema
export const CompleteSurveyResponseRequestSchema = z.object({
  responseId: z.string().uuid(),
  answers: z.array(QuestionAnswerSchema).optional(),
});

export type CompleteSurveyResponseRequest = z.infer<typeof CompleteSurveyResponseRequestSchema>;

// Complete Survey Response Response Schema
export const CompleteSurveyResponseResponseSchema = z.object({
  success: z.boolean(),
  pointsAwarded: z.number().int(),
  response: SurveyResponseSchema,
});

export type CompleteSurveyResponseResponse = z.infer<typeof CompleteSurveyResponseResponseSchema>;

// QR Code Validation Request Schema
export const SurveyQRCodeValidationRequestSchema = z.object({
  qrData: z.string(),
});

export type SurveyQRCodeValidationRequest = z.infer<typeof SurveyQRCodeValidationRequestSchema>;

// QR Code Validation Response Schema
export const SurveyQRCodeValidationResponseSchema = z.object({
  survey: z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string(),
    estimatedTime: z.number().int(),
    pointsReward: z.number().int(),
  }),
  valid: z.boolean(),
  code: z.string(),
});

export type SurveyQRCodeValidationResponse = z.infer<typeof SurveyQRCodeValidationResponseSchema>;

// Save Survey Progress Request Schema
export const SaveSurveyProgressRequestSchema = z.object({
  responseId: z.string().uuid(),
  answers: z.array(QuestionAnswerSchema),
});

export type SaveSurveyProgressRequest = z.infer<typeof SaveSurveyProgressRequestSchema>;

// Survey Search/Filter Schema
export const SurveySearchSchema = z.object({
  query: z.string().optional(),
  isActive: z.boolean().optional(),
  hasPointsReward: z.boolean().optional(),
  targetAudience: z.string().optional(),
  startDateAfter: z.date().optional(),
  endDateBefore: z.date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['title', 'code', 'startDate', 'endDate', 'responseCount', 'created']).default('created'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SurveySearch = z.infer<typeof SurveySearchSchema>;

// Survey Analytics Schema
export const SurveyAnalyticsSchema = z.object({
  totalSurveys: z.number().int(),
  activeSurveys: z.number().int(),
  totalResponses: z.number().int(),
  completionRate: z.number().min(0).max(100),
  averageResponseTime: z.number(),
  pointsAwarded: z.number().int(),
  responsesByDate: z.array(z.object({
    date: z.string(),
    count: z.number().int(),
  })),
  topSurveys: z.array(z.object({
    survey: SurveySchema,
    responseCount: z.number().int(),
    completionRate: z.number(),
  })),
  questionTypeDistribution: z.record(z.string(), z.number()),
});

export type SurveyAnalytics = z.infer<typeof SurveyAnalyticsSchema>;

// Survey Distribution Request Schema
export const SurveyDistributionRequestSchema = z.object({
  surveyId: z.string().uuid(),
  customerIds: z.array(z.string().uuid()).optional(),
  tierIds: z.array(z.string().uuid()).optional(),
  all: z.boolean().default(false),
  conditions: z.record(z.unknown()).default({}),
  notificationMethod: z.enum(['push', 'email', 'both']).default('push'),
});

export type SurveyDistributionRequest = z.infer<typeof SurveyDistributionRequestSchema>;

// Bulk Survey Operation Schema
export const BulkSurveyOperationSchema = z.object({
  operation: z.enum(['activate', 'deactivate', 'delete', 'extend', 'duplicate']),
  surveyIds: z.array(z.string().uuid()),
  params: z.record(z.unknown()).default({}),
});

export type BulkSurveyOperation = z.infer<typeof BulkSurveyOperationSchema>;

// Survey Question Validation Schema
export const SurveyQuestionValidationSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.unknown(),
  questionType: z.enum(['text', 'number', 'single_choice', 'multiple_choice', 'rating', 'boolean']),
  isRequired: z.boolean(),
  options: z.array(z.string()).optional(),
});

export type SurveyQuestionValidation = z.infer<typeof SurveyQuestionValidationSchema>;

// Survey Question Validation Result Schema
export const SurveyQuestionValidationResultSchema = z.object({
  isValid: z.boolean(),
  error: z.string().optional(),
});

export type SurveyQuestionValidationResult = z.infer<typeof SurveyQuestionValidationResultSchema>;