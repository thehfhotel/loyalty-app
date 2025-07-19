import { query, getClient } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

export interface FeatureToggle {
  id: string;
  featureKey: string;
  featureName: string;
  description?: string;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface FeatureToggleAudit {
  id: string;
  featureToggleId: string;
  previousState?: boolean;
  newState: boolean;
  changedBy: string;
  changedAt: Date;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class FeatureToggleService {
  
  /**
   * Get all feature toggles
   */
  async getAllFeatureToggles(): Promise<FeatureToggle[]> {
    try {
      const features = await query<FeatureToggle>(
        `SELECT id, feature_key AS "featureKey", feature_name AS "featureName", 
                description, is_enabled AS "isEnabled", 
                created_at AS "createdAt", updated_at AS "updatedAt",
                created_by AS "createdBy", updated_by AS "updatedBy"
         FROM feature_toggles 
         ORDER BY feature_name ASC`
      );

      return features;
    } catch (error) {
      logger.error('Failed to get feature toggles:', error);
      throw new AppError(500, 'Failed to retrieve feature toggles');
    }
  }

  /**
   * Get feature toggle by key
   */
  async getFeatureToggleByKey(featureKey: string): Promise<FeatureToggle | null> {
    try {
      const features = await query<FeatureToggle>(
        `SELECT id, feature_key AS "featureKey", feature_name AS "featureName", 
                description, is_enabled AS "isEnabled", 
                created_at AS "createdAt", updated_at AS "updatedAt",
                created_by AS "createdBy", updated_by AS "updatedBy"
         FROM feature_toggles 
         WHERE feature_key = $1`,
        [featureKey]
      );

      return features.length > 0 ? features[0] : null;
    } catch (error) {
      logger.error(`Failed to get feature toggle ${featureKey}:`, error);
      throw new AppError(500, 'Failed to retrieve feature toggle');
    }
  }

  /**
   * Check if a feature is enabled
   */
  async isFeatureEnabled(featureKey: string): Promise<boolean> {
    try {
      const features = await query<{ isEnabled: boolean }>(
        'SELECT is_enabled AS "isEnabled" FROM feature_toggles WHERE feature_key = $1',
        [featureKey]
      );

      return features.length > 0 ? features[0].isEnabled : false;
    } catch (error) {
      logger.error(`Failed to check feature ${featureKey}:`, error);
      // Default to false on error for safety
      return false;
    }
  }

  /**
   * Toggle a feature on/off
   */
  async toggleFeature(
    featureKey: string, 
    isEnabled: boolean, 
    userId: string,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<FeatureToggle> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Check if feature exists
      const existingFeatures = await client.query(
        'SELECT id, is_enabled FROM feature_toggles WHERE feature_key = $1',
        [featureKey]
      );

      if (existingFeatures.rows.length === 0) {
        throw new AppError(404, `Feature toggle '${featureKey}' not found`);
      }

      const existingFeature = existingFeatures.rows[0];

      // Update the feature toggle
      const updatedFeatures = await client.query(
        `UPDATE feature_toggles 
         SET is_enabled = $1, updated_by = $2, updated_at = NOW()
         WHERE feature_key = $3
         RETURNING id, feature_key AS "featureKey", feature_name AS "featureName", 
                   description, is_enabled AS "isEnabled", 
                   created_at AS "createdAt", updated_at AS "updatedAt",
                   created_by AS "createdBy", updated_by AS "updatedBy"`,
        [isEnabled, userId, featureKey]
      );

      const updatedFeature = updatedFeatures.rows[0] as FeatureToggle;

      // Create audit entry if state changed
      if (existingFeature.is_enabled !== isEnabled) {
        await client.query(
          `INSERT INTO feature_toggle_audit 
           (feature_toggle_id, previous_state, new_state, changed_by, reason, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            updatedFeature.id,
            existingFeature.is_enabled,
            isEnabled,
            userId,
            reason || (isEnabled ? 'Feature enabled' : 'Feature disabled'),
            ipAddress || null,
            userAgent || null
          ]
        );
      }

      await client.query('COMMIT');

      logger.info(`Feature toggle '${featureKey}' ${isEnabled ? 'enabled' : 'disabled'} by user ${userId}`);
      
      return updatedFeature;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a new feature toggle
   */
  async createFeatureToggle(
    featureKey: string,
    featureName: string,
    description: string,
    isEnabled: boolean = false,
    userId: string
  ): Promise<FeatureToggle> {
    try {
      // Check if feature key already exists
      const existing = await this.getFeatureToggleByKey(featureKey);
      if (existing) {
        throw new AppError(400, `Feature toggle with key '${featureKey}' already exists`);
      }

      const newFeatures = await query<FeatureToggle>(
        `INSERT INTO feature_toggles (feature_key, feature_name, description, is_enabled, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, feature_key AS "featureKey", feature_name AS "featureName", 
                   description, is_enabled AS "isEnabled", 
                   created_at AS "createdAt", updated_at AS "updatedAt",
                   created_by AS "createdBy", updated_by AS "updatedBy"`,
        [featureKey, featureName, description, isEnabled, userId]
      );

      const newFeature = newFeatures[0];
      
      logger.info(`Feature toggle '${featureKey}' created by user ${userId}`);
      
      return newFeature;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to create feature toggle:', error);
      throw new AppError(500, 'Failed to create feature toggle');
    }
  }

  /**
   * Get audit history for a feature toggle
   */
  async getFeatureToggleAudit(featureKey: string): Promise<FeatureToggleAudit[]> {
    try {
      const auditEntries = await query<FeatureToggleAudit>(
        `SELECT a.id, a.feature_toggle_id AS "featureToggleId", 
                a.previous_state AS "previousState", a.new_state AS "newState",
                a.changed_by AS "changedBy", a.changed_at AS "changedAt",
                a.reason, a.ip_address AS "ipAddress", a.user_agent AS "userAgent"
         FROM feature_toggle_audit a
         JOIN feature_toggles f ON a.feature_toggle_id = f.id
         WHERE f.feature_key = $1
         ORDER BY a.changed_at DESC`,
        [featureKey]
      );

      return auditEntries;
    } catch (error) {
      logger.error(`Failed to get audit history for feature ${featureKey}:`, error);
      throw new AppError(500, 'Failed to retrieve feature toggle audit history');
    }
  }

  /**
   * Get enabled features as a map for quick lookup
   */
  async getEnabledFeaturesMap(): Promise<Record<string, boolean>> {
    try {
      const features = await query<{ featureKey: string; isEnabled: boolean }>(
        'SELECT feature_key AS "featureKey", is_enabled AS "isEnabled" FROM feature_toggles'
      );

      const featuresMap: Record<string, boolean> = {};
      features.forEach(feature => {
        featuresMap[feature.featureKey] = feature.isEnabled;
      });

      return featuresMap;
    } catch (error) {
      logger.error('Failed to get enabled features map:', error);
      return {}; // Return empty map on error for safety
    }
  }

  /**
   * Get features for client (only enabled status without admin details)
   */
  async getPublicFeatures(): Promise<Record<string, boolean>> {
    return this.getEnabledFeaturesMap();
  }
}

export const featureToggleService = new FeatureToggleService();