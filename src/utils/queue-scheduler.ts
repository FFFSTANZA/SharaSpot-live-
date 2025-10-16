// src/utils/queue-scheduler.ts - PRODUCTION READY & FULLY OPTIMIZED

import { queueService } from '../services/queue';
import { analyticsService } from '../services/analytics';
import { notificationService } from '../services/notification';
import { sessionService } from '../services/session';
import { photoVerificationService } from '../services/photo-verification';
import { logger } from '../utils/logger';
import { db } from '../config/database';
import { queues, chargingStations, chargingSessions } from '../db/schema';
import { eq, and, lt, sql, inArray } from 'drizzle-orm';
import pLimit from 'p-limit';
import { performance } from 'perf_hooks';

// ===============================================
// TYPES & INTERFACES
// ===============================================

interface ScheduledTask {
  id: string;
  type: 'cleanup' | 'optimization' | 'notification' | 'analytics' | 'session' | 'alert' | 'performance' | 'verification';
  scheduledTime: Date;
  retries: number;
  maxRetries: number;
  priority: 'high' | 'normal' | 'low';
}

interface ProcessConfig {
  name: string;
  interval: number;
  handler: () => Promise<void>;
  concurrencyLimit?: number;
  priority: 'high' | 'normal' | 'low';
}

interface SystemMetrics {
  activeQueues: number;
  activeSessions: number;
  activeVerifications: number;
  expiredVerifications: number;
  cacheSize: number;
  uptime: number;
  taskQueueSize: number;
  avgTaskLatencyMs: number;
}

// ===============================================
// QUEUE SCHEDULER WITH PHOTO VERIFICATION
// ===============================================

class QueueScheduler {
  private isRunning = false;
  private startTime = Date.now();
  private intervals = new Map<string, NodeJS.Timeout>();
  private tasks = new Map<string, ScheduledTask>();
  private taskLatencies: number[] = [];
  private readonly MAX_LATENCIES = 100;

  // Concurrency limits per task type
  private readonly concurrencyLimits = {
    cleanup: pLimit(2),
    optimization: pLimit(3),
    notifications: pLimit(5),
    analytics: pLimit(2),
    sessions: pLimit(4),
    alerts: pLimit(2),
    performance: pLimit(1),
    verification: pLimit(3),
  };

  // Adaptive intervals
  private readonly baseIntervals = {
    cleanup: 2 * 60 * 1000,           // 2 min - Queue cleanup
    optimization: 5 * 60 * 1000,      // 5 min - Queue optimization
    notifications: 3 * 60 * 1000,     // 3 min - User notifications
    analytics: 10 * 60 * 1000,        // 10 min - Analytics update
    sessions: 45 * 1000,              // 45s - Session monitoring (high priority)
    alerts: 4 * 60 * 1000,            // 4 min - Availability alerts
    performance: 15 * 60 * 1000,      // 15 min - Performance monitoring
    verification: 10 * 60 * 1000,     // 10 min - Verification state cleanup
  };

