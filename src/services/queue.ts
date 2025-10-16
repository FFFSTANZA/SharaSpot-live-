// src/services/queue.ts - FINAL CONSTRAINT-SAFE VERSION
import { db } from '../db/connection';
import { sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { notificationService } from '../services/notification';

export interface QueuePosition {
  id: number;
  userWhatsapp: string;
  stationId: number;
  position: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'reserved' | 'charging' | 'completed' | 'cancelled';
  isReserved: boolean;
  reservationExpiry?: Date;
  createdAt: Date;
  stationName?: string;
  stationAddress?: string;
}

export interface QueueStats {
  totalInQueue: number;
  averageWaitTime: number;
  peakHours: string[];
  userPosition?: number;
  estimatedTime?: number;
}

class QueueService {
  /**
   * FINAL FIX - Handles unique constraint properly by using UPDATE instead of INSERT
   */
  async joinQueue(userWhatsapp: string, stationId: number): Promise<QueuePosition | null> {
    try {
      logger.info('Attempting to join queue - constraint-safe version', { userWhatsapp, stationId });

      // Step 1: Check if an entry already exists (even if completed/cancelled)
      const existingEntry = await db.execute(sql`
        SELECT id, status, position
        FROM queues 
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId}
        ORDER BY created_at DESC
        LIMIT 1
      `);

      // Step 2: Get station details first
      const stationResult = await db.execute(sql`
        SELECT id, name, address, is_active, is_open, max_queue_length, average_session_minutes
        FROM charging_stations 
        WHERE id = ${stationId}
        LIMIT 1
      `);

      if (!stationResult.rows.length) {
        logger.warn('Station not found', { stationId });
        return null;
      }

      const station = stationResult.rows[0] as any;
      
      if (!station.is_active || !station.is_open) {
        logger.warn('Station not available', { 
          stationId, 
          isActive: station.is_active, 
          isOpen: station.is_open 
        });
        return null;
      }

      // Step 3: Check current queue length
      const queueCountResult = await db.execute(sql`
        SELECT COUNT(*) as count 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status IN ('waiting', 'reserved')
      `);

      const currentQueueCount = Number((queueCountResult.rows[0] as any).count);
      const maxQueueLength = station.max_queue_length || 5;
      
      if (currentQueueCount >= maxQueueLength) {
        logger.warn('Queue is full', { 
          stationId, 
          currentQueueCount, 
          maxLength: maxQueueLength 
        });
        return null;
      }

      // Step 4: Get next position
      const positionResult = await db.execute(sql`
        SELECT COALESCE(MAX(position), 0) + 1 as next_position
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status IN ('waiting', 'reserved', 'charging')
      `);

      const nextPosition = Number((positionResult.rows[0] as any).next_position);
      const estimatedWaitTime = this.calculateWaitTime(nextPosition, station.average_session_minutes || 45);

      let queueEntry: any;

      // Step 5: CONSTRAINT-SAFE APPROACH - Update existing or insert new
      if (existingEntry.rows.length > 0) {
        const existing = existingEntry.rows[0] as any;
        
        // Update existing entry instead of creating new one (avoids constraint violation)
        const updateResult = await db.execute(sql`
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
          logger.info('Updated existing queue entry successfully', { 
            queueId: queueEntry.id,
            userWhatsapp, 
            stationId,
            position: nextPosition
          });
        }
      } else {
        // No existing entry - safe to insert new
        const insertResult = await db.execute(sql`
          INSERT INTO queues (station_id, user_whatsapp, position, status, estimated_wait_minutes, joined_at)
          VALUES (${stationId}, ${userWhatsapp}, ${nextPosition}, 'waiting', ${estimatedWaitTime}, NOW())
          RETURNING id, station_id, user_whatsapp, position, status, estimated_wait_minutes, created_at
        `);

        if (insertResult.rows.length > 0) {
          queueEntry = insertResult.rows[0];
          logger.info('Inserted new queue entry successfully', { 
            queueId: queueEntry.id,
            userWhatsapp, 
            stationId,
            position: nextPosition
          });
        }
      }

      if (!queueEntry) {
        logger.error('Failed to create or update queue entry');
        return null;
      }

      // Step 6: Update station queue count
      await this.updateStationQueueCount(stationId);

      // Step 7: Format response
      const queuePosition: QueuePosition = {
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

      // Step 8: Send notifications (non-blocking)
      this.sendNotifications(userWhatsapp, queuePosition, stationId, nextPosition);

      return queuePosition;

    } catch (error) {
      logger.error('Failed to join queue', { 
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

  /**
   * Remove user from queue - Status update approach
   */
  async leaveQueue(userWhatsapp: string, stationId: number, reason: 'user_cancelled' | 'expired' | 'completed' = 'user_cancelled'): Promise<boolean> {
    try {
      const status = reason === 'completed' ? 'completed' : 'cancelled';
      
      // Get the queue entry before updating it
      const queueResult = await db.execute(sql`
        SELECT id, position 
        FROM queues 
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND status NOT IN ('completed', 'cancelled')
        LIMIT 1
      `);

      if (!queueResult.rows.length) {
        logger.warn('No active queue entry found to cancel', { userWhatsapp, stationId });
        return false;
      }

      const queueEntry = queueResult.rows[0] as any;

      // Update status instead of deleting (preserves history, avoids constraint issues)
      await db.execute(sql`
        UPDATE queues 
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${queueEntry.id}
      `);

      // Reorder remaining queue
      await this.reorderQueue(stationId, queueEntry.position);

      // Update station queue count
      await this.updateStationQueueCount(stationId);

      // Notify queue progress
      await this.notifyQueueProgress(stationId);

      logger.info('User left queue', { 
        userWhatsapp, 
        stationId, 
        reason, 
        oldPosition: queueEntry.position 
      });

      return true;

    } catch (error) {
      logger.error('Failed to leave queue', { userWhatsapp, stationId, reason, error });
      return false;
    }
  }

  /**
   * Force join queue - Emergency method that bypasses all constraints
   */
  async forceJoinQueue(userWhatsapp: string, stationId: number): Promise<QueuePosition | null> {
    try {
      logger.info('Force joining queue - emergency method', { userWhatsapp, stationId });

      // First, force update any existing entries to cancelled
      await db.execute(sql`
        UPDATE queues 
        SET status = 'cancelled', updated_at = NOW()
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId}
        AND status NOT IN ('completed', 'cancelled')
      `);

      // Wait a moment for database consistency
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now try the normal join
      return await this.joinQueue(userWhatsapp, stationId);

    } catch (error) {
      logger.error('Force join queue failed', { userWhatsapp, stationId, error });
      return null;
    }
  }

  /**
   * Get user's current queue status - Only active queues
   */
  async getUserQueueStatus(userWhatsapp: string): Promise<QueuePosition[]> {
    try {
      const result = await db.execute(sql`
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

      return result.rows.map((row: any) => ({
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

    } catch (error) {
      logger.error('Failed to get user queue status', { userWhatsapp, error });
      return [];
    }
  }

  /**
   * Reserve charging slot for user
   */
  async reserveSlot(userWhatsapp: string, stationId: number, reservationMinutes: number = 15): Promise<boolean> {
    try {
      // Check if user is first in queue
      const queueResult = await db.execute(sql`
        SELECT id 
        FROM queues 
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND position = 1 
        AND status = 'waiting'
        LIMIT 1
      `);

      if (!queueResult.rows.length) {
        logger.warn('User not eligible for reservation', { userWhatsapp, stationId });
        return false;
      }

      const queueEntry = queueResult.rows[0] as any;
      const expiryTime = new Date(Date.now() + (reservationMinutes * 60 * 1000));

      // Check if reservation_expiry column exists
      const columnExists = await this.checkColumnExists('queues', 'reservation_expiry');
      
      if (columnExists) {
        await db.execute(sql`
          UPDATE queues 
          SET status = 'reserved', reservation_expiry = ${expiryTime}, updated_at = NOW()
          WHERE id = ${queueEntry.id}
        `);
      } else {
        await db.execute(sql`
          UPDATE queues 
          SET status = 'reserved', updated_at = NOW()
          WHERE id = ${queueEntry.id}
        `);
      }

      logger.info('Slot reserved successfully', { userWhatsapp, stationId, expiryTime });
      return true;

    } catch (error) {
      logger.error('Failed to reserve slot', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Start charging session
   */
  async startCharging(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        UPDATE queues 
        SET status = 'charging', updated_at = NOW()
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND status = 'reserved'
        RETURNING id
      `);

      if (!result.rows.length) {
        logger.warn('No valid reservation found to start charging', { userWhatsapp, stationId });
        return false;
      }

      // Promote next user in queue
      await this.promoteNextInQueue(stationId);

      logger.info('Charging session started', { userWhatsapp, stationId });
      return true;

    } catch (error) {
      logger.error('Failed to start charging', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Complete charging session
   */
  async completeCharging(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        UPDATE queues 
        SET status = 'completed', updated_at = NOW()
        WHERE user_whatsapp = ${userWhatsapp} 
        AND station_id = ${stationId} 
        AND status = 'charging'
        RETURNING id
      `);

      if (!result.rows.length) {
        logger.warn('No active charging session found', { userWhatsapp, stationId });
        return false;
      }

      // Update station and promote next user
      await Promise.all([
        this.updateStationQueueCount(stationId),
        this.promoteNextInQueue(stationId)
      ]);

      logger.info('Charging session completed', { userWhatsapp, stationId });
      return true;

    } catch (error) {
      logger.error('Failed to complete charging', { userWhatsapp, stationId, error });
      return false;
    }
  }

  // ==============================================
  // PRIVATE HELPER METHODS
  // ==============================================

  /**
   * Check if a column exists in a table
   */
  private async checkColumnExists(tableName: string, columnName: string): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = ${tableName} 
        AND column_name = ${columnName} 
        AND table_schema = 'public'
      `);

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Failed to check column existence', { tableName, columnName, error });
      return false;
    }
  }

  /**
   * Get current queue length for a station
   */
  private async getQueueLength(stationId: number): Promise<number> {
    try {
      const result = await db.execute(sql`
        SELECT COUNT(*) as count 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status IN ('waiting', 'reserved')
      `);

      return Number((result.rows[0] as any).count || 0);
    } catch (error) {
      logger.error('Failed to get queue length', { stationId, error });
      return 0;
    }
  }

  /**
   * Calculate estimated wait time
   */
  private calculateWaitTime(position: number, avgSessionMinutes: number): number {
    if (position === 1) return 5;
    return ((position - 1) * avgSessionMinutes) + 5;
  }

  /**
   * Reorder queue after a position is removed
   */
  private async reorderQueue(stationId: number, removedPosition: number): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE queues 
        SET position = position - 1, updated_at = NOW()
        WHERE station_id = ${stationId} 
        AND position > ${removedPosition} 
        AND status IN ('waiting', 'reserved')
      `);
        
      logger.debug('Queue reordered successfully', { stationId, removedPosition });
    } catch (error) {
      logger.error('Failed to reorder queue', { stationId, removedPosition, error });
    }
  }

  /**
   * Update station's current queue count
   */
  private async updateStationQueueCount(stationId: number): Promise<void> {
    try {
      const queueLength = await this.getQueueLength(stationId);
      
      await db.execute(sql`
        UPDATE charging_stations 
        SET current_queue_length = ${queueLength}, updated_at = NOW()
        WHERE id = ${stationId}
      `);
        
      logger.debug('Station queue count updated', { stationId, queueLength });
    } catch (error) {
      logger.error('Failed to update station queue count', { stationId, error });
    }
  }

  /**
   * Promote next user in queue
   */
  private async promoteNextInQueue(stationId: number): Promise<void> {
    try {
      // Find next person in queue (position 2, since position 1 just left)
      const nextResult = await db.execute(sql`
        SELECT user_whatsapp 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND position = 2 
        AND status = 'waiting'
        LIMIT 1
      `);

      if (nextResult.rows.length > 0) {
        const nextInQueue = nextResult.rows[0] as any;
        
        // Auto-reserve for 15 minutes
        await this.reserveSlot(nextInQueue.user_whatsapp, stationId, 15);
        
        // Reorder remaining queue
        await this.reorderQueue(stationId, 1);
      }
    } catch (error) {
      logger.error('Failed to promote next in queue', { stationId, error });
    }
  }

  /**
   * Notify queue progress to waiting users
   */
  private async notifyQueueProgress(stationId: number): Promise<void> {
    try {
      const waitingResult = await db.execute(sql`
        SELECT id, user_whatsapp, position 
        FROM queues 
        WHERE station_id = ${stationId} 
        AND status = 'waiting'
        ORDER BY position
      `);

      for (const user of waitingResult.rows) {
        const userQueue = user as any;
        const newWaitTime = this.calculateWaitTime(userQueue.position, 45);
        
        // Update estimated wait time
        await db.execute(sql`
          UPDATE queues 
          SET estimated_wait_minutes = ${newWaitTime}, updated_at = NOW()
          WHERE id = ${userQueue.id}
        `);

        // Send progress notification (non-blocking)
        this.sendProgressNotification(userQueue.user_whatsapp, stationId, userQueue.position, newWaitTime);
      }
    } catch (error) {
      logger.error('Failed to notify queue progress', { stationId, error });
    }
  }

  /**
 * Get queue statistics for a station
 */
async getQueueStats(stationId: number): Promise<QueueStats> {
  try {
    // Get current queue length
    const queueLength = await this.getQueueLength(stationId);
    
    // Get average wait time from completed queues in last 7 days
    const avgWaitResult = await db.execute(sql`
      SELECT AVG(estimated_wait_minutes) as avg_wait
      FROM queues 
      WHERE station_id = ${stationId} 
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '7 days'
    `);
    
    const avgWaitTime = Number((avgWaitResult.rows[0] as any)?.avg_wait || 45);

    // Get peak hours from last 30 days
    const peakHoursResult = await db.execute(sql`
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

    const peakHours = peakHoursResult.rows.map((row: any) => 
      `${row.hour}:00-${Number(row.hour) + 1}:00`
    );

    return {
      totalInQueue: queueLength,
      averageWaitTime: avgWaitTime,
      peakHours: peakHours
    };

  } catch (error) {
    logger.error('Failed to get queue stats', { stationId, error });
    return {
      totalInQueue: 0,
      averageWaitTime: 0,
      peakHours: []
    };
  }
}

  // ==============================================
  // NOTIFICATION HELPERS (NON-BLOCKING)
  // ==============================================

  /**
   * Send join queue notifications (non-blocking)
   */
  private sendNotifications(userWhatsapp: string, queuePosition: QueuePosition, stationId: number, position: number): void {
    setImmediate(async () => {
      try {
        await notificationService.sendQueueJoinedNotification(userWhatsapp, queuePosition);
        await notificationService.notifyStationOwner(stationId, 'queue_joined', { 
          userWhatsapp, 
          position 
        });
      } catch (error) {
        logger.warn('Failed to send join queue notifications', { 
          userWhatsapp, 
          stationId, 
          error 
        });
      }
    });
  }

  /**
   * Send progress notification (non-blocking)
   */
  private sendProgressNotification(userWhatsapp: string, stationId: number, position: number, waitTime: number): void {
    setImmediate(async () => {
      try {
        await notificationService.sendQueueProgressNotification(
          userWhatsapp, 
          stationId, 
          position, 
          waitTime
        );
      } catch (error) {
        logger.warn('Failed to send progress notification', { 
          userWhatsapp, 
          stationId, 
          error 
        });
      }
    });
  }
}

export const queueService = new QueueService();