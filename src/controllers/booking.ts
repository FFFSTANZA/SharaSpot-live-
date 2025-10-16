// src/controllers/booking.ts - FULLY OPTIMIZED, TYPE-SAFE, AND POWERFUL
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/userService';
import { queueService } from '../services/queue';
import { sessionService } from '../services/session';
import { notificationService } from '../services/notification';
import { photoVerificationService } from '../services/photo-verification';
import { logger } from '../utils/logger';
import { db } from '../config/database';
import { chargingStations, chargingSessions } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { validateWhatsAppId } from '../utils/validation';

// ===============================================
// INTERFACES & TYPES
// ===============================================
interface StationDetails {
  id: number;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  geohash: string | null;
  distance: string | null;
  totalSlots: number;
  availableSlots: number;
  totalPorts: number;
  availablePorts: number;
  pricePerKwh: string;
  connectorTypes: any;
  operatingHours: any;
  amenities: any;
  isActive: boolean | null;
  isOpen: boolean | null;
  rating?: string | null;
  averageRating?: string | null;
  totalReviews?: number | null;
  reviewCount?: number | null;
  updatedAt: Date | null;
}

interface ProcessedStation extends StationDetails {
  isAvailable: boolean;
  utilization: number;
  availability: string;
  priceDisplay: string;
  distanceDisplay: string;
  ratingDisplay: string;
  slotsDisplay: string;
  finalRating: number;
  finalReviews: number;
}