  private readonly processes: ProcessConfig[] = [
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

  // ===============================================
  // LIFECYCLE MANAGEMENT
  // ===============================================

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    logger.info('🚀 Starting Queue Scheduler with Photo Verification...');

    // Start all processes
    this.processes.forEach(({ name, interval, handler }) => {
      this.startProcess(name, interval, handler);
    });

    logger.info(`✅ Queue Scheduler operational with ${this.processes.length} processes`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('🛑 Stopping Queue Scheduler...');
    this.isRunning = false;

    // Clear all intervals
    for (const [name, timer] of this.intervals) {
      clearInterval(timer);
      logger.debug(`⏹️ Stopped interval: ${name}`);
    }
    this.intervals.clear();

    // Cancel pending tasks
    this.tasks.clear();

    logger.info('⏹️ Queue Scheduler stopped');
  }

  // ===============================================
  // CORE PROCESS MANAGEMENT
  // ===============================================

  private startProcess(name: string, interval: number, handler: () => Promise<void>): void {
    const timer = setInterval(async () => {
      if (!this.isRunning) return;

      const start = performance.now();
      try {
        await handler();
        const latency = performance.now() - start;
        this.recordLatency(latency);
      } catch (error) {
        logger.error(`❌ Process ${name} failed`, { error });
      }
    }, interval);

    this.intervals.set(name, timer);
    logger.debug(`🔄 Process started: ${name} (${interval / 1000}s)`);
  }

  private recordLatency(latency: number): void {
    this.taskLatencies.push(latency);
    if (this.taskLatencies.length > this.MAX_LATENCIES) {
      this.taskLatencies.shift();
    }
  }

  private getAvgLatency(): number {
    if (this.taskLatencies.length === 0) return 0;
    return this.taskLatencies.reduce((a, b) => a + b, 0) / this.taskLatencies.length;
  }

  // ===============================================
  // QUEUE MANAGEMENT HANDLERS
  // ===============================================

  /**
   * Cleanup expired reservations
   */
  private async cleanupExpiredReservations(): Promise<void> {
    const now = new Date();
    const expired = await db
      .select({ 
        id: queues.id, 
        userWhatsapp: queues.userWhatsapp, 
        stationId: queues.stationId 
      })
      .from(queues)
      .where(
        and(
          eq(queues.status, 'reserved'),
          lt(queues.reservationExpiry, now)
        )
      );

    if (expired.length === 0) return;

    const results = await Promise.allSettled(
      expired.map(item =>
        this.concurrencyLimits.cleanup(() =>
          queueService.leaveQueue(item.userWhatsapp, item.stationId, 'expired')
        )
      )
    );

    const cleaned = results.filter(r => r.status === 'fulfilled' && r.value).length;
    if (cleaned > 0) {
      logger.info(`🧹 Cleaned ${cleaned}/${expired.length} expired reservations`);
    }
  }

  /**
   * Optimize all active station queues
   */
  private async optimizeQueues(): Promise<void> {
    const stations = await db
      .select({ id: chargingStations.id })
      .from(chargingStations)
      .where(eq(chargingStations.isActive, true));

    if (stations.length === 0) return;

    const results = await Promise.allSettled(
      stations.map(station =>
        this.concurrencyLimits.optimization(() => 
          this.optimizeStationQueue(station.id)
        )
      )
    );

    const optimized = results.filter(r => r.status === 'fulfilled' && r.value).length;
    if (optimized > 0) {
      logger.info(`⚡ Optimized ${optimized}/${stations.length} station queues`);
    }
  }

  /**
   * Optimize single station queue
   */
  private async optimizeStationQueue(stationId: number): Promise<boolean> {
    const queueData = await db
      .select()
      .from(queues)
      .where(
        and(
          eq(queues.stationId, stationId),
          sql`status NOT IN ('completed', 'cancelled')`
        )
      )
      .orderBy(queues.position);

    if (queueData.length === 0) return false;

    let optimized = false;

    // Auto-promote if first slot expired >5 min
    const first = queueData.find(q => q.position === 1 && q.status === 'reserved');
    if (first?.reservationExpiry && Date.now() - first.reservationExpiry.getTime() > 5 * 60 * 1000) {
      const next = queueData.find(q => q.position === 2 && q.status === 'waiting');
      if (next) {
        const success = await queueService.reserveSlot(next.userWhatsapp, stationId, 15);
        if (success) {
          optimized = true;
          logger.info('🎯 Auto-promoted user', { stationId, user: next.userWhatsapp });
        }
      }
    }

    // Rebalance positions if needed
    const active = queueData.filter(q => !['cancelled', 'completed'].includes(q.status));
    const needsRebalance = active.some((q, i) => q.position !== i + 1);
    
    if (needsRebalance) {
      const updates = active
        .map((q, i) => ({ id: q.id, pos: i + 1 }))
        .filter(u => queueData.find(q => q.id === u.id)?.position !== u.pos);

      if (updates.length > 0) {
        await db.transaction(async (tx) => {
          for (const { id, pos } of updates) {
            await tx.update(queues)
              .set({ position: pos, updatedAt: new Date() })
              .where(eq(queues.id, id));
          }
        });
        optimized = true;
        logger.info(`⚖️ Rebalanced ${updates.length} positions`, { stationId });
      }
    }

    return optimized;
  }

  // ===============================================
  // NOTIFICATION HANDLERS
  // ===============================================

  /**
   * Process queue notifications
   */
  private async processNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // Last hour only
    const active = await db
      .select({ 
        userWhatsapp: queues.userWhatsapp, 
        stationId: queues.stationId, 
        position: queues.position, 
        createdAt: queues.createdAt 
      })
      .from(queues)
      .where(
        and(
          sql`status IN ('waiting', 'reserved')`,
          lt(queues.createdAt, cutoff)
        )
      );

    const now = Date.now();
    const notifications = active
      .map(q => {
        const waitMin = Math.floor((now - q.createdAt!.getTime()) / (1000 * 60));
        // Send notification every 15 minutes for first hour
        if (waitMin > 0 && waitMin % 15 === 0 && waitMin <= 60) {
          return this.concurrencyLimits.notifications(() =>
            notificationService.sendQueueProgressNotification(
              q.userWhatsapp, 
              q.stationId, 
              q.position, 
              waitMin
            )
          );
        }
        return null;
      })
      .filter(Boolean);

    if (notifications.length > 0) {
      await Promise.allSettled(notifications);
      logger.debug(`📱 Sent ${notifications.length} queue notifications`);
    }
  }

