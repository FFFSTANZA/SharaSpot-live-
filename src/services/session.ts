
import { db } from '../db/connection';
import { chargingStations, chargingSessions, users } from '../db/schema';
import { eq, and, desc, sql, count, sum, avg } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { notificationService } from './notification';
import { photoVerificationService } from './photo-verification';

export interface ChargingSession {
  id: string;
  userWhatsapp: string;
  stationId: number;
  stationName?: string;
  startTime?: Date;
  endTime?: Date;
  energyDelivered: number;
  currentBatteryLevel: number;
  targetBatteryLevel: number;
  pricePerKwh: number;
  totalCost: number;
  status: 'initiated' | 'active' | 'completed' | 'stopped';
  queueId?: number;
}

export interface SessionSummary {
  sessionId: string;
  duration: string;
  energyDelivered: number;
  finalBatteryLevel: number;
  totalCost: number;
  stationName: string;
  startTime: Date;
  endTime: Date;
}

class SessionService {
  private activeSessions = new Map<string, ChargingSession>();

  async startSession(
    userWhatsapp: string,
    stationId: number,
    queueId?: number
  ): Promise<ChargingSession | null> {
    try {

      const unpaidSessions = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.paymentStatus, 'pending'),
            eq(chargingSessions.status, 'completed')
          )
        );

      if (unpaidSessions.length > 0) {
        logger.warn('⚠️ User has unpaid sessions, blocking new session', {
          userWhatsapp,
          unpaidCount: unpaidSessions.length,
        });


        const { whatsappService } = await import('./whatsapp');
        await whatsappService.sendTextMessage(
          userWhatsapp,
          '⚠️ *Payment Required*\n\n' +
          `You have ${unpaidSessions.length} unpaid charging session(s).\n\n` +
          '❌ Cannot start a new session until previous payments are completed.\n\n' +
          'Please complete your pending payments to continue using SharaSpot.'
        );

        return null;
      }


      const existingSession = await this.getActiveSession(userWhatsapp, stationId);
      if (existingSession && ['active', 'initiated'].includes(existingSession.status)) {
        logger.warn('Active session already exists', { userWhatsapp, stationId });
        return existingSession;
      }

      
      const station = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);
      if (!station.length) {
        logger.error('Station not found for session', { stationId });
        return null;
      }
      const stationData = station[0];

      
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      
      const [newSession] = await db
        .insert(chargingSessions)
        .values({
          sessionId,
          userWhatsapp,
          stationId,
          queueId,
          status: 'initiated',
          verificationStatus: 'pending',
          maxPowerUsed: stationData.maxPowerKw || 50,
          ratePerKwh: stationData.pricePerKwh?.toString() || '12',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      logger.info('Session created, requesting START photo', {
        sessionId,
        userWhatsapp,
        stationId,
      });

      
      await photoVerificationService.initiateStartVerification(
        userWhatsapp,
        sessionId,
        stationId
      );

      return this.mapToChargingSession(newSession);
    } catch (error) {
      logger.error('Failed to start session', { error, userWhatsapp, stationId });
      return null;
    }
  }

  async startChargingAfterVerification(
  sessionId: string,
  startMeterReading: number
): Promise<void> {
  try {
    logger.info('Activating charging after photo verification', {
      sessionId,
      startMeterReading,
    });

    const now = new Date();
    await db
      .update(chargingSessions)
      .set({
        status: 'active',
        verificationStatus: 'start_verified',
        startTime: now,
        startedAt: now,
        startMeterReading: startMeterReading.toString(),
        updatedAt: now,
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    
    const session = await this.getSessionById(sessionId);
    if (!session) {
      logger.error('Session not found after verification', { sessionId });
      throw new Error('Session not found after verification');
    }

    
    this.activeSessions.set(sessionId, session);

    logger.info('✅ Charging activated', {
      sessionId,
      userWhatsapp: session.userWhatsapp,
      stationId: session.stationId,
      startReading: startMeterReading,
    });

    
    await notificationService.sendChargingStartedNotification(
      session.userWhatsapp,
      session  //  Pass full session object
    );
  } catch (error) {
    logger.error('Failed to activate charging', { error, sessionId });
    throw error;
  }
}

  /**
   * Get active session for user and station
   */
  async getActiveSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null> {
    
    for (const s of this.activeSessions.values()) {
      if (
        s.userWhatsapp === userWhatsapp &&
        s.stationId === stationId &&
        ['active', 'initiated'].includes(s.status)
      ) {
        return s;
      }
    }

    
    try {
      const [dbSession] = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.stationId, stationId),
            sql`${chargingSessions.status} IN ('active', 'initiated')`
          )
        )
        .limit(1);

      return dbSession ? this.mapToChargingSession(dbSession) : null;
    } catch (error) {
      logger.error('Failed to get active session', { error, userWhatsapp, stationId });
      return null;
    }
  }

  /**
   * Stop session - Triggers END photo request
   */
  async stopSession(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (!session) {
        logger.warn('No active session to stop', { userWhatsapp, stationId });
        return false;
      }

      await db
        .update(chargingSessions)
        .set({
          status: 'active', // Keep active while awaiting END photo
          verificationStatus: 'awaiting_end_photo',
          updatedAt: new Date(),
        })
        .where(eq(chargingSessions.sessionId, session.id));

      logger.info('Stop requested, awaiting END photo', {
        sessionId: session.id,
        userWhatsapp,
      });

      
      await photoVerificationService.initiateEndVerification(
        userWhatsapp,
        session.id,
        stationId
      );

      return true;
    } catch (error) {
      logger.error('Failed to stop session', { error, userWhatsapp, stationId });
      return false;
    }
  }

  /**
   *  Complete session AFTER END photo verified
   */
  async completeSessionAfterVerification(
  sessionId: string,
  endMeterReading: number,
  consumption: number
): Promise<void> {
  try {
    
    const result = await db
      .select({
        session: chargingSessions,
        station: chargingStations,
      })
      .from(chargingSessions)
      .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    
    if (!result || result.length === 0) {
      logger.error('Session not found during completion', { sessionId });
      throw new Error('Session not found');
    }
    
    const session = result[0].session;
    const station = result[0].station;

    
    if (!session.userWhatsapp) {
      throw new Error('Session missing user WhatsApp ID');
    }

    if (!session.startMeterReading) {
      throw new Error('Session missing start meter reading');
    }

    
    const startTime = session.startTime || session.startedAt || session.createdAt || new Date();
    const endTime = new Date();
    const durationMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));

    
    const ratePerKwh = parseFloat(session.ratePerKwh || '12');
    if (isNaN(ratePerKwh) || ratePerKwh <= 0) {
      throw new Error(`Invalid rate per kWh: ${session.ratePerKwh}`);
    }

    const energyCost = consumption * ratePerKwh;
    const platformFee = Math.max(5, energyCost * 0.05);
    const gst = (energyCost + platformFee) * 0.18;
    const totalCost = energyCost + platformFee + gst;

    logger.info('💰 Calculating session costs', {
      sessionId,
      consumption,
      ratePerKwh,
      energyCost: energyCost.toFixed(2),
      platformFee: platformFee.toFixed(2),
      gst: gst.toFixed(2),
      totalCost: totalCost.toFixed(2)
    });

    
    await db
      .update(chargingSessions)
      .set({
        status: 'completed',
        verificationStatus: 'completed',
        endTime,
        endedAt: endTime,
        duration: durationMinutes,
        endMeterReading: endMeterReading.toString(),
        energyDelivered: consumption.toString(),
        totalCost: totalCost.toFixed(2),
        baseCharge: platformFee.toFixed(2),
        taxAmount: gst.toFixed(2),
        paymentStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    
    this.activeSessions.delete(sessionId);

    
    const summary: SessionSummary = {
      sessionId,
      duration: this.formatDuration(durationMinutes),
      energyDelivered: consumption,
      finalBatteryLevel: session.finalBatteryPercent || 80,
      totalCost,
      stationName: station?.name || 'Charging Station',
      startTime,
      endTime,
    };

    logger.info('✅ Session completed successfully', {
      sessionId,
      userWhatsapp: session.userWhatsapp,
      consumption: consumption.toFixed(2),
      totalCost: totalCost.toFixed(2),
      duration: `${durationMinutes} minutes`
    });

    
    const enrichedSession = {
      ...session,
      stationName: station?.name || 'Charging Station',
      stationId: session.stationId,
      pricePerKwh: ratePerKwh,
      startMeterReading: session.startMeterReading,
      endMeterReading: endMeterReading.toString(),
      energyDelivered: consumption.toString(),
      totalCost: totalCost.toFixed(2),
    };

    
    setImmediate(async () => {
      try {
        await notificationService.sendSessionCompletedNotification(
          session.userWhatsapp,
          enrichedSession,  // ✅ Pass enriched session object
          summary
        );
        logger.debug('Completion notification sent', { sessionId });
      } catch (notifError) {
        logger.error('Failed to send completion notification (non-critical)', {
          sessionId,
          userWhatsapp: session.userWhatsapp,
          error: notifError
        });
      }
    });

    
    await this.updateUserStats(session.userWhatsapp, consumption, totalCost);
    
  } catch (error) {
    logger.error('Failed to complete session', { 
      error, 
      sessionId,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    
    throw error;
  }
}
  

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  private async updateUserStats(
    userWhatsapp: string,
    energyConsumed: number,
    costSpent: number
  ): Promise<void> {
    try {
      await db
        .update(users)
        .set({
          totalSessions: sql`${users.totalSessions} + 1`,
          totalEnergyConsumed: sql`${users.totalEnergyConsumed} + ${energyConsumed}`,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.whatsappId, userWhatsapp));
      logger.info('User stats updated', { userWhatsapp, energyConsumed, costSpent });
    } catch (error) {
      logger.error('Failed to update user stats', { error, userWhatsapp });
    }
  }

  private mapToChargingSession(dbSession: any): ChargingSession {
    return {
      id: dbSession.sessionId,
      userWhatsapp: dbSession.userWhatsapp,
      stationId: dbSession.stationId,
      stationName: dbSession.stationName || 'Charging Station',
      startTime: dbSession.startedAt || dbSession.startTime,
      endTime: dbSession.endTime,
      energyDelivered: parseFloat(dbSession.energyDelivered || '0'),
      currentBatteryLevel: dbSession.initialBatteryPercent || 20,
      targetBatteryLevel: dbSession.finalBatteryPercent || 80,
      pricePerKwh: parseFloat(dbSession.ratePerKwh || '12'),
      totalCost: parseFloat(dbSession.totalCost || '0'),
      status: dbSession.status,
      queueId: dbSession.queueId,
    };
  }

  
  async getSessionById(sessionId: string): Promise<ChargingSession | null> {
  try {
    const result = await db
      .select({
        session: chargingSessions,
        station: chargingStations,
      })
      .from(chargingSessions)
      .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    
    if (!result || result.length === 0) {
      logger.warn('Session not found', { sessionId });
      return null;
    }
    
    
    const sessionData = {
      ...result[0].session,
      stationName: result[0].station?.name || 'Charging Station',
    };
    
    return this.mapToChargingSession(sessionData);
  } catch (error) {
    logger.error('Failed to get session by ID', { sessionId, error });
    return null;
  }
}



    async getSessionHistory(userWhatsapp: string, limit: number = 10): Promise<ChargingSession[]> {
    try {
      const sessions = await db
        .select()
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.userWhatsapp, userWhatsapp))
        .orderBy(desc(chargingSessions.createdAt))
        .limit(limit);
      return sessions.map(s => this.mapToChargingSession(s));
    } catch (error) {
      logger.error('Failed to get session history', { userWhatsapp, error });
      return [];
    }
  }

  async getUserStats(userWhatsapp: string): Promise<any> {
    try {
      const basicStats = await db
        .select({
          totalSessions: count(),
          totalEnergyConsumed: sum(chargingSessions.energyDelivered),
          totalCostSpent: sum(chargingSessions.totalCost),
          avgSessionTime: avg(chargingSessions.duration),
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.status, 'completed')
          )
        );

      const stats = basicStats[0];
      return {
        totalSessions: Number(stats.totalSessions) || 0,
        totalEnergyConsumed: Number(stats.totalEnergyConsumed) || 0,
        totalCostSpent: Number(stats.totalCostSpent) || 0,
        avgSessionTime: Number(stats.avgSessionTime) || 0,
      };
    } catch (error) {
      logger.error('Failed to get user stats', { userWhatsapp, error });
      return null;
    }
  }

  

  async emergencyStopStation(stationId: number): Promise<boolean> {
    try {
      let stoppedCount = 0;
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.stationId === stationId && session.status === 'active') {
          await this.stopSession(session.userWhatsapp, stationId);
          stoppedCount++;
        }
      }
      logger.warn('🚨 Emergency stop executed', { stationId, stoppedSessions: stoppedCount });
      return true;
    } catch (error) {
      logger.error('Failed emergency stop', { stationId, error });
      return false;
    }
  }

  async getStationStats(stationId: number): Promise<any> {
    try {
      const stats = await db
        .select({
          totalSessions: count(),
          totalEnergyDelivered: sum(chargingSessions.energyDelivered),
          totalRevenue: sum(chargingSessions.totalCost),
          avgSessionTime: avg(chargingSessions.duration),
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'completed')
          )
        );

      const result = stats[0];
      return {
        totalSessions: Number(result.totalSessions) || 0,
        totalEnergyDelivered: Number(result.totalEnergyDelivered) || 0,
        totalRevenue: Number(result.totalRevenue) || 0,
        avgSessionTime: Number(result.avgSessionTime) || 0,
        activeSessionsCount: Array.from(this.activeSessions.values()).filter(
          s => s.stationId === stationId && s.status === 'active'
        ).length,
      };
    } catch (error) {
      logger.error('Failed to get station stats', { stationId, error });
      return null;
    }
  }

  getActiveSessions(): Map<string, ChargingSession> {
    return this.activeSessions;
  }
}

export const sessionService = new SessionService();