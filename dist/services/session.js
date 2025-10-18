"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionService = void 0;
const connection_1 = require("../db/connection");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const notification_1 = require("./notification");
const photo_verification_1 = require("./photo-verification");
class SessionService {
    constructor() {
        this.activeSessions = new Map();
    }
    async startSession(userWhatsapp, stationId, queueId) {
        try {
            const existingSession = await this.getActiveSession(userWhatsapp, stationId);
            if (existingSession && ['active', 'initiated'].includes(existingSession.status)) {
                logger_1.logger.warn('Active session already exists', { userWhatsapp, stationId });
                return existingSession;
            }
            const station = await connection_1.db
                .select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            if (!station.length) {
                logger_1.logger.error('Station not found for session', { stationId });
                return null;
            }
            const stationData = station[0];
            const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const [newSession] = await connection_1.db
                .insert(schema_1.chargingSessions)
                .values({
                sessionId,
                userWhatsapp,
                stationId,
                queueId,
                status: 'initiated',
                verificationStatus: 'pending',
                maxPowerUsed: stationData.maxPowerKw || 50,
                ratePerKwh: stationData.pricePerKwh?.toString() || '12',
                createdAt: new Date(),
                updatedAt: new Date(),
            })
                .returning();
            logger_1.logger.info('Session created, requesting START photo', {
                sessionId,
                userWhatsapp,
                stationId,
            });
            await photo_verification_1.photoVerificationService.initiateStartVerification(userWhatsapp, sessionId, stationId);
            return this.mapToChargingSession(newSession);
        }
        catch (error) {
            logger_1.logger.error('Failed to start session', { error, userWhatsapp, stationId });
            return null;
        }
    }
    async startChargingAfterVerification(sessionId, startMeterReading) {
        try {
            logger_1.logger.info('Activating charging after photo verification', {
                sessionId,
                startMeterReading,
            });
            const now = new Date();
            await connection_1.db
                .update(schema_1.chargingSessions)
                .set({
                status: 'active',
                verificationStatus: 'start_verified',
                startTime: now,
                startedAt: now,
                startMeterReading: startMeterReading.toString(),
                updatedAt: now,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId));
            const session = await this.getSessionById(sessionId);
            if (!session) {
                logger_1.logger.error('Session not found after verification', { sessionId });
                throw new Error('Session not found after verification');
            }
            this.activeSessions.set(sessionId, session);
            logger_1.logger.info('✅ Charging activated', {
                sessionId,
                userWhatsapp: session.userWhatsapp,
                stationId: session.stationId,
                startReading: startMeterReading,
            });
            await notification_1.notificationService.sendChargingStartedNotification(session.userWhatsapp, session);
        }
        catch (error) {
            logger_1.logger.error('Failed to activate charging', { error, sessionId });
            throw error;
        }
    }
    async getActiveSession(userWhatsapp, stationId) {
        for (const s of this.activeSessions.values()) {
            if (s.userWhatsapp === userWhatsapp &&
                s.stationId === stationId &&
                ['active', 'initiated'].includes(s.status)) {
                return s;
            }
        }
        try {
            const [dbSession] = await connection_1.db
                .select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, userWhatsapp), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.status} IN ('active', 'initiated')`))
                .limit(1);
            return dbSession ? this.mapToChargingSession(dbSession) : null;
        }
        catch (error) {
            logger_1.logger.error('Failed to get active session', { error, userWhatsapp, stationId });
            return null;
        }
    }
    async stopSession(userWhatsapp, stationId) {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (!session) {
                logger_1.logger.warn('No active session to stop', { userWhatsapp, stationId });
                return false;
            }
            await connection_1.db
                .update(schema_1.chargingSessions)
                .set({
                status: 'active',
                verificationStatus: 'awaiting_end_photo',
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, session.id));
            logger_1.logger.info('Stop requested, awaiting END photo', {
                sessionId: session.id,
                userWhatsapp,
            });
            await photo_verification_1.photoVerificationService.initiateEndVerification(userWhatsapp, session.id, stationId);
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to stop session', { error, userWhatsapp, stationId });
            return false;
        }
    }
    async completeSessionAfterVerification(sessionId, endMeterReading, consumption) {
        try {
            const result = await connection_1.db
                .select({
                session: schema_1.chargingSessions,
                station: schema_1.chargingStations,
            })
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId))
                .limit(1);
            if (!result || result.length === 0) {
                logger_1.logger.error('Session not found during completion', { sessionId });
                throw new Error('Session not found');
            }
            const session = result[0].session;
            const station = result[0].station;
            if (!session.userWhatsapp) {
                throw new Error('Session missing user WhatsApp ID');
            }
            if (!session.startMeterReading) {
                throw new Error('Session missing start meter reading');
            }
            const startTime = session.startTime || session.startedAt || session.createdAt || new Date();
            const endTime = new Date();
            const durationMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));
            const ratePerKwh = parseFloat(session.ratePerKwh || '12');
            if (isNaN(ratePerKwh) || ratePerKwh <= 0) {
                throw new Error(`Invalid rate per kWh: ${session.ratePerKwh}`);
            }
            const energyCost = consumption * ratePerKwh;
            const platformFee = Math.max(5, energyCost * 0.05);
            const gst = (energyCost + platformFee) * 0.18;
            const totalCost = energyCost + platformFee + gst;
            logger_1.logger.info('💰 Calculating session costs', {
                sessionId,
                consumption,
                ratePerKwh,
                energyCost: energyCost.toFixed(2),
                platformFee: platformFee.toFixed(2),
                gst: gst.toFixed(2),
                totalCost: totalCost.toFixed(2)
            });
            await connection_1.db
                .update(schema_1.chargingSessions)
                .set({
                status: 'completed',
                verificationStatus: 'completed',
                endTime,
                endedAt: endTime,
                duration: durationMinutes,
                endMeterReading: endMeterReading.toString(),
                energyDelivered: consumption.toString(),
                totalCost: totalCost.toFixed(2),
                baseCharge: platformFee.toFixed(2),
                taxAmount: gst.toFixed(2),
                paymentStatus: 'pending',
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId));
            this.activeSessions.delete(sessionId);
            const summary = {
                sessionId,
                duration: this.formatDuration(durationMinutes),
                energyDelivered: consumption,
                finalBatteryLevel: session.finalBatteryPercent || 80,
                totalCost,
                stationName: station?.name || 'Charging Station',
                startTime,
                endTime,
            };
            logger_1.logger.info('✅ Session completed successfully', {
                sessionId,
                userWhatsapp: session.userWhatsapp,
                consumption: consumption.toFixed(2),
                totalCost: totalCost.toFixed(2),
                duration: `${durationMinutes} minutes`
            });
            const enrichedSession = {
                ...session,
                stationName: station?.name || 'Charging Station',
                stationId: session.stationId,
                pricePerKwh: ratePerKwh,
                startMeterReading: session.startMeterReading,
                endMeterReading: endMeterReading.toString(),
                energyDelivered: consumption.toString(),
                totalCost: totalCost.toFixed(2),
            };
            setImmediate(async () => {
                try {
                    await notification_1.notificationService.sendSessionCompletedNotification(session.userWhatsapp, enrichedSession, summary);
                    logger_1.logger.debug('Completion notification sent', { sessionId });
                }
                catch (notifError) {
                    logger_1.logger.error('Failed to send completion notification (non-critical)', {
                        sessionId,
                        userWhatsapp: session.userWhatsapp,
                        error: notifError
                    });
                }
            });
            await this.updateUserStats(session.userWhatsapp, consumption, totalCost);
        }
        catch (error) {
            logger_1.logger.error('Failed to complete session', {
                error,
                sessionId,
                errorMessage: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    formatDuration(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
    async updateUserStats(userWhatsapp, energyConsumed, costSpent) {
        try {
            await connection_1.db
                .update(schema_1.users)
                .set({
                totalSessions: (0, drizzle_orm_1.sql) `${schema_1.users.totalSessions} + 1`,
                totalEnergyConsumed: (0, drizzle_orm_1.sql) `${schema_1.users.totalEnergyConsumed} + ${energyConsumed}`,
                lastActivityAt: new Date(),
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, userWhatsapp));
            logger_1.logger.info('User stats updated', { userWhatsapp, energyConsumed, costSpent });
        }
        catch (error) {
            logger_1.logger.error('Failed to update user stats', { error, userWhatsapp });
        }
    }
    mapToChargingSession(dbSession) {
        return {
            id: dbSession.sessionId,
            userWhatsapp: dbSession.userWhatsapp,
            stationId: dbSession.stationId,
            stationName: dbSession.stationName || 'Charging Station',
            startTime: dbSession.startedAt || dbSession.startTime,
            endTime: dbSession.endTime,
            energyDelivered: parseFloat(dbSession.energyDelivered || '0'),
            currentBatteryLevel: dbSession.initialBatteryPercent || 20,
            targetBatteryLevel: dbSession.finalBatteryPercent || 80,
            pricePerKwh: parseFloat(dbSession.ratePerKwh || '12'),
            totalCost: parseFloat(dbSession.totalCost || '0'),
            status: dbSession.status,
            queueId: dbSession.queueId,
        };
    }
    async getSessionById(sessionId) {
        try {
            const result = await connection_1.db
                .select({
                session: schema_1.chargingSessions,
                station: schema_1.chargingStations,
            })
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId))
                .limit(1);
            if (!result || result.length === 0) {
                logger_1.logger.warn('Session not found', { sessionId });
                return null;
            }
            const sessionData = {
                ...result[0].session,
                stationName: result[0].station?.name || 'Charging Station',
            };
            return this.mapToChargingSession(sessionData);
        }
        catch (error) {
            logger_1.logger.error('Failed to get session by ID', { sessionId, error });
            return null;
        }
    }
    async getSessionHistory(userWhatsapp, limit = 10) {
        try {
            const sessions = await connection_1.db
                .select()
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, userWhatsapp))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.chargingSessions.createdAt))
                .limit(limit);
            return sessions.map(s => this.mapToChargingSession(s));
        }
        catch (error) {
            logger_1.logger.error('Failed to get session history', { userWhatsapp, error });
            return [];
        }
    }
    async getUserStats(userWhatsapp) {
        try {
            const basicStats = await connection_1.db
                .select({
                totalSessions: (0, drizzle_orm_1.count)(),
                totalEnergyConsumed: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.energyDelivered),
                totalCostSpent: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost),
                avgSessionTime: (0, drizzle_orm_1.avg)(schema_1.chargingSessions.duration),
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, userWhatsapp), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const stats = basicStats[0];
            return {
                totalSessions: Number(stats.totalSessions) || 0,
                totalEnergyConsumed: Number(stats.totalEnergyConsumed) || 0,
                totalCostSpent: Number(stats.totalCostSpent) || 0,
                avgSessionTime: Number(stats.avgSessionTime) || 0,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get user stats', { userWhatsapp, error });
            return null;
        }
    }
    async emergencyStopStation(stationId) {
        try {
            let stoppedCount = 0;
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (session.stationId === stationId && session.status === 'active') {
                    await this.stopSession(session.userWhatsapp, stationId);
                    stoppedCount++;
                }
            }
            logger_1.logger.warn('🚨 Emergency stop executed', { stationId, stoppedSessions: stoppedCount });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed emergency stop', { stationId, error });
            return false;
        }
    }
    async getStationStats(stationId) {
        try {
            const stats = await connection_1.db
                .select({
                totalSessions: (0, drizzle_orm_1.count)(),
                totalEnergyDelivered: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.energyDelivered),
                totalRevenue: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost),
                avgSessionTime: (0, drizzle_orm_1.avg)(schema_1.chargingSessions.duration),
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const result = stats[0];
            return {
                totalSessions: Number(result.totalSessions) || 0,
                totalEnergyDelivered: Number(result.totalEnergyDelivered) || 0,
                totalRevenue: Number(result.totalRevenue) || 0,
                avgSessionTime: Number(result.avgSessionTime) || 0,
                activeSessionsCount: Array.from(this.activeSessions.values()).filter(s => s.stationId === stationId && s.status === 'active').length,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get station stats', { stationId, error });
            return null;
        }
    }
    getActiveSessions() {
        return this.activeSessions;
    }
}
exports.sessionService = new SessionService();
//# sourceMappingURL=session.js.map