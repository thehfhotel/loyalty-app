import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  text?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  size = 'md', 
  className = '',
  text 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <Loader2 className={`${sizeClasses[size]} animate-spin text-primary-600`} />
      {text && (
        <span className="text-sm text-gray-600 font-medium">{text}</span>
      )}
    </div>
  );
};

// Full page loading spinner
export const FullPageLoader: React.FC<{ text?: string }> = ({ text = "Loading..." }) => {
  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
};