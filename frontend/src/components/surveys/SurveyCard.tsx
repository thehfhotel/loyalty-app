import React from 'react';
import { format } from 'date-fns';
import { 
  ClipboardList, 
  Clock, 
  Calendar, 
  Award, 
  Users, 
  ChevronRight,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Survey, SurveyWithProgress, surveyService } from '../../services/surveyService';

interface SurveyCardProps {
  survey: SurveyWithProgress;
  onStart?: (survey: Survey) => void;
  onContinue?: (survey: Survey) => void;
  variant?: 'available' | 'started' | 'completed';
}

export const SurveyCard: React.FC<SurveyCardProps> = ({
  survey,
  onStart,
  onContinue,
  variant = 'available'
}) => {
  const isExpired = surveyService.isSurveyExpired(survey);
  const isAvailable = surveyService.isSurveyAvailable(survey);
  const daysUntilExpiry = surveyService.getDaysUntilExpiry(survey);
  
  const getStatusBadge = () => {
    if (variant === 'completed') {
      return <Badge variant="success">Completed</Badge>;
    }
    if (variant === 'started') {
      return <Badge variant="warning">In Progress</Badge>;
    }
    if (isExpired) {
      return <Badge variant="danger">Expired</Badge>;
    }
    if (!isAvailable) {
      return <Badge variant="secondary">Full</Badge>;
    }
    if (daysUntilExpiry <= 3) {
      return <Badge variant="warning">Expires Soon</Badge>;
    }
    return <Badge variant="success">Available</Badge>;
  };
  
  const handleActionClick = () => {
    if (variant === 'started' && onContinue) {
      onContinue(survey);
    } else if (variant === 'available' && onStart) {
      onStart(survey);
    }
  };
  
  return (
    <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-primary-100 p-2 rounded-lg">
                <ClipboardList className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-gray-900 leading-tight">
                  {survey.title}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Code: <code className="font-mono">{survey.code}</code>
                </p>
              </div>
            </div>
            {getStatusBadge()}
          </div>
          
          {/* Description */}
          <p className="text-gray-600 text-sm leading-relaxed line-clamp-3">
            {survey.description}
          </p>
          
          {/* Progress Bar (for started surveys) */}
          {variant === 'started' && survey.progress !== undefined && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Progress</span>
                <span className="font-medium text-primary-600">{survey.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${survey.progress}%` }}
                />
              </div>
            </div>
          )}
          
          {/* Survey Details */}
          <div className="grid grid-cols-2 gap-4 py-3 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              <span>{surveyService.formatEstimatedTime(survey.estimatedTime)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Award className="w-4 h-4" />
              <span>{survey.pointsReward} points</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Users className="w-4 h-4" />
              <span>
                {survey.responseCount}
                {survey.maxResponses && ` / ${survey.maxResponses}`} responses
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Calendar className="w-4 h-4" />
              <span>
                Until {format(new Date(survey.endDate), 'MMM dd')}
              </span>
            </div>
          </div>
          
          {/* Questions Info */}
          {survey.questionCount && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
              <span className="font-medium">{survey.questionCount} questions</span>
              {survey.questions && survey.questions.length > 0 && (
                <span className="ml-2">
                  • {survey.questions.filter(q => q.isRequired).length} required
                </span>
              )}
            </div>
          )}
          
          {/* Expiry Warning */}
          {daysUntilExpiry > 0 && daysUntilExpiry <= 7 && variant === 'available' && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <span className="text-sm text-orange-800">
                Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          
          {/* Completion Info */}
          {variant === 'completed' && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <div className="text-sm">
                <span className="text-green-800 font-medium">Completed</span>
                <span className="text-green-600 ml-2">
                  +{survey.pointsReward} points earned
                </span>
              </div>
            </div>
          )}
          
          {/* Action Button */}
          <div className="pt-2">
            {variant === 'available' && isAvailable && !isExpired && (
              <Button
                variant="primary"
                fullWidth
                onClick={handleActionClick}
                rightIcon={<ChevronRight className="w-4 h-4" />}
              >
                Start Survey
              </Button>
            )}
            
            {variant === 'started' && (
              <Button
                variant="primary"
                fullWidth
                onClick={handleActionClick}
                rightIcon={<ChevronRight className="w-4 h-4" />}
              >
                Continue Survey
              </Button>
            )}
            
            {variant === 'completed' && (
              <Button
                variant="secondary"
                fullWidth
                disabled
              >
                Survey Completed
              </Button>
            )}
            
            {!isAvailable && variant === 'available' && (
              <div className="text-center text-sm text-gray-500 py-2">
                {isExpired ? 'This survey has expired' : 'This survey is no longer available'}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};