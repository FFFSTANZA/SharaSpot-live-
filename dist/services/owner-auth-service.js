"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerAuthService = exports.OwnerAuthService = void 0;
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
class OwnerAuthService {
    constructor() {
        this.activeSessions = new Map();
        this.SESSION_DURATION = 24 * 60 * 60 * 1000;
    }
    async isAuthenticated(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return false;
            }
            const [owner] = await database_1.db
                .select({
                isActive: schema_1.stationOwners.isActive,
                isVerified: schema_1.stationOwners.isVerified
            })
                .from(schema_1.stationOwners)
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId))
                .limit(1);
            return !!(owner?.isActive && owner?.isVerified);
        }
        catch (error) {
            logger_1.logger.error('Authentication check failed', { whatsappId, error });
            return false;
        }
    }
    async authenticateByBusinessName(whatsappId, businessName) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId) || !businessName?.trim()) {
                return false;
            }
            const [owner] = await database_1.db
                .select({
                whatsappId: schema_1.stationOwners.whatsappId,
                businessName: schema_1.stationOwners.businessName,
                isActive: schema_1.stationOwners.isActive,
                isVerified: schema_1.stationOwners.isVerified
            })
                .from(schema_1.stationOwners)
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.businessName, businessName.trim()))
                .limit(1);
            if (!owner) {
                logger_1.logger.warn('Owner not found by business name', { businessName });
                return false;
            }
            if (owner.whatsappId !== whatsappId) {
                logger_1.logger.warn('WhatsApp ID mismatch for business name', {
                    businessName,
                    expectedWhatsappId: whatsappId,
                    actualWhatsappId: owner.whatsappId
                });
                return false;
            }
            if (!owner.isActive) {
                logger_1.logger.warn('Owner account is not active', { whatsappId, businessName });
                return false;
            }
            if (!owner.isVerified) {
                logger_1.logger.warn('Owner account is not verified', { whatsappId, businessName });
                return false;
            }
            logger_1.logger.info('Owner authenticated successfully', { whatsappId, businessName });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Authentication by business name failed', { whatsappId, businessName, error });
            return false;
        }
    }
    async getOwnerProfile(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return null;
            }
            const [owner] = await database_1.db
                .select()
                .from(schema_1.stationOwners)
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId))
                .limit(1);
            return owner || null;
        }
        catch (error) {
            logger_1.logger.error('Failed to get owner profile', { whatsappId, error });
            return null;
        }
    }
    async createAuthSession(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return null;
            }
            const isAuthenticated = await this.isAuthenticated(whatsappId);
            if (!isAuthenticated) {
                return null;
            }
            const token = this.generateSessionToken(whatsappId);
            const expiresAt = new Date(Date.now() + this.SESSION_DURATION);
            const session = {
                whatsappId,
                token,
                createdAt: new Date(),
                expiresAt,
                isActive: true
            };
            this.activeSessions.set(token, session);
            logger_1.logger.info('Auth session created', { whatsappId, token });
            return token;
        }
        catch (error) {
            logger_1.logger.error('Failed to create auth session', { whatsappId, error });
            return null;
        }
    }
    async validateSession(token) {
        try {
            const session = this.activeSessions.get(token);
            if (!session || !session.isActive || session.expiresAt < new Date()) {
                if (session)
                    this.activeSessions.delete(token);
                return false;
            }
            session.expiresAt = new Date(Date.now() + this.SESSION_DURATION);
            this.activeSessions.set(token, session);
            return true;
        }
        catch (error) {
            logger_1.logger.error('Session validation failed', { token, error });
            return false;
        }
    }
    async getWhatsAppIdFromToken(token) {
        try {
            const session = this.activeSessions.get(token);
            if (!session || !session.isActive || session.expiresAt < new Date()) {
                return null;
            }
            return session.whatsappId;
        }
        catch (error) {
            logger_1.logger.error('Failed to get WhatsApp ID from token', { token, error });
            return null;
        }
    }
    async invalidateSession(token) {
        try {
            const deleted = this.activeSessions.delete(token);
            if (deleted) {
                logger_1.logger.info('Session invalidated', { token });
            }
            return deleted;
        }
        catch (error) {
            logger_1.logger.error('Failed to invalidate session', { token, error });
            return false;
        }
    }
    async invalidateAllSessions(whatsappId) {
        try {
            let count = 0;
            for (const [token, session] of this.activeSessions.entries()) {
                if (session.whatsappId === whatsappId) {
                    this.activeSessions.delete(token);
                    count++;
                }
            }
            if (count > 0) {
                logger_1.logger.info('All sessions invalidated for owner', { whatsappId, count });
            }
            return count > 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to invalidate all sessions', { whatsappId, error });
            return false;
        }
    }
    cleanupExpiredSessions() {
        const now = new Date();
        let expiredCount = 0;
        for (const [token, session] of this.activeSessions.entries()) {
            if (session.expiresAt < now) {
                this.activeSessions.delete(token);
                expiredCount++;
            }
        }
        if (expiredCount > 0) {
            logger_1.logger.info('Expired sessions cleaned up', { expiredCount });
        }
    }
    getActiveSessionsCount() {
        return this.activeSessions.size;
    }
    generateSessionToken(whatsappId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        return `owner_${whatsappId}_${timestamp}_${random}`;
    }
}
exports.OwnerAuthService = OwnerAuthService;
exports.ownerAuthService = new OwnerAuthService();
setInterval(() => {
    exports.ownerAuthService.cleanupExpiredSessions();
}, 60 * 60 * 1000);
//# sourceMappingURL=owner-auth-service.js.map