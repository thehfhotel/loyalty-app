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
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SurveyResponseListResponse {
  responses: SurveyResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SurveyAnalytics {
  survey_id: string;
  title: string;
  total_invitations: number;
  total_responses: number;
  completion_rate: number;
  average_completion_time: number;
  response_rate: number;
  question_analytics: QuestionAnalytics[];
}

export interface QuestionAnalytics {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  total_responses: number;
  response_distribution?: Record<string, number>;
  average_rating?: number;
  common_responses?: string[];
}