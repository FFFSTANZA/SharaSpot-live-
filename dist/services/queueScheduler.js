"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueScheduler = void 0;
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
class QueueScheduler {
    static async cleanupExpiredReservations() {
        try {
            logger_1.logger.info('🧹 Starting cleanup process...');
            const columnExists = await this.checkColumnExists('queues', 'reservation_expiry');
            if (!columnExists) {
                logger_1.logger.warn('⚠️ reservation_expiry column does not exist, skipping cleanup');
                return;
            }
            const expiredReservations = await database_1.db
                .select()
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.status, 'reserved'), (0, drizzle_orm_1.lt)(schema_1.queues.reservationExpiry, new Date())));
            if (expiredReservations.length === 0) {
                logger_1.logger.info('✅ No expired reservations to cleanup');
                return;
            }
            await database_1.db
                .update(schema_1.queues)
                .set({
                status: 'waiting',
                reservationExpiry: null,
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.status, 'reserved'), (0, drizzle_orm_1.lt)(schema_1.queues.reservationExpiry, new Date())));
            logger_1.logger.info('✅ Cleanup completed', {
                cleanedCount: expiredReservations.length
            });
        }
        catch (error) {
            logger_1.logger.error('❌ Cleanup process failed', { error });
        }
    }
    static async processQueueNotifications() {
        try {
            logger_1.logger.info('📢 Processing queue notifications...');
            const reminderColumnExists = await this.checkColumnExists('queues', 'reminder_sent');
            if (!reminderColumnExists) {
                logger_1.logger.warn('⚠️ reminder_sent column does not exist, skipping notifications');
                return;
            }
            const pendingQueues = await database_1.db
                .select()
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.inArray)(schema_1.queues.status, ['waiting', 'reserved']))
                .orderBy(schema_1.queues.createdAt);
            logger_1.logger.info('📊 Found queues for notification processing', {
                count: pendingQueues.length
            });
            for (const queue of pendingQueues) {
                await this.processQueueItemNotification(queue);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Notifications process failed', { error });
        }
    }
    static async checkColumnExists(tableName, columnName) {
        try {
            const result = await database_1.db.execute(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = '${tableName}' 
        AND column_name = '${columnName}' 
        AND table_schema = 'public'
      `);
            return result.rows.length > 0;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to check column existence', { tableName, columnName, error });
            return false;
        }
    }
    static async processQueueItemNotification(queue) {
        try {
            logger_1.logger.debug('Processing notification for queue item', {
                queueId: queue.id,
                userWhatsapp: queue.userWhatsapp,
                status: queue.status
            });
            if (queue.position <= 3 && !queue.reminderSent) {
                await this.sendPositionNotification(queue);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to process queue notification', {
                queueId: queue.id,
                error
            });
        }
    }
    static async sendPositionNotification(queue) {
        try {
            logger_1.logger.info('📤 Sending position notification', {
                userWhatsapp: queue.userWhatsapp,
                position: queue.position
            });
            const reminderColumnExists = await this.checkColumnExists('queues', 'reminder_sent');
            if (reminderColumnExists) {
                await database_1.db
                    .update(schema_1.queues)
                    .set({
                    reminderSent: true,
                    updatedAt: new Date()
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.queues.id, queue.id));
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send position notification', {
                queueId: queue.id,
                error
            });
        }
    }
    static async runScheduler() {
        logger_1.logger.info('🚀 Starting queue scheduler...');
        const runCleanup = async () => {
            try {
                await this.cleanupExpiredReservations();
            }
            catch (error) {
                logger_1.logger.error('❌ Scheduler cleanup failed', { error });
            }
        };
        const runNotifications = async () => {
            try {
                await this.processQueueNotifications();
            }
            catch (error) {
                logger_1.logger.error('❌ Scheduler notifications failed', { error });
            }
        };
        setInterval(runCleanup, 60 * 1000);
        setInterval(runNotifications, 120 * 1000);
        logger_1.logger.info('✅ Queue scheduler started successfully');
    }
}
exports.QueueScheduler = QueueScheduler;
//# sourceMappingURL=queueScheduler.js.map