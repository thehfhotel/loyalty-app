import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiFileText,
  FiStar,
  FiUsers,
  FiHelpCircle,
  FiPlus,
  FiCopy,
  FiTrash2,
  FiEdit
} from 'react-icons/fi';
import DashboardButton from '../../components/navigation/DashboardButton';
import { Survey, SurveyQuestion } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import toast from 'react-hot-toast';

interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  questions: SurveyQuestion[];
  popularity: number;
}

const getPredefinedTemplates = (t: (key: string) => string): SurveyTemplate[] => [
  {
    id: 'satisfaction',
    name: t('surveys.admin.templates.predefinedTemplates.satisfaction.name'),
    description: t('surveys.admin.templates.predefinedTemplates.satisfaction.description'),
    icon: <FiStar className="h-8 w-8" />,
    category: t('surveys.admin.templates.categories.feedback'),
    popularity: 95,
    questions: [
      {
        id: 'q1',
        type: 'rating_5',
        text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q1.text'),
        description: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q1.description'),
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'single_choice',
        text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q2.text'),
        required: true,
        options: [
          { id: 'opt1', text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q2.options.veryLikely'), value: 5 },
          { id: 'opt2', text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q2.options.likely'), value: 4 },
          { id: 'opt3', text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q2.options.neutral'), value: 3 },
          { id: 'opt4', text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q2.options.unlikely'), value: 2 },
          { id: 'opt5', text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q2.options.veryUnlikely'), value: 1 }
        ],
        order: 2
      },
      {
        id: 'q3',
        type: 'textarea',
        text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q3.text'),
        required: false,
        order: 3
      },
      {
        id: 'q4',
        type: 'textarea',
        text: t('surveys.admin.templates.predefinedTemplates.satisfaction.questions.q4.text'),
        required: false,
        order: 4
      }
    ]
  },
  {
    id: 'nps',
    name: t('surveys.admin.templates.predefinedTemplates.nps.name'),
    description: t('surveys.admin.templates.predefinedTemplates.nps.description'),
    icon: <FiUsers className="h-8 w-8" />,
    category: t('surveys.admin.templates.categories.loyalty'),
    popularity: 88,
    questions: [
      {
        id: 'q1',
        type: 'rating_10',
        text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q1.text'),
        description: t('surveys.admin.templates.predefinedTemplates.nps.questions.q1.description'),
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'textarea',
        text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q2.text'),
        required: true,
        order: 2
      },
      {
        id: 'q3',
        type: 'single_choice',
        text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.text'),
        required: true,
        options: [
          { id: 'opt1', text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.options.room'), value: 'room' },
          { id: 'opt2', text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.options.staff'), value: 'staff' },
          { id: 'opt3', text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.options.location'), value: 'location' },
          { id: 'opt4', text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.options.value'), value: 'value' },
          { id: 'opt5', text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.options.amenities'), value: 'amenities' },
          { id: 'opt6', text: t('surveys.admin.templates.predefinedTemplates.nps.questions.q3.options.other'), value: 'other' }
        ],
        order: 3
      }
    ]
  },
  {
    id: 'post-stay',
    name: t('surveys.admin.templates.predefinedTemplates.postStay.name'),
    description: t('surveys.admin.templates.predefinedTemplates.postStay.description'),
    icon: <FiFileText className="h-8 w-8" />,
    category: t('surveys.admin.templates.categories.feedback'),
    popularity: 82,
    questions: [
      {
        id: 'q1',
        type: 'rating_5',
        text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q1.text'),
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'multiple_choice',
        text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.text'),
        required: false,
        options: [
          { id: 'opt1', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.pool'), value: 'pool' },
          { id: 'opt2', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.gym'), value: 'gym' },
          { id: 'opt3', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.spa'), value: 'spa' },
          { id: 'opt4', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.restaurant'), value: 'restaurant' },
          { id: 'opt5', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.bar'), value: 'bar' },
          { id: 'opt6', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.business'), value: 'business' },
          { id: 'opt7', text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q2.options.concierge'), value: 'concierge' }
        ],
        order: 2
      },
      {
        id: 'q3',
        type: 'yes_no',
        text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q3.text'),
        required: true,
        order: 3
      },
      {
        id: 'q4',
        type: 'textarea',
        text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q4.text'),
        required: false,
        order: 4
      },
      {
        id: 'q5',
        type: 'yes_no',
        text: t('surveys.admin.templates.predefinedTemplates.postStay.questions.q5.text'),
        required: true,
        order: 5
      }
    ]
  },
  {
    id: 'event-feedback',
    name: t('surveys.admin.templates.predefinedTemplates.eventFeedback.name'),
    description: t('surveys.admin.templates.predefinedTemplates.eventFeedback.description'),
    icon: <FiUsers className="h-8 w-8" />,
    category: t('surveys.admin.templates.categories.events'),
    popularity: 75,
    questions: [
      {
        id: 'q1',
        type: 'single_choice',
        text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q1.text'),
        required: true,
        options: [
          { id: 'opt1', text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q1.options.email'), value: 'email' },
          { id: 'opt2', text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q1.options.social'), value: 'social' },
          { id: 'opt3', text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q1.options.website'), value: 'website' },
          { id: 'opt4', text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q1.options.referral'), value: 'referral' },
          { id: 'opt5', text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q1.options.other'), value: 'other' }
        ],
        order: 1
      },
      {
        id: 'q2',
        type: 'rating_5',
        text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q2.text'),
        required: true,
        order: 2
      },
      {
        id: 'q3',
        type: 'rating_5',
        text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q3.text'),
        required: true,
        order: 3
      },
      {
        id: 'q4',
        type: 'yes_no',
        text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q4.text'),
        required: true,
        order: 4
      },
      {
        id: 'q5',
        type: 'textarea',
        text: t('surveys.admin.templates.predefinedTemplates.eventFeedback.questions.q5.text'),
        required: false,
        order: 5
      }
    ]
  },
  {
    id: 'quick-pulse',
    name: t('surveys.admin.templates.predefinedTemplates.quickPulse.name'),
    description: t('surveys.admin.templates.predefinedTemplates.quickPulse.description'),
    icon: <FiHelpCircle className="h-8 w-8" />,
    category: t('surveys.admin.templates.categories.quick'),
    popularity: 70,
    questions: [
      {
        id: 'q1',
        type: 'rating_5',
        text: t('surveys.admin.templates.predefinedTemplates.quickPulse.questions.q1.text'),
        required: true,
        order: 1
      },
      {
        id: 'q2',
        type: 'text',
        text: t('surveys.admin.templates.predefinedTemplates.quickPulse.questions.q2.text'),
        description: t('surveys.admin.templates.predefinedTemplates.quickPulse.questions.q2.description'),
        required: false,
        order: 2
      }
    ]
  }
];

const SurveyTemplates: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [customTemplates, setCustomTemplates] = useState<Survey[]>([]);

  useEffect(() => {
    try {
      setTemplates(getPredefinedTemplates(t));
      loadCustomTemplates();
    } catch (error) {
      console.error('Error initializing templates:', error);
      toast.error('Failed to load survey templates');
    }
  }, [t]);

  const loadCustomTemplates = () => {
    // Custom templates functionality is disabled for now
    // Templates are provided as predefined options only
    setCustomTemplates([]);
    setLoading(false);
  };

  const categories = [
    { key: 'all', label: t('surveys.admin.templates.allTemplates') },
    { key: 'Feedback', label: t('surveys.admin.templates.categories.feedback') },
    { key: 'Loyalty', label: t('surveys.admin.templates.categories.loyalty') },
    { key: 'Events', label: t('surveys.admin.templates.categories.events') },
    { key: 'Quick', label: t('surveys.admin.templates.categories.quick') },
    { key: 'Custom', label: t('surveys.admin.templates.categories.custom') }
  ];

  const filteredTemplates = selectedCategory === 'all' 
    ? templates 
    : templates.filter(template => template.category === t(`surveys.admin.templates.categories.${selectedCategory.toLowerCase()}`));

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
    if (!confirm(t('surveys.admin.templates.deleteConfirm'))) {
      return;
    }

    try {
      await surveyService.deleteSurvey(templateId);
      toast.success(t('surveys.admin.templates.templateDeleted'));
      loadCustomTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error(t('surveys.admin.templates.deleteFailed'));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{t('surveys.admin.templates.title')}</h1>
              <p className="text-sm text-gray-600 mt-1">
                {t('surveys.admin.templates.subtitle')}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/admin/surveys"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                {t('surveys.admin.templates.backToSurveys')}
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
                  key={category.key}
                  onClick={() => setSelectedCategory(category.key)}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === category.key
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {category.label}
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
                {t('surveys.admin.templates.startFromScratch')}
              </h3>
              <p className="text-gray-600">
                {t('surveys.admin.templates.createCustomSurvey')}
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
                      {t('surveys.admin.templates.popularityText', { percent: template.popularity })}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {template.name}
                  </h3>
                  
                  <p className="text-sm text-gray-600 mb-4">
                    {template.description}
                  </p>
                  
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>{t('surveys.admin.templates.questionsCount', { count: template.questions.length })}</span>
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
                      {t('surveys.admin.templates.useTemplate')}
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
                {t('surveys.admin.templates.customTemplatesTitle')}
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
                          {t('surveys.admin.templates.categories.custom')}
                        </span>
                      </div>
                      
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {template.title}
                      </h3>
                      
                      <p className="text-sm text-gray-600 mb-4">
                        {template.description ?? t('surveys.admin.templates.noDescription')}
                      </p>
                      
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                        <span>{template.questions.length} questions</span>
                        <span>
                          {t('surveys.admin.templates.created', { date: new Date(template.created_at).toLocaleDateString() })}
                        </span>
                      </div>
                      
                      <div className="flex space-x-2">
                        <button
                          onClick={() => navigate(`/admin/surveys/${template.id}/edit`)}
                          className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                          <FiEdit className="mr-2 h-4 w-4" />
                          {t('surveys.admin.templates.edit')}
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