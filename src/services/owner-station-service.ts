import { db } from '../config/database';
import { chargingStations, queues, chargingSessions } from '../db/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

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

export class OwnerStationService {
  
  async getOwnerStations(whatsappId: string): Promise<OwnerStation[]> {
    if (!validateWhatsAppId(whatsappId)) return [];

    try {
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
          createdAt: chargingStations.createdAt
        })
        .from(chargingStations)
        .where(eq(chargingStations.ownerWhatsappId, whatsappId))
        .orderBy(desc(chargingStations.createdAt));

      const stationsWithAnalytics = await Promise.all(
        stations.map(async (station) => {
          const queueLength = await this.getQueueLength(station.id);
          const todayRevenue = await this.getTodayRevenue(station.id);

          return {
            id: station.id,
            name: station.name,
            address: station.address,
            isActive: station.isActive || false,
            isOpen: station.isOpen || false,
            totalSlots: station.totalSlots || 0,
            availableSlots: station.availableSlots || 0,
            pricePerKwh: station.pricePerKwh?.toString() || '0',
            connectorTypes: station.connectorTypes,
            operatingHours: station.operatingHours,
            queueLength,
            todayRevenue
          };
        })
      );

      return stationsWithAnalytics;

    } catch (error) {
      logger.error('Failed to get owner stations', { whatsappId, error });
      return [];
    }
  }

  async toggleStationStatus(stationId: number, ownerWhatsappId: string): Promise<boolean> {
    try {
      const [station] = await db
        .select({ 
          isActive: chargingStations.isActive,
          ownerWhatsappId: chargingStations.ownerWhatsappId
        })
        .from(chargingStations)
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(chargingStations.ownerWhatsappId, ownerWhatsappId)
          )
        )
        .limit(1);

      if (!station) {
        logger.warn('Station not found or access denied', { stationId, ownerWhatsappId });
        return false;
      }

      const newStatus = !station.isActive;
      
      await db
        .update(chargingStations)
        .set({
          isActive: newStatus,
          updatedAt: new Date()
        })
        .where(eq(chargingStations.id, stationId));

      logger.info('Station status toggled', { stationId, newStatus, ownerWhatsappId });
      return true;

    } catch (error) {
      logger.error('Failed to toggle station status', { stationId, ownerWhatsappId, error });
      return false;
    }
  }

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

      const analytics = await this.getStationAnalytics(stationId);

      return {
        ...station,
        analytics
      };

    } catch (error) {
      logger.error('Failed to get station details', { stationId, ownerWhatsappId, error });
      return null;
    }
  }

  async getStationAnalytics(stationId: number): Promise<StationAnalytics> {
    try {
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

      const activeSessions = await this.getActiveSessionsCount(stationId);
      const utilizationRate = totalSlots > 0 ? Math.round((activeSessions / totalSlots) * 100) : 0;

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

  private async getQueueLength(stationId: number): Promise<number> {
    try {
      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
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

  private async getTodaySessionsCount(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
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
            gte(chargingSessions.startTime, today)
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
            gte(chargingSessions.startTime, today)
          )
        );

      const energy = sessions.reduce((sum, session) => 
        sum + parseFloat(session.energyDelivered?.toString() || '0'), 0
      );

      return Math.round(energy * 100) / 100;
    } catch (error) {
      logger.error('Failed to get today energy', { stationId, error });
      return 0;
    }
  }

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

  private async getActiveSessionsCount(stationId: number): Promise<number> {
    try {
      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as integer)` })
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
        .limit(100);

      if (sessions.length === 0) return 0;

      const totalDuration = sessions.reduce((sum, session) => {
        if (session.startTime && session.endTime) {
          const duration = session.endTime.getTime() - session.startTime.getTime();
          return sum + (duration / (1000 * 60));
        }
        return sum;
      }, 0);

      return Math.round(totalDuration / sessions.length);
    } catch (error) {
      logger.error('Failed to get average session duration', { stationId, error });
      return 30;
    }
  }
}

export const ownerStationService = new OwnerStationService();