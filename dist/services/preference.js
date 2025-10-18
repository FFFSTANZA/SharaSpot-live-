"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferenceService = exports.PreferenceService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const logger_1 = require("../utils/logger");
class PreferenceService {
    constructor() {
        this.userContexts = new Map();
    }
    async startPreferenceFlow(whatsappId, isOnboarding = false) {
        try {
            this.userContexts.set(whatsappId, {
                whatsappId,
                currentStep: 'ev_model',
                preferenceData: {},
                isOnboarding,
            });
            logger_1.logger.info('Started preference flow', { whatsappId, isOnboarding });
        }
        catch (error) {
            logger_1.logger.error('Failed to start preference flow', { whatsappId, error });
        }
    }
    getUserContext(whatsappId) {
        return this.userContexts.get(whatsappId) || null;
    }
    updateUserContext(whatsappId, updates) {
        const context = this.userContexts.get(whatsappId);
        if (context) {
            this.userContexts.set(whatsappId, { ...context, ...updates });
        }
    }
    clearUserContext(whatsappId) {
        this.userContexts.delete(whatsappId);
    }
    async savePreferences(whatsappId) {
        try {
            logger_1.logger.info('💾 Attempting to save preferences', { whatsappId });
            const context = this.getUserContext(whatsappId);
            if (!context) {
                logger_1.logger.warn('No context found for saving preferences', { whatsappId });
                return null;
            }
            const { userService } = await Promise.resolve().then(() => __importStar(require('./userService')));
            let user = await userService.getUserByWhatsAppId(whatsappId);
            if (!user) {
                user = await userService.createUser({ whatsappId });
                if (!user) {
                    logger_1.logger.error('Failed to create user for preferences', { whatsappId });
                    return null;
                }
            }
            logger_1.logger.info('✅ User found/created, updating preferences', { whatsappId, userId: user.id });
            const updateData = {
                preferencesCaptured: true,
                updatedAt: new Date(),
            };
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
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set(updateData)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            if (updatedUser) {
                this.clearUserContext(whatsappId);
                logger_1.logger.info('✅ Preferences saved successfully', {
                    whatsappId,
                    userId: updatedUser.id,
                    preferences: context.preferenceData
                });
                return updatedUser;
            }
            logger_1.logger.error('❌ Failed to update user preferences - no user returned', { whatsappId });
            return null;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to save preferences', {
                whatsappId,
                error: error?.message || 'Unknown error',
                stack: error?.stack
            });
            return null;
        }
    }
    async resetUserPreferences(whatsappId) {
        try {
            logger_1.logger.info('🔄 Resetting user preferences', { whatsappId });
            await database_1.db
                .update(schema_1.users)
                .set({
                vehicleType: null,
                evModel: null,
                connectorType: null,
                chargingIntent: null,
                queuePreference: null,
                preferencesCaptured: false,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId));
            this.clearUserContext(whatsappId);
            logger_1.logger.info('✅ User preferences reset successfully', { whatsappId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to reset user preferences', { whatsappId, error });
            return false;
        }
    }
    isInPreferenceFlow(whatsappId) {
        return this.userContexts.has(whatsappId);
    }
    getNextStep(currentStep) {
        const stepOrder = [
            'ev_model',
            'connector_type',
            'charging_intent',
            'queue_preference',
            'completed'
        ];
        const currentIndex = stepOrder.indexOf(currentStep);
        return stepOrder[currentIndex + 1] || 'completed';
    }
    getPreviousStep(currentStep) {
        const stepOrder = [
            'ev_model',
            'connector_type',
            'charging_intent',
            'queue_preference',
            'completed'
        ];
        const currentIndex = stepOrder.indexOf(currentStep);
        return stepOrder[currentIndex - 1] || 'ev_model';
    }
    async loadUserPreferences(whatsappId) {
        try {
            const [user] = await database_1.db
                .select()
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
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
        }
        catch (error) {
            logger_1.logger.error('Failed to load user preferences', { whatsappId, error });
            return null;
        }
    }
    async updateSinglePreference(whatsappId, field, value) {
        try {
            const updateData = {
                updatedAt: new Date(),
            };
            updateData[field] = value;
            await database_1.db
                .update(schema_1.users)
                .set(updateData)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId));
            const context = this.getUserContext(whatsappId);
            if (context) {
                context.preferenceData[field] = value;
                this.userContexts.set(whatsappId, context);
            }
            logger_1.logger.info('Single preference updated successfully', { whatsappId, field, value });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to update single preference', { whatsappId, field, value, error });
            return false;
        }
    }
    async getPreferencesSummary(whatsappId) {
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
        }
        catch (error) {
            logger_1.logger.error('Failed to get preferences summary', { whatsappId, error });
            return '❌ Unable to load preferences. Please try again.';
        }
    }
    validatePreferenceData(data) {
        const errors = [];
        if (data.vehicleType && !['Car', 'Bike/Scooter', 'Any'].includes(data.vehicleType)) {
            errors.push('Invalid vehicle type');
        }
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
    getHealthStatus() {
        return {
            status: 'healthy',
            activeContexts: this.userContexts.size,
            uptime: process.uptime().toString()
        };
    }
    cleanupExpiredContexts() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        let cleanupCount = 0;
        for (const [whatsappId, context] of this.userContexts.entries()) {
            if (context.timestamp && context.timestamp < oneHourAgo) {
                this.userContexts.delete(whatsappId);
                cleanupCount++;
            }
        }
        if (cleanupCount > 0) {
            logger_1.logger.info(`Cleaned up ${cleanupCount} expired preference contexts`);
        }
    }
}
exports.PreferenceService = PreferenceService;
exports.preferenceService = new PreferenceService();
//# sourceMappingURL=preference.js.map