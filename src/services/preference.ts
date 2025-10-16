// src/services/preference.ts - COMPLETE FIXED IMPLEMENTATION
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { users, type User } from '../db/schema';
import { logger } from '../utils/logger';

export interface PreferenceStep {
  step: 'ev_model' | 'connector_type' | 'charging_intent' | 'queue_preference' | 'completed';
  data?: any;
}

export interface UserContext {
  whatsappId: string;
  currentStep: PreferenceStep['step'];
  preferenceData: {
    vehicleType?: string;
    evModel?: string;
    connectorType?: string;
    chargingIntent?: string;
    queuePreference?: string;
  }
  isOnboarding: boolean;
}

export class PreferenceService {
  // In-memory context storage (Phase 1 limitation - no Redis)
  private userContexts = new Map<string, UserContext>();

  /**
   * Start preference gathering flow
   */
  async startPreferenceFlow(whatsappId: string, isOnboarding: boolean = false): Promise<void> {
    try {
      // Initialize user context
      this.userContexts.set(whatsappId, {
        whatsappId,
        currentStep: 'ev_model',
        preferenceData: {},
        isOnboarding,
      });

      logger.info('Started preference flow', { whatsappId, isOnboarding });
    } catch (error) {
      logger.error('Failed to start preference flow', { whatsappId, error });
    }
  }

  /**
   * Get user context
   */
  getUserContext(whatsappId: string): UserContext | null {
    return this.userContexts.get(whatsappId) || null;
  }

  /**
   * Update user context
   */
  updateUserContext(whatsappId: string, updates: Partial<UserContext>): void {
    const context = this.userContexts.get(whatsappId);
    if (context) {
      this.userContexts.set(whatsappId, { ...context, ...updates });
    }
  }

  /**
   * Clear user context (after completion)
   */
  clearUserContext(whatsappId: string): void {
    this.userContexts.delete(whatsappId);
  }

  /**
   * Save user preferences to database - COMPLETE IMPLEMENTATION
   */
  async savePreferences(whatsappId: string): Promise<User | null> {
    try {
      logger.info('💾 Attempting to save preferences', { whatsappId });
      
      const context = this.getUserContext(whatsappId);
      if (!context) {
        logger.warn('No context found for saving preferences', { whatsappId });
        return null;
      }

      // Get or create user first - using dynamic import to avoid circular dependency
      const { userService } = await import('./userService');
      
      // Try to get existing user first
      let user = await userService.getUserByWhatsAppId(whatsappId);
      
      // If user doesn't exist, create one
      if (!user) {
        user = await userService.createUser({ whatsappId });
        if (!user) {
          logger.error('Failed to create user for preferences', { whatsappId });
          return null;
        }
      }

      logger.info('✅ User found/created, updating preferences', { whatsappId, userId: user.id });

      // Prepare update data with only non-null values
      const updateData: any = {
        preferencesCaptured: true,
        updatedAt: new Date(),
      };

      // Only update fields that have values
      if (context.preferenceData.vehicleType) {
        updateData.vehicleType = context.preferenceData.vehicleType;
      }
      if (context.preferenceData.evModel) {
        updateData.evModel = context.preferenceData.evModel;
      }
      if (context.preferenceData.connectorType) {
        updateData.connectorType = context.preferenceData.connectorType;
      }
      if (context.preferenceData.chargingIntent) {
        updateData.chargingIntent = context.preferenceData.chargingIntent;
      }
      if (context.preferenceData.queuePreference) {
        updateData.queuePreference = context.preferenceData.queuePreference;
      }

      // Update preferences directly in database
      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.whatsappId, whatsappId))
        .returning();

      if (updatedUser) {
        this.clearUserContext(whatsappId);
        logger.info('✅ Preferences saved successfully', { 
          whatsappId, 
          userId: updatedUser.id,
          preferences: context.preferenceData 
        });
        return updatedUser;
      }

