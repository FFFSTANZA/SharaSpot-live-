import { db } from '../config/database';
import { stationOwners, chargingSessions, chargingStations } from '../db/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

export interface OwnerProfile {
  id: number;
  whatsappId: string;
  name: string;
  businessName?: string;
  phoneNumber: string;
  email?: string;
  businessType?: string;
  gstNumber?: string;
  isVerified: boolean;
  isActive: boolean;
  kycStatus: string;
  totalStations: number;
  totalRevenue: string;
  averageRating: string;
  createdAt: Date;
}

export interface OwnerAnalytics {
  todaySessions: number;
  todayRevenue: number;
  todayEnergy: number;
  avgSessionDuration: number;
  weekSessions: number;
  weekRevenue: number;
  weekGrowth: number;
  bestStationName: string;
  avgUtilization: number;
  peakHours: string;
  averageRating: number;
  totalReviews: number;
  repeatCustomers: number;
}

export class OwnerService {
  
  async getOwnerProfile(whatsappId: string): Promise<OwnerProfile | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        logger.error('Invalid WhatsApp ID', { whatsappId });
        return null;
      }

      const [owner] = await db
        .select()
        .from(stationOwners)
        .where(eq(stationOwners.whatsappId, whatsappId))
        .limit(1);

      if (!owner) {
        logger.warn('Owner profile not found', { whatsappId });
        return null;
      }

      return {
        id: owner.id,
        whatsappId: owner.whatsappId,
        name: owner.name,
        businessName: owner.businessName || undefined,
        phoneNumber: owner.phoneNumber || '',
        email: owner.email || undefined,
        businessType: owner.businessType || undefined,
        gstNumber: owner.gstNumber || undefined,
        isVerified: owner.isVerified || false,
        isActive: owner.isActive || false,
        kycStatus: owner.kycStatus || 'pending',
        totalStations: owner.totalStations || 0,
        totalRevenue: owner.totalRevenue?.toString() || '0',
        averageRating: owner.averageRating?.toString() || '0',
        createdAt: owner.createdAt || new Date()
      };

    } catch (error) {
      logger.error('Failed to get owner profile', { whatsappId, error });
      return null;
    }
  }

  async updateOwnerProfile(whatsappId: string, updates: Partial<OwnerProfile>): Promise<boolean> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return false;
      }

      await db
        .update(stationOwners)
        .set({
          ...updates,
          updatedAt: new Date()
        })
        .where(eq(stationOwners.whatsappId, whatsappId));

      logger.info('Owner profile updated', { whatsappId, updates });
      return true;

    } catch (error) {
      logger.error('Failed to update owner profile', { whatsappId, error });
      return false;
    }
  }

  async getOwnerAnalytics(whatsappId: string): Promise<OwnerAnalytics | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return null;
      }

      const ownerStations = await db
        .select({ id: chargingStations.id, name: chargingStations.name })
        .from(chargingStations)
        .where(eq(chargingStations.ownerWhatsappId, whatsappId));

      if (!ownerStations.length) {
        return null;
      }

      const stationIds = ownerStations.map(s => s.id);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const todaySessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            sql`${chargingSessions.stationId} = ANY(ARRAY[${sql.join(stationIds.map(id => sql`${id}`), sql`, `)}])`,
            gte(chargingSessions.startTime, today)
          )
        );

      const weekSessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            sql`${chargingSessions.stationId} = ANY(ARRAY[${sql.join(stationIds.map(id => sql`${id}`), sql`, `)}])`,
            gte(chargingSessions.startTime, weekAgo)
          )
        );

      const lastWeekSessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            sql`${chargingSessions.stationId} = ANY(ARRAY[${sql.join(stationIds.map(id => sql`${id}`), sql`, `)}])`,
            gte(chargingSessions.startTime, twoWeeksAgo),
            sql`${chargingSessions.startTime} < ${weekAgo}`
          )
        );

      const todayRevenue = todaySessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      const todayEnergy = todaySessions.reduce((sum, session) => 
        sum + parseFloat(session.energyDelivered?.toString() || '0'), 0
      );

      const avgDuration = todaySessions.length > 0 ?
        todaySessions.reduce((sum, session) => {
          if (session.startTime && session.endTime) {
            return sum + (session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60);
          }
          return sum;
        }, 0) / todaySessions.length : 0;

      const weekRevenue = weekSessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      const lastWeekRevenue = lastWeekSessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      const weekGrowth = lastWeekRevenue > 0 ?
        ((weekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100 : 0;

      const stationRevenues = await Promise.all(
        ownerStations.map(async (station) => {
          const sessions = await db
            .select()
            .from(chargingSessions)
            .where(
              and(
                eq(chargingSessions.stationId, station.id),
                gte(chargingSessions.startTime, weekAgo)
              )
            );
          
          const revenue = sessions.reduce((sum, s) => 
            sum + parseFloat(s.totalCost?.toString() || '0'), 0
          );

          return { name: station.name, revenue };
        })
      );

      const bestStation = stationRevenues.reduce((max, current) => 
        current.revenue > max.revenue ? current : max, 
        { name: 'N/A', revenue: 0 }
      );

      const allStations = await db
        .select({
          totalSlots: chargingStations.totalSlots,
          availableSlots: chargingStations.availableSlots
        })
        .from(chargingStations)
        .where(eq(chargingStations.ownerWhatsappId, whatsappId));

      const totalSlots = allStations.reduce((sum, s) => sum + (s.totalSlots || 0), 0);
      const totalAvailable = allStations.reduce((sum, s) => sum + (s.availableSlots || 0), 0);
      const avgUtilization = totalSlots > 0 ? 
        Math.round(((totalSlots - totalAvailable) / totalSlots) * 100) : 0;

      const hourlyData = todaySessions
        .filter(s => s.startTime)
        .map(s => new Date(s.startTime!).getHours());

      const peakHour = hourlyData.length > 0 ?
        hourlyData.sort((a, b) => 
          hourlyData.filter(h => h === b).length - hourlyData.filter(h => h === a).length
        )[0] : 12;

      const completedSessions = await db
        .select({
          customerRating: chargingSessions.customerRating,
          userWhatsapp: chargingSessions.userWhatsapp
        })
        .from(chargingSessions)
        .where(
          and(
            sql`${chargingSessions.stationId} = ANY(ARRAY[${sql.join(stationIds.map(id => sql`${id}`), sql`, `)}])`,
            eq(chargingSessions.status, 'completed')
          )
        );

      const ratings = completedSessions
        .filter(s => s.customerRating)
        .map(s => s.customerRating!);

      const avgRating = ratings.length > 0 ?
        ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;

      const uniqueUsers = new Set(completedSessions.map(s => s.userWhatsapp));
      const totalUsers = uniqueUsers.size;
      const repeatUsers = completedSessions.length - totalUsers;
      const repeatPercentage = totalUsers > 0 ? 
        Math.round((repeatUsers / totalUsers) * 100) : 0;

      return {
        todaySessions: todaySessions.length,
        todayRevenue: Math.round(todayRevenue),
        todayEnergy: Math.round(todayEnergy * 100) / 100,
        avgSessionDuration: Math.round(avgDuration),
        weekSessions: weekSessions.length,
        weekRevenue: Math.round(weekRevenue),
        weekGrowth: Math.round(weekGrowth * 10) / 10,
        bestStationName: bestStation.name,
        avgUtilization,
        peakHours: `${peakHour}:00 - ${peakHour + 1}:00`,
        averageRating: Math.round(avgRating * 10) / 10,
        totalReviews: ratings.length,
        repeatCustomers: repeatPercentage
      };

    } catch (error) {
      logger.error('Failed to get owner analytics', { whatsappId, error });
      return null;
    }
  }

  async isRegisteredOwner(whatsappId: string): Promise<boolean> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return false;
      }

      const [owner] = await db
        .select({ id: stationOwners.id })
        .from(stationOwners)
        .where(eq(stationOwners.whatsappId, whatsappId))
        .limit(1);

      return !!owner;

    } catch (error) {
      logger.error('Failed to check owner registration', { whatsappId, error });
      return false;
    }
  }

  async getOwnerByBusinessName(businessName: string): Promise<OwnerProfile | null> {
    try {
      const [owner] = await db
        .select()
        .from(stationOwners)
        .where(eq(stationOwners.businessName, businessName))
        .limit(1);

      if (!owner) {
        return null;
      }

      return {
        id: owner.id,
        whatsappId: owner.whatsappId,
        name: owner.name,
        businessName: owner.businessName || undefined,
        phoneNumber: owner.phoneNumber || '',
        email: owner.email || undefined,
        businessType: owner.businessType || undefined,
        gstNumber: owner.gstNumber || undefined,
        isVerified: owner.isVerified || false,
        isActive: owner.isActive || false,
        kycStatus: owner.kycStatus || 'pending',
        totalStations: owner.totalStations || 0,
        totalRevenue: owner.totalRevenue?.toString() || '0',
        averageRating: owner.averageRating?.toString() || '0',
        createdAt: owner.createdAt || new Date()
      };

    } catch (error) {
      logger.error('Failed to get owner by business name', { businessName, error });
      return null;
    }
  }
}

export const ownerService = new OwnerService();