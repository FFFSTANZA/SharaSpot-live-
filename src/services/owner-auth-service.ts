import { db } from '../config/database';
import { stationOwners } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

// Session storage (in production, use Redis or database)
interface AuthSession {
  whatsappId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export class OwnerAuthService {
  private activeSessions = new Map<string, AuthSession>();
  private readonly SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Check if owner is authenticated - FIXED: Direct DB query, no circular import
   */
  async isAuthenticated(whatsappId: string): Promise<boolean> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return false;
      }

      // Direct database query - no dependency on owner-service
      const [owner] = await db
        .select({ 
          isActive: stationOwners.isActive,
          isVerified: stationOwners.isVerified
        })
        .from(stationOwners)
        .where(eq(stationOwners.whatsappId, whatsappId))
        .limit(1);

      return !!(owner?.isActive && owner?.isVerified);
    } catch (error) {
      logger.error('Authentication check failed', { whatsappId, error });
      return false;
    }
  }

  /**
   * Authenticate owner by business name - FIXED: Direct DB query
   */
  async authenticateByBusinessName(whatsappId: string, businessName: string): Promise<boolean> {
    try {
      if (!validateWhatsAppId(whatsappId) || !businessName?.trim()) {
        return false;
      }

      // Direct database query - no circular dependency
      const [owner] = await db
        .select({
          whatsappId: stationOwners.whatsappId,
          businessName: stationOwners.businessName,
          isActive: stationOwners.isActive,
          isVerified: stationOwners.isVerified
        })
        .from(stationOwners)
        .where(eq(stationOwners.businessName, businessName.trim()))
        .limit(1);

      if (!owner) {
        logger.warn('Owner not found by business name', { businessName });
        return false;
      }

      // Security check: WhatsApp ID must match
      if (owner.whatsappId !== whatsappId) {
        logger.warn('WhatsApp ID mismatch for business name', { 
          businessName, 
          expectedWhatsappId: whatsappId,
          actualWhatsappId: owner.whatsappId
        });
        return false;
      }

      // Check if owner is active and verified
      if (!owner.isActive) {
        logger.warn('Owner account is not active', { whatsappId, businessName });
        return false;
      }

      if (!owner.isVerified) {
        logger.warn('Owner account is not verified', { whatsappId, businessName });
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
   * Get owner profile - FIXED: Direct query
   */
  async getOwnerProfile(whatsappId: string): Promise<any | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return null;
      }

      const [owner] = await db
        .select()
        .from(stationOwners)
        .where(eq(stationOwners.whatsappId, whatsappId))
        .limit(1);

      return owner || null;
    } catch (error) {
      logger.error('Failed to get owner profile', { whatsappId, error });
      return null;
    }
  }

  /**
   * Create authentication session
   */
  async createAuthSession(whatsappId: string): Promise<string | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return null;
      }

      // Check if owner exists and is active
      const isAuthenticated = await this.isAuthenticated(whatsappId);
      if (!isAuthenticated) {
        return null;
      }

      // Generate session token
      const token = this.generateSessionToken(whatsappId);
      const expiresAt = new Date(Date.now() + this.SESSION_DURATION);

      // Store session
      const session: AuthSession = {
        whatsappId,
        token,
        createdAt: new Date(),
        expiresAt,
        isActive: true
      };

      this.activeSessions.set(token, session);

      logger.info('Auth session created', { whatsappId, token });
      return token;

    } catch (error) {
      logger.error('Failed to create auth session', { whatsappId, error });
      return null;
    }
  }

  /**
   * Validate session token
   */
  async validateSession(token: string): Promise<boolean> {
    try {
      const session = this.activeSessions.get(token);
      
      if (!session || !session.isActive || session.expiresAt < new Date()) {
        if (session) this.activeSessions.delete(token);
        return false;
      }

      // Update expiration (sliding window)
      session.expiresAt = new Date(Date.now() + this.SESSION_DURATION);
      this.activeSessions.set(token, session);

      return true;
    } catch (error) {
      logger.error('Session validation failed', { token, error });
      return false;
    }
  }

  /**
   * Get WhatsApp ID from session token
   */
  async getWhatsAppIdFromToken(token: string): Promise<string | null> {
    try {
      const session = this.activeSessions.get(token);
      
      if (!session || !session.isActive || session.expiresAt < new Date()) {
        return null;
      }

      return session.whatsappId;
    } catch (error) {
      logger.error('Failed to get WhatsApp ID from token', { token, error });
      return null;
    }
  }

  /**
   * Invalidate session
   */
  async invalidateSession(token: string): Promise<boolean> {
    try {
      const deleted = this.activeSessions.delete(token);
      if (deleted) {
        logger.info('Session invalidated', { token });
      }
      return deleted;
    } catch (error) {
      logger.error('Failed to invalidate session', { token, error });
      return false;
    }
  }

  /**
   * Invalidate all sessions for a WhatsApp ID
   */
  async invalidateAllSessions(whatsappId: string): Promise<boolean> {
    try {
      let count = 0;
      
      for (const [token, session] of this.activeSessions.entries()) {
        if (session.whatsappId === whatsappId) {
          this.activeSessions.delete(token);
          count++;
        }
      }

      if (count > 0) {
        logger.info('All sessions invalidated for owner', { whatsappId, count });
      }
      return count > 0;
    } catch (error) {
      logger.error('Failed to invalidate all sessions', { whatsappId, error });
      return false;
    }
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    let expiredCount = 0;
    
    for (const [token, session] of this.activeSessions.entries()) {
      if (session.expiresAt < now) {
        this.activeSessions.delete(token);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.info('Expired sessions cleaned up', { expiredCount });
    }
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Generate session token
   */
  private generateSessionToken(whatsappId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `owner_${whatsappId}_${timestamp}_${random}`;
  }
}

// Export singleton
export const ownerAuthService = new OwnerAuthService();

// Regular cleanup of expired sessions
setInterval(() => {
  ownerAuthService.cleanupExpiredSessions();
}, 60 * 60 * 1000); // Cleanup every hour
