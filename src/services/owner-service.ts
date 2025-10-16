// src/owner/services/owner-service.ts - Main Owner Service
import { db } from '../config/database';
import { stationOwners, chargingSessions, queues, chargingStations } from '../db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
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

// ===============================================
// OWNER SERVICE CLASS
// ===============================================

export class OwnerService {
  
  /**
   * Get owner profile by WhatsApp ID
   */
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

  /**
   * Update owner profile
   */
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

  /**
   * Get comprehensive owner analytics
   */
  async getOwnerAnalytics(whatsappId: string): Promise<OwnerAnalytics | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return null;
      }

      // Get owner's stations
      const ownerStations = await db
        .select({ id: chargingStations.id, name: chargingStations.name })
        .from(chargingStations)
        .innerJoin(stationOwners, eq(chargingStations.ownerWhatsappId, stationOwners.id))
        .where(eq(stationOwners.whatsappId, whatsappId));

      if (!ownerStations.length) {
        return null;
      }

      const stationIds = ownerStations.map(s => s.id);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      // Get today's sessions
      const todaySessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationIds[0]), // Simplified for demo
            gte(chargingSessions.startTime, today)
          )
        );

      // Calculate analytics
      const todayRevenue = todaySessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      const todayEnergy = todaySessions.reduce((sum, session) => 
        sum + parseFloat(session.energyDelivered?.toString() || '0'), 0
      );

      const avgDuration = todaySessions.length > 0 ? 
        todaySessions.reduce((sum, session) => sum + (session.duration || 0), 0) / todaySessions.length : 0;

      // Get week's data (simplified)
      const weekSessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationIds[0]),
            gte(chargingSessions.startTime, weekAgo)
          )
        );

      const weekRevenue = weekSessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      return {
        todaySessions: todaySessions.length,
        todayRevenue: Math.round(todayRevenue),
        todayEnergy: Math.round(todayEnergy * 100) / 100,
        avgSessionDuration: Math.round(avgDuration),
        weekSessions: weekSessions.length,
        weekRevenue: Math.round(weekRevenue),
        weekGrowth: 12.5, // Placeholder calculation
        bestStationName: ownerStations[0]?.name || 'N/A',
        avgUtilization: 68, // Placeholder calculation
        peakHours: '6-9 PM', // Placeholder
        averageRating: 4.2, // Placeholder
        totalReviews: 15, // Placeholder
        repeatCustomers: 35 // Placeholder percentage
      };

    } catch (error) {
      logger.error('Failed to get owner analytics', { whatsappId, error });
      return null;
    }
  }

  /**
   * Check if user is registered owner
   */
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

  /**
   * Get owner by business name (for login)
   */
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

// ===============================================
// OWNER STATION SERVICE
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
  operatingHours: any;
  createdAt: Date;
}

export interface StationAnalytics {
  queueLength: number;
  todaySessions: number;
  todayRevenue: number;
  todayEnergy: number;
  utilizationRate: number;
  activeUsers: number;
}

export class OwnerStationService {
  
  /**
   * Get all stations for owner
   */
  async getOwnerStations(whatsappId: string): Promise<OwnerStation[]> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return [];
      }

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
          operatingHours: chargingStations.operatingHours,
          createdAt: chargingStations.createdAt
        })
        .from(chargingStations)
        .innerJoin(stationOwners, eq(chargingStations.ownerWhatsappId, stationOwners.id))
        .where(eq(stationOwners.whatsappId, whatsappId))
        .orderBy(desc(chargingStations.createdAt));

      return stations.map(station => ({
        id: station.id,
        name: station.name,
        address: station.address,
        isActive: station.isActive || false,
        isOpen: station.isOpen || false,
        totalSlots: station.totalSlots || 0,
        availableSlots: station.availableSlots || 0,
        pricePerKwh: station.pricePerKwh?.toString() || '0',
        operatingHours: station.operatingHours,
        createdAt: station.createdAt || new Date()
      }));

    } catch (error) {
      logger.error('Failed to get owner stations', { whatsappId, error });
      return [];
    }
  }

  /**
   * Toggle station active status
   */
  async toggleStationStatus(stationId: number, ownerWhatsappId: string): Promise<boolean> {
    try {
      // Verify ownership
      const [station] = await db
        .select({ 
          isActive: chargingStations.isActive,
          ownerId: chargingStations.ownerWhatsappId
        })
        .from(chargingStations)
        .innerJoin(stationOwners, eq(chargingStations.ownerWhatsappId, stationOwners.id))
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(stationOwners.whatsappId, ownerWhatsappId)
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

      logger.info('Station status toggled', { stationId, newStatus, ownerWhatsappId });
      return true;

    } catch (error) {
      logger.error('Failed to toggle station status', { stationId, ownerWhatsappId, error });
      return false;
    }
  }

  /**
   * Get station analytics
   */
  async getStationAnalytics(stationId: number): Promise<StationAnalytics | null> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get current queue length
      const queueLength = await db
        .select()
        .from(queues)
        .where(
          and(
            eq(queues.stationId, stationId),
            eq(queues.status, 'waiting')
          )
        );

      // Get today's sessions
      const todaySessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today)
          )
        );

      const todayRevenue = todaySessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      const todayEnergy = todaySessions.reduce((sum, session) => 
        sum + parseFloat(session.energyDelivered?.toString() || '0'), 0
      );

      // Get active sessions count
      const activeSessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'active')
          )
        );

      return {
        queueLength: queueLength.length,
        todaySessions: todaySessions.length,
        todayRevenue: Math.round(todayRevenue),
        todayEnergy: Math.round(todayEnergy * 100) / 100,
        utilizationRate: Math.round((activeSessions.length / 4) * 100), // Assuming 4 slots per station
        activeUsers: activeSessions.length
      };

    } catch (error) {
      logger.error('Failed to get station analytics', { stationId, error });
      return null;
    }
  }
}