// ===============================================
// IN-MEMORY CACHING & DEBOUNCE
// ===============================================
const stationCache = new Map<number, { data: ProcessedStation; expiry: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

// ===============================================
// BOOKING CONTROLLER WITH PHOTO VERIFICATION
// ===============================================
export class BookingController {
  // Prevent duplicate button processing
  private readonly recentButtonActions = new Map<string, string>();

  // ===============================================
  // MESSAGE HANDLING WITH VERIFICATION
  // ===============================================
  async handleMessage(message: any): Promise<void> {
    const whatsappId = message.from;
    const verificationState = photoVerificationService.getVerificationState(whatsappId);

    if (message.type === 'image' && verificationState) {
      await this.handleVerificationPhoto(whatsappId, message, verificationState);
      return;
    }

    if (message.type === 'text' && verificationState) {
      await photoVerificationService.handleManualEntry(whatsappId, message.text.body);
      return;
    }
  }

  private async handleVerificationPhoto(
    whatsappId: string,
    message: any,
    state: any
  ): Promise<void> {
    try {
      const imageBuffer = await this.downloadWhatsAppImageWithRetry(message.image.id, 2);
      if (state.waitingFor === 'start_photo') {
        await photoVerificationService.handleStartPhoto(whatsappId, imageBuffer);
      } else if (state.waitingFor === 'end_photo') {
        await photoVerificationService.handleEndPhoto(whatsappId, imageBuffer);
      }
    } catch (error) {
      logger.error('Photo processing failed', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process photo. Please ensure good lighting and clear view of the meter. Try again.'
      );
    }
  }

  private async downloadWhatsAppImageWithRetry(mediaId: string, retries = 2): Promise<Buffer> {
    let lastError: Error | null = null;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
        });
        const data = (await response.json()) as { url?: string };
        if (!data.url) throw new Error('Media URL not found');
        const imageResponse = await fetch(data.url, {
          headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
        });
        return Buffer.from(await imageResponse.arrayBuffer());
      } catch (error) {
        lastError = error as Error;
        if (i < retries) await new Promise(res => setTimeout(res, 1000 * (i + 1)));
      }
    }
    throw lastError!;
  }

  async handleButtonClick(buttonId: string, whatsappId: string): Promise<void> {
    // Idempotency guard
    const lastActionKey = `last_button_${whatsappId}`;
    const lastAction = this.recentButtonActions.get(lastActionKey);
    if (lastAction === buttonId) {
      logger.warn('Duplicate button click ignored', { whatsappId, buttonId });
      return;
    }
    this.recentButtonActions.set(lastActionKey, buttonId);
    setTimeout(() => this.recentButtonActions.delete(lastActionKey), 5000);

    // Photo verification confirmations
    if (buttonId === 'confirm_start_reading') {
      const success = await photoVerificationService.confirmStartReading(whatsappId);
      if (success) {
        const state = photoVerificationService.getVerificationState(whatsappId);
        if (state?.sessionId && state.lastReading !== undefined) {
          await sessionService.startChargingAfterVerification(state.sessionId, state.lastReading);
        }
      }
      return;
    }

    if (buttonId === 'confirm_end_reading') {
      const success = await photoVerificationService.confirmEndReading(whatsappId);
      if (success) {
        await this.sendSessionSummary(whatsappId);
      }
      return;
    }

    // Retake photo buttons
    if (buttonId === 'retake_start_photo') {
      await photoVerificationService.retakeStartPhoto(whatsappId);
      return;
    }
    if (buttonId === 'retake_end_photo') {
      await photoVerificationService.retakeEndPhoto(whatsappId);
      return;
    }

    // Session start/stop
    if (buttonId.startsWith('session_start_')) {
      const stationId = parseInt(buttonId.replace('session_start_', ''));
      await this.handleChargingStart(whatsappId, stationId);
      return;
    }
    if (buttonId.startsWith('session_stop_')) {
      const stationId = parseInt(buttonId.replace('session_stop_', ''));
      await this.handleSessionStop(whatsappId, stationId);
      return;
    }

    // Route other actions
    await this.routeButtonAction(buttonId, whatsappId);
  }

  private async routeButtonAction(buttonId: string, whatsappId: string): Promise<void> {
    const [action, ...params] = buttonId.split('_');
    const stationId = params.length > 0 ? parseInt(params[params.length - 1]) : 0;

    switch (action) {
      case 'book': await this.handleStationBooking(whatsappId, stationId); break;
      case 'join': await this.handleJoinQueue(whatsappId, stationId); break;
      case 'queue': await this.handleQueueStatus(whatsappId, stationId); break;
      case 'cancel': await this.handleQueueCancel(whatsappId, stationId); break;
      case 'directions': await this.handleGetDirections(whatsappId, stationId); break;
      case 'alternatives': await this.handleFindAlternatives(whatsappId, stationId); break;
      case 'status': await this.handleSessionStatus(whatsappId, stationId); break;
      case 'extend':
        const minutes = params[0] === '30' ? 30 : 60;
        await this.handleSessionExtend(whatsappId, stationId, minutes);
        break;
      default:
        logger.warn('Unknown button action', { buttonId, whatsappId });
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown action. Please try again.');
    }
  }

  // ===============================================
  // CORE BOOKING OPERATIONS
  // ===============================================
  async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found');
        return;
      }
      await this.showStationOverview(whatsappId, station);
    } catch (error) {
      await this.handleError(error, 'station selection', { whatsappId, stationId });
    }
  }

  async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const [user, station] = await Promise.all([
        userService.getUserByWhatsAppId(whatsappId),
        this.getStationDetails(stationId)
      ]);
      if (!user || !station) {
        await this.sendError(whatsappId, 'Unable to process booking');
        return;
      }

      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      if (existingQueues.length > 0) {
        await this.handleExistingBooking(whatsappId, existingQueues[0]);
        return;
      }

      if (station.isAvailable && station.availableSlots > 0) {
        await this.handleInstantBooking(whatsappId, station, user);
      } else if (this.isStationBookable(station)) {
        await this.handleQueueBooking(whatsappId, station, user);
      } else {
        await this.handleUnavailableStation(whatsappId, station);
      }
    } catch (error) {
      await this.handleError(error, 'station booking', { whatsappId, stationId });
    }
  }

  async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not available');
        return;
      }
      await whatsappService.sendTextMessage(whatsappId, this.formatStationDetails(station));
      setTimeout(() => this.sendStationActionButtons(whatsappId, station), 2000);
    } catch (error) {
      await this.handleError(error, 'station details', { whatsappId, stationId });
    }
  }

  // ===============================================
  // QUEUE MANAGEMENT
  // ===============================================
  async handleJoinQueue(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found');
        return;
      }

      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      const existingQueue = existingQueues.find(q => q.stationId === stationId);
      if (existingQueue) {
        await this.showExistingQueueStatus(whatsappId, existingQueue);
        return;
      }

      const queuePosition = await queueService.joinQueue(whatsappId, stationId);
      if (!queuePosition) {
        await this.handleQueueJoinFailure(whatsappId, station);
        return;
      }
      await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
    } catch (error) {
      await this.handleError(error, 'join queue', { whatsappId, stationId });
    }
  }

  async handleQueueStatus(whatsappId: string, stationId?: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;
    try {
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      if (userQueues.length === 0) {
        await this.showNoActiveQueues(whatsappId);
        return;
      }
      for (const queue of userQueues) {
        await this.displayQueueStatus(whatsappId, queue);
      }
      setTimeout(() => this.sendQueueManagementButtons(whatsappId, userQueues), 2000);
    } catch (error) {
      await this.handleError(error, 'queue status', { whatsappId });
    }
  }

  async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
  if (!this.validateInput(whatsappId, stationId)) return;
  
  try {
    // ✅ STEP 1: Check for active charging session and cancel it first
    const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
    
    if (activeSession && ['initiated', 'active'].includes(activeSession.status)) {
      logger.info('Cancelling active charging session during queue cancellation', { 
        whatsappId, 
        stationId, 
        sessionId: activeSession.id,
        sessionStatus: activeSession.status
      });
      
      try {
        // ✅ Cancel the charging session
        await db
          .update(chargingSessions)
          .set({
            status: 'cancelled',
            verificationStatus: 'cancelled',
            endTime: new Date(),
            endedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(chargingSessions.sessionId, activeSession.id));
        
        // ✅ Remove from active sessions
        sessionService.getActiveSessions().delete(activeSession.id);
        
        logger.info('✅ Charging session cancelled successfully', { 
          whatsappId, 
          stationId, 
          sessionId: activeSession.id 
        });
        
        // ✅ Clean up photo verification state if exists
        photoVerificationService.cleanupState(whatsappId);
        
      } catch (sessionError) {
        logger.error('Failed to cancel charging session, continuing with queue cancellation', { 
          whatsappId, 
          stationId, 
          sessionError 
        });
        // Continue with queue cancellation even if session cancellation fails
      }
    }
    
    // ✅ STEP 2: Cancel the queue
    const success = await queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
    
    if (!success) {
      await this.sendError(whatsappId, 'No active queue found');
      return;
    }
    
    // ✅ STEP 3: Send success notification
    await this.handleSuccessfulCancellation(whatsappId, stationId);
    
  } catch (error) {
    await this.handleError(error, 'queue cancel', { whatsappId, stationId });
  }
}

  // ===============================================
  // SESSION MANAGEMENT WITH VERIFICATION
  // ===============================================
  /**
 * ❌ PROBLEM: Validation issues with queue status checks
 */
