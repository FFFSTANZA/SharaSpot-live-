"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueService = void 0;
const connection_1 = require("../db/connection");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const notification_1 = require("../services/notification");
class QueueService {
    async joinQueue(userWhatsapp, stationId) {
        try {
            logger_1.logger.info('Attempting to join queue - constraint-safe version', { userWhatsapp, stationId });
            const existingEntry = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT id, status, position
        FROM queues 
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId}
        ORDER BY created_at DESC
        LIMIT 1
      `);
            const stationResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT id, name, address, is_active, is_open, max_queue_length, average_session_minutes
        FROM charging_stations 
        WHERE id = ${stationId}
        LIMIT 1
      `);
            if (!stationResult.rows.length) {
                logger_1.logger.warn('Station not found', { stationId });
                return null;
            }
            const station = stationResult.rows[0];
            if (!station.is_active || !station.is_open) {
                logger_1.logger.warn('Station not available', {
                    stationId,
                    isActive: station.is_active,
                    isOpen: station.is_open
                });
                return null;
            }
            const queueCountResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT COUNT(*) as count 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status IN ('waiting', 'reserved')
      `);
            const currentQueueCount = Number(queueCountResult.rows[0].count);
            const maxQueueLength = station.max_queue_length || 5;
            if (currentQueueCount >= maxQueueLength) {
                logger_1.logger.warn('Queue is full', {
                    stationId,
                    currentQueueCount,
                    maxLength: maxQueueLength
                });
                return null;
            }
            const positionResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT COALESCE(MAX(position), 0) + 1 as next_position
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status IN ('waiting', 'reserved', 'charging')
      `);
            const nextPosition = Number(positionResult.rows[0].next_position);
            const estimatedWaitTime = this.calculateWaitTime(nextPosition, station.average_session_minutes || 45);
            let queueEntry;
            if (existingEntry.rows.length > 0) {
                const existing = existingEntry.rows[0];
                const updateResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
          UPDATE queues 
          SET 
            position = ${nextPosition},
            status = 'waiting',
            estimated_wait_minutes = ${estimatedWaitTime},
            updated_at = NOW(),
            joined_at = NOW()
          WHERE id = ${existing.id}
          RETURNING id, station_id, user_whatsapp, position, status, estimated_wait_minutes, created_at
        `);
                if (updateResult.rows.length > 0) {
                    queueEntry = updateResult.rows[0];
                    logger_1.logger.info('Updated existing queue entry successfully', {
                        queueId: queueEntry.id,
                        userWhatsapp,
                        stationId,
                        position: nextPosition
                    });
                }
            }
            else {
                const insertResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
          INSERT INTO queues (station_id, user_whatsapp, position, status, estimated_wait_minutes, joined_at)
          VALUES (${stationId}, ${userWhatsapp}, ${nextPosition}, 'waiting', ${estimatedWaitTime}, NOW())
          RETURNING id, station_id, user_whatsapp, position, status, estimated_wait_minutes, created_at
        `);
                if (insertResult.rows.length > 0) {
                    queueEntry = insertResult.rows[0];
                    logger_1.logger.info('Inserted new queue entry successfully', {
                        queueId: queueEntry.id,
                        userWhatsapp,
                        stationId,
                        position: nextPosition
                    });
                }
            }
            if (!queueEntry) {
                logger_1.logger.error('Failed to create or update queue entry');
                return null;
            }
            await this.updateStationQueueCount(stationId);
            const queuePosition = {
                id: queueEntry.id,
                userWhatsapp: queueEntry.user_whatsapp,
                stationId: queueEntry.station_id,
                position: queueEntry.position,
                estimatedWaitMinutes: queueEntry.estimated_wait_minutes,
                status: queueEntry.status,
                isReserved: queueEntry.status === 'reserved',
                reservationExpiry: queueEntry.reservation_expiry || undefined,
                createdAt: queueEntry.created_at,
                stationName: station.name,
                stationAddress: station.address
            };
            this.sendNotifications(userWhatsapp, queuePosition, stationId, nextPosition);
            return queuePosition;
        }
        catch (error) {
            logger_1.logger.error('Failed to join queue', {
                userWhatsapp,
                stationId,
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : error
            });
            return null;
        }
    }
    async leaveQueue(userWhatsapp, stationId, reason = 'user_cancelled') {
        try {
            const status = reason === 'completed' ? 'completed' : 'cancelled';
            const queueResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT id, position 
        FROM queues 
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND status NOT IN ('completed', 'cancelled')
        LIMIT 1
      `);
            if (!queueResult.rows.length) {
                logger_1.logger.warn('No active queue entry found to cancel', { userWhatsapp, stationId });
                return false;
            }
            const queueEntry = queueResult.rows[0];
            await connection_1.db.execute((0, drizzle_orm_1.sql) `
        UPDATE queues 
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${queueEntry.id}
      `);
            await this.reorderQueue(stationId, queueEntry.position);
            await this.updateStationQueueCount(stationId);
            await this.notifyQueueProgress(stationId);
            logger_1.logger.info('User left queue', {
                userWhatsapp,
                stationId,
                reason,
                oldPosition: queueEntry.position
            });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to leave queue', { userWhatsapp, stationId, reason, error });
            return false;
        }
    }
    async forceJoinQueue(userWhatsapp, stationId) {
        try {
            logger_1.logger.info('Force joining queue - emergency method', { userWhatsapp, stationId });
            await connection_1.db.execute((0, drizzle_orm_1.sql) `
        UPDATE queues 
        SET status = 'cancelled', updated_at = NOW()
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId}
        AND status NOT IN ('completed', 'cancelled')
      `);
            await new Promise(resolve => setTimeout(resolve, 100));
            return await this.joinQueue(userWhatsapp, stationId);
        }
        catch (error) {
            logger_1.logger.error('Force join queue failed', { userWhatsapp, stationId, error });
            return null;
        }
    }
    async getUserQueueStatus(userWhatsapp) {
        try {
            const result = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT 
          q.id,
          q.user_whatsapp,
          q.station_id,
          q.position,
          q.estimated_wait_minutes,
          q.status,
          q.reservation_expiry,
          q.created_at,
          s.name as station_name,
          s.address as station_address
        FROM queues q
        LEFT JOIN charging_stations s ON q.station_id = s.id
        WHERE q.user_whatsapp = ${userWhatsapp}
        AND q.status NOT IN ('completed', 'cancelled')
        ORDER BY q.created_at DESC
      `);
            return result.rows.map((row) => ({
                id: row.id,
                userWhatsapp: row.user_whatsapp,
                stationId: row.station_id,
                position: row.position,
                estimatedWaitMinutes: row.estimated_wait_minutes,
                status: row.status,
                isReserved: row.status === 'reserved',
                reservationExpiry: row.reservation_expiry || undefined,
                createdAt: row.created_at,
                stationName: row.station_name,
                stationAddress: row.station_address,
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get user queue status', { userWhatsapp, error });
            return [];
        }
    }
    async reserveSlot(userWhatsapp, stationId, reservationMinutes = 15) {
        try {
            const queueResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT id 
        FROM queues 
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND position = 1 
        AND status = 'waiting'
        LIMIT 1
      `);
            if (!queueResult.rows.length) {
                logger_1.logger.warn('User not eligible for reservation', { userWhatsapp, stationId });
                return false;
            }
            const queueEntry = queueResult.rows[0];
            const expiryTime = new Date(Date.now() + (reservationMinutes * 60 * 1000));
            const columnExists = await this.checkColumnExists('queues', 'reservation_expiry');
            if (columnExists) {
                await connection_1.db.execute((0, drizzle_orm_1.sql) `
          UPDATE queues 
          SET status = 'reserved', reservation_expiry = ${expiryTime}, updated_at = NOW()
          WHERE id = ${queueEntry.id}
        `);
            }
            else {
                await connection_1.db.execute((0, drizzle_orm_1.sql) `
          UPDATE queues 
          SET status = 'reserved', updated_at = NOW()
          WHERE id = ${queueEntry.id}
        `);
            }
            logger_1.logger.info('Slot reserved successfully', { userWhatsapp, stationId, expiryTime });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to reserve slot', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async startCharging(userWhatsapp, stationId) {
        try {
            const result = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        UPDATE queues 
        SET status = 'charging', updated_at = NOW()
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND status = 'reserved'
        RETURNING id
      `);
            if (!result.rows.length) {
                logger_1.logger.warn('No valid reservation found to start charging', { userWhatsapp, stationId });
                return false;
            }
            await this.promoteNextInQueue(stationId);
            logger_1.logger.info('Charging session started', { userWhatsapp, stationId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to start charging', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async completeCharging(userWhatsapp, stationId) {
        try {
            const result = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        UPDATE queues 
        SET status = 'completed', updated_at = NOW()
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND status = 'charging'
        RETURNING id
      `);
            if (!result.rows.length) {
                logger_1.logger.warn('No active charging session found', { userWhatsapp, stationId });
                return false;
            }
            await Promise.all([
                this.updateStationQueueCount(stationId),
                this.promoteNextInQueue(stationId)
            ]);
            logger_1.logger.info('Charging session completed', { userWhatsapp, stationId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to complete charging', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async checkColumnExists(tableName, columnName) {
        try {
            const result = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = ${tableName} 
        AND column_name = ${columnName} 
        AND table_schema = 'public'
      `);
            return result.rows.length > 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to check column existence', { tableName, columnName, error });
            return false;
        }
    }
    async getQueueLength(stationId) {
        try {
            const result = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT COUNT(*) as count 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status IN ('waiting', 'reserved')
      `);
            return Number(result.rows[0].count || 0);
        }
        catch (error) {
            logger_1.logger.error('Failed to get queue length', { stationId, error });
            return 0;
        }
    }
    calculateWaitTime(position, avgSessionMinutes) {
        if (position === 1)
            return 5;
        return ((position - 1) * avgSessionMinutes) + 5;
    }
    async reorderQueue(stationId, removedPosition) {
        try {
            await connection_1.db.execute((0, drizzle_orm_1.sql) `
        UPDATE queues 
        SET position = position - 1, updated_at = NOW()
        WHERE station_id = ${stationId} 
        AND position > ${removedPosition} 
        AND status IN ('waiting', 'reserved')
      `);
            logger_1.logger.debug('Queue reordered successfully', { stationId, removedPosition });
        }
        catch (error) {
            logger_1.logger.error('Failed to reorder queue', { stationId, removedPosition, error });
        }
    }
    async updateStationQueueCount(stationId) {
        try {
            const queueLength = await this.getQueueLength(stationId);
            await connection_1.db.execute((0, drizzle_orm_1.sql) `
        UPDATE charging_stations 
        SET current_queue_length = ${queueLength}, updated_at = NOW()
        WHERE id = ${stationId}
      `);
            logger_1.logger.debug('Station queue count updated', { stationId, queueLength });
        }
        catch (error) {
            logger_1.logger.error('Failed to update station queue count', { stationId, error });
        }
    }
    async promoteNextInQueue(stationId) {
        try {
            const nextResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT user_whatsapp 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND position = 2 
        AND status = 'waiting'
        LIMIT 1
      `);
            if (nextResult.rows.length > 0) {
                const nextInQueue = nextResult.rows[0];
                await this.reserveSlot(nextInQueue.user_whatsapp, stationId, 15);
                await this.reorderQueue(stationId, 1);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to promote next in queue', { stationId, error });
        }
    }
    async notifyQueueProgress(stationId) {
        try {
            const waitingResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT id, user_whatsapp, position 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status = 'waiting'
        ORDER BY position
      `);
            for (const user of waitingResult.rows) {
                const userQueue = user;
                const newWaitTime = this.calculateWaitTime(userQueue.position, 45);
                await connection_1.db.execute((0, drizzle_orm_1.sql) `
          UPDATE queues 
          SET estimated_wait_minutes = ${newWaitTime}, updated_at = NOW()
          WHERE id = ${userQueue.id}
        `);
                this.sendProgressNotification(userQueue.user_whatsapp, stationId, userQueue.position, newWaitTime);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to notify queue progress', { stationId, error });
        }
    }
    async getQueueStats(stationId) {
        try {
            const queueLength = await this.getQueueLength(stationId);
            const avgWaitResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
      SELECT AVG(estimated_wait_minutes) as avg_wait
      FROM queues 
      WHERE station_id = ${stationId} 
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '7 days'
    `);
            const avgWaitTime = Number(avgWaitResult.rows[0]?.avg_wait || 45);
            const peakHoursResult = await connection_1.db.execute((0, drizzle_orm_1.sql) `
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as count
      FROM queues 
      WHERE station_id = ${stationId}
      AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY count DESC
      LIMIT 3
    `);
            const peakHours = peakHoursResult.rows.map((row) => `${row.hour}:00-${Number(row.hour) + 1}:00`);
            return {
                totalInQueue: queueLength,
                averageWaitTime: avgWaitTime,
                peakHours: peakHours
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get queue stats', { stationId, error });
            return {
                totalInQueue: 0,
                averageWaitTime: 0,
                peakHours: []
            };
        }
    }
    sendNotifications(userWhatsapp, queuePosition, stationId, position) {
        setImmediate(async () => {
            try {
                await notification_1.notificationService.sendQueueJoinedNotification(userWhatsapp, queuePosition);
                await notification_1.notificationService.notifyStationOwner(stationId, 'queue_joined', {
                    userWhatsapp,
                    position
                });
            }
            catch (error) {
                logger_1.logger.warn('Failed to send join queue notifications', {
                    userWhatsapp,
                    stationId,
                    error
                });
            }
        });
    }
    sendProgressNotification(userWhatsapp, stationId, position, waitTime) {
        setImmediate(async () => {
            try {
                await notification_1.notificationService.sendQueueProgressNotification(userWhatsapp, stationId, position, waitTime);
            }
            catch (error) {
                logger_1.logger.warn('Failed to send progress notification', {
                    userWhatsapp,
                    stationId,
                    error
                });
            }
        });
    }
}
exports.queueService = new QueueService();
//# sourceMappingURL=queue.js.map