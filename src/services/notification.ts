
import { whatsappService } from './whatsapp';
import { userService } from './userService';
import { logger } from '../utils/logger';
import { chargingStations } from '../db/schema';
import { db } from '../db/connection';
import { eq } from 'drizzle-orm';

interface NotificationSchedule {
  userWhatsapp: string;
  stationId: number;
  type: 'reservation_expiry' | 'queue_reminder' | 'maintenance_alert';
  scheduledTime: Date;
  message?: string;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // Rounded to 1 decimal
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

class NotificationService {
  private scheduledNotifications = new Map<string, NodeJS.Timeout>();
  
  /**
   * Send queue joined notification with rich content
   */
  async sendQueueJoinedNotification(userWhatsapp: string, queuePosition: any): Promise<void> {
    try {
      const station = await this.getStationDetails(queuePosition.stationId);
      const message = this.formatQueueJoinedMessage(queuePosition, station);
      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendListMessage(
          userWhatsapp,
          '⚡ *Queue Management Options*',
          'Choose an action for your booking:',
          [
            {
              title: '📊 Queue Status',
              rows: [
                { id: `queue_status_${queuePosition.stationId}`, title: '📍 My Position', description: 'Check current queue status' },
                { id: `queue_estimate_${queuePosition.stationId}`, title: '⏱️ Time Estimate', description: 'Get updated wait time' },
                { id: `queue_analytics_${queuePosition.stationId}`, title: '📈 Queue Analytics', description: 'View station insights' }
              ]
            },
            {
              title: '🔧 Queue Actions',
              rows: [
                { id: `queue_remind_${queuePosition.stationId}`, title: '🔔 Reminder', description: 'Get notified 10 min before' },
                { id: `queue_cancel_${queuePosition.stationId}`, title: '❌ Leave Queue', description: 'Cancel your booking' },
                { id: `queue_share_${queuePosition.stationId}`, title: '📤 Share Status', description: 'Share with someone' }
              ]
            }
          ]
        );
      }, 2000);
    } catch (error) {
      logger.error('Failed to send queue joined notification', { userWhatsapp, error });
    }
  }

  


async sendReservationConfirmation(userWhatsapp: string, stationId: number, reservationMinutes: number): Promise<void> {
  try {
    const station = await this.getStationDetails(stationId);
    const expiryTime = new Date(Date.now() + reservationMinutes * 60 * 1000);

    const message = `🎉 *SLOT RESERVED!*\n\n` +
      `📍 *${station?.name || 'Charging Station'}*\n` +
      `📍 ${station?.address || 'Loading address...'}\n\n` +
      `⏰ *Reservation Expires:* ${expiryTime.toLocaleTimeString()}\n` +
      `⏳ *You have ${reservationMinutes} minutes* to arrive\n\n` +
      `🚗 *Next Steps:*\n` +
      `• Navigate to the station now\n` +
      `• Scan QR code or tap "Start Charging"\n` +
      `• Your charging slot is secured!\n\n` +
      `💡 *Pro Tip:* Enable location sharing for real-time navigation assistance`;

    await whatsappService.sendTextMessage(userWhatsapp, message);

    if (station?.latitude && station?.longitude) {
      setTimeout(async () => {
        await whatsappService.sendLocationMessage(
          userWhatsapp,
          station.latitude,
          station.longitude,
          `${station.name} - Your Reserved Slot`,
          station.address || ''
        );
      }, 1000);
    }

    
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        userWhatsapp,
        `🚀 *Ready to charge?*\n\nArrive at the station and select an option:`,
        [
          { id: `start_charging_${stationId}`, title: '⚡ Start Charging' },
          { id: `extend_reservation_${stationId}`, title: '⏰ Extend Time' },
          { id: `cancel_reservation_${stationId}`, title: '❌ Cancel' }
        ]
      );
    }, 1000);  // ← CHANGED FROM 3000 TO 1000
  } catch (error) {
    logger.error('Failed to send reservation confirmation', { userWhatsapp, stationId, error });
  }
}

  /**
   * OPTIMIZED: Simplified charging started notification
   * Called AFTER start photo verification completes
   */
  /** */