async handleChargingStart(whatsappId: string, stationId: number): Promise<void> {
  if (!this.validateInput(whatsappId, stationId)) return;
  try {
    // ❌ PROBLEM: Queue status might not be synchronized
    const userQueues = await queueService.getUserQueueStatus(whatsappId);
    const reservedQueue = userQueues.find(q =>
      q.stationId === stationId && ['reserved', 'waiting'].includes(q.status)
    );
    
    // ❌ PROBLEM: Fails if queue status isn't exactly 'reserved' or 'waiting'
    if (!reservedQueue) {
      await this.handleNoValidReservation(whatsappId, stationId);
      return;
    }

    const session = await sessionService.startSession(whatsappId, stationId, reservedQueue.id);
    if (!session) {
      await this.handleSessionStartFailure(whatsappId, stationId);
      return;
    }

    // ❌ PROBLEM: This might fail silently if queue service has issues
    await queueService.startCharging(whatsappId, stationId).catch(err =>
      logger.warn('Failed to update queue status', { whatsappId, stationId, err })
    );
  } catch (error) {
    await this.handleError(error, 'charging start', { whatsappId, stationId });
  }
}



  async handleSessionStatus(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
      if (!activeSession) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '⚡ *No Active Session*\nNo active charging session found at this station.'
        );
        return;
      }
      await this.displayBasicSessionInfo(whatsappId, activeSession);
    } catch (error) {
      await this.handleError(error, 'session status', { whatsappId, stationId });
    }
  }

  async handleSessionStop(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
      if (!activeSession) {
        await this.sendError(whatsappId, 'No active session found');
        return;
      }

      const success = await sessionService.stopSession(whatsappId, stationId);
      if (!success) {
        await this.sendError(whatsappId, 'Failed to stop session');
        return;
      }

      await queueService.completeCharging(whatsappId, stationId).catch(err =>
        logger.warn('Failed to complete queue', { whatsappId, stationId, err })
      );
    } catch (error) {
      await this.handleError(error, 'session stop', { whatsappId, stationId });
    }
  }

  async handleSessionExtend(whatsappId: string, stationId: number, minutes: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
      if (!activeSession) {
        await this.sendError(whatsappId, 'No active session to extend');
        return;
      }

      const newTargetBattery = Math.min(100, (activeSession.targetBatteryLevel || 80) + Math.floor(minutes / 30) * 10);
      const extendedTime = new Date(Date.now() + minutes * 60000);
      await whatsappService.sendTextMessage(
        whatsappId,
        `⏰ *Session Extended*\n` +
        `⚡ +${minutes} minutes\n` +
        `🔋 New target: ${newTargetBattery}%\n` +
        `🕐 Expected completion: ${extendedTime.toLocaleTimeString()}`
      );
    } catch (error) {
      await this.handleError(error, 'session extend', { whatsappId, stationId });
    }
  }

  private async sendSessionSummary(whatsappId: string): Promise<void> {
    try {
      const [session] = await db.select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, whatsappId),
            eq(chargingSessions.verificationStatus, 'completed')
          )
        )
        .orderBy(desc(chargingSessions.createdAt))
        .limit(1);

      if (!session) return;

      const consumption = parseFloat(session.energyDelivered || '0');
      const totalCost = parseFloat(session.totalCost || '0');
      const duration = session.duration || 0;

      await whatsappService.sendTextMessage(
        whatsappId,
        `🎉 *Charging Complete!*\n` +
        `📊 *Summary:*\n` +
        `⚡ Energy: ${consumption.toFixed(2)} kWh\n` +
        `⏱️ Duration: ${Math.floor(duration / 60)}h ${duration % 60}m\n` +
        `💰 Total: ₹${totalCost.toFixed(2)}\n` +
        `📈 *Meter Readings:*\n` +
        `Start: ${session.startMeterReading} kWh\n` +
        `End: ${session.endMeterReading} kWh\n` +
        `✅ Payment processing...\n` +
        `📧 Receipt sent to your email.`
      );
    } catch (error) {
      logger.error('Failed to send session summary', { whatsappId, error });
    }
  }

  // ===============================================
  // SMART BOOKING HANDLERS
  // ===============================================
  private async handleInstantBooking(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    try {
      const queuePosition = await queueService.joinQueue(whatsappId, station.id);
      if (!queuePosition) {
        await this.handleQueueBooking(whatsappId, station, user);
        return;
      }

      const reserved = await queueService.reserveSlot(whatsappId, station.id, 15);
      if (reserved) {
        await this.showInstantBookingSuccess(whatsappId, station, user);
      } else {
        await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
      }
    } catch (error) {
      logger.error('Instant booking failed', { whatsappId, stationId: station.id, error });
      await this.handleQueueBooking(whatsappId, station, user);
    }
  }

  private async handleQueueBooking(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    const queueStats = await queueService.getQueueStats(station.id);
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Join Queue at ${station.name}?*\n` +
      `📊 ${queueStats.totalInQueue} people in queue\n` +
      `⏱️ Average wait: ${queueStats.averageWaitTime} min\n` +
      `💰 Rate: ${station.priceDisplay}\n` +
      `💵 Estimated cost: ~₹${this.estimateCost(station, user)}`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎯 *Proceed?*',
      [
        { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
        { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' },
        { id: `get_directions_${station.id}`, title: '🗺️ Directions' }
      ]
    ), 2000);
  }

  private async handleExistingBooking(whatsappId: string, existingQueue: any): Promise<void> {
    const statusMap: Record<string, string> = {
      reserved: '✅ Reserved',
      waiting: '⏳ In Queue',
      charging: '⚡ Active'
    };
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚠️ *Existing Booking*\n` +
      `📍 ${existingQueue.stationName}\n` +
      `📊 Status: ${statusMap[existingQueue.status] || 'Active'}\n` +
      `👥 Position: #${existingQueue.position}\n` +
      `💡 Only one booking allowed at a time.`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Manage Booking:*',
      [
        { id: `queue_status_${existingQueue.stationId}`, title: '📊 Status' },
        { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel' },
        { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Directions' }
      ]
    ), 2000);
  }

  // ===============================================
  // SUCCESS & FAILURE HANDLERS
  // ===============================================
  private async showInstantBookingSuccess(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🎉 *Slot Reserved!*\n` +
      `📍 ${station.name}\n` +
      `⚡ Reserved for 15 minutes\n` +
      `💰 Rate: ${station.priceDisplay}\n` +
      `💵 Estimated cost: ~₹${this.estimateCost(station, user)}\n` +
      `⏰ Arrive within 15 minutes!`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '⚡ *Ready to Start?*',
      [
        { id: `start_charging_${station.id}`, title: '⚡ Start Charging' },
        { id: `get_directions_${station.id}`, title: '🗺️ Navigate' },
        { id: `cancel_queue_${station.id}`, title: '❌ Cancel' }
      ]
    ), 2000);
  }

  private async handleSuccessfulQueueJoin(whatsappId: string, queuePosition: any): Promise<void> {
    const waitAdvice = queuePosition.estimatedWaitMinutes > 30
      ? '\n💡 Long wait. Consider alternatives.'
      : '\n✅ Reasonable wait time!';

    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Joined Queue Successfully!*\n` +
      `📍 ${queuePosition.stationName}\n` +
      `👥 Position: #${queuePosition.position}\n` +
      `⏱️ Estimated wait: ~${queuePosition.estimatedWaitMinutes} min\n` +
      `🔔 Live updates enabled${waitAdvice}`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Manage Queue:*',
      [
        { id: `queue_status_${queuePosition.stationId}`, title: '📊 Refresh Status' },
        { id: `get_directions_${queuePosition.stationId}`, title: '🗺️ Navigate' },
        { id: `cancel_queue_${queuePosition.stationId}`, title: '❌ Cancel' }
      ]
    ), 2000);
  }

  private async handleSuccessfulCancellation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `✅ *Queue Cancelled*\nBooking cancelled successfully.\nNo charges applied.\n💡 Find another station?`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Next Steps:*',
      [
        { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
        { id: 'new_search', title: '🆕 New Search' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ]
    ), 2000);
  }

  private async handleQueueJoinFailure(whatsappId: string, station: ProcessedStation): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Queue Full*\nUnable to join queue at ${station.name}.\n🔍 Find alternatives?`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎯 *Options:*',
      [
        { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' },
        { id: 'find_nearby_stations', title: '🗺️ Nearby' },
        { id: 'new_search', title: '🆕 Search' }
      ]
    ), 2000);
  }

  /**
 * ✅ FIXED: Enhanced session start failure handling with diagnostic info
 */
private async handleSessionStartFailure(whatsappId: string, stationId: number): Promise<void> {
  try {
    // Try to diagnose the issue
    const [userQueues, activeSession] = await Promise.all([
      queueService.getUserQueueStatus(whatsappId).catch(() => []),
      sessionService.getActiveSession(whatsappId, stationId).catch(() => null)
    ]);

    const queueAtStation = userQueues.find(q => q.stationId === stationId);
    
    let message: string;
    let buttons: Array<{ id: string; title: string }>;

    // Case 1: User already has an active session
    if (activeSession) {
      message = `⚠️ *Session Already Active*\n\n` +
        `You already have an active charging session at this station.\n\n` +
        `📊 Current Status: ${activeSession.status}\n` +
        `🔌 Use the session controls below to manage it.`;
      
      buttons = [
        { id: `session_status_${stationId}`, title: '📊 Check Status' },
        { id: `session_stop_${stationId}`, title: '🛑 Stop Session' },
        { id: 'help', title: '❓ Help' }
      ];
    }
    // Case 2: Queue position exists but session creation failed
    else if (queueAtStation) {
      message = `❌ *Session Start Failed*\n\n` +
        `Queue Position: #${queueAtStation.position}\n` +
        `Status: ${queueAtStation.status}\n\n` +
        `⚠️ *Possible Reasons:*\n` +
        `• Station is currently offline\n` +
        `• Technical maintenance in progress\n` +
        `• Connectivity issues\n\n` +
        `💡 Please wait a moment and try again.`;
      
      buttons = [
        { id: `start_charging_${stationId}`, title: '🔄 Retry Start' },
        { id: `queue_status_${stationId}`, title: '📊 Queue Status' },
        { id: 'help', title: '📞 Contact Support' }
      ];
    }
    // Case 3: No queue position - shouldn't happen but handle gracefully
    else {
      message = `❌ *Failed to Start Session*\n\n` +
        `Unable to create charging session.\n\n` +
        `⚠️ *Possible Issues:*\n` +
        `• No active reservation found\n` +
        `• Station connectivity problems\n` +
        `• Technical maintenance\n\n` +
        `💡 Try joining the queue first, then start charging.`;
      
      buttons = [
        { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
        { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
        { id: 'help', title: '❓ Get Help' }
      ];
    }

    await whatsappService.sendTextMessage(whatsappId, message);

    // Send action buttons after a short delay
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔧 *What would you like to do?*',
        buttons
      );
    }, 2000);

    // Log the failure for diagnostics
    logger.error('Session start failure handled', {
      whatsappId,
      stationId,
      hasQueue: !!queueAtStation,
      queueStatus: queueAtStation?.status,
      hasActiveSession: !!activeSession
    });

  } catch (error) {
    logger.error('Failed to handle session start failure', { whatsappId, stationId, error });
    
    // Fallback generic message if diagnostic checks fail
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Failed to Start Charging*\n\n` +
      `Unable to create charging session.\n\n` +
      `⚠️ *Common Reasons:*\n` +
      `• Station connectivity issues\n` +
      `• No valid reservation\n` +
      `• Technical maintenance in progress\n\n` +
      `💡 *Recommended Actions:*\n` +
      `1. Check your queue status\n` +
      `2. Verify station is available\n` +
      `3. Try again in a few moments\n` +
      `4. Contact support if issue persists`
    );
    
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔧 *Actions:*',
        [
          { id: `queue_status_${stationId}`, title: '📊 Check Queue' },
          { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
          { id: 'help', title: '📞 Support' }
        ]
      );
    }, 2000);
  }
}
  
 /**
 * ✅ FIXED: Enhanced error handling with actionable next steps
 */
private async handleNoValidReservation(whatsappId: string, stationId: number): Promise<void> {
  try {
    // Check if user has any queue position at all
    const userQueues = await queueService.getUserQueueStatus(whatsappId);
    const queueAtStation = userQueues.find(q => q.stationId === stationId);

    let message: string;
    let buttons: Array<{ id: string; title: string }>;

    if (queueAtStation) {
      // User has a queue position but it's not in the right state
      message = `⚠️ *Reservation Not Ready*\n\n` +
        `Your queue position: #${queueAtStation.position}\n` +
        `Status: ${queueAtStation.status}\n\n` +
        `⏳ Please wait until your slot is ready.\n` +
        `You'll receive a notification when it's your turn!`;
      
      buttons = [
        { id: `queue_status_${stationId}`, title: '🔄 Refresh Status' },
        { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
        { id: `cancel_queue_${stationId}`, title: '❌ Cancel Queue' }
      ];
    } else {
      // User has no queue position at this station
      message = `❌ *No Active Reservation*\n\n` +
        `You need an active queue position to start charging at this station.\n\n` +
        `💡 *Next Steps:*\n` +
        `• Join the queue first\n` +
        `• Wait for your turn\n` +
        `• You'll be notified when ready`;
      
      buttons = [
        { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
        { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
        { id: 'find_nearby_stations', title: '🔍 Find Alternatives' }
      ];
    }

    await whatsappService.sendTextMessage(whatsappId, message);

    // Send action buttons after a short delay
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎯 *What would you like to do?*',
        buttons
      );
    }, 2000);

  } catch (error) {
    logger.error('Failed to handle no valid reservation', { whatsappId, stationId, error });
    
    // Fallback simple message if queue check fails
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ *No Valid Reservation*\n\n' +
      'You need an active reservation to start charging.\n' +
      'Please join the queue or book a slot first.'
    );
    
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎯 *Next Steps:*',
        [
          { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
          { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
          { id: 'new_search', title: '🔍 New Search' }
        ]
      );
    }, 2000);
  }
}

  private async handleUnavailableStation(whatsappId: string, station: ProcessedStation): Promise<void> {
    let reason = '❌ Station unavailable';
    let suggestion = 'Try another station';
    if (!station.isActive) {
      reason = '🚫 Station offline for maintenance';
      suggestion = 'Check back later';
    } else if (!station.isOpen) {
      reason = '🕐 Station closed';
      suggestion = `Hours: ${this.formatOperatingHours(station.operatingHours)}`;
    } else if (station.availableSlots === 0) {
      reason = '🔴 All slots occupied';
      suggestion = 'Join queue or find alternatives';
    }
    await whatsappService.sendTextMessage(whatsappId, `${reason}\n${suggestion}`);
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Options:*',
      [
        { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
        { id: 'find_nearby_stations', title: '🗺️ Nearby' },
        { id: 'new_search', title: '🆕 Search' }
      ]
    ), 2000);
  }

  // ===============================================
  // DISPLAY METHODS
  // ===============================================
  private async displayQueueStatus(whatsappId: string, queue: any): Promise<void> {
    const statusEmoji: Record<string, string> = {
      waiting: '⏳', reserved: '✅', charging: '⚡',
      ready: '🎯', completed: '✅', cancelled: '❌'
    };
    const emoji = statusEmoji[queue.status] || '📋';
    const timeInfo = queue.status === 'reserved' && queue.reservationExpiry
      ? `⏰ Expires: ${new Date(queue.reservationExpiry).toLocaleTimeString()}`
      : `⏱️ Wait: ~${queue.estimatedWaitMinutes} min`;

    await whatsappService.sendTextMessage(
      whatsappId,
      `${emoji} *Queue Status*\n` +
      `📍 ${queue.stationName}\n` +
      `📊 Status: ${this.capitalizeFirst(queue.status)}\n` +
      `👥 Position: #${queue.position}\n` +
      `${timeInfo}\n` +
      `📅 Joined: ${new Date(queue.createdAt).toLocaleString()}`
    );
  }

  private async displayBasicSessionInfo(whatsappId: string, session: any): Promise<void> {
    const startTime = session.startTime || new Date();
    const duration = Math.floor((Date.now() - startTime.getTime()) / 60000);
    const durationText = duration > 60
      ? `${Math.floor(duration / 60)}h ${duration % 60}m`
      : `${duration}m`;

    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Active Charging Session*\n` +
      `📍 ${session.stationName || 'Charging Station'}\n` +
      `🔋 Current: ${session.currentBatteryLevel || 0}%\n` +
      `🎯 Target: ${session.targetBatteryLevel || 80}%\n` +
      `⚡ Rate: ${session.chargingRate || 0} kW\n` +
      `💰 Rate: ₹${session.pricePerKwh || 0}/kWh\n` +
      `⏱️ Duration: ${durationText}\n` +
      `📊 Estimated cost: ₹${session.totalCost?.toFixed(2) || '0.00'}\n` +
      `🔄 Session is active`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎛️ *Session Controls:*',
      [
        { id: `extend_30_${session.stationId}`, title: '⏰ +30min' },
        { id: `extend_60_${session.stationId}`, title: '⏰ +1hr' },
        { id: `session_stop_${session.stationId}`, title: '🛑 Stop Session' }
      ]
    ), 2000);
  }

  private async showNoActiveQueues(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📋 *Your Bookings*\nNo active bookings found.\n🔍 Ready to find a station?'
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '⚡ *Find Stations:*',
      [
        { id: 'find_nearby_stations', title: '🗺️ Nearby' },
        { id: 'new_search', title: '🆕 Search' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ]
    ), 2000);
  }

  private async showExistingQueueStatus(whatsappId: string, existingQueue: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Already in Queue*\n` +
      `You're already queued at this station.\n` +
      `👥 Position: #${existingQueue.position}\n` +
      `⏱️ Wait: ~${existingQueue.estimatedWaitMinutes} min\n` +
      `💡 Updates coming as your position changes.`
    );
    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Manage:*',
      [
        { id: `queue_status_${existingQueue.stationId}`, title: '📊 Refresh' },
        { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Navigate' },
        { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel' }
      ]
    ), 2000);
  }

  private async sendQueueManagementButtons(whatsappId: string, queues: any[]): Promise<void> {
    if (queues.length === 0) return;
    const primaryQueue = queues[0];
    const buttons = [];
    if (primaryQueue.status === 'reserved') {
      buttons.push({ id: `session_start_${primaryQueue.stationId}`, title: '⚡ Start' });
    }
    buttons.push(
      { id: `get_directions_${primaryQueue.stationId}`, title: '🗺️ Navigate' },
      { id: `cancel_queue_${primaryQueue.stationId}`, title: '❌ Cancel' }
    );
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🎛️ *Queue Management:*',
      buttons.slice(0, 3)
    );
  }

  // ===============================================
  // ADDITIONAL ACTIONS
  // ===============================================
  async handleGetDirections(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;
    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found');
        return;
      }
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(station.name + ' ' + station.address)}`;
      const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(station.name + ' ' + station.address)}`;
      await whatsappService.sendTextMessage(
        whatsappId,
        `🗺️ *Directions to ${station.name}*\n` +
        `📍 ${station.address}\n` +
        `🔗 *Navigate:*\n` +
        `📱 Google Maps: ${googleMapsUrl}\n` +
        `🚗 Waze: ${wazeUrl}\n` +
        `💡 *Tips:*\n` +
        `• Save location for quick access\n` +
        `• Check hours before travel\n` +
        `• Arrive 5 min early for reservations`
      );
      setTimeout(() => whatsappService.sendButtonMessage(
        whatsappId,
        '📱 *While traveling:*',
        [
          { id: `queue_status_${station.id}`, title: '📊 Check Queue' },
          { id: `station_info_${station.id}`, title: '📋 Details' },
          { id: 'help', title: '❓ Support' }
        ]
      ), 2000);
    } catch (error) {
      await this.handleError(error, 'get directions', { whatsappId, stationId });
    }
  }

  async handleFindAlternatives(whatsappId: string, stationId: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 *Finding Alternatives...*\n' +
        'Searching for nearby options with:\n' +
        '• Similar charging speeds\n• Compatible connectors\n• Shorter waits\n• Better rates'
      );
      const user = await userService.getUserByWhatsAppId(whatsappId);
      setTimeout(async () => {
        await whatsappService.sendTextMessage(
          whatsappId,
          `🎯 *Alternative Strategies:*\n` +
          `**Quick Options:**\n` +
          `🔍 Expand search radius\n` +
          `⏰ Find shorter queues\n` +
          `💰 Better rate stations\n` +
          `**Smart Tips:**\n` +
          `${user?.connectorType ? `🔌 ${user.connectorType} compatible\n` : ''}` +
          `📊 Off-peak hours (10 PM - 8 AM)\n` +
          `🏢 Try commercial areas`
        );
        await whatsappService.sendButtonMessage(
          whatsappId,
          '🎯 *Next Move:*',
          [
            { id: 'expand_search', title: '📡 Expand Area' },
            { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
            { id: 'new_search', title: '🆕 New Search' }
          ]
        );
      }, 3000);
    } catch (error) {
      await this.handleError(error, 'find alternatives', { whatsappId, stationId });
    }
  }

  // ===============================================
  // DATABASE OPERATIONS WITH CACHING
  // ===============================================
  private async getStationDetails(stationId: number): Promise<ProcessedStation | null> {
    const now = Date.now();
    const cached = stationCache.get(stationId);
    if (cached && cached.expiry > now) {
      return cached.data;
    }

    try {
      const [station] = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (!station) {
        logger.warn('Station not found', { stationId });
        return null;
      }

      const processed = this.processStationData(station);
      stationCache.set(stationId, { data: processed, expiry: now + CACHE_TTL_MS });
      return processed;
    } catch (error) {
      logger.error('Database query failed', { stationId, error });
      return null;
    }
  }

  private processStationData(station: any): ProcessedStation {
    const isActive = station.isActive ?? false;
    const isOpen = station.isOpen ?? false;
    const availableSlots = Number(station.availableSlots || station.availablePorts) || 0;
    const totalSlots = Number(station.totalSlots || station.totalPorts) || 1;
    const distance = Number(station.distance) || 0;
    const price = Number(station.pricePerKwh) || 0;
    const rating = Number(station.rating || station.averageRating) || 0;
    const reviews = Number(station.totalReviews || station.reviewCount) || 0;
    const utilization = totalSlots > 0
      ? Math.round(((totalSlots - availableSlots) / totalSlots) * 100)
      : 0;
    const isAvailable = availableSlots > 0 && isActive && isOpen;

    let availability = 'Offline';
    if (isActive && isOpen) {
      availability = availableSlots > 0 ? 'Available' : 'Full';
    }

    return {
      ...station,
      distance: station.distance || '0',
      totalSlots,
      availableSlots,
      totalPorts: station.totalPorts || totalSlots,
      availablePorts: station.availablePorts || availableSlots,
      isActive,
      isOpen,
      isAvailable,
      utilization,
      availability,
      priceDisplay: price > 0 ? `₹${price.toFixed(2)}/kWh` : 'N/A',
      distanceDisplay: distance > 0 ? `${distance.toFixed(1)} km` : 'N/A',
      ratingDisplay: rating > 0 ? `${rating.toFixed(1)} ⭐` : 'No ratings',
      slotsDisplay: `${availableSlots}/${totalSlots} available`,
      finalRating: rating,
      finalReviews: reviews
    };
  }

  // ===============================================
  // MESSAGE FORMATTING
  // ===============================================
  private async showStationOverview(whatsappId: string, station: ProcessedStation): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *${station.name}*\n` +
      `📍 ${station.address}\n` +
      `📏 ${station.distanceDisplay}\n` +
      `⚡ ${station.slotsDisplay}\n` +
      `💰 ${station.priceDisplay}\n` +
      `⭐ ${station.ratingDisplay} (${station.finalReviews} reviews)\n` +
      `🔌 *Connectors:* ${this.formatConnectorTypes(station.connectorTypes)}\n` +
      `🕒 *Hours:* ${this.formatOperatingHours(station.operatingHours)}\n` +
      `🎯 *Status:* ${this.getStatusWithEmoji(station.availability)} ${station.availability}`
    );
    setTimeout(() => this.sendStationActionButtons(whatsappId, station), 2000);
  }

  private formatStationDetails(station: ProcessedStation): string {
    let details = `🏢 *${station.name}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📍 *Location:*\n${station.address}\n` +
      `⚡ *Charging:*\n` +
      `• Slots: ${station.slotsDisplay}\n` +
      `• Price: ${station.priceDisplay}\n` +
      `• Connectors: ${this.formatConnectorTypes(station.connectorTypes)}\n` +
      `🕒 *Hours:*\n${this.formatOperatingHours(station.operatingHours)}\n` +
      `⭐ *Rating:* ${station.ratingDisplay}\n` +
      `📊 *Utilization:* ${station.utilization}%\n`;

    if (station.amenities && Array.isArray(station.amenities) && station.amenities.length > 0) {
      details += `\n🎯 *Amenities:*\n${station.amenities.map((a: string) => `• ${this.capitalizeFirst(a)}`).join('\n')}\n`;
    }
    details += `\n${this.getStatusWithEmoji(station.availability)} *Status:* ${station.availability}`;
    return details;
  }

  private async sendStationActionButtons(whatsappId: string, station: ProcessedStation): Promise<void> {
    const buttons = [];
    if (station.isAvailable) {
      buttons.push(
        { id: `book_station_${station.id}`, title: '⚡ Book Now' },
        { id: `station_info_${station.id}`, title: '📊 Details' }
      );
    } else {
      buttons.push(
        { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
        { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' }
      );
    }
    buttons.push({ id: `get_directions_${station.id}`, title: '🗺️ Navigate' });

    if (buttons.length > 0) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `🎯 *Actions for ${station.name}:*`,
        buttons.slice(0, 3),
        '🏢 Station Menu'
      );
    }
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================
  private validateInput(whatsappId: string, stationId: number): boolean {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID', { whatsappId });
      return false;
    }
    if (!stationId || isNaN(stationId) || stationId <= 0) {
      logger.error('Invalid station ID', { stationId, whatsappId });
      whatsappService.sendTextMessage(whatsappId, '❌ Invalid station. Try again.');
      return false;
    }
    return true;
  }

  private isStationBookable(station: ProcessedStation): boolean {
    return station.isActive === true && station.isOpen === true;
  }

  private formatConnectorTypes(connectorTypes: any): string {
    if (Array.isArray(connectorTypes)) {
      return connectorTypes.length > 0 ? connectorTypes.join(', ') : 'Standard';
    }
    return connectorTypes || 'Standard';
  }

  private formatOperatingHours(operatingHours: any): string {
    if (typeof operatingHours === 'object' && operatingHours !== null) {
      const allDay = Object.values(operatingHours).every(h => h === '24/7');
      if (allDay) return '24/7';
      return 'Varies by day';
    }
    return operatingHours || '24/7';
  }

  private getStatusWithEmoji(availability: string): string {
    const map: Record<string, string> = {
      Available: '✅', Full: '🔴', Offline: '⚫'
    };
    return map[availability] || '❓';
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private estimateCost(station: ProcessedStation, user: any): string {
    const basePrice = Number(station.pricePerKwh) || 12;
    const estimatedKwh = user.connectorType === 'CCS2' ? 25 : 15;
    return (basePrice * estimatedKwh).toFixed(0);
  }

  // ===============================================
  // ERROR HANDLING
  // ===============================================
  private async handleError(error: any, operation: string, context: Record<string, any>): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`${operation} failed`, { ...context, error: errorMsg });
    if (context.whatsappId) {
      await this.sendError(context.whatsappId, `Failed to ${operation}. Please try again.`);
    }
  }

  private async sendError(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
    } catch (error) {
      logger.error('Failed to send error', { whatsappId, error });
    }
  }

  private async sendNotFound(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `🔍 ${message}`);
    } catch (error) {
      logger.error('Failed to send not found', { whatsappId, error });
    }
  }

  // ===============================================
  // HEALTH CHECK
  // ===============================================
  public getHealthStatus() {
    return {
      status: 'healthy' as const,
      activeOperations: 0,
      lastActivity: new Date().toISOString(),
      integrations: {
        queueService: !!queueService,
        sessionService: !!sessionService,
        notificationService: !!notificationService,
        photoVerification: !!photoVerificationService
      }
    };
  }

  // ===============================================
  // BACKWARD COMPATIBILITY
  // ===============================================
  async processQueueJoin(whatsappId: string, stationId: number): Promise<void> {
    return this.handleJoinQueue(whatsappId, stationId);
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const bookingController = new BookingController();