      logger.error('❌ Failed to update user preferences - no user returned', { whatsappId });
      return null;

    } catch (error: any) {
      logger.error('❌ Failed to save preferences', { 
        whatsappId, 
        error: error?.message || 'Unknown error',
        stack: error?.stack 
      });
      return null;
    }
  }

  /**
   * Reset user preferences - MISSING METHOD ADDED
   */
  async resetUserPreferences(whatsappId: string): Promise<boolean> {
    try {
      logger.info('🔄 Resetting user preferences', { whatsappId });

      // Clear from database
      await db
        .update(users)
        .set({
          vehicleType: null,
          evModel: null,
          connectorType: null,
          chargingIntent: null,
          queuePreference: null,
          preferencesCaptured: false,
          updatedAt: new Date(),
        })
        .where(eq(users.whatsappId, whatsappId));

      // Clear from memory
      this.clearUserContext(whatsappId);
      
      logger.info('✅ User preferences reset successfully', { whatsappId });
      return true;

    } catch (error) {
      logger.error('❌ Failed to reset user preferences', { whatsappId, error });
      return false;
    }
  }

  /**
   * Check if user is in preference flow
   */
  isInPreferenceFlow(whatsappId: string): boolean {
    return this.userContexts.has(whatsappId);
  }

  /**
   * Get next step in preference flow
   */
  getNextStep(currentStep: PreferenceStep['step']): PreferenceStep['step'] {
    const stepOrder: PreferenceStep['step'][] = [
      'ev_model',
      'connector_type', 
      'charging_intent',
      'queue_preference',
      'completed'
    ];
    
    const currentIndex = stepOrder.indexOf(currentStep);
    return stepOrder[currentIndex + 1] || 'completed';
  }

  /**
   * Get previous step in preference flow
   */
  getPreviousStep(currentStep: PreferenceStep['step']): PreferenceStep['step'] {
    const stepOrder: PreferenceStep['step'][] = [
      'ev_model',
      'connector_type',
      'charging_intent', 
      'queue_preference',
      'completed'
    ];
    
    const currentIndex = stepOrder.indexOf(currentStep);
    return stepOrder[currentIndex - 1] || 'ev_model';
  }

  /**
   * Load user preferences from database
   */
  async loadUserPreferences(whatsappId: string): Promise<UserContext | null> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.whatsappId, whatsappId))
        .limit(1);

      if (!user) {
        return null;
      }

      return {
        whatsappId,
        currentStep: 'completed',
        isOnboarding: false,
        preferenceData: {
          vehicleType: user.vehicleType || undefined,
          evModel: user.evModel || undefined,
          connectorType: user.connectorType || undefined,
          chargingIntent: user.chargingIntent || undefined,
          queuePreference: user.queuePreference || undefined,
        }
      };
    } catch (error) {
      logger.error('Failed to load user preferences', { whatsappId, error });
      return null;
    }
  }

  /**
   * Update single preference field
   */
  async updateSinglePreference(
    whatsappId: string, 
    field: keyof UserContext['preferenceData'], 
    value: string
  ): Promise<boolean> {
    try {
      const updateData: any = {
        updatedAt: new Date(),
      };
      updateData[field] = value;

      await db
        .update(users)
        .set(updateData)
        .where(eq(users.whatsappId, whatsappId));

      // Also update in-memory context if exists
      const context = this.getUserContext(whatsappId);
      if (context) {
        context.preferenceData[field] = value;
        this.userContexts.set(whatsappId, context);
      }

      logger.info('Single preference updated successfully', { whatsappId, field, value });
      return true;
    } catch (error) {
      logger.error('Failed to update single preference', { whatsappId, field, value, error });
      return false;
    }
  }

  /**
   * Get preferences summary for user
   */
  async getPreferencesSummary(whatsappId: string): Promise<string> {
    try {
      const context = await this.loadUserPreferences(whatsappId);
      if (!context?.preferenceData) {
        return '❓ No preferences found. Type "hi" to set up your preferences.';
      }

      const data = context.preferenceData;
      return `📋 *Your EV Profile*\n\n` +
        `🚗 Vehicle: ${data.vehicleType || 'Any'}\n` +
        `🏷️ Model: ${data.evModel || 'Not specified'}\n` +
        `🔌 Connector: ${data.connectorType || 'Any'}\n` +
        `⚡ Style: ${data.chargingIntent || 'Any'}\n` +
        `🕐 Wait: ${data.queuePreference || 'Flexible'}\n\n` +
        `💡 Type "settings" to update.`;
    } catch (error) {
      logger.error('Failed to get preferences summary', { whatsappId, error });
      return '❌ Unable to load preferences. Please try again.';
    }
  }

  /**
   * Validate preference data
   */
  validatePreferenceData(data: UserContext['preferenceData']): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (data.vehicleType && !['Car', 'Bike/Scooter', 'Any'].includes(data.vehicleType)) {
      errors.push('Invalid vehicle type');
    }
    
    // Updated connector types for Indian market
    const validConnectors = ['CCS2', 'CHAdeMO', 'Type2', 'Bharat DC001', 'Proprietary', '3-Pin', 'Fast Charge', 'Any'];
    if (data.connectorType && !validConnectors.includes(data.connectorType)) {
      errors.push('Invalid connector type');
    }
    
    if (data.chargingIntent && !['Quick Top-up', 'Full Charge', 'Emergency'].includes(data.chargingIntent)) {
      errors.push('Invalid charging intent');
    }
    
    if (data.queuePreference && !['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'].includes(data.queuePreference)) {
      errors.push('Invalid queue preference');
    }
    
    if (data.evModel && (data.evModel.length < 2 || data.evModel.length > 100)) {
      errors.push('EV model must be between 2-100 characters');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Health check for monitoring
   */
  getHealthStatus(): {
    status: 'healthy' | 'degraded';
    activeContexts: number;
    uptime: string;
  } {
    return {
      status: 'healthy',
      activeContexts: this.userContexts.size,
      uptime: process.uptime().toString()
    };
  }

  /**
   * Cleanup expired contexts to prevent memory leaks
   */
  cleanupExpiredContexts(): void {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    let cleanupCount = 0;
    
    for (const [whatsappId, context] of this.userContexts.entries()) {
      // Remove contexts older than 1 hour (if they have timestamps)
      if ((context as any).timestamp && (context as any).timestamp < oneHourAgo) {
        this.userContexts.delete(whatsappId);
        cleanupCount++;
      }
    }
    
    if (cleanupCount > 0) {
      logger.info(`Cleaned up ${cleanupCount} expired preference contexts`);
    }
  }
}

export const preferenceService = new PreferenceService();