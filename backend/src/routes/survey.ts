import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { surveyController } from '../controllers/surveyController';
import { z } from 'zod';

const router = Router();

// Validation schemas
const questionSchema = z.object({
  id: z.string(),
  type: z.enum(['multiple_choice', 'single_choice', 'text', 'textarea', 'rating_5', 'rating_10', 'yes_no']),
  text: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean(),
  options: z.array(z.object({
    id: z.string(),
    text: z.string(),
    value: z.union([z.string(), z.number()])
  })).optional(),
  min_rating: z.number().optional(),
  max_rating: z.number().optional(),
  order: z.number()
});

const targetSegmentSchema = z.object({
  tier_restrictions: z.array(z.string()).optional(),
  min_points: z.number().optional(),
  max_points: z.number().optional(),
  registration_after: z.string().optional(),
  registration_before: z.string().optional(),
  oauth_providers: z.array(z.string()).optional(),
  exclude_users: z.array(z.string()).optional()
});

const createSurveySchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  questions: z.array(questionSchema).min(1),
  target_segment: targetSegmentSchema.optional(),
  scheduled_start: z.string().datetime().optional(),
  scheduled_end: z.string().datetime().optional()
});

const updateSurveySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  questions: z.array(questionSchema).optional(),
  target_segment: targetSegmentSchema.optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'archived']).optional(),
  scheduled_start: z.string().datetime().optional(),
  scheduled_end: z.string().datetime().optional()
});

const submitResponseSchema = z.object({
  survey_id: z.string().uuid(),
  answers: z.record(z.string(), z.any()),
  is_completed: z.boolean().optional()
});

// Survey CRUD routes (Admin)
router.post('/', 
  authenticate, 
  validateRequest(createSurveySchema), 
  surveyController.createSurvey
);

router.get('/', 
  authenticate, 
  surveyController.getSurveys
);

router.get('/:id', 
  authenticate, 
  surveyController.getSurvey
);

router.put('/:id', 
  authenticate, 
  validateRequest(updateSurveySchema), 
  surveyController.updateSurvey
);

router.delete('/:id', 
  authenticate, 
  surveyController.deleteSurvey
);

// Survey response routes
router.post('/responses', 
  authenticate, 
  validateRequest(submitResponseSchema), 
  surveyController.submitResponse
);

router.get('/responses/:surveyId/user', 
  authenticate, 
  surveyController.getUserResponse
);

router.get('/:surveyId/responses', 
  authenticate, 
  surveyController.getSurveyResponses
);

// Customer survey routes
router.get('/available/user', 
  authenticate, 
  surveyController.getAvailableSurveys
);

// Analytics routes (Admin)
router.get('/:surveyId/analytics', 
  authenticate, 
  surveyController.getSurveyAnalytics
);

router.get('/:surveyId/export', 
  authenticate, 
  surveyController.exportSurveyResponses
);

// Invitation routes (Admin)
router.get('/:surveyId/invitations',
  authenticate,
  surveyController.getSurveyInvitations
);

router.post('/:surveyId/invitations/send',
  authenticate,
  surveyController.sendSurveyInvitations
);

router.post('/invitations/:invitationId/resend',
  authenticate,
  surveyController.resendInvitation
);

export default router;