export type QuestionType = 'multiple_choice' | 'single_choice' | 'text' | 'textarea' | 'rating_5' | 'rating_10' | 'yes_no';
export type SurveyStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type SurveyAccessType = 'invite_only' | 'public';
export type InvitationStatus = 'pending' | 'sent' | 'viewed' | 'started' | 'completed' | 'expired';

export interface QuestionOption {
  id: string;
  text: string;
  value: string | number;
}

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  text: string;
  description?: string;
  required: boolean;
  options?: QuestionOption[];
  min_rating?: number;
  max_rating?: number;
  order: number;
}

export interface TargetSegment {
  tier_restrictions?: string[];
  min_points?: number;
  max_points?: number;
  registration_after?: string;
  registration_before?: string;
  oauth_providers?: string[];
  exclude_users?: string[];
}

export interface Survey {
  id: string;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  target_segment: TargetSegment;
  status: SurveyStatus;
  access_type: SurveyAccessType;
  scheduled_start?: string;
  scheduled_end?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  user_id: string;
  answers: Record<string, any>;
  is_completed: boolean;
  progress: number;
  started_at: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
}

export interface SurveyInvitation {
  id: string;
  survey_id: string;
  user_id: string;
  status: InvitationStatus;
  sent_at?: string;
  viewed_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

// API Request/Response types
export interface CreateSurveyRequest {
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  target_segment?: TargetSegment;
  access_type: SurveyAccessType;
  status?: SurveyStatus;
  scheduled_start?: string;
  scheduled_end?: string;
}

export interface UpdateSurveyRequest extends Partial<CreateSurveyRequest> {
  status?: SurveyStatus;
}

export interface SubmitResponseRequest {
  survey_id: string;
  answers: Record<string, any>;
  is_completed?: boolean;
}

export interface SurveyListResponse {
  surveys: Survey[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SurveyResponseListResponse {
  responses: SurveyResponse[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SurveyAnalytics {
  survey: Survey;
  responses: SurveyResponse[];
  totalResponses: number;
  completionRate: number;
  averageCompletionTime: number;
  responsesByDate: { date: string; count: number }[];
  questionAnalytics: {
    questionId: string;
    question: string;
    type: string;
    responses: Record<string, number>;
    averageRating?: number;
  }[];
}

// Survey Coupon Assignment types
// Note: Coupons are always awarded on survey completion

export interface SurveyCouponAssignment {
  id: string;
  survey_id: string;
  coupon_id: string;
  is_active: boolean;
  max_awards?: number;
  awarded_count: number;
  assigned_by?: string;
  assigned_reason: string;
  custom_expiry_days?: number;
  created_at: string;
  updated_at: string;
}

export interface SurveyCouponDetails {
  assignment_id: string;
  survey_id: string;
  survey_title: string;
  survey_status: string;
  coupon_id: string;
  coupon_code: string;
  coupon_name: string;
  coupon_type: string;
  coupon_value?: number;
  coupon_currency: string;
  coupon_status: string;
  is_active: boolean;
  max_awards?: number;
  awarded_count: number;
  custom_expiry_days?: number;
  assigned_reason: string;
  assigned_by?: string;
  assigned_by_email?: string;
  assigned_at: string;
  updated_at: string;
}

export interface SurveyRewardHistory {
  id: string;
  survey_coupon_assignment_id: string;
  survey_response_id: string;
  user_coupon_id: string;
  user_id: string;
  awarded_at: string;
  award_condition_met: string;
  metadata: Record<string, any>;
  created_at: string;
  // Additional display fields
  user_email?: string;
  user_name?: string;
  coupon_code?: string;
  coupon_name?: string;
}

// API Request types for survey-coupon assignments
export interface AssignCouponToSurveyRequest {
  survey_id: string;
  coupon_id: string;
  max_awards?: number;
  custom_expiry_days?: number;
  assigned_reason?: string;
}

export interface UpdateSurveyCouponAssignmentRequest {
  max_awards?: number;
  custom_expiry_days?: number;
  assigned_reason?: string;
  is_active?: boolean;
}

export interface SurveyCouponAssignmentListResponse {
  assignments: SurveyCouponDetails[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SurveyRewardHistoryResponse {
  rewards: SurveyRewardHistory[];
  total: number;
  totalPages: number;
}