// ===============================================
// OWNER AUTH SERVICE
// ===============================================

export class OwnerAuthService {
  
  /**
   * Check if owner is authenticated
   */
  async isAuthenticated(whatsappId: string): Promise<boolean> {
    try {
      const owner = await ownerService.getOwnerProfile(whatsappId);
      return !!(owner?.isActive);
    } catch (error) {
      logger.error('Authentication check failed', { whatsappId, error });
      return false;
    }
  }

  /**
   * Authenticate owner by business name
   */
  async authenticateByBusinessName(whatsappId: string, businessName: string): Promise<boolean> {
    try {
      const owner = await ownerService.getOwnerByBusinessName(businessName);
      
      if (!owner) {
        logger.warn('Owner not found by business name', { businessName });
        return false;
      }

      // For security, check if the WhatsApp ID matches
      if (owner.whatsappId !== whatsappId) {
        logger.warn('WhatsApp ID mismatch for business name', { businessName, whatsappId });
        return false;
      }

      logger.info('Owner authenticated successfully', { whatsappId, businessName });
      return true;

    } catch (error) {
      logger.error('Authentication by business name failed', { whatsappId, businessName, error });
      return false;
    }
  }

  /**
   * Create authentication session (placeholder for future JWT implementation)
   */
  async createAuthSession(whatsappId: string): Promise<string | null> {
    try {
      // For now, just return a simple token
      // In production, implement proper JWT tokens
      const token = `owner_${whatsappId}_${Date.now()}`;
      logger.info('Auth session created', { whatsappId, token });
      return token;
    } catch (error) {
      logger.error('Failed to create auth session', { whatsappId, error });
      return null;
    }
  }
}

// ===============================================
// OWNER BUTTON PARSER UTILITY
// ===============================================

export interface OwnerButtonParseResult {
  action: string;
  category: 'auth' | 'main' | 'station' | 'profile' | 'analytics' | 'system';
  stationId?: number;
  additionalData?: any;
}

export function parseOwnerButtonId(buttonId: string): OwnerButtonParseResult {
  try {
    // Remove 'owner_' prefix if present
    const cleanId = buttonId.replace(/^owner_/, '');
    
    // Split by underscore
    const parts = cleanId.split('_');
    const action = parts[0];

    // Authentication actions
    if (['register', 'login', 'help'].includes(action)) {
      return {
        action,
        category: 'auth'
      };
    }

    // Main menu actions
    if (['stations', 'profile', 'analytics', 'settings', 'main', 'menu'].includes(action)) {
      return {
        action: action === 'menu' ? 'main_menu' : action,
        category: 'main'
      };
    }

    // Station-specific actions
    if (action === 'station' || parts.includes('station')) {
      const stationIndex = parts.findIndex(part => part === 'station');
      const stationId = stationIndex >= 0 && parts[stationIndex + 1] ? 
        parseInt(parts[stationIndex + 1], 10) : undefined;

      return {
        action: parts.slice(0, stationIndex).join('_') || action,
        category: 'station',
        stationId
      };
    }

    // Toggle actions with station ID
    if (action === 'toggle' && parts.includes('station')) {
      const stationId = parseInt(parts[parts.length - 1], 10);
      return {
        action: 'toggle_station',
        category: 'station',
        stationId: !isNaN(stationId) ? stationId : undefined
      };
    }

    // System actions
    if (['exit', 'help', 'contact', 'support'].includes(action)) {
      return {
        action: parts.join('_'),
        category: 'system'
      };
    }

    // Default parsing
    return {
      action: parts.join('_'),
      category: 'main'
    };

  } catch (error) {
    logger.error('Owner button ID parsing failed', { buttonId, error });
    return {
      action: 'unknown',
      category: 'system'
    };
  }
}

// ===============================================
// SERVICE INSTANCES
// ===============================================

export const ownerService = new OwnerService();
export const ownerStationService = new OwnerStationService();
export const ownerAuthService = new OwnerAuthService();