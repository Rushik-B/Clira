/**
 * Feature Flags Service
 * 
 * Centralized feature flag management for controlled rollout of Always-On Email Mapping
 * Features can be enabled/disabled via environment variables for safe deployment
 */

export interface FeatureFlagConfig {
  alwaysOnSorting: boolean;
  folderManagement: boolean;
}

export class FeatureFlags {
  /**
   * Check if Always-On Sorting is enabled for a user
   * Controls the persistent email sorting worker and cron jobs
   */
  static isAlwaysOnSortingEnabled(userId?: string): boolean {
    // Global feature flag
    const globalEnabled = process.env.FEATURE_FLAG_ALWAYS_ON_SORTING === 'true';
    
    if (!globalEnabled) {
      return false;
    }

    // Emergency kill switch
    if (process.env.ALWAYS_ON_SORTING_EMERGENCY_DISABLED === 'true') {
      console.warn(`[FEATURE FLAGS] ⚠️ Always-on sorting emergency disabled`);
      return false;
    }

    // TODO: Future per-user rollout logic can go here
    // For now, all users get the same flag
    return true;
  }

  /**
   * Check if Folder Management UI is enabled for a user
   * Controls access to folder prompt editing, rules, and Sort Now button
   */
  static isFolderManagementEnabled(userId?: string): boolean {
    return process.env.FEATURE_FLAG_FOLDER_MANAGEMENT === 'true';
  }

  /**
   * Get all feature flag states for a user
   * Useful for debugging and admin dashboards
   */
  static getAllFlags(userId?: string): FeatureFlagConfig {
    return {
      alwaysOnSorting: this.isAlwaysOnSortingEnabled(userId),
      folderManagement: this.isFolderManagementEnabled(userId),
    };
  }

  /**
   * Get configuration values for Always-On Sorting
   * Centralized access to environment-based config
   */
  static getAlwaysOnSortingConfig() {
    return {
      cronSchedule: process.env.ALWAYS_ON_SORT_CRON || '0 */2 * * *',
      maxBatchSize: parseInt(process.env.MAPPING_MAX_BATCH_SIZE || '100'),
      confidenceThreshold: parseInt(process.env.MAPPING_CONFIDENCE_THRESHOLD || '70'),
      tokenBudgetPerRun: parseInt(process.env.MAPPING_TOKEN_BUDGET_PER_RUN || '50000'),
      ignoreDateForFolderGen: process.env.EMAIL_MAPPING_IGNORE_DATE === 'true'
    };
  }

  /**
   * Validate that required environment variables are set
   * Call this during application startup
   */
  static validateConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.getAlwaysOnSortingConfig();

    // Validate cron expression format (basic check)
    if (!config.cronSchedule.match(/^[\d\*\/,\-\s]+$/)) {
      errors.push('ALWAYS_ON_SORT_CRON has invalid format');
    }

    // Validate numeric ranges
    if (config.maxBatchSize < 1 || config.maxBatchSize > 1000) {
      errors.push('MAPPING_MAX_BATCH_SIZE must be between 1 and 1000');
    }

    if (config.confidenceThreshold < 0 || config.confidenceThreshold > 100) {
      errors.push('MAPPING_CONFIDENCE_THRESHOLD must be between 0 and 100');
    }

    if (config.tokenBudgetPerRun < 1000) {
      errors.push('MAPPING_TOKEN_BUDGET_PER_RUN should be at least 1000');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Log current feature flag configuration (for debugging)
   */
  static logConfiguration(userId?: string): void {
    const flags = this.getAllFlags(userId);
    const config = this.getAlwaysOnSortingConfig();

    console.log(`[FEATURE FLAGS] Configuration for user ${userId || 'system'}:`);
    console.log(`[FEATURE FLAGS]   Always-On Sorting: ${flags.alwaysOnSorting}`);
    console.log(`[FEATURE FLAGS]   Folder Management: ${flags.folderManagement}`);
    console.log(`[FEATURE FLAGS]   Cron Schedule: ${config.cronSchedule}`);
    console.log(`[FEATURE FLAGS]   Max Batch Size: ${config.maxBatchSize}`);
    console.log(`[FEATURE FLAGS]   Confidence Threshold: ${config.confidenceThreshold}%`);
  }
}