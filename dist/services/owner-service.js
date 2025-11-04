"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerService = exports.OwnerService = void 0;
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
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, whatsappId));
            if (!ownerStations.length) {
                return null;
            }
            const stationIds = ownerStations.map(s => s.id);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const twoWeeksAgo = new Date();
            twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
            const todaySessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.chargingSessions.stationId} = ANY(ARRAY[${drizzle_orm_1.sql.join(stationIds.map(id => (0, drizzle_orm_1.sql) `${id}`), (0, drizzle_orm_1.sql) `, `)}])`, (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, today)));
            const weekSessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.chargingSessions.stationId} = ANY(ARRAY[${drizzle_orm_1.sql.join(stationIds.map(id => (0, drizzle_orm_1.sql) `${id}`), (0, drizzle_orm_1.sql) `, `)}])`, (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, weekAgo)));
            const lastWeekSessions = await database_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.chargingSessions.stationId} = ANY(ARRAY[${drizzle_orm_1.sql.join(stationIds.map(id => (0, drizzle_orm_1.sql) `${id}`), (0, drizzle_orm_1.sql) `, `)}])`, (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, twoWeeksAgo), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.startTime} < ${weekAgo}`));
            const todayRevenue = todaySessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            const todayEnergy = todaySessions.reduce((sum, session) => sum + parseFloat(session.energyDelivered?.toString() || '0'), 0);
            const avgDuration = todaySessions.length > 0 ?
                todaySessions.reduce((sum, session) => {
                    if (session.startTime && session.endTime) {
                        return sum + (session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60);
                    }
                    return sum;
                }, 0) / todaySessions.length : 0;
            const weekRevenue = weekSessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            const lastWeekRevenue = lastWeekSessions.reduce((sum, session) => sum + parseFloat(session.totalCost?.toString() || '0'), 0);
            const weekGrowth = lastWeekRevenue > 0 ?
                ((weekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100 : 0;
            const stationRevenues = await Promise.all(ownerStations.map(async (station) => {
                const sessions = await database_1.db
                    .select()
                    .from(schema_1.chargingSessions)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, station.id), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.startTime, weekAgo)));
                const revenue = sessions.reduce((sum, s) => sum + parseFloat(s.totalCost?.toString() || '0'), 0);
                return { name: station.name, revenue };
            }));
            const bestStation = stationRevenues.reduce((max, current) => current.revenue > max.revenue ? current : max, { name: 'N/A', revenue: 0 });
            const allStations = await database_1.db
                .select({
                totalSlots: schema_1.chargingStations.totalSlots,
                availableSlots: schema_1.chargingStations.availableSlots
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.ownerWhatsappId, whatsappId));
            const totalSlots = allStations.reduce((sum, s) => sum + (s.totalSlots || 0), 0);
            const totalAvailable = allStations.reduce((sum, s) => sum + (s.availableSlots || 0), 0);
            const avgUtilization = totalSlots > 0 ?
                Math.round(((totalSlots - totalAvailable) / totalSlots) * 100) : 0;
            const hourlyData = todaySessions
                .filter(s => s.startTime)
                .map(s => new Date(s.startTime).getHours());
            const peakHour = hourlyData.length > 0 ?
                hourlyData.sort((a, b) => hourlyData.filter(h => h === b).length - hourlyData.filter(h => h === a).length)[0] : 12;
            const completedSessions = await database_1.db
                .select({
                customerRating: schema_1.chargingSessions.customerRating,
                userWhatsapp: schema_1.chargingSessions.userWhatsapp
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.chargingSessions.stationId} = ANY(ARRAY[${drizzle_orm_1.sql.join(stationIds.map(id => (0, drizzle_orm_1.sql) `${id}`), (0, drizzle_orm_1.sql) `, `)}])`, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const ratings = completedSessions
                .filter(s => s.customerRating)
                .map(s => s.customerRating);
            const avgRating = ratings.length > 0 ?
                ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
            const uniqueUsers = new Set(completedSessions.map(s => s.userWhatsapp));
            const totalUsers = uniqueUsers.size;
            const repeatUsers = completedSessions.length - totalUsers;
            const repeatPercentage = totalUsers > 0 ?
                Math.round((repeatUsers / totalUsers) * 100) : 0;
            return {
                todaySessions: todaySessions.length,
                todayRevenue: Math.round(todayRevenue),
                todayEnergy: Math.round(todayEnergy * 100) / 100,
                avgSessionDuration: Math.round(avgDuration),
                weekSessions: weekSessions.length,
                weekRevenue: Math.round(weekRevenue),
                weekGrowth: Math.round(weekGrowth * 10) / 10,
                bestStationName: bestStation.name,
                avgUtilization,
                peakHours: `${peakHour}:00 - ${peakHour + 1}:00`,
                averageRating: Math.round(avgRating * 10) / 10,
                totalReviews: ratings.length,
                repeatCustomers: repeatPercentage
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
exports.ownerService = new OwnerService();
//# sourceMappingURL=owner-service.js.map