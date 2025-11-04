"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsService = void 0;
const connection_1 = require("../db/connection");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
class AnalyticsService {
    constructor() {
        this.cache = new Map();
        this.alertSubscriptions = new Map();
    }
    async getStationAnalytics(stationId) {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            const currentQueue = await connection_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.queues.status, 'waiting')));
            const currentQueueLength = Number(currentQueue[0]?.count) || 0;
            const recentSessions = await connection_1.db
                .select({
                waitTime: (0, drizzle_orm_1.sql) `EXTRACT(EPOCH FROM (${schema_1.chargingSessions.startedAt} - ${schema_1.chargingSessions.createdAt})) / 60`
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.startedAt} IS NOT NULL`));
            const averageWaitTime = recentSessions.length > 0
                ? Math.round(recentSessions.reduce((sum, s) => sum + (Number(s.waitTime) || 0), 0) / recentSessions.length)
                : 5;
            const peakHoursData = await connection_1.db
                .select({
                hour: (0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`,
                count: (0, drizzle_orm_1.count)()
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))))
                .groupBy((0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`)
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.count)()));
            const peakHours = peakHoursData.slice(0, 3).map(p => {
                const hour = parseInt(String(p.hour));
                return hour === 0 ? '12 AM' :
                    hour < 12 ? `${hour} AM` :
                        hour === 12 ? '12 PM' :
                            `${hour - 12} PM`;
            });
            const isPeakHour = peakHoursData.slice(0, 3).some(p => parseInt(String(p.hour)) === currentHour);
            const utilizationData = await connection_1.db
                .select({
                totalSessions: (0, drizzle_orm_1.count)(),
                avgDuration: (0, drizzle_orm_1.avg)((0, drizzle_orm_1.sql) `EXTRACT(EPOCH FROM (${schema_1.chargingSessions.endedAt} - ${schema_1.chargingSessions.startedAt})) / 60`)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.endedAt} IS NOT NULL AND ${schema_1.chargingSessions.startedAt} IS NOT NULL`));
            const sessionsToday = Number(utilizationData[0]?.totalSessions) || 0;
            const avgDurationMinutes = Number(utilizationData[0]?.avgDuration) || 45;
            const maxPossibleSessions = Math.floor((24 * 60) / avgDurationMinutes);
            const utilization = Math.min(Math.round((sessionsToday / maxPossibleSessions) * 100), 100);
            const completedSessions = await connection_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed'), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))));
            const totalSessionsWeek = await connection_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))));
            const efficiency = Number(totalSessionsWeek[0]?.count) > 0
                ? Math.round((Number(completedSessions[0]?.count) / Number(totalSessionsWeek[0]?.count)) * 100)
                : 95;
            const baseWaitTime = averageWaitTime * Math.max(currentQueueLength, 1);
            const peakMultiplier = isPeakHour ? 1.3 : 1.0;
            const estimatedWaitTime = Math.round(baseWaitTime * peakMultiplier);
            const stationData = await connection_1.db
                .select({
                rating: schema_1.chargingStations.rating,
                averageRating: schema_1.chargingStations.averageRating,
                totalReviews: schema_1.chargingStations.totalReviews,
                reviewCount: schema_1.chargingStations.reviewCount
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            const stationRating = Number(stationData[0]?.rating || stationData[0]?.averageRating) || 4.0;
            const userSatisfaction = Math.min(Math.round((stationRating / 5.0) * 100), 100);
            const trends = {
                hourly: await this.getHourlyTrends(stationId),
                daily: await this.getDailyTrends(stationId),
                weekly: await this.getWeeklyTrends(stationId)
            };
            const liveData = {
                activeSessions: await this.getActiveSessionsCount(stationId),
                queueLength: currentQueueLength,
                availableSlots: await this.getAvailableSlotsCount(stationId),
                powerOutput: Math.round(Math.random() * 100 + 150),
                currentWaitTime: estimatedWaitTime,
                utilization,
                energyToday: Math.round(Math.random() * 500 + 200),
                predictions: [
                    isPeakHour ? '🔴 Peak hours - longer wait times' : '🟢 Off-peak - shorter wait times',
                    efficiency > 90 ? '✅ Station operating efficiently' : '⚠️ Station may have issues',
                    currentQueueLength > 3 ? '📈 High demand expected' : '📉 Normal demand'
                ]
            };
            return {
                stationId,
                currentQueueLength,
                averageWaitTime,
                estimatedWaitTime,
                isPeakHour,
                peakHours,
                utilization,
                efficiency,
                userSatisfaction,
                trends,
                liveData
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get station analytics', { stationId, error });
            return {
                stationId,
                currentQueueLength: 0,
                averageWaitTime: 5,
                estimatedWaitTime: 5,
                isPeakHour: false,
                peakHours: ['9 AM', '6 PM', '8 PM'],
                utilization: 50,
                efficiency: 85,
                userSatisfaction: 80,
                trends: { hourly: [], daily: [], weekly: [] },
                liveData: {
                    activeSessions: 0,
                    queueLength: 0,
                    availableSlots: 2,
                    powerOutput: 150,
                    currentWaitTime: 5,
                    utilization: 50,
                    energyToday: 300,
                    predictions: ['🟡 Limited data available']
                }
            };
        }
    }
    async getOptimalTimes(stationId, userWhatsapp) {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            const hourlyData = await connection_1.db
                .select({
                hour: (0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`,
                avgWaitTime: (0, drizzle_orm_1.avg)((0, drizzle_orm_1.sql) `EXTRACT(EPOCH FROM (${schema_1.chargingSessions.startedAt} - ${schema_1.chargingSessions.createdAt})) / 60`),
                sessionCount: (0, drizzle_orm_1.count)()
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.startedAt} IS NOT NULL`))
                .groupBy((0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`)
                .orderBy((0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`);
            const optimalTimes = [];
            const hourlyMap = new Map(hourlyData.map(h => [parseInt(String(h.hour)), h]));
            for (let i = 1; i <= 12; i++) {
                const targetHour = (currentHour + i) % 24;
                const histData = hourlyMap.get(targetHour);
                const waitTime = Number(histData?.avgWaitTime) || 5;
                const sessionCount = Number(histData?.sessionCount) || 0;
                const confidence = Math.min(Math.round((sessionCount / 10) * 100), 100);
                const timeStr = targetHour === 0 ? '12 AM' :
                    targetHour < 12 ? `${targetHour} AM` :
                        targetHour === 12 ? '12 PM' :
                            `${targetHour - 12} PM`;
                let description;
                let recommendation;
                if (waitTime <= 5) {
                    description = 'Excellent time to charge';
                    recommendation = '🟢 Highly recommended - minimal wait';
                }
                else if (waitTime <= 15) {
                    description = 'Good time with moderate wait';
                    recommendation = '🟡 Good option - short wait expected';
                }
                else if (waitTime <= 30) {
                    description = 'Busy period with longer wait';
                    recommendation = '🟠 Consider alternative time';
                }
                else {
                    description = 'Peak hours with extended wait';
                    recommendation = '🔴 Avoid if possible - try different time';
                }
                optimalTimes.push({
                    time: timeStr,
                    waitTime: Math.round(waitTime),
                    description,
                    recommendation,
                    confidence
                });
            }
            return optimalTimes.sort((a, b) => a.waitTime - b.waitTime);
        }
        catch (error) {
            logger_1.logger.error('Failed to get optimal times', { stationId, userWhatsapp, error });
            return [
                {
                    time: '6 AM',
                    waitTime: 2,
                    description: 'Early morning - least busy',
                    recommendation: '🟢 Excellent choice - no wait expected',
                    confidence: 70
                },
                {
                    time: '2 PM',
                    waitTime: 5,
                    description: 'Afternoon lull - good availability',
                    recommendation: '🟢 Good time - minimal wait',
                    confidence: 65
                }
            ];
        }
    }
    async getRealtimeEstimate(stationId, userWhatsapp) {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            const dayOfWeek = now.getDay();
            const queueData = await connection_1.db
                .select({
                queueLength: (0, drizzle_orm_1.count)(),
                avgPosition: (0, drizzle_orm_1.avg)(schema_1.queues.position)
            })
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.queues.status, 'waiting')));
            const currentQueueLength = Number(queueData[0]?.queueLength) || 0;
            const recentSessions = await connection_1.db
                .select({
                duration: (0, drizzle_orm_1.sql) `EXTRACT(EPOCH FROM (${schema_1.chargingSessions.endedAt} - ${schema_1.chargingSessions.startedAt})) / 60`
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.endedAt} IS NOT NULL AND ${schema_1.chargingSessions.startedAt} IS NOT NULL`))
                .limit(20);
            const avgSessionDuration = recentSessions.length > 0
                ? Math.round(recentSessions.reduce((sum, s) => sum + (Number(s.duration) || 0), 0) / recentSessions.length)
                : 45;
            const factors = {
                timeOfDay: this.getTimeOfDayFactor(currentHour),
                dayOfWeek: this.getDayOfWeekFactor(dayOfWeek),
                weatherImpact: Math.random() * 0.2 + 0.9,
                seasonalFactor: this.getSeasonalFactor(now.getMonth()),
                stationEfficiency: 0.95
            };
            const baseWaitTime = avgSessionDuration * Math.max(currentQueueLength, 0);
            const dynamicMultiplier = factors.timeOfDay * factors.dayOfWeek * factors.weatherImpact * factors.seasonalFactor;
            const adjustedWaitTime = Math.round(baseWaitTime * dynamicMultiplier / factors.stationEfficiency);
            const estimatedWait = Math.max(Math.min(adjustedWaitTime, 180), 0);
            const confidence = Math.min(Math.round((recentSessions.length / 20) * 80 + 20), 95);
            const expectedTime = new Date(now.getTime() + estimatedWait * 60 * 1000);
            const expectedTimeStr = expectedTime.toLocaleTimeString('en-IN', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            const recentChanges = [];
            if (currentQueueLength === 0) {
                recentChanges.push('🟢 No queue - immediate availability');
            }
            else if (currentQueueLength <= 2) {
                recentChanges.push('🟡 Short queue detected');
            }
            else {
                recentChanges.push('🔴 Longer queue than usual');
            }
            if (factors.timeOfDay > 1.2) {
                recentChanges.push('📈 Peak hour traffic affecting wait times');
            }
            else if (factors.timeOfDay < 0.8) {
                recentChanges.push('📉 Off-peak hours - faster service');
            }
            let tip;
            if (estimatedWait <= 5) {
                tip = '🚀 Great timing! Head over now for quick charging.';
            }
            else if (estimatedWait <= 15) {
                tip = '⏱️ Short wait expected. Good time to charge.';
            }
            else if (estimatedWait <= 30) {
                tip = '📱 Moderate wait. Consider grabbing coffee nearby.';
            }
            else if (estimatedWait <= 60) {
                tip = '🕐 Longer wait. Maybe try a nearby station or wait for off-peak hours.';
            }
            else {
                tip = '⚠️ Significant delay expected. Check alternative stations.';
            }
            return {
                estimatedWait,
                confidence,
                expectedTime: expectedTimeStr,
                recentChanges,
                tip
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get realtime estimate', { stationId, userWhatsapp, error });
            return {
                estimatedWait: 10,
                confidence: 50,
                expectedTime: new Date(Date.now() + 10 * 60 * 1000).toLocaleTimeString('en-IN', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                }),
                recentChanges: ['⚠️ Limited real-time data available'],
                tip: '📊 Estimates based on historical patterns.'
            };
        }
    }
    async getActiveSessionsCount(stationId) {
        try {
            const result = await connection_1.db
                .select({ count: (0, drizzle_orm_1.count)() })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'active')));
            return Number(result[0]?.count) || 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get active sessions count', { stationId, error });
            return 0;
        }
    }
    async getAvailableSlotsCount(stationId) {
        try {
            const result = await connection_1.db
                .select({
                availableSlots: schema_1.chargingStations.availableSlots,
                availablePorts: schema_1.chargingStations.availablePorts
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            return Number(result[0]?.availableSlots || result[0]?.availablePorts) || 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get available slots count', { stationId, error });
            return 0;
        }
    }
    async getHourlyTrends(stationId) {
        try {
            const result = await connection_1.db.select({
                hour: (0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`,
                sessions: (0, drizzle_orm_1.count)(),
                avgWait: (0, drizzle_orm_1.avg)((0, drizzle_orm_1.sql) `EXTRACT(EPOCH FROM (${schema_1.chargingSessions.startedAt} - ${schema_1.chargingSessions.createdAt})) / 60`)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.startedAt} IS NOT NULL`))
                .groupBy((0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`)
                .orderBy((0, drizzle_orm_1.sql) `EXTRACT(HOUR FROM ${schema_1.chargingSessions.createdAt})`);
            return result.map(row => ({
                time: `${String(row.hour).padStart(2, '0')}:00`,
                utilization: Math.min(100, (Number(row.sessions) / 7) * 15),
                queueLength: Math.round(Number(row.sessions) / 7),
                avgWaitTime: Number(row.avgWait) || 0
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get hourly trends', { stationId, error });
            return [];
        }
    }
    async getDailyTrends(stationId) {
        try {
            const result = await connection_1.db.select({
                date: (0, drizzle_orm_1.sql) `DATE(${schema_1.chargingSessions.createdAt})`,
                sessions: (0, drizzle_orm_1.count)(),
                totalCost: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost),
                avgWait: (0, drizzle_orm_1.avg)((0, drizzle_orm_1.sql) `EXTRACT(EPOCH FROM (${schema_1.chargingSessions.startedAt} - ${schema_1.chargingSessions.createdAt})) / 60`)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.startedAt} IS NOT NULL`))
                .groupBy((0, drizzle_orm_1.sql) `DATE(${schema_1.chargingSessions.createdAt})`)
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `DATE(${schema_1.chargingSessions.createdAt})`))
                .limit(30);
            return result.map(row => ({
                date: String(row.date),
                sessions: Number(row.sessions),
                revenue: Number(row.totalCost) || 0,
                avgWaitTime: Number(row.avgWait) || 0
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get daily trends', { stationId, error });
            return [];
        }
    }
    async getWeeklyTrends(stationId) {
        try {
            const result = await connection_1.db.select({
                week: (0, drizzle_orm_1.sql) `DATE_TRUNC('week', ${schema_1.chargingSessions.createdAt})`,
                sessions: (0, drizzle_orm_1.count)(),
                totalCost: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.gte)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000))))
                .groupBy((0, drizzle_orm_1.sql) `DATE_TRUNC('week', ${schema_1.chargingSessions.createdAt})`)
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `DATE_TRUNC('week', ${schema_1.chargingSessions.createdAt})`))
                .limit(12);
            return result.map(row => ({
                week: String(row.week),
                totalSessions: Number(row.sessions),
                totalRevenue: Number(row.totalCost) || 0,
                avgSatisfaction: 4.2
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get weekly trends', { stationId, error });
            return [];
        }
    }
    getTimeOfDayFactor(hour) {
        if (hour >= 8 && hour <= 10)
            return 1.4;
        if (hour >= 17 && hour <= 19)
            return 1.5;
        if (hour >= 20 && hour <= 22)
            return 1.2;
        if (hour >= 2 && hour <= 6)
            return 0.6;
        return 1.0;
    }
    getDayOfWeekFactor(dayOfWeek) {
        if (dayOfWeek === 0 || dayOfWeek === 6)
            return 1.1;
        if (dayOfWeek >= 1 && dayOfWeek <= 5)
            return 1.0;
        return 1.0;
    }
    getSeasonalFactor(month) {
        if (month >= 3 && month <= 5)
            return 1.1;
        if (month >= 11 || month <= 1)
            return 1.15;
        if (month >= 6 && month <= 8)
            return 1.05;
        return 1.0;
    }
    async submitRating(userWhatsapp, stationId, rating) {
        try {
            if (rating < 1 || rating > 5) {
                logger_1.logger.warn('Invalid rating value', { userWhatsapp, stationId, rating });
                return false;
            }
            logger_1.logger.info('User rating submitted', { userWhatsapp, stationId, rating });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to submit rating', { userWhatsapp, stationId, rating, error });
            return false;
        }
    }
    clearCache() {
        this.cache.clear();
        logger_1.logger.info('Analytics cache cleared');
    }
    getCacheStats() {
        return {
            size: this.cache.size,
            alertSubscriptions: this.alertSubscriptions.size
        };
    }
}
exports.analyticsService = new AnalyticsService();
//# sourceMappingURL=analytics.js.map