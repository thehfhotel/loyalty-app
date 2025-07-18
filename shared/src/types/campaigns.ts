import { z } from 'zod';

// Campaign Types
export const CampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['promotional', 'informational', 'survey', 'welcome']),
  content: z.object({
    title: z.string(),
    message: z.string(),
    imageUrl: z.string().optional(),
    actionUrl: z.string().optional(),
    actionText: z.string().optional(),
  }),
  targeting: z.object({
    tierIds: z.array(z.string().uuid()).optional(),
    minPoints: z.number().optional(),
    maxPoints: z.number().optional(),
    minStays: z.number().optional(),
    lastStayDays: z.number().optional(),
    segments: z.array(z.string()).optional(),
  }),
  delivery: z.object({
    channels: z.array(z.enum(['push', 'email', 'sms', 'in-app'])),
    priority: z.enum(['low', 'normal', 'high']),
    scheduledAt: z.date().optional(),
    timezone: z.string().optional(),
  }),
  status: z.enum(['draft', 'scheduled', 'active', 'completed', 'cancelled']),
  metrics: z.object({
    sent: z.number().default(0),
    delivered: z.number().default(0),
    opened: z.number().default(0),
    clicked: z.number().default(0),
    converted: z.number().default(0),
  }).optional(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
  sentAt: z.date().optional(),
});

export type Campaign = z.infer<typeof CampaignSchema>;

// Coupon Types
export const CouponSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['percentage', 'fixed_amount', 'free_item']),
  value: z.number().min(0),
  category: z.enum(['room', 'dining', 'spa', 'experience', 'general']),
  conditions: z.object({
    minSpend: z.number().optional(),
    maxDiscount: z.number().optional(),
    applicableItems: z.array(z.string()).optional(),
    excludedItems: z.array(z.string()).optional(),
    tierIds: z.array(z.string().uuid()).optional(),
  }).optional(),
  usage: z.object({
    maxUses: z.number().optional(),
    maxUsesPerCustomer: z.number().default(1),
    currentUses: z.number().default(0),
  }),
  validity: z.object({
    validFrom: z.date(),
    validTo: z.date(),
    daysFromIssue: z.number().optional(),
  }),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Coupon = z.infer<typeof CouponSchema>;

// Customer Coupon (Issued Coupon)
export const CustomerCouponSchema = z.object({
  id: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  couponId: z.string().uuid(),
  code: z.string(),
  qrCode: z.string(),
  status: z.enum(['active', 'used', 'expired']),
  issuedAt: z.date(),
  expiresAt: z.date(),
  usedAt: z.date().optional(),
  usedAmount: z.number().optional(),
  notes: z.string().optional(),
});

export type CustomerCoupon = z.infer<typeof CustomerCouponSchema>;

// Survey Types
export const SurveyQuestionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['text', 'number', 'single_choice', 'multiple_choice', 'rating', 'boolean']),
  question: z.string(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  order: z.number(),
});

export const SurveySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  questions: z.array(SurveyQuestionSchema),
  targeting: z.object({
    tierIds: z.array(z.string().uuid()).optional(),
    recentStayDays: z.number().optional(),
    segments: z.array(z.string()).optional(),
  }),
  settings: z.object({
    allowAnonymous: z.boolean().default(false),
    showProgress: z.boolean().default(true),
    pointsReward: z.number().min(0).default(0),
    maxResponses: z.number().optional(),
  }),
  status: z.enum(['draft', 'active', 'completed', 'archived']),
  validFrom: z.date().optional(),
  validTo: z.date().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Survey = z.infer<typeof SurveySchema>;
export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

// Survey Response
export const SurveyResponseSchema = z.object({
  id: z.string().uuid(),
  surveyId: z.string().uuid(),
  customerProfileId: z.string().uuid().optional(),
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    answer: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  })),
  isComplete: z.boolean().default(false),
  timeSpent: z.number().optional(),
  submittedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SurveyResponse = z.infer<typeof SurveyResponseSchema>;

// Notification Types
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  customerProfileId: z.string().uuid(),
  type: z.enum(['campaign', 'system', 'promotion', 'survey', 'reminder']),
  title: z.string(),
  message: z.string(),
  data: z.record(z.any()).optional(),
  channel: z.enum(['push', 'email', 'sms', 'in-app']),
  status: z.enum(['pending', 'sent', 'delivered', 'opened', 'failed']),
  priority: z.enum(['low', 'normal', 'high']),
  scheduledAt: z.date().optional(),
  sentAt: z.date().optional(),
  openedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Notification = z.infer<typeof NotificationSchema>;