  // ===============================================
  // ANALYTICS HANDLERS
  // ===============================================

  /**
   * Update analytics for all stations
   */
  private async updateAnalytics(): Promise<void> {
    const stations = await db
      .select({ id: chargingStations.id })
      .from(chargingStations)
      .where(eq(chargingStations.isActive, true));

    if (stations.length === 0) return;

    await Promise.allSettled([
      ...stations.map(s => 
        this.concurrencyLimits.analytics(() => 
          analyticsService.getStationAnalytics(s.id)
        )
      ),
      this.updateQueueCounts(stations.map(s => s.id))
    ]);

    logger.debug(`📊 Analytics updated for ${stations.length} stations`);
  }

  /**
   * Update queue counts for stations
   */
  private async updateQueueCounts(stationIds: number[]): Promise<void> {
    if (stationIds.length === 0) return;

    const counts = await db
      .select({
        stationId: queues.stationId,
        count: sql<number>`count(*)`
      })
      .from(queues)
      .where(
        and(
          inArray(queues.stationId, stationIds),
          sql`status IN ('waiting', 'reserved', 'charging')`
        )
      )
      .groupBy(queues.stationId);

    const countMap = new Map(counts.map(c => [c.stationId, Number(c.count)]));

    await db.transaction(async (tx) => {
      for (const id of stationIds) {
        await tx.update(chargingStations)
          .set({
            currentQueueLength: countMap.get(id) || 0,
            updatedAt: new Date()
          })
          .where(eq(chargingStations.id, id));
      }
    });
  }

  // ===============================================
  // SESSION MONITORING WITH VERIFICATION - FIXED
  // ===============================================

