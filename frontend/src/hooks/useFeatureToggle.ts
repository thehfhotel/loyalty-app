import { useState, useEffect } from 'react';
import { featureToggleService } from '../services/featureToggleService';

/**
 * Hook to check if a feature is enabled
 * @param featureKey - The feature key to check
 * @returns boolean indicating if the feature is enabled
 */
export function useFeatureToggle(featureKey: string): boolean {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkFeature = async () => {
      try {
        const enabled = await featureToggleService.isFeatureEnabled(featureKey);
        setIsEnabled(enabled);
      } catch (error) {
        console.warn(`Failed to check feature toggle for ${featureKey}:`, error);
        // Default to false on error for safety
        setIsEnabled(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkFeature();
  }, [featureKey]);

  return isEnabled;
}

/**
 * Hook to get multiple feature toggles at once for efficiency
 * @param featureKeys - Array of feature keys to check
 * @returns Record<string, boolean> mapping feature keys to their enabled status
 */
export function useFeatureToggles(featureKeys: string[]): Record<string, boolean> {
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkFeatures = async () => {
      try {
        const publicFeatures = await featureToggleService.getPublicFeatures();
        
        // Filter to only the requested features
        const requestedFeatures: Record<string, boolean> = {};
        featureKeys.forEach(key => {
          requestedFeatures[key] = publicFeatures[key] || false;
        });
        
        setFeatures(requestedFeatures);
      } catch (error) {
        console.warn('Failed to check feature toggles:', error);
        // Default all to false on error for safety
        const defaultFeatures: Record<string, boolean> = {};
        featureKeys.forEach(key => {
          defaultFeatures[key] = false;
        });
        setFeatures(defaultFeatures);
      } finally {
        setIsLoading(false);
      }
    };

    if (featureKeys.length > 0) {
      checkFeatures();
    } else {
      setIsLoading(false);
    }
  }, [featureKeys.join(',')]);

  return features;
}

/**
 * Common feature keys used throughout the application
 */
export const FEATURE_KEYS = {
  ACCOUNT_LINKING: 'account_linking',
  FACEBOOK_OAUTH: 'facebook_oauth',
} as const;