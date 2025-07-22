-- Survey system seed data
-- Insert sample surveys for development and testing

-- Insert sample surveys
INSERT INTO surveys (id, title, description, questions, target_segment, access_type, status, created_at, updated_at) VALUES 
(
  'b5cbde95-7faf-4268-b3e3-7047a1e4e17b',
  'Public Test Survey',
  'This is a public survey for testing the surveys page',
  '[
    {
      "id": "q_1",
      "type": "single_choice",
      "text": "How satisfied are you with our service?",
      "required": true,
      "order": 1,
      "options": [
        {"id": "opt_1", "text": "Very Satisfied", "value": 5},
        {"id": "opt_2", "text": "Satisfied", "value": 4},
        {"id": "opt_3", "text": "Neutral", "value": 3},
        {"id": "opt_4", "text": "Dissatisfied", "value": 2},
        {"id": "opt_5", "text": "Very Dissatisfied", "value": 1}
      ]
    },
    {
      "id": "q_2",
      "type": "text",
      "text": "Please provide any additional feedback",
      "required": false,
      "order": 2
    }
  ]'::jsonb,
  '{}'::jsonb,
  'public',
  'active',
  NOW(),
  NOW()
),
(
  'survey-sample-1',
  'Customer Satisfaction Survey',
  'Tell us about your experience with our hotel services',
  '[
    {
      "id": "q_rating",
      "type": "rating_5",
      "text": "How would you rate your overall experience?",
      "required": true,
      "order": 1
    },
    {
      "id": "q_recommend",
      "type": "yes_no",
      "text": "Would you recommend us to others?",
      "required": true,
      "order": 2
    }
  ]'::jsonb,
  '{}'::jsonb,
  'public',
  'active',
  NOW(),
  NOW()
),
(
  'survey-sample-2',
  'Service Quality Assessment',
  'Help us improve our service quality',
  '[
    {
      "id": "q_service_rating",
      "type": "rating_10",
      "text": "Rate the quality of our customer service (1-10)",
      "required": true,
      "order": 1
    }
  ]'::jsonb,
  '{}'::jsonb,
  'public',
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  questions = EXCLUDED.questions,
  target_segment = EXCLUDED.target_segment,
  access_type = EXCLUDED.access_type,
  status = EXCLUDED.status,
  updated_at = NOW();