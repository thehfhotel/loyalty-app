import React from 'react';
import { CheckCircle, Circle, Clock } from 'lucide-react';

interface SurveyProgressProps {
  currentStep: number;
  totalSteps: number;
  completedSteps: number;
  estimatedTime?: number;
  elapsedTime?: number;
}

export const SurveyProgress: React.FC<SurveyProgressProps> = ({
  currentStep,
  totalSteps,
  completedSteps,
  estimatedTime,
  elapsedTime
}) => {
  const progressPercentage = (completedSteps / totalSteps) * 100;
  
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  return (
    <div className="bg-white border-b border-gray-200 p-4 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Progress Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Question {currentStep} of {totalSteps}
            </h2>
            <p className="text-sm text-gray-600">
              {completedSteps} completed • {totalSteps - completedSteps} remaining
            </p>
          </div>
          
          {/* Time Info */}
          <div className="text-right">
            {elapsedTime !== undefined && (
              <div className="flex items-center gap-1 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                <span>{formatTime(elapsedTime)}</span>
              </div>
            )}
            {estimatedTime && (
              <div className="text-xs text-gray-500">
                Est. {estimatedTime}m total
              </div>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>0%</span>
            <span className="font-medium text-primary-600">
              {Math.round(progressPercentage)}%
            </span>
            <span>100%</span>
          </div>
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-between">
          {Array.from({ length: Math.min(totalSteps, 10) }, (_, index) => {
            const stepNumber = index + 1;
            const isCompleted = stepNumber <= completedSteps;
            const isCurrent = stepNumber === currentStep;
            
            return (
              <div
                key={stepNumber}
                className={`flex items-center ${
                  index < Math.min(totalSteps, 10) - 1 ? 'flex-1' : ''
                }`}
              >
                <div className="relative">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                      isCompleted
                        ? 'bg-green-500 text-white'
                        : isCurrent
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      stepNumber
                    )}
                  </div>
                  
                  {isCurrent && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
                  )}
                </div>
                
                {index < Math.min(totalSteps, 10) - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 transition-colors ${
                      stepNumber <= completedSteps ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            );
          })}
          
          {totalSteps > 10 && (
            <div className="text-xs text-gray-500 ml-2">
              +{totalSteps - 10} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
};