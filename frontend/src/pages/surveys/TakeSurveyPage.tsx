import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { SurveyProgress } from '../../components/surveys/SurveyProgress';
import { SurveyQuestionForm } from '../../components/surveys/SurveyQuestionForm';
import { 
  surveyService, 
  Survey, 
  SurveyResponse, 
  SurveyQuestion,
  QuestionAnswer
} from '../../services/surveyService';
import toast from 'react-hot-toast';

const TakeSurveyPage: React.FC = () => {
  const { responseId } = useParams<{ responseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get survey from navigation state if available
  const surveyFromState = location.state?.survey as Survey;
  
  const [survey, setSurvey] = useState<Survey | null>(surveyFromState || null);
  const [response, setResponse] = useState<SurveyResponse | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (responseId) {
      loadSurveyResponse();
    }
  }, [responseId]);

  useEffect(() => {
    // Timer for elapsed time
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((new Date().getTime() - startTime.getTime()) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime]);

  const loadSurveyResponse = async () => {
    if (!responseId) return;
    
    setIsLoading(true);
    try {
      const responseData = await surveyService.getSurveyResponse(responseId);
      setResponse(responseData);
      
      if (!survey) {
        const surveyData = await surveyService.getSurvey(responseData.surveyId);
        setSurvey(surveyData);
      }
      
      const questionsData = await surveyService.getSurveyQuestions(responseData.surveyId);
      setQuestions(questionsData);
      
      // Load existing answers
      const existingAnswers: Record<string, any> = {};
      responseData.answers?.forEach((answer: QuestionAnswer) => {
        existingAnswers[answer.questionId] = answer.answer;
      });
      setAnswers(existingAnswers);
      
      // Find current question index based on progress
      const answeredQuestions = Object.keys(existingAnswers).length;
      setCurrentQuestionIndex(Math.min(answeredQuestions, questionsData.length - 1));
      
    } catch (error) {
      toast.error('Failed to load survey');
      console.error('Error loading survey response:', error);
      navigate('/surveys');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerChange = (answer: any) => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: answer
    }));
  };

  const handleNext = async () => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;

    // Validate current answer
    const answer = answers[currentQuestion.id];
    const validation = surveyService.validateAnswer(currentQuestion, answer);
    
    if (!validation.isValid) {
      toast.error(validation.error || 'Please provide a valid answer');
      return;
    }

    // Save progress
    await saveProgress();

    // Move to next question
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      // This is the last question, submit survey
      await handleSubmit();
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const saveProgress = async () => {
    if (!responseId || !response) return;
    
    setIsSaving(true);
    try {
      const answersArray = Object.entries(answers).map(([questionId, answer]) => ({
        questionId,
        answer
      }));

      await surveyService.saveSurveyProgress(responseId, answersArray);
    } catch (error) {
      console.error('Error saving progress:', error);
      // Don't show error to user for auto-save
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!responseId || !response) return;

    // Validate all required questions are answered
    const unansweredRequired = questions.filter(q => 
      q.isRequired && !answers[q.id]
    );

    if (unansweredRequired.length > 0) {
      toast.error(`Please answer all required questions (${unansweredRequired.length} remaining)`);
      return;
    }

    setIsSubmitting(true);
    try {
      const answersArray = Object.entries(answers).map(([questionId, answer]) => ({
        questionId,
        answer
      }));

      const result = await surveyService.completeSurveyResponse(responseId, answersArray);
      
      toast.success(`Survey completed! You earned ${result.pointsAwarded} points.`);
      navigate('/surveys', { 
        state: { 
          completed: true,
          pointsEarned: result.pointsAwarded 
        }
      });
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to submit survey');
      console.error('Error submitting survey:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExit = () => {
    if (Object.keys(answers).length > 0) {
      const confirmed = window.confirm(
        'Are you sure you want to exit? Your progress will be saved and you can continue later.'
      );
      if (confirmed) {
        saveProgress().then(() => {
          navigate('/surveys');
        });
      }
    } else {
      navigate('/surveys');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading survey..." />
      </div>
    );
  }

  if (!survey || !response || questions.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Survey not found
          </h2>
          <p className="text-gray-600 mb-4">
            The survey you're looking for could not be loaded.
          </p>
          <Button onClick={() => navigate('/surveys')}>
            Back to Surveys
          </Button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const completedQuestions = Object.keys(answers).length;
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Progress Header */}
      <SurveyProgress
        currentStep={currentQuestionIndex + 1}
        totalSteps={questions.length}
        completedSteps={completedQuestions}
        estimatedTime={survey.estimatedTime}
        elapsedTime={elapsedTime}
      />

      {/* Survey Content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Survey Header */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={handleExit}
            >
              Exit Survey
            </Button>
            {isSaving && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <div className="animate-spin rounded-full h-3 w-3 border-b border-gray-600" />
                Saving...
              </div>
            )}
          </div>
          
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {survey.title}
            </h1>
            <p className="text-gray-600">
              {survey.description}
            </p>
          </div>
        </div>

        {/* Question Form */}
        <SurveyQuestionForm
          question={currentQuestion}
          initialAnswer={answers[currentQuestion.id]}
          onAnswerChange={handleAnswerChange}
          onNext={handleNext}
          onPrevious={handlePrevious}
          isFirst={currentQuestionIndex === 0}
          isLast={isLastQuestion}
          showNavigation={false}
        />

        {/* Custom Navigation */}
        <div className="flex justify-between items-center mt-6 pt-6 border-t border-gray-200">
          <Button
            variant="secondary"
            onClick={handlePrevious}
            disabled={currentQuestionIndex === 0}
          >
            Previous
          </Button>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              leftIcon={<Save className="w-4 h-4" />}
              onClick={saveProgress}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save & Exit'}
            </Button>
            
            <Button
              variant="primary"
              rightIcon={isLastQuestion ? <Send className="w-4 h-4" /> : undefined}
              onClick={handleNext}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 
               isLastQuestion ? 'Submit Survey' : 'Next Question'}
            </Button>
          </div>
        </div>

        {/* Survey Info */}
        <div className="mt-8 p-4 bg-white rounded-lg border border-gray-200">
          <div className="flex justify-between items-center text-sm text-gray-600">
            <span>Survey Code: <code className="font-mono">{survey.code}</code></span>
            <span>Points Reward: {survey.pointsReward}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TakeSurveyPage;