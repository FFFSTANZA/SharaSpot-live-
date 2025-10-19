// src/services/queueScheduler.ts
import { db } from '../config/database';
import { queues } from '../db/schema';
import { eq, lt, inArray, and } from 'drizzle-orm';
import { logger } from '../utils/logger';

/**
 * QueueScheduler handles periodic cleanup and notification logic
 * without using transactions (neon-http safe).
 */
export class QueueScheduler {

  /**
   * 🧹 Cleanup expired reservations safely
   */
  static async cleanupExpiredReservations() {
    try {
      logger.info('🧹 Starting cleanup process...');

      const columnExists = await this.checkColumnExists('queues', 'reservation_expiry');
      if (!columnExists) {
        logger.warn('⚠️ reservation_expiry column does not exist, skipping cleanup');
        return;
      }

      const expiredReservations = await db
        .select()
        .from(queues)
        .where(
          and(
            eq(queues.status, 'reserved'),
            lt(queues.reservationExpiry, new Date())
          )
        );

      if (!expiredReservations || expiredReservations.length === 0) {
        logger.info('✅ No expired reservations to cleanup');
        return;
      }

      await db
        .update(queues)
        .set({
          status: 'waiting',
          reservationExpiry: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(queues.status, 'reserved'),
            lt(queues.reservationExpiry, new Date())
          )
        );

      logger.info('✅ Cleanup completed successfully', {
        cleanedCount: expiredReservations.length,
      });
    } catch (error) {
      logger.error('❌ Cleanup process failed', { error });
    }
  }

  /**
   * 📢 Process queue notifications safely
   */
  static async processQueueNotifications() {
    try {
      logger.info('📢 Processing queue notifications...');

      const reminderColumnExists = await this.checkColumnExists('queues', 'reminder_sent');
      if (!reminderColumnExists) {
        logger.warn('⚠️ reminder_sent column does not exist, skipping notifications');
        return;
      }

      const pendingQueues = await db
        .select()
        .from(queues)
        .where(inArray(queues.status, ['waiting', 'reserved']))
        .orderBy(queues.createdAt);

      if (!pendingQueues.length) {
        logger.info('✅ No pending queues for notifications');
        return;
      }

      logger.info('📊 Found queues for notification processing', {
        count: pendingQueues.length,
      });

      for (const queue of pendingQueues) {
        await this.processQueueItemNotification(queue);
      }
    } catch (error) {
      logger.error('❌ Notifications process failed', { error });
    }
  }

  /**
   * 🔍 Check if a column exists in the given table
   */
  static async checkColumnExists(tableName: string, columnName: string): Promise<boolean> {
    try {
      const result = await db.execute(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_name = '${tableName}' 
         AND column_name = '${columnName}' 
         AND table_schema = 'public'`
      );

      // Works for both Neon and PostgreSQL
      return result?.rows?.length > 0;
    } catch (error) {
      logger.error('❌ Failed to check column existence', { tableName, columnName, error });
      return false;
    }
  }

  /**
   * 📬 Handle notification logic for each queue
   */
  static async processQueueItemNotification(queue: any) {
    try {
      logger.debug('Processing notification for queue item', {
        queueId: queue.id,
        userWhatsapp: queue.userWhatsapp,
        status: queue.status,
      });

      if (queue.position <= 3 && !queue.reminderSent) {
        await this.sendPositionNotification(queue);
      }
    } catch (error) {
      logger.error('❌ Failed to process queue notification', {
        queueId: queue.id,
        error,
      });
    }
  }

  /**
   * 💬 Send position-based notification to WhatsApp user
   */
  static async sendPositionNotification(queue: any) {
    try {
      logger.info('📤 Sending position notification', {
        userWhatsapp: queue.userWhatsapp,
        position: queue.position,
      });

      // ✅ TODO: Integrate your WhatsApp send logic here
      // await whatsappService.sendTextMessage(queue.userWhatsapp, message);

      const reminderColumnExists = await this.checkColumnExists('queues', 'reminder_sent');
      if (reminderColumnExists) {
        await db
          .update(queues)
          .set({
            reminderSent: true,
            updatedAt: new Date(),
          })
          .where(eq(queues.id, queue.id));
      }
    } catch (error) {
      logger.error('❌ Failed to send position notification', {
        queueId: queue.id,
        error,
      });
    }
  }

  /**
   * 🕒 Run the scheduler safely on intervals
   */
  static async runScheduler() {
    logger.info('🚀 Starting queue scheduler...');

    const runCleanup = async () => {
      try {
        await this.cleanupExpiredReservations();
      } catch (error) {
        logger.error('❌ Scheduler cleanup failed', { error });
      }
    };

    const runNotifications = async () => {
      try {
        await this.processQueueNotifications();
      } catch (error) {
        logger.error('❌ Scheduler notifications failed', { error });
      }
    };

    // Run cleanup every 60 seconds
    setInterval(runCleanup, 60 * 1000);

    // Run notifications every 120 seconds
    setInterval(runNotifications, 120 * 1000);

    logger.info('✅ Queue scheduler started successfully');
  }
}
