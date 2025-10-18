"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueScheduler = void 0;
const queue_1 = require("../services/queue");
const analytics_1 = require("../services/analytics");
const notification_1 = require("../services/notification");
const session_1 = require("../services/session");
const photo_verification_1 = require("../services/photo-verification");
const logger_1 = require("../utils/logger");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const p_limit_1 = __importDefault(require("p-limit"));
const perf_hooks_1 = require("perf_hooks");
class QueueScheduler {
    constructor() {
        this.isRunning = false;
        this.startTime = Date.now();
        this.intervals = new Map();
        this.tasks = new Map();
        this.taskLatencies = [];
        this.MAX_LATENCIES = 100;
        this.concurrencyLimits = {
            cleanup: (0, p_limit_1.default)(2),
            optimization: (0, p_limit_1.default)(3),
            notifications: (0, p_limit_1.default)(5),
            analytics: (0, p_limit_1.default)(2),
            sessions: (0, p_limit_1.default)(4),
            alerts: (0, p_limit_1.default)(2),
            performance: (0, p_limit_1.default)(1),
            verification: (0, p_limit_1.default)(3),
        };
        this.baseIntervals = {
            cleanup: 2 * 60 * 1000,
            optimization: 5 * 60 * 1000,
            notifications: 3 * 60 * 1000,
            analytics: 10 * 60 * 1000,
            sessions: 45 * 1000,
            alerts: 4 * 60 * 1000,
            performance: 15 * 60 * 1000,
            verification: 10 * 60 * 1000,
        };
        this.processes = [
            {
                name: 'cleanup',
                interval: this.baseIntervals.cleanup,
                handler: this.cleanupExpiredReservations.bind(this),
                priority: 'low'
            },
            {
                name: 'optimization',
                interval: this.baseIntervals.optimization,
                handler: this.optimizeQueues.bind(this),
                priority: 'normal'
            },
            {
                name: 'notifications',
                interval: this.baseIntervals.notifications,
                handler: this.processNotifications.bind(this),
                priority: 'normal'
            },
            {
                name: 'analytics',
                interval: this.baseIntervals.analytics,
                handler: this.updateAnalytics.bind(this),
                priority: 'low'
            },
            {
                name: 'sessions',
                interval: this.baseIntervals.sessions,
                handler: this.monitorSessions.bind(this),
                priority: 'high'
            },
            {
                name: 'alerts',
                interval: this.baseIntervals.alerts,
                handler: this.checkAvailabilityAlerts.bind(this),
                priority: 'normal'
            },
            {
                name: 'performance',
                interval: this.baseIntervals.performance,
                handler: this.monitorPerformance.bind(this),
                priority: 'low'
            },
            {
                name: 'verification',
                interval: this.baseIntervals.verification,
                handler: this.cleanupVerificationStates.bind(this),
                priority: 'normal'
            },
        ];
    }
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('Scheduler already running');
            return;
        }
        this.isRunning = true;
        this.startTime = Date.now();
        logger_1.logger.info('🚀 Starting Queue Scheduler with Photo Verification...');
        this.processes.forEach(({ name, interval, handler }) => {
            this.startProcess(name, interval, handler);
        });
        logger_1.logger.info(`✅ Queue Scheduler operational with ${this.processes.length} processes`);
    }
    async stop() {
        if (!this.isRunning)
            return;
        logger_1.logger.info('🛑 Stopping Queue Scheduler...');
        this.isRunning = false;
        for (const [name, timer] of this.intervals) {
            clearInterval(timer);
            logger_1.logger.debug(`⏹️ Stopped interval: ${name}`);
        }
        this.intervals.clear();
        this.tasks.clear();
        logger_1.logger.info('⏹️ Queue Scheduler stopped');
    }
    startProcess(name, interval, handler) {
        const timer = setInterval(async () => {
            if (!this.isRunning)
                return;
            const start = perf_hooks_1.performance.now();
            try {
                await handler();
                const latency = perf_hooks_1.performance.now() - start;
                this.recordLatency(latency);
            }
            catch (error) {
                logger_1.logger.error(`❌ Process ${name} failed`, { error });
            }
        }, interval);
        this.intervals.set(name, timer);
        logger_1.logger.debug(`🔄 Process started: ${name} (${interval / 1000}s)`);
    }
    recordLatency(latency) {
        this.taskLatencies.push(latency);
        if (this.taskLatencies.length > this.MAX_LATENCIES) {
            this.taskLatencies.shift();
        }
    }
    getAvgLatency() {
        if (this.taskLatencies.length === 0)
            return 0;
        return this.taskLatencies.reduce((a, b) => a + b, 0) / this.taskLatencies.length;
    }
    async cleanupExpiredReservations() {
        const now = new Date();
        const expired = await database_1.db
            .select({
            id: schema_1.queues.id,
            userWhatsapp: schema_1.queues.userWhatsapp,
            stationId: schema_1.queues.stationId
        })
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.status, 'reserved'), (0, drizzle_orm_1.lt)(schema_1.queues.reservationExpiry, now)));
        if (expired.length === 0)
            return;
        const results = await Promise.allSettled(expired.map(item => this.concurrencyLimits.cleanup(() => queue_1.queueService.leaveQueue(item.userWhatsapp, item.stationId, 'expired'))));
        const cleaned = results.filter(r => r.status === 'fulfilled' && r.value).length;
        if (cleaned > 0) {
            logger_1.logger.info(`🧹 Cleaned ${cleaned}/${expired.length} expired reservations`);
        }
    }
    async optimizeQueues() {
        const stations = await database_1.db
            .select({ id: schema_1.chargingStations.id })
            .from(schema_1.chargingStations)
            .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.isActive, true));
        if (stations.length === 0)
            return;
        const results = await Promise.allSettled(stations.map(station => this.concurrencyLimits.optimization(() => this.optimizeStationQueue(station.id))));
        const optimized = results.filter(r => r.status === 'fulfilled' && r.value).length;
        if (optimized > 0) {
            logger_1.logger.info(`⚡ Optimized ${optimized}/${stations.length} station queues`);
        }
    }
    async optimizeStationQueue(stationId) {
        const queueData = await database_1.db
            .select()
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, stationId), (0, drizzle_orm_1.sql) `status NOT IN ('completed', 'cancelled')`))
            .orderBy(schema_1.queues.position);
        if (queueData.length === 0)
            return false;
        let optimized = false;
        const first = queueData.find(q => q.position === 1 && q.status === 'reserved');
        if (first?.reservationExpiry && Date.now() - first.reservationExpiry.getTime() > 5 * 60 * 1000) {
            const next = queueData.find(q => q.position === 2 && q.status === 'waiting');
            if (next) {
                const success = await queue_1.queueService.reserveSlot(next.userWhatsapp, stationId, 15);
                if (success) {
                    optimized = true;
                    logger_1.logger.info('🎯 Auto-promoted user', { stationId, user: next.userWhatsapp });
                }
            }
        }
        const active = queueData.filter(q => !['cancelled', 'completed'].includes(q.status));
        const needsRebalance = active.some((q, i) => q.position !== i + 1);
        if (needsRebalance) {
            const updates = active
                .map((q, i) => ({ id: q.id, pos: i + 1 }))
                .filter(u => queueData.find(q => q.id === u.id)?.position !== u.pos);
            if (updates.length > 0) {
                await database_1.db.transaction(async (tx) => {
                    for (const { id, pos } of updates) {
                        await tx.update(schema_1.queues)
                            .set({ position: pos, updatedAt: new Date() })
                            .where((0, drizzle_orm_1.eq)(schema_1.queues.id, id));
                    }
                });
                optimized = true;
                logger_1.logger.info(`⚖️ Rebalanced ${updates.length} positions`, { stationId });
            }
        }
        return optimized;
    }
    async processNotifications() {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000);
        const active = await database_1.db
            .select({
            userWhatsapp: schema_1.queues.userWhatsapp,
            stationId: schema_1.queues.stationId,
            position: schema_1.queues.position,
            createdAt: schema_1.queues.createdAt
        })
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `status IN ('waiting', 'reserved')`, (0, drizzle_orm_1.lt)(schema_1.queues.createdAt, cutoff)));
        const now = Date.now();
        const notifications = active
            .map(q => {
            const waitMin = Math.floor((now - q.createdAt.getTime()) / (1000 * 60));
            if (waitMin > 0 && waitMin % 15 === 0 && waitMin <= 60) {
                return this.concurrencyLimits.notifications(() => notification_1.notificationService.sendQueueProgressNotification(q.userWhatsapp, q.stationId, q.position, waitMin));
            }
            return null;
        })
            .filter(Boolean);
        if (notifications.length > 0) {
            await Promise.allSettled(notifications);
            logger_1.logger.debug(`📱 Sent ${notifications.length} queue notifications`);
        }
    }
    async updateAnalytics() {
        const stations = await database_1.db
            .select({ id: schema_1.chargingStations.id })
            .from(schema_1.chargingStations)
            .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.isActive, true));
        if (stations.length === 0)
            return;
        await Promise.allSettled([
            ...stations.map(s => this.concurrencyLimits.analytics(() => analytics_1.analyticsService.getStationAnalytics(s.id))),
            this.updateQueueCounts(stations.map(s => s.id))
        ]);
        logger_1.logger.debug(`📊 Analytics updated for ${stations.length} stations`);
    }
    async updateQueueCounts(stationIds) {
        if (stationIds.length === 0)
            return;
        const counts = await database_1.db
            .select({
            stationId: schema_1.queues.stationId,
            count: (0, drizzle_orm_1.sql) `count(*)`
        })
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.queues.stationId, stationIds), (0, drizzle_orm_1.sql) `status IN ('waiting', 'reserved', 'charging')`))
            .groupBy(schema_1.queues.stationId);
        const countMap = new Map(counts.map(c => [c.stationId, Number(c.count)]));
        await database_1.db.transaction(async (tx) => {
            for (const id of stationIds) {
                await tx.update(schema_1.chargingStations)
                    .set({
                    currentQueueLength: countMap.get(id) || 0,
                    updatedAt: new Date()
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, id));
            }
        });
    }
    async monitorSessions() {
        const sessions = session_1.sessionService.getActiveSessions();
        if (sessions.size === 0)
            return;
        const checks = Array.from(sessions.values()).map(session => this.concurrencyLimits.sessions(async () => {
            try {
                const sessionData = await this.getSessionFromDb(session.id);
                if (!sessionData) {
                    logger_1.logger.warn('Session not found in DB', { sessionId: session.id });
                    return null;
                }
                if (sessionData.verificationStatus === 'awaiting_start_photo') {
                    const waitTime = Date.now() - sessionData.createdAt.getTime();
                    if (waitTime > 10 * 60 * 1000) {
                        logger_1.logger.warn('⏰ Session start photo timeout', {
                            sessionId: session.id,
                            userWhatsapp: sessionData.userWhatsapp
                        });
                        await database_1.db.update(schema_1.chargingSessions)
                            .set({
                            status: 'cancelled',
                            verificationStatus: 'verification_timeout',
                            updatedAt: new Date()
                        })
                            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, session.id));
                        return 'verification_timeout';
                    }
                    return 'verification_pending';
                }
                if (sessionData.verificationStatus === 'awaiting_end_photo') {
                    return 'verification_pending';
                }
                if (sessionData.status !== 'active') {
                    return 'not_active';
                }
                const currentBattery = session.currentBatteryLevel || 0;
                const targetBattery = session.targetBatteryLevel || 80;
                if (currentBattery >= targetBattery) {
                    logger_1.logger.info('🎉 Session target reached', {
                        sessionId: session.id,
                        battery: currentBattery,
                        target: targetBattery
                    });
                    await session_1.sessionService.stopSession(sessionData.userWhatsapp, sessionData.stationId);
                    return 'target_reached';
                }
                if (sessionData.startTime) {
                    const durationMinutes = Math.floor((Date.now() - sessionData.startTime.getTime()) / (1000 * 60));
                    if (durationMinutes > 240) {
                        logger_1.logger.info('⏰ Session exceeded 4 hours, requesting end photo', {
                            sessionId: session.id,
                            durationMinutes
                        });
                        await session_1.sessionService.stopSession(sessionData.userWhatsapp, sessionData.stationId);
                        return 'duration_exceeded';
                    }
                }
                const maxPowerUsed = parseFloat(sessionData.maxPowerUsed?.toString() || '0');
                if (maxPowerUsed > 0 && maxPowerUsed < 5) {
                    logger_1.logger.warn('⚠️ Low power usage detected', {
                        sessionId: session.id,
                        maxPowerUsed
                    });
                    return 'anomaly_detected';
                }
                return 'monitoring';
            }
            catch (err) {
                logger_1.logger.error('Session check error', { sessionId: session.id, err });
                return null;
            }
        }));
        const results = await Promise.allSettled(checks);
        const statusCounts = new Map();
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                const count = statusCounts.get(result.value) || 0;
                statusCounts.set(result.value, count + 1);
            }
        });
        if (statusCounts.size > 0) {
            const summary = Array.from(statusCounts.entries())
                .map(([status, count]) => `${status}: ${count}`)
                .join(', ');
            logger_1.logger.debug(`🔋 Session monitoring: ${summary} (total: ${sessions.size})`);
        }
    }
    async getSessionFromDb(sessionId) {
        const sessions = await database_1.db
            .select()
            .from(schema_1.chargingSessions)
            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId))
            .limit(1);
        return sessions[0] || null;
    }
    async cleanupVerificationStates() {
        try {
            photo_verification_1.photoVerificationService.cleanupExpiredStates();
            const orphanedSessions = await database_1.db
                .select({
                sessionId: schema_1.chargingSessions.sessionId,
                userWhatsapp: schema_1.chargingSessions.userWhatsapp,
                verificationStatus: schema_1.chargingSessions.verificationStatus,
                createdAt: schema_1.chargingSessions.createdAt
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `verification_status IN ('awaiting_start_photo', 'awaiting_end_photo')`, (0, drizzle_orm_1.lt)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 30 * 60 * 1000))));
            if (orphanedSessions.length > 0) {
                logger_1.logger.info(`🧹 Found ${orphanedSessions.length} orphaned verification sessions`);
                await database_1.db.transaction(async (tx) => {
                    for (const session of orphanedSessions) {
                        await tx.update(schema_1.chargingSessions)
                            .set({
                            verificationStatus: 'verification_timeout',
                            status: 'cancelled',
                            updatedAt: new Date()
                        })
                            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, session.sessionId));
                    }
                });
                logger_1.logger.info(`✅ Cleaned ${orphanedSessions.length} orphaned verification sessions`);
            }
        }
        catch (error) {
            logger_1.logger.error('Verification cleanup failed', { error });
        }
    }
    async checkAvailabilityAlerts() {
        logger_1.logger.debug('🚨 Availability alerts checked');
    }
    async monitorPerformance() {
        const [activeQueues, activeVerifications, expiredVerifications, cacheSize] = await Promise.all([
            this.countActiveQueues(),
            this.countActiveVerifications(),
            this.countExpiredVerifications(),
            Promise.resolve(this.getCacheSize())
        ]);
        const metrics = {
            activeQueues,
            activeSessions: session_1.sessionService.getActiveSessions().size,
            activeVerifications,
            expiredVerifications,
            cacheSize,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            taskQueueSize: this.tasks.size,
            avgTaskLatencyMs: this.getAvgLatency(),
        };
        logger_1.logger.info('📊 System Performance', metrics);
        if (expiredVerifications > 10) {
            logger_1.logger.warn(`⚠️ High expired verification count: ${expiredVerifications}`);
        }
        this.cleanupCache();
    }
    async countActiveQueues() {
        const res = await database_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.sql) `status IN ('waiting', 'reserved')`);
        return Number(res[0]?.count || 0);
    }
    async countActiveVerifications() {
        const res = await database_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_1.chargingSessions)
            .where((0, drizzle_orm_1.sql) `verification_status IN ('awaiting_start_photo', 'awaiting_end_photo')`);
        return Number(res[0]?.count || 0);
    }
    async countExpiredVerifications() {
        const res = await database_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_1.chargingSessions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `verification_status IN ('awaiting_start_photo', 'awaiting_end_photo')`, (0, drizzle_orm_1.lt)(schema_1.chargingSessions.createdAt, new Date(Date.now() - 30 * 60 * 1000))));
        return Number(res[0]?.count || 0);
    }
    getCacheSize() {
        const cache = analytics_1.analyticsService.analyticsCache;
        return cache?.size || 0;
    }
    cleanupCache() {
        const cache = analytics_1.analyticsService.analyticsCache;
        if (!cache)
            return;
        const now = Date.now();
        const cutoff = 30 * 60 * 1000;
        let cleaned = 0;
        for (const [key, value] of cache.entries()) {
            if (now - value.timestamp > cutoff) {
                cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger_1.logger.debug(`🗑️ Cleaned ${cleaned} cache entries`);
        }
    }
    scheduleTask(type, scheduledTime, maxRetries = 3, priority = 'normal') {
        const taskId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const task = {
            id: taskId,
            type,
            scheduledTime,
            retries: 0,
            maxRetries,
            priority
        };
        this.tasks.set(taskId, task);
        const delay = Math.max(0, scheduledTime.getTime() - Date.now());
        setTimeout(() => this.executeTask(taskId), delay);
        logger_1.logger.info('📅 Task scheduled', {
            taskId,
            type,
            delay: `${(delay / 1000).toFixed(1)}s`,
            priority
        });
        return taskId;
    }
    async executeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task || !this.isRunning) {
            this.tasks.delete(taskId);
            return;
        }
        const handlers = {
            cleanup: this.cleanupExpiredReservations.bind(this),
            optimization: this.optimizeQueues.bind(this),
            notification: this.processNotifications.bind(this),
            analytics: this.updateAnalytics.bind(this),
            session: this.monitorSessions.bind(this),
            alert: this.checkAvailabilityAlerts.bind(this),
            performance: this.monitorPerformance.bind(this),
            verification: this.cleanupVerificationStates.bind(this),
        };
        const handler = handlers[task.type];
        if (!handler) {
            logger_1.logger.error('Unknown task type', { taskId, type: task.type });
            this.tasks.delete(taskId);
            return;
        }
        try {
            await handler();
            this.tasks.delete(taskId);
            logger_1.logger.info('✅ Task completed', { taskId });
        }
        catch (error) {
            task.retries++;
            if (task.retries < task.maxRetries) {
                const backoff = Math.min(300000, Math.pow(2, task.retries) * 60000);
                setTimeout(() => this.executeTask(taskId), backoff);
                logger_1.logger.warn('🔄 Task retry scheduled', {
                    taskId,
                    retry: task.retries,
                    backoff: `${(backoff / 1000).toFixed(0)}s`
                });
            }
            else {
                this.tasks.delete(taskId);
                logger_1.logger.error('💀 Task failed permanently', {
                    taskId,
                    type: task.type,
                    retries: task.maxRetries
                });
            }
        }
    }
    getStatus() {
        return {
            isRunning: this.isRunning,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            activeProcesses: Array.from(this.intervals.keys()),
            scheduledTasks: this.tasks.size,
            avgLatencyMs: this.getAvgLatency().toFixed(2),
            processes: this.processes.map(p => ({
                name: p.name,
                interval: `${p.interval / 1000}s`,
                priority: p.priority,
            })),
        };
    }
    async healthCheck() {
        if (!this.isRunning)
            return false;
        if (this.intervals.size !== this.processes.length)
            return false;
        try {
            await database_1.db.execute((0, drizzle_orm_1.sql) `SELECT 1`);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.queueScheduler = new QueueScheduler();
if (process.env.NODE_ENV === 'production') {
    exports.queueScheduler.start().catch(err => {
        logger_1.logger.error('💥 Failed to start QueueScheduler', { err });
        process.exit(1);
    });
}
const shutdown = async () => {
    logger_1.logger.info('⏳ Graceful shutdown initiated...');
    await exports.queueScheduler.stop();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
//# sourceMappingURL=queue-scheduler.js.map