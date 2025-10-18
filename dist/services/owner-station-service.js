"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerStationService = exports.OwnerStationService = void 0;
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
class OwnerStationService {
    async getOwnerStations(whatsappId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId))
            return [];
        try {
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
                connectorTypes: schema_1.chargingStations.connectorTypes,
                operatingHours: schema_1.chargingStations.operatingHours,
                currentQueueLength: schema_1.chargingStations.currentQueueLength,
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, whatsappId))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.chargingStations.createdAt));
            const enhancedStations = await Promise.all(stations.map(async (station) => {
                const [queueCount, todayRevenue] = await Promise.all([
                    this.getQueueLength(station.id),
                    this.getTodayRevenue(station.id)
                ]);
                return {
                    id: station.id,
                    name: station.name,
                    address: station.address,
                    isActive: station.isActive || false,
                    isOpen: station.isOpen || false,
                    totalSlots: station.totalSlots || 4,
                    availableSlots: station.availableSlots || 4,
                    pricePerKwh: station.pricePerKwh?.toString() || '12.50',
                    connectorTypes: station.connectorTypes,
                    operatingHours: station.operatingHours,
                    queueLength: queueCount,
                    todayRevenue
                };
            }));
            logger_1.logger.info('Retrieved owner stations', { whatsappId, count: enhancedStations.length });
            return enhancedStations;
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
                ownerWhatsappId: schema_1.chargingStations.ownerWhatsappId
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, ownerWhatsappId)))
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
            logger_1.logger.info('Station status toggled', {
                stationId,
                ownerWhatsappId,
                oldStatus: station.isActive,
                newStatus
            });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to toggle station status', { stationId, ownerWhatsappId, error });
            return false;
        }
    }
    async getStationDetails(stationId, ownerWhatsappId) {
        try {
            const [station] = await database_1.db
                .select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, ownerWhatsappId)))
                .limit(1);
            if (!station) {
                return null;
            }
            const analytics = await this.getStationAnalytics(stationId);
            return {
                ...station,
                ...analytics
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get station details', { stationId, ownerWhatsappId, error });
            return null;
        }
    }
    async getStationAnalytics(stationId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const [queueLength, todaySessions, todayRevenue, todayEnergy, totalSlots, averageSessionDuration] = await Promise.all([
                this.getQueueLength(stationId),
                this.getTodaySessionsCount(stationId),
                this.getTodayRevenue(stationId),
                this.getTodayEnergy(stationId),
                this.getStationSlots(stationId),
                this.getAverageSessionDuration(stationId)
            ]);
            const activeSessions = await this.getActiveSessionsCount(stationId);
            const utilizationRate = totalSlots > 0 ?
                Math.round((activeSessions / totalSlots) * 100) : 0;
            return {
                queueLength,
                todaySessions,
                todayRevenue,
                todayEnergy,
                utilizationRate,
                averageSessionDuration
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get station analytics', { stationId, error });
            return {
                queueLength: 0,
                todaySessions: 0,
                todayRevenue: 0,
                todayEnergy: 0,
                utilizationRate: 0,
                averageSessionDuration: 0
            };
        }
    }
    async getOwnerQuickStats(whatsappId) {
        try {
            const stations = await this.getOwnerStations(whatsappId);
            const totalStations = stations.length;
            const activeStations = stations.filter(s => s.isActive).length;
            const todayRevenue = stations.reduce((sum, s) => sum + s.todayRevenue, 0);
            const activeSessionsPromises = stations.map(s => this.getActiveSessionsCount(s.id));
            const activeSessionsCounts = await Promise.all(activeSessionsPromises);
            const activeSessions = activeSessionsCounts.reduce((sum, count) => sum + count, 0);
            const todayEnergyPromises = stations.map(s => this.getTodayEnergy(s.id));
            const todayEnergyCounts = await Promise.all(todayEnergyPromises);
            const todayEnergy = todayEnergyCounts.reduce((sum, energy) => sum + energy, 0);
            return {
                totalStations,
                activeStations,
                todayRevenue,
                activeSessions,
                todayEnergy: Math.round(todayEnergy * 100) / 100
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get owner quick stats', { whatsappId, error });
            return {
                totalStations: 0,
                activeStations: 0,
                todayRevenue: 0,
                activeSessions: 0,
                todayEnergy: 0
            };
        }
    }
    async getQueueLength(stationId) {
        try {
            const [result] = await database_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.queues.status, 'waiting')));
            return result?.count || 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get queue length', { stationId, error });
            return 0;
        }
    }
    async getTodayRevenue(stationId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const sessions = await database_1.db
                .select({ totalCost: schema_1.chargingSessions.totalCost })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, today), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const revenue = sessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            return Math.round(revenue);
        }
        catch (error) {
            logger_1.logger.error('Failed to get today revenue', { stationId, error });
            return 0;
        }
    }
    async getTodaySessionsCount(stationId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const [result] = await database_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, today)));
            return result?.count || 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get today sessions count', { stationId, error });
            return 0;
        }
    }
    async getTodayEnergy(stationId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const sessions = await database_1.db
                .select({ energyDelivered: schema_1.chargingSessions.energyDelivered })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, today), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const energy = sessions.reduce((sum, session) => sum + parseFloat(session.energyDelivered?.toString() || '0'), 0);
            return energy;
        }
        catch (error) {
            logger_1.logger.error('Failed to get today energy', { stationId, error });
            return 0;
        }
    }
    async getStationSlots(stationId) {
        try {
            const [station] = await database_1.db
                .select({ totalSlots: schema_1.chargingStations.totalSlots })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            return station?.totalSlots || 4;
        }
        catch (error) {
            logger_1.logger.error('Failed to get station slots', { stationId, error });
            return 4;
        }
    }
    async getActiveSessionsCount(stationId) {
        try {
            const [result] = await database_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'active')));
            return result?.count || 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get active sessions count', { stationId, error });
            return 0;
        }
    }
    async getAverageSessionDuration(stationId) {
        try {
            const sessions = await database_1.db
                .select({
                startTime: schema_1.chargingSessions.startTime,
                endTime: schema_1.chargingSessions.endTime
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')))
                .limit(100);
            if (sessions.length === 0)
                return 0;
            const totalDuration = sessions.reduce((sum, session) => {
                if (session.startTime && session.endTime) {
                    const duration = session.endTime.getTime() - session.startTime.getTime();
                    return sum + (duration / (1000 * 60));
                }
                return sum;
            }, 0);
            return Math.round(totalDuration / sessions.length);
        }
        catch (error) {
            logger_1.logger.error('Failed to get average session duration', { stationId, error });
            return 30;
        }
    }
    async verifyStationOwnership(stationId, ownerWhatsappId) {
        try {
            const [result] = await database_1.db
                .select({ id: schema_1.chargingStations.id })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, ownerWhatsappId)))
                .limit(1);
            return !!result;
        }
        catch (error) {
            logger_1.logger.error('Failed to verify station ownership', { stationId, ownerWhatsappId, error });
            return false;
        }
    }
}
exports.OwnerStationService = OwnerStationService;
exports.ownerStationService = new OwnerStationService();
//# sourceMappingURL=owner-station-service.js.map