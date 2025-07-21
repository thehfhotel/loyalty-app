import React from 'react';
import { useTranslation } from 'react-i18next';

interface SurveyProgressProps {
  current: number;
  total: number;
  progress: number;
}

const SurveyProgress: React.FC<SurveyProgressProps> = ({
  current,
  total,
  progress
}) => {
  const { t } = useTranslation();

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-700">
          {t('surveys.progress', 'Progress')}: {current} {t('surveys.of', 'of')} {total}
        </span>
        <span className="text-sm font-medium text-blue-600">
          {progress}%
        </span>
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      
      {progress > 0 && progress < 100 && (
        <p className="text-xs text-gray-500 mt-1">
          {t('surveys.progressSaved', 'Your progress is automatically saved')}
        </p>
      )}
    </div>
  );
};

export default SurveyProgress;