async sendChargingStartedNotification(userWhatsapp: string, session: any): Promise<void> {
  try {
    const station = await this.getStationDetails(session.stationId);
    const pricePerKwh = station?.pricePerKwh || session.pricePerKwh || '12.5';
    const startReading = session.startMeterReading || 0;

    const message = `⚡ *CHARGING ACTIVE*\n\n` +
      `📍 *${station?.name || 'Charging Station'}*\n` +
      `✅ Session started successfully\n\n` +
      `📊 *Initial Reading:* ${startReading} kWh\n` +
      `💰 *Rate:* ₹${pricePerKwh}/kWh\n` +
      `🔌 *Connector:* ${session.connectorType || 'Standard'}\n\n` +
      `🛑 *To stop:* Use /stop command or button below`;

    await whatsappService.sendTextMessage(userWhatsapp, message);

    
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        userWhatsapp,
        '🎛️ *Session Control:*',
        [
          { id: `session_status_${session.stationId}`, title: '📊 Check Status' },
          { id: `session_stop_${session.stationId}`, title: '🛑 Stop Charging' }
        ]
      );
    }, 2000);
  } catch (error) {
    logger.error('Failed to send charging started notification', { userWhatsapp, session, error });
  }
}

  /**
   * OPTIMIZED: Complete charging notification with verified meter readings
   * Called AFTER end photo verification completes
   */
  /**
 * OPTIMIZED: Complete charging notification with verified meter readings
 * Called AFTER end photo verification completes
 */
