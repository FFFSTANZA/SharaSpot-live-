"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerAuthService = exports.ownerStationService = exports.ownerService = exports.OwnerAuthService = exports.OwnerStationService = exports.OwnerService = void 0;
exports.parseOwnerButtonId = parseOwnerButtonId;
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
class OwnerService {
    async getOwnerProfile(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                logger_1.logger.error('Invalid WhatsApp ID', { whatsappId });
                return null;
            }
            const [owner] = await database_1.db
                .select()
                .from(schema_1.stationOwners)
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId))
                .limit(1);
            if (!owner) {
                logger_1.logger.warn('Owner profile not found', { whatsappId });
                return null;
            }
            return {
                id: owner.id,
                whatsappId: owner.whatsappId,
                name: owner.name,
                businessName: owner.businessName || undefined,
                phoneNumber: owner.phoneNumber || '',
                email: owner.email || undefined,
                businessType: owner.businessType || undefined,
                gstNumber: owner.gstNumber || undefined,
                isVerified: owner.isVerified || false,
                isActive: owner.isActive || false,
                kycStatus: owner.kycStatus || 'pending',
                totalStations: owner.totalStations || 0,
                totalRevenue: owner.totalRevenue?.toString() || '0',
                averageRating: owner.averageRating?.toString() || '0',
                createdAt: owner.createdAt || new Date()
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get owner profile', { whatsappId, error });
            return null;
        }
    }
    async updateOwnerProfile(whatsappId, updates) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return false;
            }
            await database_1.db
                .update(schema_1.stationOwners)
                .set({
                ...updates,
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId));
            logger_1.logger.info('Owner profile updated', { whatsappId, updates });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to update owner profile', { whatsappId, error });
            return false;
        }
    }
    async getOwnerAnalytics(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return null;
            }
            const ownerStations = await database_1.db
                .select({ id: schema_1.chargingStations.id, name: schema_1.chargingStations.name })
                .from(schema_1.chargingStations)
                .innerJoin(schema_1.stationOwners, (0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, schema_1.stationOwners.id))
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId));
            if (!ownerStations.length) {
                return null;
            }
            const stationIds = ownerStations.map(s => s.id);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const todaySessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationIds[0]), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, today)));
            const todayRevenue = todaySessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            const todayEnergy = todaySessions.reduce((sum, session) => sum + parseFloat(session.energyDelivered?.toString() || '0'), 0);
            const avgDuration = todaySessions.length > 0 ?
                todaySessions.reduce((sum, session) => sum + (session.duration || 0), 0) / todaySessions.length : 0;
            const weekSessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationIds[0]), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, weekAgo)));
            const weekRevenue = weekSessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            return {
                todaySessions: todaySessions.length,
                todayRevenue: Math.round(todayRevenue),
                todayEnergy: Math.round(todayEnergy * 100) / 100,
                avgSessionDuration: Math.round(avgDuration),
                weekSessions: weekSessions.length,
                weekRevenue: Math.round(weekRevenue),
                weekGrowth: 12.5,
                bestStationName: ownerStations[0]?.name || 'N/A',
                avgUtilization: 68,
                peakHours: '6-9 PM',
                averageRating: 4.2,
                totalReviews: 15,
                repeatCustomers: 35
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get owner analytics', { whatsappId, error });
            return null;
        }
    }
    async isRegisteredOwner(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return false;
            }
            const [owner] = await database_1.db
                .select({ id: schema_1.stationOwners.id })
                .from(schema_1.stationOwners)
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId))
                .limit(1);
            return !!owner;
        }
        catch (error) {
            logger_1.logger.error('Failed to check owner registration', { whatsappId, error });
            return false;
        }
    }
    async getOwnerByBusinessName(businessName) {
        try {
            const [owner] = await database_1.db
                .select()
                .from(schema_1.stationOwners)
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.businessName, businessName))
                .limit(1);
            if (!owner) {
                return null;
            }
            return {
                id: owner.id,
                whatsappId: owner.whatsappId,
                name: owner.name,
                businessName: owner.businessName || undefined,
                phoneNumber: owner.phoneNumber || '',
                email: owner.email || undefined,
                businessType: owner.businessType || undefined,
                gstNumber: owner.gstNumber || undefined,
                isVerified: owner.isVerified || false,
                isActive: owner.isActive || false,
                kycStatus: owner.kycStatus || 'pending',
                totalStations: owner.totalStations || 0,
                totalRevenue: owner.totalRevenue?.toString() || '0',
                averageRating: owner.averageRating?.toString() || '0',
                createdAt: owner.createdAt || new Date()
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get owner by business name', { businessName, error });
            return null;
        }
    }
}
exports.OwnerService = OwnerService;
class OwnerStationService {
    async getOwnerStations(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                return [];
            }
            const stations = await database_1.db
                .select({
                id: schema_1.chargingStations.id,
                name: schema_1.chargingStations.name,
                address: schema_1.chargingStations.address,
                isActive: schema_1.chargingStations.isActive,
                isOpen: schema_1.chargingStations.isOpen,
                totalSlots: schema_1.chargingStations.totalSlots,
                availableSlots: schema_1.chargingStations.availableSlots,
                pricePerKwh: schema_1.chargingStations.pricePerKwh,
                operatingHours: schema_1.chargingStations.operatingHours,
                createdAt: schema_1.chargingStations.createdAt
            })
                .from(schema_1.chargingStations)
                .innerJoin(schema_1.stationOwners, (0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, schema_1.stationOwners.id))
                .where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, whatsappId))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.chargingStations.createdAt));
            return stations.map(station => ({
                id: station.id,
                name: station.name,
                address: station.address,
                isActive: station.isActive || false,
                isOpen: station.isOpen || false,
                totalSlots: station.totalSlots || 0,
                availableSlots: station.availableSlots || 0,
                pricePerKwh: station.pricePerKwh?.toString() || '0',
                operatingHours: station.operatingHours,
                createdAt: station.createdAt || new Date()
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get owner stations', { whatsappId, error });
            return [];
        }
    }
    async toggleStationStatus(stationId, ownerWhatsappId) {
        try {
            const [station] = await database_1.db
                .select({
                isActive: schema_1.chargingStations.isActive,
                ownerId: schema_1.chargingStations.ownerWhatsappId
            })
                .from(schema_1.chargingStations)
                .innerJoin(schema_1.stationOwners, (0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, schema_1.stationOwners.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId), (0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, ownerWhatsappId)))
                .limit(1);
            if (!station) {
                logger_1.logger.warn('Station not found or access denied', { stationId, ownerWhatsappId });
                return false;
            }
            const newStatus = !station.isActive;
            await database_1.db
                .update(schema_1.chargingStations)
                .set({
                isActive: newStatus,
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId));
            logger_1.logger.info('Station status toggled', { stationId, newStatus, ownerWhatsappId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to toggle station status', { stationId, ownerWhatsappId, error });
            return false;
        }
    }
    async getStationAnalytics(stationId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const queueLength = await database_1.db
                .select()
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.queues.status, 'waiting')));
            const todaySessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, today)));
            const todayRevenue = todaySessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            const todayEnergy = todaySessions.reduce((sum, session) => sum + parseFloat(session.energyDelivered?.toString() || '0'), 0);
            const activeSessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'active')));
            return {
                queueLength: queueLength.length,
                todaySessions: todaySessions.length,
                todayRevenue: Math.round(todayRevenue),
                todayEnergy: Math.round(todayEnergy * 100) / 100,
                utilizationRate: Math.round((activeSessions.length / 4) * 100),
                activeUsers: activeSessions.length
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get station analytics', { stationId, error });
            return null;
        }
    }
}
exports.OwnerStationService = OwnerStationService;
class OwnerAuthService {
    async isAuthenticated(whatsappId) {
        try {
            const owner = await exports.ownerService.getOwnerProfile(whatsappId);
            return !!(owner?.isActive);
        }
        catch (error) {
            logger_1.logger.error('Authentication check failed', { whatsappId, error });
            return false;
        }
    }
    async authenticateByBusinessName(whatsappId, businessName) {
        try {
            const owner = await exports.ownerService.getOwnerByBusinessName(businessName);
            if (!owner) {
                logger_1.logger.warn('Owner not found by business name', { businessName });
                return false;
            }
            if (owner.whatsappId !== whatsappId) {
                logger_1.logger.warn('WhatsApp ID mismatch for business name', { businessName, whatsappId });
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
    async createAuthSession(whatsappId) {
        try {
            const token = `owner_${whatsappId}_${Date.now()}`;
            logger_1.logger.info('Auth session created', { whatsappId, token });
            return token;
        }
        catch (error) {
            logger_1.logger.error('Failed to create auth session', { whatsappId, error });
            return null;
        }
    }
}
exports.OwnerAuthService = OwnerAuthService;
function parseOwnerButtonId(buttonId) {
    try {
        const cleanId = buttonId.replace(/^owner_/, '');
        const parts = cleanId.split('_');
        const action = parts[0];
        if (['register', 'login', 'help'].includes(action)) {
            return {
                action,
                category: 'auth'
            };
        }
        if (['stations', 'profile', 'analytics', 'settings', 'main', 'menu'].includes(action)) {
            return {
                action: action === 'menu' ? 'main_menu' : action,
                category: 'main'
            };
        }
        if (action === 'station' || parts.includes('station')) {
            const stationIndex = parts.findIndex(part => part === 'station');
            const stationId = stationIndex >= 0 && parts[stationIndex + 1] ?
                parseInt(parts[stationIndex + 1], 10) : undefined;
            return {
                action: parts.slice(0, stationIndex).join('_') || action,
                category: 'station',
                stationId
            };
        }
        if (action === 'toggle' && parts.includes('station')) {
            const stationId = parseInt(parts[parts.length - 1], 10);
            return {
                action: 'toggle_station',
                category: 'station',
                stationId: !isNaN(stationId) ? stationId : undefined
            };
        }
        if (['exit', 'help', 'contact', 'support'].includes(action)) {
            return {
                action: parts.join('_'),
                category: 'system'
            };
        }
        return {
            action: parts.join('_'),
            category: 'main'
        };
    }
    catch (error) {
        logger_1.logger.error('Owner button ID parsing failed', { buttonId, error });
        return {
            action: 'unknown',
            category: 'system'
        };
    }
}
exports.ownerService = new OwnerService();
exports.ownerStationService = new OwnerStationService();
exports.ownerAuthService = new OwnerAuthService();
//# sourceMappingURL=owner-service.js.map