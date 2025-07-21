import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { 
  FiFileText, 
  FiStar, 
  FiUsers, 
  FiShoppingCart, 
  FiHelpCircle,
  FiPlus,
  FiCopy,
  FiTrash2,
  FiEdit
} from 'react-icons/fi';
import DashboardButton from '../../components/navigation/DashboardButton';
import { Survey } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import toast from 'react-hot-toast';

interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  questions: any[];
  popularity: number;
}

const predefinedTemplates: SurveyTemplate[] = [
  {
    id: 'satisfaction',
    name: 'Customer Satisfaction Survey',
    description: 'Measure overall customer satisfaction with your services',
    icon: <FiStar className="h-8 w-8" />,
    category: 'Feedback',
    popularity: 95,
    questions: [
      {
        id: 'q1',
        type: 'rating_5',
        text: 'How satisfied are you with our service?',
        description: 'Please rate your overall satisfaction',
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'single_choice',
        text: 'How likely are you to recommend us to others?',
        required: true,
        options: [
          { id: 'opt1', text: 'Very likely', value: 5 },
          { id: 'opt2', text: 'Likely', value: 4 },
          { id: 'opt3', text: 'Neutral', value: 3 },
          { id: 'opt4', text: 'Unlikely', value: 2 },
          { id: 'opt5', text: 'Very unlikely', value: 1 }
        ],
        order: 2
      },
      {
        id: 'q3',
        type: 'textarea',
        text: 'What did you like most about your experience?',
        required: false,
        order: 3
      },
      {
        id: 'q4',
        type: 'textarea',
        text: 'What could we improve?',
        required: false,
        order: 4
      }
    ]
  },
  {
    id: 'nps',
    name: 'Net Promoter Score (NPS)',
    description: 'Measure customer loyalty and likelihood to recommend',
    icon: <FiUsers className="h-8 w-8" />,
    category: 'Loyalty',
    popularity: 88,
    questions: [
      {
        id: 'q1',
        type: 'rating_10',
        text: 'How likely are you to recommend our hotel to a friend or colleague?',
        description: '0 = Not at all likely, 10 = Extremely likely',
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'textarea',
        text: 'What is the primary reason for your score?',
        required: true,
        order: 2
      },
      {
        id: 'q3',
        type: 'single_choice',
        text: 'Which aspect influenced your rating the most?',
        required: true,
        options: [
          { id: 'opt1', text: 'Room quality', value: 'room' },
          { id: 'opt2', text: 'Staff service', value: 'staff' },
          { id: 'opt3', text: 'Location', value: 'location' },
          { id: 'opt4', text: 'Value for money', value: 'value' },
          { id: 'opt5', text: 'Amenities', value: 'amenities' },
          { id: 'opt6', text: 'Other', value: 'other' }
        ],
        order: 3
      }
    ]
  },
  {
    id: 'post-stay',
    name: 'Post-Stay Feedback',
    description: 'Gather detailed feedback after guest checkout',
    icon: <FiFileText className="h-8 w-8" />,
    category: 'Feedback',
    popularity: 82,
    questions: [
      {
        id: 'q1',
        type: 'rating_5',
        text: 'How would you rate your overall stay?',
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'multiple_choice',
        text: 'Which amenities did you use during your stay?',
        required: false,
        options: [
          { id: 'opt1', text: 'Swimming pool', value: 'pool' },
          { id: 'opt2', text: 'Gym/Fitness center', value: 'gym' },
          { id: 'opt3', text: 'Spa', value: 'spa' },
          { id: 'opt4', text: 'Restaurant', value: 'restaurant' },
          { id: 'opt5', text: 'Bar', value: 'bar' },
          { id: 'opt6', text: 'Business center', value: 'business' },
          { id: 'opt7', text: 'Concierge services', value: 'concierge' }
        ],
        order: 2
      },
      {
        id: 'q3',
        type: 'yes_no',
        text: 'Did you experience any issues during your stay?',
        required: true,
        order: 3
      },
      {
        id: 'q4',
        type: 'textarea',
        text: 'Please describe any issues you experienced',
        required: false,
        order: 4
      },
      {
        id: 'q5',
        type: 'yes_no',
        text: 'Would you stay with us again?',
        required: true,
        order: 5
      }
    ]
  },
  {
    id: 'event-feedback',
    name: 'Event Feedback Survey',
    description: 'Collect feedback from event or conference attendees',
    icon: <FiUsers className="h-8 w-8" />,
    category: 'Events',
    popularity: 75,
    questions: [
      {
        id: 'q1',
        type: 'single_choice',
        text: 'How did you hear about this event?',
        required: true,
        options: [
          { id: 'opt1', text: 'Email invitation', value: 'email' },
          { id: 'opt2', text: 'Social media', value: 'social' },
          { id: 'opt3', text: 'Website', value: 'website' },
          { id: 'opt4', text: 'Word of mouth', value: 'referral' },
          { id: 'opt5', text: 'Other', value: 'other' }
        ],
        order: 1
      },
      {
        id: 'q2',
        type: 'rating_5',
        text: 'How would you rate the event overall?',
        required: true,
        order: 2
      },
      {
        id: 'q3',
        type: 'rating_5',
        text: 'How satisfied were you with the venue and facilities?',
        required: true,
        order: 3
      },
      {
        id: 'q4',
        type: 'yes_no',
        text: 'Would you attend a similar event in the future?',
        required: true,
        order: 4
      },
      {
        id: 'q5',
        type: 'textarea',
        text: 'Any suggestions for future events?',
        required: false,
        order: 5
      }
    ]
  },
  {
    id: 'quick-pulse',
    name: 'Quick Pulse Check',
    description: 'Short 2-3 question survey for quick feedback',
    icon: <FiHelpCircle className="h-8 w-8" />,
    category: 'Quick',
    popularity: 70,
    questions: [
      {
        id: 'q1',
        type: 'rating_5',
        text: 'How was your experience today?',
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'text',
        text: 'What made it that way?',
        description: 'Please share in a few words',
        required: false,
        order: 2
      }
    ]
  }
];