async sendChargingCompletedNotification(
  userWhatsapp: string, 
  session: any,
  summary?: any
): Promise<void> {
  try {
    
    const stationName = session?.stationName || 'Charging Station';
    const duration = summary?.duration || 'N/A';
    const energyDelivered = summary?.energyDelivered || session?.energyDelivered || 0;
    const totalCost = summary?.totalCost || session?.totalCost || 0;
    const startReading = session?.startMeterReading || 0;
    const endReading = session?.endMeterReading || 0;

    const message = `✅ *CHARGING COMPLETE!*\n\n` +
      `📍 *${stationName}*\n` +
      `⏱️ *Duration:* ${duration}\n` +
      `⚡ *Energy Delivered:* ${energyDelivered} kWh\n` +
      `💰 *Total Cost:* ₹${totalCost}\n\n` +
      `📊 *Meter Readings:*\n` +
      `• Start: ${startReading} kWh\n` +
      `• End: ${endReading} kWh\n\n` +
      `🎯 *Thank you for using SharaSpot!*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);

    
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        userWhatsapp,
        '📊 *What\'s Next?*',
        [
          { id: `rate_session_5_${session.stationId}`, title: '⭐ Rate 5 Stars' },
          { id: 'find_nearby_stations', title: '🔍 Find Stations' },
          { id: 'view_session_history', title: '📜 View History' }
        ]
      );
    }, 2000);

  } catch (error) {
    logger.error('Failed to send charging completed notification', { 
      userWhatsapp, 
      session, 
      summary,
      error: error instanceof Error ? error.message : String(error)
    });
    
  }
}

  async sendQueueLeftNotification(userWhatsapp: string, stationId: number, reason: string): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      let message = '';

      switch (reason) {
        case 'user_cancelled':
          message = `✅ *BOOKING CANCELLED*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `🕐 *Cancelled:* ${new Date().toLocaleTimeString()}\n\n` +
            `Your queue position has been released.\n` +
            `Other users have been automatically promoted.\n\n` +
            `💡 *Need another station?* Let's find you alternatives!`;
          break;
        case 'expired':
          message = `⏰ *RESERVATION EXPIRED*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `🕐 *Expired:* ${new Date().toLocaleTimeString()}\n\n` +
            `Your 15-minute reservation window has ended.\n` +
            `The slot has been released to the next user.\n\n` +
            `🔄 *Want to try again?* You can rejoin the queue!`;
          break;
        default:
          message = `📝 *QUEUE STATUS UPDATED*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `Your booking status has been updated.\n\n` +
            `💡 *Looking for alternatives?* We can help!`;
      }

      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '🔍 *What would you like to do next?*',
          [
            { id: `rejoin_queue_${stationId}`, title: '🔄 Rejoin Queue' },
            { id: 'find_alternatives', title: '🗺️ Find Alternatives' },
            { id: 'schedule_later', title: '⏰ Schedule Later' }
          ]
        );
      }, 2000);
    } catch (error) {
      logger.error('Failed to send queue left notification', { userWhatsapp, stationId, reason, error });
    }
  }

  async sendQueueProgressNotification(userWhatsapp: string, stationId: number, position: number, waitTime: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const expectedTime = new Date(Date.now() + waitTime * 60 * 1000).toLocaleTimeString();
      let emoji = '📈';
      let message = '';

      if (position === 1) {
        emoji = '🎯';
        message = `${emoji} *YOU'RE NEXT!*\n\n` +
          `📍 *${station?.name || 'Charging Station'}*\n` +
          `🏆 *Position:* #${position} (FIRST!)\n` +
          `⏱️ *Expected:* ${expectedTime}\n\n` +
          `🚀 *Get ready!* Your slot will be reserved automatically.\n` +
          `Start heading to the station now!`;
      } else if (position === 2) {
        emoji = '🔥';
        message = `${emoji} *ALMOST THERE!*\n\n` +
          `📍 *${station?.name || 'Charging Station'}*\n` +
          `🎯 *Position:* #${position}\n` +
          `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
          `🕐 *Expected:* ${expectedTime}\n\n` +
          `🎉 *You're next in line!* Stay nearby for quick notifications.`;
      } else {
        message = `${emoji} *QUEUE PROGRESS UPDATE*\n\n` +
          `📍 *${station?.name || 'Charging Station'}*\n` +
          `📍 *Your Position:* #${position}\n` +
          `⏱️ *Updated Wait:* ${waitTime} minutes\n` +
          `🕐 *Expected:* ${expectedTime}\n\n` +
          `🚶‍♂️ *Queue is moving!* ${this.getProgressTip(position, waitTime)}`;
      }

      await whatsappService.sendTextMessage(userWhatsapp, message);

      if (position <= 3) {
        setTimeout(async () => {
          await whatsappService.sendButtonMessage(
            userWhatsapp,
            position === 1 ? '🎯 *Your turn is coming!*' : '📊 *Manage your booking:*',
            [
              { id: `live_status_${stationId}`, title: '📡 Live Status' },
              { id: `share_position_${stationId}`, title: '📤 Share Position' },
              { id: `cancel_booking_${stationId}`, title: '❌ Cancel' }
            ]
          );
        }, 1500);
      }
    } catch (error) {
      logger.error('Failed to send queue progress notification', { userWhatsapp, stationId, position, waitTime, error });
    }
  }

  
  
  

  async scheduleReservationExpiry(userWhatsapp: string, stationId: number, expiryTime: Date): Promise<void> {
    try {
      const notificationKey = `expiry_${userWhatsapp}_${stationId}`;
      const existing = this.scheduledNotifications.get(notificationKey);
      if (existing) clearTimeout(existing);

      const warningTime = new Date(expiryTime.getTime() - 5 * 60 * 1000);
      const warningDelay = warningTime.getTime() - Date.now();
      if (warningDelay > 0) {
        const warningTimeout = setTimeout(async () => {
          await this.sendReservationWarning(userWhatsapp, stationId, 5);
        }, warningDelay);
        this.scheduledNotifications.set(`warning_${notificationKey}`, warningTimeout);
      }

      const expiryDelay = expiryTime.getTime() - Date.now();
      if (expiryDelay > 0) {
        const expiryTimeout = setTimeout(async () => {
          await this.sendReservationExpired(userWhatsapp, stationId);
          this.scheduledNotifications.delete(notificationKey);
        }, expiryDelay);
        this.scheduledNotifications.set(notificationKey, expiryTimeout);
      }

      logger.info('Reservation expiry notifications scheduled', { userWhatsapp, stationId, expiryTime });
    } catch (error) {
      logger.error('Failed to schedule reservation expiry', { userWhatsapp, stationId, expiryTime, error });
    }
  }

  private async sendReservationWarning(userWhatsapp: string, stationId: number, minutesLeft: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const message = `⚠️ *RESERVATION EXPIRING SOON!*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `⏰ *${minutesLeft} minutes left* to arrive\n\n` +
        `🚗 *Please hurry!* Your reserved slot will be released if you don't arrive in time.\n\n` +
        `📍 *Need directions?* Tap below for navigation.`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '⚡ *Quick Actions:*',
          [
            { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
            { id: `extend_time_${stationId}`, title: '⏰ Extend Time' },
            { id: `cancel_urgent_${stationId}`, title: '❌ Cancel Now' }
          ]
        );
      }, 1000);

      if (station?.latitude && station?.longitude) {
        setTimeout(async () => {
          await whatsappService.sendLocationMessage(
            userWhatsapp,
            station.latitude,
            station.longitude,
            `🚨 ${station.name} - HURRY! ${minutesLeft} min left`,
            'Your reserved charging slot'
          );
        }, 2000);
      }
    } catch (error) {
      logger.error('Failed to send reservation warning', { userWhatsapp, stationId, minutesLeft, error });
    }
  }

  private async sendReservationExpired(userWhatsapp: string, stationId: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const message = `💔 *RESERVATION EXPIRED*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `🕐 *Expired:* ${new Date().toLocaleTimeString()}\n\n` +
        `⏰ *Time's up!* Your 15-minute reservation window has ended.\n` +
        `The charging slot has been automatically released.\n\n` +
        `🔄 *Don't worry!* You can rejoin the queue or find alternatives.`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '🔄 *What would you like to do?*',
          [
            { id: `rejoin_queue_${stationId}`, title: '🔄 Rejoin Queue' },
            { id: 'find_nearby_alternatives', title: '🗺️ Find Nearby' },
            { id: 'schedule_for_later', title: '⏰ Schedule Later' }
          ]
        );
      }, 2000);
    } catch (error) {
      logger.error('Failed to send reservation expired notification', { userWhatsapp, stationId, error });
    }
  }

  
  
  

  async notifyStationOwner(stationId: number, eventType: string, data: any): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const ownerWhatsapp = station?.ownerWhatsappId;
      if (!ownerWhatsapp) {
        logger.warn('No owner WhatsApp ID found for station', { stationId });
        return;
      }

      let message = '';
      switch (eventType) {
        case 'queue_joined':
          message = `📈 *New Customer*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer joined queue\n` +
            `📍 Position: #${data.position}\n` +
            `🕐 ${new Date().toLocaleTimeString()}`;
          break;
        case 'queue_left':
          message = `📉 *Customer Left*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer left queue\n` +
            `📍 Was position: #${data.position}\n` +
            `📝 Reason: ${data.reason}`;
          break;
        case 'slot_reserved':
          message = `🎯 *Slot Reserved*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer reserved slot\n` +
            `⏰ Expires: ${data.expiryTime.toLocaleTimeString()}`;
          break;
        case 'charging_started':
          message = `⚡ *Charging Started*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer started charging\n` +
            `🕐 ${new Date().toLocaleTimeString()}`;
          break;
        case 'charging_completed':
          message = `✅ *Session Complete*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer completed charging\n` +
            `🕐 ${new Date().toLocaleTimeString()}`;
          break;
      }

      if (message) {
        await whatsappService.sendTextMessage(ownerWhatsapp, message);
        logger.info('Station owner notified', { stationId, ownerWhatsapp, eventType });
      }
    } catch (error) {
      logger.error('Failed to notify station owner', { stationId, eventType, data, error });
    }
  }

  
  
  

  /**
   * REMOVED: Complex session monitoring notification
   * Now handled by sendChargingStartedNotification after photo verification
   */
  async sendSessionStartNotification(userWhatsapp: string, session: any): Promise<void> {
    
    await this.sendChargingStartedNotification(userWhatsapp, session);
  }

  async sendSessionPausedNotification(userWhatsapp: string, session: any): Promise<void> {
    try {
      const message = `⏸️ *CHARGING PAUSED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🕐 *Paused:* ${new Date().toLocaleTimeString()}\n\n` +
        `⏰ *Your slot is reserved for 10 minutes*\n` +
        `🔄 *Charging will auto-resume if not manually stopped*\n\n` +
        `💡 *Resume anytime from your session controls*`;
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send session paused notification', { userWhatsapp, session, error });
    }
  }

  async sendSessionResumedNotification(userWhatsapp: string, session: any): Promise<void> {
    try {
      const message = `▶️ *CHARGING RESUMED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🕐 *Resumed:* ${new Date().toLocaleTimeString()}\n\n` +
        `⚡ *Charging is now active again*\n` +
        `🛑 *To stop:* Use /stop or button`;
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send session resumed notification', { userWhatsapp, session, error });
    }
  }

  async sendSessionProgressNotification(userWhatsapp: string, session: any, progress: any): Promise<void> {
    try {
      const message = `📊 *CHARGING PROGRESS*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🔋 *Battery:* ${progress.currentBatteryLevel}%\n` +
        `⚡ *Power:* ${progress.chargingRate} kW\n` +
        `💰 *Cost so far:* ₹${progress.currentCost}\n` +
        `⏱️ *Est. completion:* ${progress.estimatedCompletion}\n\n` +
        `${progress.statusMessage}`;
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send session progress notification', { userWhatsapp, session, progress, error });
    }
  }

  /**
   * OPTIMIZED: Session completed notification with verified readings
   * This is now the main method called after END photo verification
   */
  async sendSessionCompletedNotification(userWhatsapp: string, session: any, summary: any): Promise<void> {
    await this.sendChargingCompletedNotification(userWhatsapp, session, summary);
  }

  async sendSessionExtendedNotification(userWhatsapp: string, session: any, newTarget: number): Promise<void> {
    try {
      const message = `⏰ *SESSION EXTENDED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🎯 *New Target:* ${newTarget}%\n` +
        `🔋 *Current:* ${session.currentBatteryLevel}%\n\n` +
        `⚡ *Charging will continue to your new target*\n` +
        `📊 *Updated estimates will be sent*`;
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send session extended notification', { userWhatsapp, session, newTarget, error });
    }
  }

  
  
  

  async sendAnomalyAlert(userWhatsapp: string, session: any, status: any): Promise<void> {
    try {
      const message = `⚠️ *CHARGING ANOMALY DETECTED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `📊 *Issue:* Lower than expected charging rate\n` +
        `⚡ *Current Rate:* ${status.chargingRate} kW\n` +
        `📈 *Expected:* ${session.chargingRate} kW\n\n` +
        `🔧 *Station team has been notified*\n` +
        `📞 *Contact support if issues persist*`;
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send anomaly alert', { userWhatsapp, session, status, error });
    }
  }

  async sendAvailabilityAlert(userWhatsapp: string, stationId: number, analytics: any): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const message = `🚨 *STATION AVAILABLE!*\n\n` +
        `📍 *${station?.name}*\n` +
        `🟢 *Queue Length:* ${analytics.currentQueueLength} people\n` +
        `⏱️ *Wait Time:* ${analytics.estimatedWaitTime} minutes\n\n` +
        `⚡ *Perfect time to charge!*\n` +
        `🚀 *Book now for quick access*`;
      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '🎯 *Quick Actions:*',
          [
            { id: `quick_book_${stationId}`, title: '⚡ Book Now' },
            { id: `get_directions_${stationId}`, title: '🗺️ Directions' },
            { id: `dismiss_alert_${stationId}`, title: '❌ Dismiss' }
          ]
        );
      }, 1000);
    } catch (error) {
      logger.error('Failed to send availability alert', { userWhatsapp, stationId, analytics, error });
    }
  }

  async sendPromotionNotification(userWhatsapp: string, stationId: number, newPosition: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const message = `📈 *QUEUE POSITION UPDATED!*\n\n` +
        `📍 *${station?.name}*\n` +
        `🎯 *New Position:* #${newPosition}\n` +
        `⏱️ *You moved up in the queue!*\n\n` +
        (newPosition === 1
          ? '🎉 *You\'re next!* Get ready for your slot.'
          : newPosition === 2
          ? '🔥 *Almost there!* You\'re second in line.'
          : '📊 *Progress!* You\'re getting closer.');
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send promotion notification', { userWhatsapp, stationId, newPosition, error });
    }
  }

  async sendSessionReminder(userWhatsapp: string, stationId: number, status: any): Promise<void> {
    try {
      const message = `🔔 *CHARGING REMINDER*\n\n` +
        `🔋 *Your battery is now ${status.currentBatteryLevel}%*\n` +
        `⏱️ *Est. completion:* ${status.estimatedCompletion}\n\n` +
        `💡 *Your EV is almost ready!*\n` +
        `🚗 *Plan your departure accordingly*`;
      await whatsappService.sendTextMessage(userWhatsapp, message);
    } catch (error) {
      logger.error('Failed to send session reminder', { userWhatsapp, stationId, status, error });
    }
  }

  
  
  

  /**
   * Fetch station details and optionally compute distance from user
   */
  async getStationDetails(stationId: number, userLat?: number, userLng?: number): Promise<any> {
    try {
      const station = await db
        .select({
          id: chargingStations.id,
          name: chargingStations.name,
          address: chargingStations.address,
          latitude: chargingStations.latitude,
          longitude: chargingStations.longitude,
          totalSlots: chargingStations.totalSlots,
          availableSlots: chargingStations.availableSlots,
          totalPorts: chargingStations.totalPorts,
          availablePorts: chargingStations.availablePorts,
          pricePerKwh: chargingStations.pricePerKwh,
          connectorTypes: chargingStations.connectorTypes,
          amenities: chargingStations.amenities,
          operatingHours: chargingStations.operatingHours,
          rating: chargingStations.rating,
          averageRating: chargingStations.averageRating,
          totalReviews: chargingStations.totalReviews,
          reviewCount: chargingStations.reviewCount,
          isActive: chargingStations.isActive,
          updatedAt: chargingStations.updatedAt,
          ownerWhatsappId: chargingStations.ownerWhatsappId,
        })
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (station.length === 0) {
        logger.warn('Station not found', { stationId });
        return null;
      }

      const data = station[0];

      
      let distance: number | null = null;
      if (userLat != null && userLng != null && data.latitude && data.longitude) {
        distance = calculateDistance(
          userLat,
          userLng,
          Number(data.latitude),
          Number(data.longitude)
        );
      }

      
      const total = data.totalSlots || data.totalPorts || 1;
      const available = data.availableSlots || data.availablePorts || 0;
      const utilization = total > 0 ? Math.round(((total - available) / total) * 100) : 0;

      return {
        ...data,
        distance,
        utilization,
        availability: available > 0 ? 'Available' : total > 0 ? 'Queue Available' : 'Unavailable',
        isAvailable: available > 0,
        isBusy: utilization > 80,
        priceDisplay: `₹${data.pricePerKwh || 0}/kWh`,
        distanceDisplay: distance !== null ? `${distance} km` : 'Unknown',
        ratingDisplay: data.rating || data.averageRating
          ? `${Number(data.rating || data.averageRating).toFixed(1)} ⭐`
          : 'No ratings',
        slotsDisplay: `${available}/${total} available`,
        finalRating: data.rating || data.averageRating || 0,
        finalReviews: data.totalReviews || data.reviewCount || 0,
      };
    } catch (error) {
      logger.error('Failed to get station details', { stationId, error });
      return null;
    }
  }

  private formatQueueJoinedMessage(queuePosition: any, station: any): string {
    const waitTime = queuePosition.estimatedWaitMinutes;
    const expectedTime = new Date(Date.now() + waitTime * 60 * 1000).toLocaleTimeString();
    return `🎉 *BOOKING CONFIRMED!*\n\n` +
      `📍 *${station?.name || 'Charging Station'}*\n` +
      `🎯 *Your Position:* #${queuePosition.position}\n` +
      `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
      `🕐 *Expected Time:* ${expectedTime}\n\n` +
      `✨ *What happens next:*\n` +
      `• Live position updates every 5 minutes\n` +
      `• Auto-reservation when you're #1\n` +
      `• Navigation assistance when ready\n` +
      `• Smart notifications throughout\n\n` +
      `🎮 *Manage your booking with options below* ⬇️`;
  }

  private async generateSessionSummary(userWhatsapp: string, stationId: number): Promise<any> {
    
    return {
      energyDelivered: 25.5,
      duration: 45,
      totalCost: 306,
      batteryLevel: 85,
    };
  }

  private getProgressTip(position: number, waitTime: number): string {
    if (position <= 3) return 'Stay nearby for quick notifications!';
    if (waitTime < 30) return 'Great time to grab a coffee nearby!';
    if (waitTime < 60) return 'Perfect for a quick meal or errands!';
    return 'Consider exploring nearby attractions!';
  }

  
  
  

  clearUserNotifications(userWhatsapp: string): void {
    for (const [key, timeout] of this.scheduledNotifications.entries()) {
      if (key.includes(userWhatsapp)) {
        clearTimeout(timeout);
        this.scheduledNotifications.delete(key);
      }
    }
    logger.info('Cleared scheduled notifications for user', { userWhatsapp });
  }

  getNotificationStats(): any {
    return {
      scheduledNotifications: this.scheduledNotifications.size,
      activeKeys: Array.from(this.scheduledNotifications.keys()),
    };
  }
}

export const notificationService = new NotificationService();