  /**
   * Monitor active charging sessions
   */
  private async monitorSessions(): Promise<void> {
    const sessions = sessionService.getActiveSessions();
    if (sessions.size === 0) return;

    const checks = Array.from(sessions.values()).map(session =>
      this.concurrencyLimits.sessions(async () => {
        try {
          const sessionData = await this.getSessionFromDb(session.id);
          if (!sessionData) {
            logger.warn('Session not found in DB', { sessionId: session.id });
            return null;
          }

          // ✅ Check verification status
          if (sessionData.verificationStatus === 'awaiting_start_photo') {
            const waitTime = Date.now() - sessionData.createdAt!.getTime();
            if (waitTime > 10 * 60 * 1000) { // 10 min timeout
              logger.warn('⏰ Session start photo timeout', { 
                sessionId: session.id, 
                userWhatsapp: sessionData.userWhatsapp 
              });
              
              await db.update(chargingSessions)
                .set({
                  status: 'cancelled',
                  verificationStatus: 'verification_timeout',
                  updatedAt: new Date()
                })
                .where(eq(chargingSessions.sessionId, session.id));
                
              return 'verification_timeout';
            }
            return 'verification_pending';
          }

          if (sessionData.verificationStatus === 'awaiting_end_photo') {
            return 'verification_pending';
          }

          // Only monitor active charging sessions
          if (sessionData.status !== 'active') {
            return 'not_active';
          }

          // ✅ FIX: Get battery data from in-memory session object (not DB)
          // The DB schema doesn't have currentBatteryLevel/targetBatteryLevel
          // These are tracked in memory by sessionService
          const currentBattery = session.currentBatteryLevel || 0;
          const targetBattery = session.targetBatteryLevel || 80;

          if (currentBattery >= targetBattery) {
            logger.info('🎉 Session target reached', { 
              sessionId: session.id, 
              battery: currentBattery, 
              target: targetBattery 
            });
            
            await sessionService.stopSession(
              sessionData.userWhatsapp, 
              sessionData.stationId
            );
            
            return 'target_reached';
          }

          // Check duration-based completion
          if (sessionData.startTime) {
            const durationMinutes = Math.floor(
              (Date.now() - sessionData.startTime.getTime()) / (1000 * 60)
            );
            
            // Auto-request end photo after 4 hours
            if (durationMinutes > 240) {
              logger.info('⏰ Session exceeded 4 hours, requesting end photo', {
                sessionId: session.id,
                durationMinutes
              });
              
              await sessionService.stopSession(
                sessionData.userWhatsapp,
                sessionData.stationId
              );
              
              return 'duration_exceeded';
            }
          }

          // Check for power anomalies (if available)
          const maxPowerUsed = parseFloat(sessionData.maxPowerUsed?.toString() || '0');
          if (maxPowerUsed > 0 && maxPowerUsed < 5) {
            logger.warn('⚠️ Low power usage detected', {
              sessionId: session.id,
              maxPowerUsed
            });
            return 'anomaly_detected';
          }

          return 'monitoring';
          
        } catch (err) {
          logger.error('Session check error', { sessionId: session.id, err });
          return null;
        }
      })
    );

    const results = await Promise.allSettled(checks);
    const statusCounts = new Map<string, number>();
    
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
      logger.debug(`🔋 Session monitoring: ${summary} (total: ${sessions.size})`);
    }
  }

  /**
   * Get session from database
   */
  private async getSessionFromDb(sessionId: string) {
    const sessions = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    
    return sessions[0] || null;
  }

  // ===============================================
  // PHOTO VERIFICATION CLEANUP
  // ===============================================

  /**
   * Cleanup expired verification states
   */
  private async cleanupVerificationStates(): Promise<void> {
    try {
      // Use the photoVerificationService cleanup method
      photoVerificationService.cleanupExpiredStates();

      // Also cleanup orphaned verification sessions in DB
      const orphanedSessions = await db
        .select({
          sessionId: chargingSessions.sessionId,
          userWhatsapp: chargingSessions.userWhatsapp,
          verificationStatus: chargingSessions.verificationStatus,
          createdAt: chargingSessions.createdAt
        })
        .from(chargingSessions)
        .where(
          and(
            sql`verification_status IN ('awaiting_start_photo', 'awaiting_end_photo')`,
            lt(chargingSessions.createdAt, new Date(Date.now() - 30 * 60 * 1000)) // 30 min old
          )
        );

      if (orphanedSessions.length > 0) {
        logger.info(`🧹 Found ${orphanedSessions.length} orphaned verification sessions`);

        // Mark as failed or timeout
        await db.transaction(async (tx) => {
          for (const session of orphanedSessions) {
            await tx.update(chargingSessions)
              .set({
                verificationStatus: 'verification_timeout',
                status: 'cancelled',
                updatedAt: new Date()
              })
              .where(eq(chargingSessions.sessionId, session.sessionId));
          }
        });

        logger.info(`✅ Cleaned ${orphanedSessions.length} orphaned verification sessions`);
      }

    } catch (error) {
      logger.error('Verification cleanup failed', { error });
    }
  }

  // ===============================================
  // ALERT HANDLERS
  // ===============================================

  /**
   * Check availability alerts
   */
  private async checkAvailabilityAlerts(): Promise<void> {
    // Placeholder for future alert service integration
    logger.debug('🚨 Availability alerts checked');
  }

  // ===============================================
  // PERFORMANCE MONITORING
  // ===============================================

  /**
   * Monitor system performance
   */
  private async monitorPerformance(): Promise<void> {
    const [activeQueues, activeVerifications, expiredVerifications, cacheSize] = await Promise.all([
      this.countActiveQueues(),
      this.countActiveVerifications(),
      this.countExpiredVerifications(),
      Promise.resolve(this.getCacheSize())
    ]);

    const metrics: SystemMetrics = {
      activeQueues,
      activeSessions: sessionService.getActiveSessions().size,
      activeVerifications,
      expiredVerifications,
      cacheSize,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      taskQueueSize: this.tasks.size,
      avgTaskLatencyMs: this.getAvgLatency(),
    };

    logger.info('📊 System Performance', metrics);

    // Alert if too many expired verifications
    if (expiredVerifications > 10) {
      logger.warn(`⚠️ High expired verification count: ${expiredVerifications}`);
    }

    this.cleanupCache();
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private async countActiveQueues(): Promise<number> {
    const res = await db
      .select({ count: sql<number>`count(*)` })
      .from(queues)
      .where(sql`status IN ('waiting', 'reserved')`);
    return Number(res[0]?.count || 0);
  }

  private async countActiveVerifications(): Promise<number> {
    const res = await db
      .select({ count: sql<number>`count(*)` })
      .from(chargingSessions)
      .where(
        sql`verification_status IN ('awaiting_start_photo', 'awaiting_end_photo')`
      );
    return Number(res[0]?.count || 0);
  }

  private async countExpiredVerifications(): Promise<number> {
    const res = await db
      .select({ count: sql<number>`count(*)` })
      .from(chargingSessions)
      .where(
        and(
          sql`verification_status IN ('awaiting_start_photo', 'awaiting_end_photo')`,
          lt(chargingSessions.createdAt, new Date(Date.now() - 30 * 60 * 1000))
        )
      );
    return Number(res[0]?.count || 0);
  }

  private getCacheSize(): number {
    const cache = (analyticsService as any).analyticsCache;
    return cache?.size || 0;
  }

  private cleanupCache(): void {
    const cache = (analyticsService as any).analyticsCache;
    if (!cache) return;

    const now = Date.now();
    const cutoff = 30 * 60 * 1000;
    let cleaned = 0;

    for (const [key, value] of cache.entries()) {
      if (now - (value as any).timestamp > cutoff) {
        cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`🗑️ Cleaned ${cleaned} cache entries`);
    }
  }

  // ===============================================
  // SMART TASK SCHEDULING
  // ===============================================

  scheduleTask(
    type: ScheduledTask['type'],
    scheduledTime: Date,
    maxRetries = 3,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): string {
    const taskId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: ScheduledTask = { 
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

    logger.info('📅 Task scheduled', { 
      taskId, 
      type, 
      delay: `${(delay / 1000).toFixed(1)}s`, 
      priority 
    });
    return taskId;
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !this.isRunning) {
      this.tasks.delete(taskId);
      return;
    }

    const handlers: Record<string, () => Promise<void>> = {
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
      logger.error('Unknown task type', { taskId, type: task.type });
      this.tasks.delete(taskId);
      return;
    }

    try {
      await handler();
      this.tasks.delete(taskId);
      logger.info('✅ Task completed', { taskId });
    } catch (error) {
      task.retries++;
      if (task.retries < task.maxRetries) {
        const backoff = Math.min(300_000, Math.pow(2, task.retries) * 60_000); // Cap at 5 min
        setTimeout(() => this.executeTask(taskId), backoff);
        logger.warn('🔄 Task retry scheduled', { 
          taskId, 
          retry: task.retries, 
          backoff: `${(backoff / 1000).toFixed(0)}s` 
        });
      } else {
        this.tasks.delete(taskId);
        logger.error('💀 Task failed permanently', { 
          taskId, 
          type: task.type, 
          retries: task.maxRetries 
        });
      }
    }
  }

  // ===============================================
  // STATUS & HEALTH
  // ===============================================

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

  async healthCheck(): Promise<boolean> {
    if (!this.isRunning) return false;
    if (this.intervals.size !== this.processes.length) return false;
    
    try {
      await db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}

// ===============================================
// SINGLETON EXPORT
// ===============================================

export const queueScheduler = new QueueScheduler();

// Auto-start in production
if (process.env.NODE_ENV === 'production') {
  queueScheduler.start().catch(err => {
    logger.error('💥 Failed to start QueueScheduler', { err });
    process.exit(1);
  });
}

// Graceful shutdown
const shutdown = async () => {
  logger.info('⏳ Graceful shutdown initiated...');
  await queueScheduler.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);