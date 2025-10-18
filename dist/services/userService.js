"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = exports.UserService = void 0;
exports.handleIncomingMessage = handleIncomingMessage;
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
class UserService {
    async getOrCreateUser(whatsappId) {
        try {
            logger_1.logger.info('🔍 Looking for user', { whatsappId });
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                throw new Error('Invalid WhatsApp ID format');
            }
            const existingUser = await this.getUserByWhatsAppId(whatsappId);
            if (existingUser) {
                logger_1.logger.info('✅ Found existing user', {
                    whatsappId,
                    userId: existingUser.id
                });
                return existingUser;
            }
            logger_1.logger.info('➕ Creating new user', { whatsappId });
            try {
                const [newUser] = await database_1.db
                    .insert(schema_1.users)
                    .values({
                    whatsappId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                    .returning();
                await this.logUserAction(whatsappId, 'user_created', null, newUser);
                logger_1.logger.info('✅ Successfully created new user', {
                    whatsappId,
                    userId: newUser.id
                });
                return newUser;
            }
            catch (error) {
                if (error?.code === '23505' && error?.constraint === 'users_whatsapp_id_unique') {
                    logger_1.logger.warn('🔄 User creation race condition detected, fetching existing user', { whatsappId });
                    const existingUser = await this.getUserByWhatsAppId(whatsappId);
                    if (existingUser) {
                        return existingUser;
                    }
                }
                throw error;
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to get or create user', {
                whatsappId,
                error: error?.message || 'Unknown error',
                code: error?.code
            });
            throw error;
        }
    }
    async getUserByWhatsAppId(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                logger_1.logger.warn('Invalid WhatsApp ID format', { whatsappId });
                return null;
            }
            const [user] = await database_1.db
                .select()
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .limit(1);
            return user || null;
        }
        catch (error) {
            logger_1.logger.error('Failed to get user by WhatsApp ID', { whatsappId, error });
            return null;
        }
    }
    async createUser(userData) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(userData.whatsappId)) {
                throw new Error('Invalid WhatsApp ID format');
            }
            const user = await this.getOrCreateUser(userData.whatsappId);
            const updates = {};
            if (typeof userData.name === 'string' && userData.name.trim().length > 0) {
                updates.name = userData.name.trim();
            }
            if (typeof userData.phoneNumber === 'string' && userData.phoneNumber.trim().length > 0) {
                updates.phoneNumber = userData.phoneNumber.trim();
            }
            if (Object.keys(updates).length > 0) {
                const updatedUser = await this.updateUserProfile(userData.whatsappId, updates);
                if (!updatedUser) {
                    logger_1.logger.warn('Profile update failed during user creation, returning original user', {
                        whatsappId: userData.whatsappId
                    });
                    return user;
                }
                return updatedUser;
            }
            return user;
        }
        catch (error) {
            logger_1.logger.error('Failed to create user', { userData, error });
            throw error;
        }
    }
    async updateUserPreferences(whatsappId, preferences) {
        try {
            const validationResult = validation_1.userPreferencesSchema.safeParse(preferences);
            if (!validationResult.success) {
                logger_1.logger.warn('Invalid user preferences', { whatsappId, preferences, errors: validationResult.error });
                return null;
            }
            const currentUser = await this.getUserByWhatsAppId(whatsappId);
            if (!currentUser) {
                logger_1.logger.warn('User not found for preferences update', { whatsappId });
                return null;
            }
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set({
                ...preferences,
                preferencesCaptured: true,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            await this.logUserAction(whatsappId, 'preferences_updated', currentUser, updatedUser);
            logger_1.logger.info('✅ User preferences updated', {
                whatsappId,
                preferences,
                userId: updatedUser.id
            });
            return updatedUser;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user preferences', { whatsappId, preferences, error });
            return null;
        }
    }
    async updateUserProfile(whatsappId, profileData) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                logger_1.logger.warn('Invalid WhatsApp ID for profile update', { whatsappId });
                return null;
            }
            const currentUser = await this.getUserByWhatsAppId(whatsappId);
            if (!currentUser) {
                logger_1.logger.warn('User not found for profile update', { whatsappId });
                return null;
            }
            const updates = {};
            if (typeof profileData.name === 'string' && profileData.name.trim().length > 0) {
                updates.name = profileData.name.trim();
            }
            if (typeof profileData.phoneNumber === 'string' && profileData.phoneNumber.trim().length > 0) {
                updates.phoneNumber = profileData.phoneNumber.trim();
            }
            if (Object.keys(updates).length === 0) {
                logger_1.logger.info('No valid updates provided for profile', { whatsappId, profileData });
                return currentUser;
            }
            updates.updatedAt = new Date();
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set(updates)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            if (updatedUser) {
                await this.logUserAction(whatsappId, 'profile_updated', currentUser, updatedUser);
                logger_1.logger.info('✅ User profile updated successfully', {
                    whatsappId,
                    userId: updatedUser.id,
                    updates: Object.keys(updates)
                });
                return updatedUser;
            }
            logger_1.logger.error('❌ Profile update failed - no user returned', { whatsappId });
            return null;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to update user profile', {
                whatsappId,
                profileData,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    async hasCompletedPreferences(whatsappId) {
        try {
            const user = await this.getUserByWhatsAppId(whatsappId);
            return user?.preferencesCaptured || false;
        }
        catch (error) {
            logger_1.logger.error('Failed to check user preferences completion', { whatsappId, error });
            return false;
        }
    }
    async updateUserBanStatus(whatsappId, isBanned, adminWhatsappId) {
        try {
            const currentUser = await this.getUserByWhatsAppId(whatsappId);
            if (!currentUser) {
                logger_1.logger.warn('User not found for ban status update', { whatsappId });
                return false;
            }
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set({
                isBanned,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            await database_1.db.insert(schema_1.auditLogs).values({
                actorWhatsappId: adminWhatsappId,
                actorType: 'admin',
                action: isBanned ? 'user_banned' : 'user_unbanned',
                resourceType: 'user',
                resourceId: whatsappId,
                oldValues: { isBanned: currentUser.isBanned },
                newValues: { isBanned },
                createdAt: new Date(),
            });
            logger_1.logger.info(`✅ User ${isBanned ? 'banned' : 'unbanned'}`, {
                whatsappId,
                adminWhatsappId,
                userId: updatedUser.id
            });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user ban status', { whatsappId, isBanned, adminWhatsappId, error });
            return false;
        }
    }
    async isUserBanned(whatsappId) {
        try {
            const user = await this.getUserByWhatsAppId(whatsappId);
            return user?.isBanned || false;
        }
        catch (error) {
            logger_1.logger.error('Failed to check user ban status', { whatsappId, error });
            return false;
        }
    }
    async upsertUser(whatsappId, userData) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                throw new Error('Invalid WhatsApp ID format');
            }
            const result = await database_1.db
                .insert(schema_1.users)
                .values({
                whatsappId,
                ...userData,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
                .onConflictDoUpdate({
                target: schema_1.users.whatsappId,
                set: {
                    ...userData,
                    updatedAt: new Date(),
                }
            })
                .returning();
            logger_1.logger.info('✅ User upserted successfully', {
                whatsappId,
                userId: result[0].id
            });
            return result[0];
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to upsert user', { whatsappId, error: error?.message || 'Unknown error' });
            throw error;
        }
    }
    async logUserAction(whatsappId, action, oldValues, newValues) {
        try {
            await database_1.db.insert(schema_1.auditLogs).values({
                actorWhatsappId: whatsappId,
                actorType: 'user',
                action,
                resourceType: 'user',
                resourceId: whatsappId,
                oldValues,
                newValues,
                createdAt: new Date(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to log user action', { whatsappId, action, error });
        }
    }
}
exports.UserService = UserService;
exports.userService = new UserService();
async function handleIncomingMessage(whatsappId, message) {
    try {
        logger_1.logger.info('📨 Processing message', { whatsappId, messageType: message?.type });
        const user = await exports.userService.getOrCreateUser(whatsappId);
        return user;
    }
    catch (error) {
        logger_1.logger.error('❌ Message processing failed', {
            whatsappId,
            messageId: message?.id,
            error: error?.message || 'Unknown error'
        });
        await sendErrorMessage(whatsappId, "Sorry, something went wrong. Please try again.");
        throw error;
    }
}
async function sendErrorMessage(whatsappId, message) {
    logger_1.logger.info('📤 Sending error message', { whatsappId, message });
}
//# sourceMappingURL=userService.js.map