const SurveyTemplates: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<SurveyTemplate[]>(predefinedTemplates);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [customTemplates, setCustomTemplates] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCustomTemplates();
  }, []);

  const loadCustomTemplates = async () => {
    try {
      setLoading(true);
      // Load surveys that are marked as templates
      const response = await surveyService.getSurveys(1, 100, 'template');
      setCustomTemplates(response.surveys);
    } catch (error) {
      console.error('Error loading custom templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const categories = ['all', 'Feedback', 'Loyalty', 'Events', 'Quick', 'Custom'];

  const filteredTemplates = selectedCategory === 'all' 
    ? templates 
    : templates.filter(t => t.category === selectedCategory);

  const handleUseTemplate = (template: SurveyTemplate) => {
    // Navigate to survey builder with template data
    navigate('/admin/surveys/create', { 
      state: { 
        template: {
          title: template.name,
          description: template.description,
          questions: template.questions
        }
      }
    });
  };

  const handleDeleteCustomTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      await surveyService.deleteSurvey(templateId);
      toast.success('Template deleted successfully');
      loadCustomTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Survey Templates</h1>
              <p className="text-sm text-gray-600 mt-1">
                Start with a pre-built template or create your own
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/admin/surveys"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Back to Surveys
              </Link>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Category Filter */}
          <div className="mb-6">
            <div className="flex space-x-2 overflow-x-auto pb-2">
              {categories.map(category => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === category
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {category === 'all' ? 'All Templates' : category}
                </button>
              ))}
            </div>
          </div>

          {/* Blank Template Card */}
          <div className="mb-8">
            <div
              onClick={() => navigate('/admin/surveys/create')}
              className="bg-white rounded-lg shadow-sm border-2 border-dashed border-gray-300 hover:border-blue-400 p-8 text-center cursor-pointer transition-all hover:shadow-md"
            >
              <FiPlus className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Start from Scratch
              </h3>
              <p className="text-gray-600">
                Create a custom survey with your own questions
              </p>
            </div>
          </div>

          {/* Template Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map(template => (
              <div
                key={template.id}
                className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="text-blue-600">{template.icon}</div>
                    <span className="text-xs text-gray-500">
                      {template.popularity}% use this
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {template.name}
                  </h3>
                  
                  <p className="text-sm text-gray-600 mb-4">
                    {template.description}
                  </p>
                  
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>{template.questions.length} questions</span>
                    <span className="bg-gray-100 px-2 py-1 rounded">
                      {template.category}
                    </span>
                  </div>
                  
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleUseTemplate(template)}
                      className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <FiCopy className="mr-2 h-4 w-4" />
                      Use Template
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Custom Templates Section */}
          {customTemplates.length > 0 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mt-12 mb-6">
                Your Custom Templates
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {customTemplates.map(template => (
                  <div
                    key={template.id}
                    className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
                  >
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="text-purple-600">
                          <FiFileText className="h-8 w-8" />
                        </div>
                        <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">
                          Custom
                        </span>
                      </div>
                      
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {template.title}
                      </h3>
                      
                      <p className="text-sm text-gray-600 mb-4">
                        {template.description || 'No description'}
                      </p>
                      
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                        <span>{template.questions.length} questions</span>
                        <span>
                          Created {new Date(template.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div className="flex space-x-2">
                        <button
                          onClick={() => navigate(`/admin/surveys/${template.id}/edit`)}
                          className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                          <FiEdit className="mr-2 h-4 w-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCustomTemplate(template.id)}
                          className="inline-flex items-center justify-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50"
                        >
                          <FiTrash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SurveyTemplates;