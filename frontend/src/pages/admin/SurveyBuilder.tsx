import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FiPlus, FiTrash2, FiMove, FiSave, FiEye } from 'react-icons/fi';
import { Survey, SurveyQuestion, CreateSurveyRequest, QuestionType } from '../../types/survey';
import { surveyService } from '../../services/surveyService';
import DashboardButton from '../../components/navigation/DashboardButton';
import QuestionEditor from '../../components/surveys/QuestionEditor';
import SurveyPreview from '../../components/surveys/SurveyPreview';
import toast from 'react-hot-toast';

const SurveyBuilder: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  const [survey, setSurvey] = useState<Partial<Survey>>({
    title: '',
    description: '',
    questions: [],
    target_segment: {},
    status: 'draft',
    access_type: 'public'
  });
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isEditing) {
      loadSurvey();
    } else if (location.state?.template) {
      // Load from template
      const template = location.state.template;
      setSurvey({
        title: template.title,
        description: template.description,
        questions: template.questions,
        target_segment: {},
        status: 'draft',
        access_type: 'public'
      });
    }
  }, [id, isEditing, location.state]);

  const loadSurvey = async () => {
    if (!id) return;
    
    try {
      setLoading(true);
      const surveyData = await surveyService.getSurveyById(id);
      setSurvey(surveyData);
    } catch (err: any) {
      console.error('Error loading survey:', err);
      toast.error('Failed to load survey');
      navigate('/admin/surveys');
    } finally {
      setLoading(false);
    }
  };

  const handleSurveyChange = (field: string, value: any) => {
    setSurvey(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addQuestion = (type: QuestionType) => {
    const newQuestion: SurveyQuestion = {
      id: surveyService.generateQuestionId(),
      type,
      text: '',
      required: true,
      order: (survey.questions?.length || 0) + 1,
      ...(type === 'multiple_choice' || type === 'single_choice' ? {
        options: [
          { id: surveyService.generateOptionId(), text: 'Option 1', value: 'option1' },
          { id: surveyService.generateOptionId(), text: 'Option 2', value: 'option2' }
        ]
      } : {}),
      ...(type === 'rating_5' ? { min_rating: 1, max_rating: 5 } : {}),
      ...(type === 'rating_10' ? { min_rating: 1, max_rating: 10 } : {})
    };

    setSurvey(prev => ({
      ...prev,
      questions: [...(prev.questions || []), newQuestion]
    }));
  };

  const updateQuestion = (questionId: string, updates: Partial<SurveyQuestion>) => {
    setSurvey(prev => ({
      ...prev,
      questions: prev.questions?.map(q => 
        q.id === questionId ? { ...q, ...updates } : q
      ) || []
    }));
  };

  const removeQuestion = (questionId: string) => {
    setSurvey(prev => ({
      ...prev,
      questions: prev.questions?.filter(q => q.id !== questionId) || []
    }));
  };

  const reorderQuestions = (fromIndex: number, toIndex: number) => {
    const questions = [...(survey.questions || [])];
    const [removed] = questions.splice(fromIndex, 1);
    questions.splice(toIndex, 0, removed);
    
    // Update order numbers
    const reorderedQuestions = questions.map((q, index) => ({
      ...q,
      order: index + 1
    }));

    setSurvey(prev => ({
      ...prev,
      questions: reorderedQuestions
    }));
  };

  const saveSurvey = async (status?: string) => {
    if (!survey.title || !survey.questions?.length) {
      toast.error('Please provide a title and at least one question');
      return;
    }

    try {
      setSaving(true);
      
      const surveyData: CreateSurveyRequest = {
        title: survey.title,
        description: survey.description,
        questions: survey.questions,
        target_segment: survey.target_segment,
        ...(status && { status })
      };

      if (isEditing && id) {
        await surveyService.updateSurvey(id, { ...surveyData, status: status || survey.status });
        toast.success('Survey updated successfully');
      } else {
        const newSurvey = await surveyService.createSurvey(surveyData);
        toast.success('Survey created successfully');
        navigate(`/admin/surveys/${newSurvey.id}/edit`);
      }
    } catch (err: any) {
      console.error('Error saving survey:', err);
      toast.error(err.response?.data?.message || 'Failed to save survey');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto p-4">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Loading survey...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                {isEditing ? 'Edit Survey' : 'Create Survey'}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FiEye className="mr-2 h-4 w-4" />
                {showPreview ? 'Hide Preview' : 'Preview'}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4">
        {showPreview ? (
          <SurveyPreview survey={survey as Survey} onClose={() => setShowPreview(false)} />
        ) : (
          <div className="space-y-6">
            {/* Basic Information */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h2>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                    Survey Title *
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={survey.title || ''}
                    onChange={(e) => handleSurveyChange('title', e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Enter survey title..."
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                    Description
                  </label>
                  <textarea
                    id="description"
                    rows={3}
                    value={survey.description || ''}
                    onChange={(e) => handleSurveyChange('description', e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Describe the purpose of this survey..."
                  />
                </div>

                <div>
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                    Status
                  </label>
                  <select
                    id="status"
                    value={survey.status || 'draft'}
                    onChange={(e) => handleSurveyChange('status', e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="access_type" className="block text-sm font-medium text-gray-700">
                    Access Type *
                  </label>
                  <select
                    id="access_type"
                    value={survey.access_type || 'public'}
                    onChange={(e) => handleSurveyChange('access_type', e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="public">Public - Available to all users in the app</option>
                    <option value="invite_only">Invite Only - Specific users must be invited</option>
                  </select>
                  <p className="mt-2 text-sm text-gray-500">
                    {survey.access_type === 'public' 
                      ? 'Public surveys appear in the user\'s "Take Survey" menu and are accessible to all users.'
                      : 'Invite-only surveys are only visible to users who receive specific invitations from administrators.'
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Questions */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium text-gray-900">Questions</h2>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">
                    {survey.questions?.length || 0} questions
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {survey.questions?.map((question, index) => (
                  <QuestionEditor
                    key={question.id}
                    question={question}
                    index={index}
                    onUpdate={(updates) => updateQuestion(question.id, updates)}
                    onRemove={() => removeQuestion(question.id)}
                    onReorder={reorderQuestions}
                    canMove={survey.questions!.length > 1}
                  />
                ))}

                {survey.questions?.length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                    <p className="text-gray-500 mb-4">No questions added yet</p>
                  </div>
                )}
              </div>

              {/* Add Question Buttons */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Add Question</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <button
                    onClick={() => addQuestion('single_choice')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    Single Choice
                  </button>
                  <button
                    onClick={() => addQuestion('multiple_choice')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    Multiple Choice
                  </button>
                  <button
                    onClick={() => addQuestion('text')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    Text Input
                  </button>
                  <button
                    onClick={() => addQuestion('textarea')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    Long Text
                  </button>
                  <button
                    onClick={() => addQuestion('rating_5')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    5-Star Rating
                  </button>
                  <button
                    onClick={() => addQuestion('rating_10')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    10-Point Scale
                  </button>
                  <button
                    onClick={() => addQuestion('yes_no')}
                    className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FiPlus className="mr-2 h-4 w-4" />
                    Yes/No
                  </button>
                </div>
              </div>
            </div>

            {/* Save Actions */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex justify-between items-center">
                <button
                  onClick={() => navigate('/admin/surveys')}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => saveSurvey('draft')}
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    <FiSave className="mr-2 h-4 w-4" />
                    Save Draft
                  </button>
                  
                  <button
                    onClick={() => saveSurvey('active')}
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>}
                    {isEditing ? 'Update & Publish' : 'Create & Publish'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SurveyBuilder;