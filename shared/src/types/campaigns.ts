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

// Campaign-specific coupon and survey types are now in dedicated files
// Import from ./coupon.ts and ./survey.ts instead

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