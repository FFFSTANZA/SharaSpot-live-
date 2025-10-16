import { db } from '../config/database';
import { chargingStations, stationOwners, queues, chargingSessions } from '../db/schema';
import { eq, and, gte, count, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

// ===============================================
// INTERFACES
// ===============================================

export interface OwnerStation {
  id: number;
  name: string;
  address: string;
  isActive: boolean;
  isOpen: boolean;
  totalSlots: number;
  availableSlots: number;
  pricePerKwh: string;
  queueLength: number;
  todayRevenue: number;
  connectorTypes: any;
  operatingHours: any;
}

export interface StationAnalytics {
  queueLength: number;
  todaySessions: number;
  todayRevenue: number;
  todayEnergy: number;
  utilizationRate: number;
  averageSessionDuration: number;
}

// ===============================================
// OWNER STATION SERVICE - FIXED
// ===============================================

export class OwnerStationService {
  
  /**
   * Get all stations for owner - FIXED: Assumes ownerWhatsappId stores WhatsApp ID directly
   */
  async getOwnerStations(whatsappId: string): Promise<OwnerStation[]> {
    if (!validateWhatsAppId(whatsappId)) return [];

    try {
      // FIXED: Direct query assuming ownerWhatsappId contains the WhatsApp ID
      const stations = await db
        .select({
          id: chargingStations.id,
          name: chargingStations.name,
          address: chargingStations.address,
          isActive: chargingStations.isActive,
          isOpen: chargingStations.isOpen,
          totalSlots: chargingStations.totalSlots,
          availableSlots: chargingStations.availableSlots,
          pricePerKwh: chargingStations.pricePerKwh,
          connectorTypes: chargingStations.connectorTypes,
          operatingHours: chargingStations.operatingHours,
          currentQueueLength: chargingStations.currentQueueLength,
        })
        .from(chargingStations)
        .where(eq(chargingStations.ownerWhatsappId, whatsappId)) // FIXED: Direct WhatsApp ID match
        .orderBy(desc(chargingStations.createdAt));

      // Enhance with real-time data
      const enhancedStations = await Promise.all(
        stations.map(async (station) => {
          const [queueCount, todayRevenue] = await Promise.all([
            this.getQueueLength(station.id),
            this.getTodayRevenue(station.id)
          ]);

          return {
            id: station.id,
            name: station.name,
            address: station.address,
            isActive: station.isActive || false,
            isOpen: station.isOpen || false,
            totalSlots: station.totalSlots || 4,
            availableSlots: station.availableSlots || 4,
            pricePerKwh: station.pricePerKwh?.toString() || '12.50',
            connectorTypes: station.connectorTypes,
            operatingHours: station.operatingHours,
            queueLength: queueCount,
            todayRevenue
          };
        })
      );

      logger.info('Retrieved owner stations', { whatsappId, count: enhancedStations.length });
      return enhancedStations;

    } catch (error) {
      logger.error('Failed to get owner stations', { whatsappId, error });
      return [];
    }
  }

  /**
   * Toggle station status - FIXED: Direct ownership verification
   */
  async toggleStationStatus(stationId: number, ownerWhatsappId: string): Promise<boolean> {
    try {
      // FIXED: Direct ownership verification using WhatsApp ID
      const [station] = await db
        .select({ 
          isActive: chargingStations.isActive,
          ownerWhatsappId: chargingStations.ownerWhatsappId
        })
        .from(chargingStations)
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(chargingStations.ownerWhatsappId, ownerWhatsappId) // Direct WhatsApp ID check
          )
        )
        .limit(1);

      if (!station) {
        logger.warn('Station not found or access denied', { stationId, ownerWhatsappId });
        return false;
      }

      // Toggle status
      const newStatus = !station.isActive;
      
      await db
        .update(chargingStations)
        .set({
          isActive: newStatus,
          updatedAt: new Date()
        })
        .where(eq(chargingStations.id, stationId));

      logger.info('Station status toggled', { 
        stationId, 
        ownerWhatsappId,
        oldStatus: station.isActive,
        newStatus
      });

      return true;

    } catch (error) {
      logger.error('Failed to toggle station status', { stationId, ownerWhatsappId, error });
      return false;
    }
  }

  /**
   * Get station details for owner
   */
  async getStationDetails(stationId: number, ownerWhatsappId: string): Promise<any | null> {
    try {
      const [station] = await db
        .select()
        .from(chargingStations)
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(chargingStations.ownerWhatsappId, ownerWhatsappId)
          )
        )
        .limit(1);

      if (!station) {
        return null;
      }

      // Get analytics
      const analytics = await this.getStationAnalytics(stationId);

      return {
        ...station,
        ...analytics
      };

    } catch (error) {
      logger.error('Failed to get station details', { stationId, ownerWhatsappId, error });
      return null;
    }
  }

  /**
   * Get comprehensive station analytics - ENHANCED
   */
  async getStationAnalytics(stationId: number): Promise<StationAnalytics> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Parallel queries for efficiency
      const [
        queueLength,
        todaySessions,
        todayRevenue,
        todayEnergy,
        totalSlots,
        averageSessionDuration
      ] = await Promise.all([
        this.getQueueLength(stationId),
        this.getTodaySessionsCount(stationId),
        this.getTodayRevenue(stationId),
        this.getTodayEnergy(stationId),
        this.getStationSlots(stationId),
        this.getAverageSessionDuration(stationId)
      ]);

      // Calculate utilization (active sessions / total slots * 100)
      const activeSessions = await this.getActiveSessionsCount(stationId);
      const utilizationRate = totalSlots > 0 ? 
        Math.round((activeSessions / totalSlots) * 100) : 0;

      return {
        queueLength,
        todaySessions,
        todayRevenue,
        todayEnergy,
        utilizationRate,
        averageSessionDuration
      };

    } catch (error) {
      logger.error('Failed to get station analytics', { stationId, error });
      return {
        queueLength: 0,
        todaySessions: 0,
        todayRevenue: 0,
        todayEnergy: 0,
        utilizationRate: 0,
        averageSessionDuration: 0
      };
    }
  }

  /**
   * Get owner quick stats for dashboard
   */
  async getOwnerQuickStats(whatsappId: string): Promise<{
    totalStations: number;
    activeStations: number;
    todayRevenue: number;
    activeSessions: number;
    todayEnergy: number;
  }> {
    try {
      const stations = await this.getOwnerStations(whatsappId);
      
      const totalStations = stations.length;
      const activeStations = stations.filter(s => s.isActive).length;
      const todayRevenue = stations.reduce((sum, s) => sum + s.todayRevenue, 0);
      
      // Calculate total active sessions across all stations
      const activeSessionsPromises = stations.map(s => this.getActiveSessionsCount(s.id));
      const activeSessionsCounts = await Promise.all(activeSessionsPromises);
      const activeSessions = activeSessionsCounts.reduce((sum, count) => sum + count, 0);

      // Calculate today's total energy across all stations
      const todayEnergyPromises = stations.map(s => this.getTodayEnergy(s.id));
      const todayEnergyCounts = await Promise.all(todayEnergyPromises);
      const todayEnergy = todayEnergyCounts.reduce((sum, energy) => sum + energy, 0);

      return {
        totalStations,
        activeStations,
        todayRevenue,
        activeSessions,
        todayEnergy: Math.round(todayEnergy * 100) / 100 // Round to 2 decimals
      };

    } catch (error) {
      logger.error('Failed to get owner quick stats', { whatsappId, error });
      return {
        totalStations: 0,
        activeStations: 0,
        todayRevenue: 0,
        activeSessions: 0,
        todayEnergy: 0
      };
    }
  }

  // ===============================================
  // HELPER METHODS - ENHANCED ERROR HANDLING
  // ===============================================

  /**
   * Get current queue length
   */
  private async getQueueLength(stationId: number): Promise<number> {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(queues)
        .where(
          and(
            eq(queues.stationId, stationId),
            eq(queues.status, 'waiting')
          )
        );

      return result?.count || 0;
    } catch (error) {
      logger.error('Failed to get queue length', { stationId, error });
      return 0;
    }
  }

  /**
   * Get today's revenue for station
   */
  private async getTodayRevenue(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sessions = await db
        .select({ totalCost: chargingSessions.totalCost })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today),
            eq(chargingSessions.status, 'completed') // Only count completed sessions
          )
        );

      const revenue = sessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      return Math.round(revenue);
    } catch (error) {
      logger.error('Failed to get today revenue', { stationId, error });
      return 0;
    }
  }

  /**
   * Get today's sessions count
   */
  private async getTodaySessionsCount(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [result] = await db
        .select({ count: count() })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today)
          )
        );

      return result?.count || 0;
    } catch (error) {
      logger.error('Failed to get today sessions count', { stationId, error });
      return 0;
    }
  }

  /**
   * Get today's energy delivered
   */
  private async getTodayEnergy(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sessions = await db
        .select({ energyDelivered: chargingSessions.energyDelivered })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today),
            eq(chargingSessions.status, 'completed')
          )
        );

      const energy = sessions.reduce((sum, session) => 
        sum + parseFloat(session.energyDelivered?.toString() || '0'), 0
      );

      return energy;
    } catch (error) {
      logger.error('Failed to get today energy', { stationId, error });
      return 0;
    }
  }

  /**
   * Get station total slots
   */
  private async getStationSlots(stationId: number): Promise<number> {
    try {
      const [station] = await db
        .select({ totalSlots: chargingStations.totalSlots })
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      return station?.totalSlots || 4;
    } catch (error) {
      logger.error('Failed to get station slots', { stationId, error });
      return 4;
    }
  }

  /**
   * Get active sessions count
   */
  private async getActiveSessionsCount(stationId: number): Promise<number> {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'active')
          )
        );

      return result?.count || 0;
    } catch (error) {
      logger.error('Failed to get active sessions count', { stationId, error });
      return 0;
    }
  }

  /**
   * Get average session duration in minutes
   */
  private async getAverageSessionDuration(stationId: number): Promise<number> {
    try {
      const sessions = await db
        .select({ 
          startTime: chargingSessions.startTime,
          endTime: chargingSessions.endTime
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'completed')
          )
        )
        .limit(100); // Last 100 sessions for average

      if (sessions.length === 0) return 0;

      const totalDuration = sessions.reduce((sum, session) => {
        if (session.startTime && session.endTime) {
          const duration = session.endTime.getTime() - session.startTime.getTime();
          return sum + (duration / (1000 * 60)); // Convert to minutes
        }
        return sum;
      }, 0);

      return Math.round(totalDuration / sessions.length);
    } catch (error) {
      logger.error('Failed to get average session duration', { stationId, error });
      return 30; // Default 30 minutes
    }
  }

  /**
   * Verify station ownership
   */
  private async verifyStationOwnership(stationId: number, ownerWhatsappId: string): Promise<boolean> {
    try {
      const [result] = await db
        .select({ id: chargingStations.id })
        .from(chargingStations)
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(chargingStations.ownerWhatsappId, ownerWhatsappId)
          )
        )
        .limit(1);

      return !!result;
    } catch (error) {
      logger.error('Failed to verify station ownership', { stationId, ownerWhatsappId, error });
      return false;
    }
  }
}

// Export singleton
export const ownerStationService = new OwnerStationService();