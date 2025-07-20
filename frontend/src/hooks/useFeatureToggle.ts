import { useState, useEffect } from 'react';
import { featureToggleService } from '../services/featureToggleService';

// Cache to avoid multiple API calls for the same session
const featureCache: Record<string, boolean> = {};
let cachePromise: Promise<Record<string, boolean>> | null = null;

/**
 * Hook to check if a feature is enabled
 * @param featureKey - The feature key to check
 * @returns boolean indicating if the feature is enabled
 */
export function useFeatureToggle(featureKey: string): boolean {
  const [isEnabled, setIsEnabled] = useState(featureCache[featureKey] || false);
  const [isLoading, setIsLoading] = useState(!featureCache.hasOwnProperty(featureKey));

  useEffect(() => {
    const checkFeature = async () => {
      try {
        // If we already have it cached, use that
        if (featureCache.hasOwnProperty(featureKey)) {
          setIsEnabled(featureCache[featureKey]);
          setIsLoading(false);
          return;
        }

        // If we're already fetching, wait for that
        if (cachePromise) {
          const features = await cachePromise;
          featureCache[featureKey] = features[featureKey] || false;
          setIsEnabled(featureCache[featureKey]);
          setIsLoading(false);
          return;
        }

        // Otherwise, fetch all features
        cachePromise = featureToggleService.getPublicFeatures();
        const features = await cachePromise;
        
        // Cache all features
        Object.keys(features).forEach(key => {
          featureCache[key] = features[key];
        });
        
        setIsEnabled(features[featureKey] || false);
      } catch (error) {
        console.warn(`Failed to check feature toggle for ${featureKey}:`, error);
        // Default to false on error for safety
        featureCache[featureKey] = false;
        setIsEnabled(false);
      } finally {
        setIsLoading(false);
        cachePromise = null;
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
 * Clear the feature toggle cache
 * Useful when features might have changed (e.g., after admin updates)
 */
export function clearFeatureCache(): void {
  Object.keys(featureCache).forEach(key => {
    delete featureCache[key];
  });
  cachePromise = null;
}

/**
 * Common feature keys used throughout the application
 */
export const FEATURE_KEYS = {
  ACCOUNT_LINKING: 'account_linking',
  FACEBOOK_OAUTH: 'facebook_oauth',
} as const;