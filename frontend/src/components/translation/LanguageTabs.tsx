import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SupportedLanguage } from '../../types/multilingual';
import { FiCheck, FiClock, FiAlertCircle, FiFile } from 'react-icons/fi';

interface LanguageTabsProps {
  languages: SupportedLanguage[];
  currentLanguage: SupportedLanguage;
  onLanguageChange: (language: SupportedLanguage) => void;
  translationStatus?: { [key in SupportedLanguage]?: 'original' | 'translated' | 'pending' | 'error' };
  isLoading?: boolean;
  className?: string;
  'aria-label'?: string;
}

const LanguageTabs: React.FC<LanguageTabsProps> = ({
  languages,
  currentLanguage,
  onLanguageChange,
  translationStatus = {},
  isLoading = false,
  className = '',
  'aria-label': ariaLabel = 'Language selection'
}) => {
  const { t } = useTranslation();

  // Memoize language display names for performance
  const languageNames = useMemo(() => ({
    'th': 'ไทย',
    'en': 'English',
    'zh-CN': '中文'
  } as const), []);

  const getLanguageDisplayName = useCallback((language: SupportedLanguage): string => {
    return languageNames[language] ?? language;
  }, [languageNames]);

  // Memoize status indicators for performance
  const getStatusIndicator = useCallback((language: SupportedLanguage) => {
    // Only show status indicators if translationStatus prop is provided and has values
    if (!translationStatus || Object.keys(translationStatus).length === 0) {
      return null;
    }
    
    const status = translationStatus[language];
    
    const statusConfig = {
      original: { color: 'text-blue-600', label: t('translation.original') },
      translated: { color: 'text-green-600', label: t('translation.translated') },
      pending: { color: 'text-yellow-600 animate-pulse', label: t('translation.pending') },
      error: { color: 'text-red-600', label: t('translation.error') }
    };
    
    const config = statusConfig[status as keyof typeof statusConfig];
    if (!config) {return null;}
    
    return (
      <span 
        className={`${config.color} text-xs`}
        aria-label={config.label}
        role="status"
      >
        ●
      </span>
    );
  }, [translationStatus, t]);

  // Memoize the tab click handler
  const handleLanguageChange = useCallback((language: SupportedLanguage) => {
    if (isLoading || language === currentLanguage) {return;}
    onLanguageChange(language);
  }, [isLoading, currentLanguage, onLanguageChange]);

  // Memoize the tabs to prevent unnecessary re-renders
  const tabs = useMemo(() => 
    languages.map((language) => {
      const isActive = currentLanguage === language;
      const isDisabled = isLoading;
      
      return (
        <button
          key={language}
          onClick={() => handleLanguageChange(language)}
          disabled={isDisabled}
          className={`
            relative whitespace-nowrap py-2 px-3 border-b-2 font-medium text-sm 
            flex items-center space-x-2 transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed
            ${isActive
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            }
          `}
          aria-pressed={isActive}
          aria-label={`Switch to ${getLanguageDisplayName(language)}`}
          role="tab"
          tabIndex={isActive ? 0 : -1}
        >
          <span>{getLanguageDisplayName(language)}</span>
          {getStatusIndicator(language)}
          {isLoading && isActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
              <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </button>
      );
    }), [languages, currentLanguage, isLoading, handleLanguageChange, getLanguageDisplayName, getStatusIndicator]);

  return (
    <div className={`border-b border-gray-200 ${className}`}>
      <nav 
        className="-mb-px flex space-x-8" 
        aria-label={ariaLabel}
        role="tablist"
      >
        {tabs}
      </nav>
      
      {/* Enhanced Status Legend */}
      {translationStatus && Object.keys(translationStatus).length > 0 && (
        <StatusLegend translationStatus={translationStatus} />      
      )}
    </div>
  );
};

// Enhanced Status Legend Component
interface StatusLegendProps {
  translationStatus: { [key in SupportedLanguage]?: 'original' | 'translated' | 'pending' | 'error' };
}

const StatusLegend: React.FC<StatusLegendProps> = ({ translationStatus }) => {
  const { t } = useTranslation();

  // Memoize status configuration for performance
  const statusConfig = useMemo(() => ({
    original: {
      icon: FiFile,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      label: t('translation.original'),
      description: t('translation.originalDescription')
    },
    translated: {
      icon: FiCheck,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      label: t('translation.translated'),
      description: t('translation.translatedDescription')
    },
    pending: {
      icon: FiClock,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      label: t('translation.pending'),
      description: t('translation.pendingDescription')
    },
    error: {
      icon: FiAlertCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      label: t('translation.error'),
      description: t('translation.errorDescription')
    }
  }), [t]);

  // Get unique statuses currently in use
  const activeStatuses = useMemo(() => {
    const statusesInUse = Object.values(translationStatus).filter(Boolean);
    return [...new Set(statusesInUse)] as Array<keyof typeof statusConfig>;
  }, [translationStatus]);

  // Count languages by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(translationStatus).forEach(status => {
      if (status) {
        counts[status] = (counts[status] ?? 0) + 1;
      }
    });
    return counts;
  }, [translationStatus]);

  if (activeStatuses.length === 0) {return null;}

  return (
    <div 
      className="mt-4 p-4 bg-gradient-to-r from-slate-50 to-gray-50 border border-gray-200 rounded-lg shadow-sm"
      role="region"
      aria-label={t('translation.statusLegend')}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700 flex items-center space-x-2">
          <span>{t('translation.statusLegend')}</span>
          <span className="text-xs text-gray-500">(
            {Object.keys(translationStatus).length} {t('translation.languages')}
          )
          </span>
        </h3>
      </div>
      
      {/* Status Items */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {activeStatuses.map((status) => {
          const config = statusConfig[status];
          const count = statusCounts[status] ?? 0;
          const IconComponent = config.icon;
          
          return (
            <div
              key={status}
              className={`
                flex items-center p-3 rounded-md border transition-all duration-200
                ${config.bgColor} ${config.borderColor} 
                hover:shadow-sm group
              `}
              role="listitem"
              aria-label={`${config.label}: ${count} ${count === 1 ? t('translation.language') : t('translation.languages')}`}
            >
              <div className={`flex-shrink-0 ${config.color} mr-3`}>
                <IconComponent size={16} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${config.color} truncate`}>
                    {config.label}
                  </span>
                  <span className={`ml-2 text-xs font-semibold ${config.color} bg-white px-2 py-0.5 rounded-full`}>
                    {count}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1 group-hover:text-gray-600 transition-colors">
                  {config.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Progress Summary */}
      {activeStatuses.includes('translated') && activeStatuses.includes('pending') && (
        <div className="mt-3 p-2 bg-white rounded border border-gray-200">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">{t('translation.progress')}:</span>
            <div className="flex items-center space-x-2">
              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${(statusCounts.translated ?? 0) / Object.keys(translationStatus).length * 100}%` 
                  }}
                  aria-label={`${Math.round((statusCounts.translated || 0) / Object.keys(translationStatus).length * 100)}% complete`}
                />
              </div>
              <span className="text-green-600 font-medium">
                {Math.round((statusCounts.translated || 0) / Object.keys(translationStatus).length * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LanguageTabs;