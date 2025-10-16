// src/services/queueScheduler.ts - Fix queue scheduler queries
import { db } from '../config/database';
import { queues } from '../db/schema';
import { eq, lt, inArray, and } from 'drizzle-orm';
import { logger } from '../utils/logger';

export class QueueScheduler {
  
  /**
   * Fixed cleanup process - handle missing columns gracefully
   */
  static async cleanupExpiredReservations() {
    try {
      logger.info('🧹 Starting cleanup process...');

      // First check if reservation_expiry column exists
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

      if (expiredReservations.length === 0) {
        logger.info('✅ No expired reservations to cleanup');
        return;
      }

      // Update expired reservations back to waiting
      await db
        .update(queues)
        .set({ 
          status: 'waiting',
          reservationExpiry: null,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(queues.status, 'reserved'),
            lt(queues.reservationExpiry, new Date())
          )
        );

      logger.info('✅ Cleanup completed', { 
        cleanedCount: expiredReservations.length 
      });

    } catch (error) {
      logger.error('❌ Cleanup process failed', { error });
      // Don't throw - let the scheduler continue
    }
  }

  /**
   * Fixed notifications process
   */
  static async processQueueNotifications() {
    try {
      logger.info('📢 Processing queue notifications...');

      // Check if required columns exist
      const reminderColumnExists = await this.checkColumnExists('queues', 'reminder_sent');
      
      if (!reminderColumnExists) {
        logger.warn('⚠️ reminder_sent column does not exist, skipping notifications');
        return;
      }

      // Get queues that need notifications
      const pendingQueues = await db
        .select()
        .from(queues)
        .where(inArray(queues.status, ['waiting', 'reserved']))
        .orderBy(queues.createdAt);

      logger.info('📊 Found queues for notification processing', { 
        count: pendingQueues.length 
      });

      // Process each queue for notifications
      for (const queue of pendingQueues) {
        await this.processQueueItemNotification(queue);
      }

    } catch (error) {
      logger.error('❌ Notifications process failed', { error });
    }
  }

  /**
   * Helper to check if column exists in table
   */
  static async checkColumnExists(tableName: string, columnName: string): Promise<boolean> {
    try {
      const result = await db.execute(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = '${tableName}' 
        AND column_name = '${columnName}' 
        AND table_schema = 'public'
      `);

      return result.rows.length > 0;
    } catch (error) {
      logger.error('❌ Failed to check column existence', { tableName, columnName, error });
      return false;
    }
  }

  /**
   * Process individual queue item notification
   */
  static async processQueueItemNotification(queue: any) {
    try {
      // Your notification logic here
      logger.debug('Processing notification for queue item', { 
        queueId: queue.id,
        userWhatsapp: queue.userWhatsapp,
        status: queue.status
      });

      // Example: Send notification based on queue position
      if (queue.position <= 3 && !queue.reminderSent) {
        // Send "your turn is coming" notification
        await this.sendPositionNotification(queue);
      }

    } catch (error) {
      logger.error('❌ Failed to process queue notification', { 
        queueId: queue.id, 
        error 
      });
    }
  }

  /**
   * Send position notification to user
   */
  static async sendPositionNotification(queue: any) {
    try {
      // Implement your WhatsApp notification logic here
      logger.info('📤 Sending position notification', { 
        userWhatsapp: queue.userWhatsapp,
        position: queue.position 
      });

      // Mark reminder as sent (only if column exists)
      const reminderColumnExists = await this.checkColumnExists('queues', 'reminder_sent');
      
      if (reminderColumnExists) {
        await db
          .update(queues)
          .set({ 
            reminderSent: true,
            updatedAt: new Date() 
          })
          .where(eq(queues.id, queue.id));
      }

    } catch (error) {
      logger.error('❌ Failed to send position notification', { 
        queueId: queue.id, 
        error 
      });
    }
  }

  /**
   * Safe scheduler runner that handles errors gracefully
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