// src/controllers/queue-webhook.ts - Photo-Based Flow (No Time Tracking)
import { whatsappService } from '../services/whatsapp';
import { bookingController } from './booking';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';
import { parseButtonId, ButtonParseResult } from '../utils/button-parser';

interface QueuePosition {
  position: number;
  stationId: number;
  stationName: string;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'ready' | 'charging' | 'completed' | 'cancelled';
  joinedAt: Date;
}

interface SessionData {
  sessionId: string;
  stationId: number;
  stationName: string;
  startReading?: number;
  currentRate: number;
  status: 'initiated' | 'active' | 'completed';
}

export class QueueWebhookController {

  // ===============================================
  // MAIN ENTRY POINTS
  // ===============================================

  async handleQueueButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID', { whatsappId });
      return;
    }

    try {
      logger.info('Processing queue button', { whatsappId, buttonId, buttonTitle });
      const parsed = parseButtonId(buttonId);
      await this.routeAction(whatsappId, buttonId, parsed, buttonTitle);
    } catch (error) {
      await this.handleError(error, 'queue button', { whatsappId, buttonId });
    }
  }

  async handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID', { whatsappId });
      return;
    }

    try {
      logger.info('Processing queue list', { whatsappId, listId, listTitle });
      const parsed = parseButtonId(listId);
      await this.routeAction(whatsappId, listId, parsed, listTitle);
    } catch (error) {
      await this.handleError(error, 'queue list', { whatsappId, listId });
    }
  }

  // ===============================================
  // ACTION ROUTING
  // ===============================================

  private async routeAction(
    whatsappId: string,
    actionId: string,
    parsed: ButtonParseResult,
    title: string
  ): Promise<void> {
    const { action, category, stationId } = parsed;

    switch (category) {
      case 'queue':
        await this.handleQueueCategory(whatsappId, action, stationId);
        break;

      case 'session':
        await this.handleSessionCategory(whatsappId, action, stationId);
        break;

      case 'station':
        await this.handleStationCategory(whatsappId, action, stationId);
        break;

      default:
        await this.handleSpecificActions(whatsappId, actionId, stationId);
    }
  }

  // ===============================================
  // CATEGORY HANDLERS
  // ===============================================

  private async handleQueueCategory(whatsappId: string, action: string, stationId: number): Promise<void> {
    switch (action) {
      case 'status':
        await this.handleQueueStatus(whatsappId, stationId);
        break;
      case 'cancel':
        await this.handleQueueCancel(whatsappId, stationId);
        break;
      case 'confirm_cancel':
        await this.handleConfirmCancel(whatsappId, stationId);
        break;
      case 'join':
        await this.handleJoinQueue(whatsappId, stationId);
        break;
      default:
        await this.handleUnknownAction(whatsappId, action);
    }
  }

  private async handleSessionCategory(whatsappId: string, action: string, stationId: number): Promise<void> {
  switch (action) {
    case 'start':
    case 'start_charging':  
      await bookingController.handleChargingStart(whatsappId, stationId);
      break;
    case 'status':
      await this.handleSessionStatus(whatsappId, stationId);
      break;
    case 'stop':
      await bookingController.handleSessionStop(whatsappId, stationId);
      break;
    default:
      await this.handleUnknownAction(whatsappId, action);
  }
}

  private async handleStationCategory(whatsappId: string, action: string, stationId: number): Promise<void> {
    switch (action) {
      case 'book':
        await bookingController.handleStationBooking(whatsappId, stationId);
        break;
      case 'info':
      case 'details':
        await bookingController.showStationDetails(whatsappId, stationId);
        break;
      case 'directions':
        await bookingController.handleGetDirections(whatsappId, stationId);
        break;
      case 'alternatives':
        await bookingController.handleFindAlternatives(whatsappId, stationId);
        break;
      case 'rate':
        await this.handleStationRating(whatsappId, stationId);
        break;
      default:
        await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

  private async handleSpecificActions(whatsappId: string, actionId: string, stationId: number): Promise<void> {
    if (actionId.startsWith('notify_')) {
      await this.handleNotificationActions(whatsappId, stationId);
    } else if (actionId.startsWith('rate_')) {
      await this.handleStationRating(whatsappId, stationId);
    } else {
      await this.handleUnknownAction(whatsappId, actionId);
    }
  }

  // ===============================================
  // QUEUE OPERATIONS
  // ===============================================

  private async handleQueueStatus(whatsappId: string, stationId: number): Promise<void> {
    try {
      const queueData = await this.getQueueData(whatsappId, stationId);

      if (!queueData) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📋 *No Active Queue*\n\nYou are not currently in any queue.\n\n🔍 Ready to find a charging station?'
        );
        
        setTimeout(async () => {
          await this.sendFindStationButtons(whatsappId);
        }, 2000);
        return;
      }

      const statusMessage = this.formatQueueStatus(queueData);
      await whatsappService.sendTextMessage(whatsappId, statusMessage);

      setTimeout(async () => {
        await this.sendQueueManagementButtons(whatsappId, queueData);
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'queue status', { whatsappId, stationId });
    }
  }

  private async handleJoinQueue(whatsappId: string, stationId: number): Promise<void> {
    try {
      await bookingController.handleJoinQueue(whatsappId, stationId);
    } catch (error) {
      await this.handleError(error, 'join queue', { whatsappId, stationId });
    }
  }

  private async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '❓ *Cancel Queue Position*\n\nAre you sure you want to cancel your booking?\n\n⚠️ Your position will be released.',
        [
          { id: `confirm_cancel_${stationId}`, title: '✅ Yes, Cancel' },
          { id: `queue_status_${stationId}`, title: '❌ Keep Position' },
          { id: `get_directions_${stationId}`, title: '🗺️ Directions' }
        ]
      );
    } catch (error) {
      await this.handleError(error, 'queue cancel', { whatsappId, stationId });
    }
  }

  private async handleConfirmCancel(whatsappId: string, stationId: number): Promise<void> {
    try {
      await bookingController.handleQueueCancel(whatsappId, stationId);
    } catch (error) {
      await this.handleError(error, 'confirm cancel', { whatsappId, stationId });
    }
  }

  // ===============================================
  // SESSION OPERATIONS (SIMPLIFIED)
  // ===============================================

  private async handleSessionStatus(whatsappId: string, stationId: number): Promise<void> {
    try {
      const sessionData = await this.getSessionData(whatsappId, stationId);

      if (!sessionData) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '⚡ *No Active Session*\n\nYou don\'t have an active charging session.\n\n🔍 Ready to start charging?'
        );
        return;
      }

      const statusMessage = this.formatSessionStatus(sessionData);
      await whatsappService.sendTextMessage(whatsappId, statusMessage);

      // ✅ Only send simple session controls (no time-based features)
      setTimeout(async () => {
        await this.sendSessionControls(whatsappId, sessionData);
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'session status', { whatsappId, stationId });
    }
  }

  // ===============================================
  // ADDITIONAL FEATURES
  // ===============================================

  private async handleNotificationActions(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔔 *Notifications Enabled*\n\n' +
        'You will receive alerts for:\n' +
        '• Queue position updates\n' +
        '• When your slot is ready\n' +
        '• Session completion\n\n' +
        '✅ All set!'
      );
    } catch (error) {
      await this.handleError(error, 'notifications', { whatsappId, stationId });
    }
  }

  private async handleStationRating(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⭐ *Rate Your Experience*\n\nHow would you rate this charging station?',
        [
          { id: `rate_5_${stationId}`, title: '⭐⭐⭐⭐⭐ Excellent' },
          { id: `rate_4_${stationId}`, title: '⭐⭐⭐⭐ Good' },
          { id: `rate_3_${stationId}`, title: '⭐⭐⭐ Average' }
        ]
      );
    } catch (error) {
      await this.handleError(error, 'station rating', { whatsappId, stationId });
    }
  }

  // ===============================================
  // MESSAGE FORMATTING
  // ===============================================

  private formatQueueStatus(queueData: QueuePosition): string {
    const statusEmoji = this.getQueueStatusEmoji(queueData.status);
    const progressBar = this.generateProgressBar(queueData.position, 5);

    return `${statusEmoji} *Queue Status*\n\n` +
      `📍 *${queueData.stationName}*\n` +
      `👥 *Position:* #${queueData.position}\n` +
      `${progressBar}\n` +
      `⏱️ *Estimated Wait:* ${queueData.estimatedWaitMinutes} minutes\n` +
      `📅 *Joined:* ${queueData.joinedAt.toLocaleTimeString()}\n` +
      `🔄 *Status:* ${this.getStatusDescription(queueData.status)}\n\n` +
      `${this.getQueueTip(queueData)}`;
  }

  private formatSessionStatus(sessionData: SessionData): string {
    // ✅ SIMPLIFIED: No duration, no real-time tracking
    let message = `⚡ *Charging Session*\n\n` +
      `*${sessionData.stationName}*\n` +
      `*Rate:* ₹${sessionData.currentRate}/kWh\n` +
      `*Status:* ${sessionData.status.toUpperCase()}\n\n`;

    if (sessionData.status === 'active' && sessionData.startReading) {
      message += `📊 *Initial Reading:* ${sessionData.startReading.toFixed(2)} kWh\n\n`;
    }

    message += sessionData.status === 'active'
      ? `🔋 *Charging in progress...*\n\nWhen done, use /stop to end session.`
      : `⏳ *Waiting for photo verification...*`;

    return message;
  }

  // ===============================================
  // BUTTON GENERATORS (SIMPLIFIED)
  // ===============================================

  private async sendQueueManagementButtons(whatsappId: string, queueData: QueuePosition): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Queue Management:*',
      [
        { id: `queue_status_${queueData.stationId}`, title: '🔄 Refresh Status' },
        { id: `get_directions_${queueData.stationId}`, title: '🗺️ Directions' },
        { id: `cancel_queue_${queueData.stationId}`, title: '❌ Cancel' }
      ]
    );
  }

  /**
   * ✅ SIMPLIFIED: Only essential session controls
   * ❌ REMOVED: Pause, Extend, Time Estimates
   */
  private async sendSessionControls(whatsappId: string, sessionData: SessionData): Promise<void> {
    const buttons = sessionData.status === 'active'
      ? [
          { id: `session_status_${sessionData.stationId}`, title: '📊 Refresh Status' },
          { id: `session_stop_${sessionData.stationId}`, title: '🛑 Stop Session' }
        ]
      : [
          { id: `session_status_${sessionData.stationId}`, title: '📊 Check Status' }
        ];

    await whatsappService.sendButtonMessage(
      whatsappId,
      '⚡ *Session Controls:*',
      buttons,
      'Simple controls for your session'
    );
  }

  private async sendFindStationButtons(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Find Charging Stations:*',
      [
        { id: 'share_gps_location', title: '📍 Share Location' },
        { id: 'new_search', title: '🆕 New Search' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ]
    );
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private getQueueStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      'waiting': '⏳',
      'ready': '🎯',
      'charging': '⚡',
      'completed': '✅',
      'cancelled': '❌'
    };
    return emojiMap[status] || '📍';
  }

  private getStatusDescription(status: string): string {
    const descriptions: Record<string, string> = {
      'waiting': 'In Queue',
      'ready': 'Ready to Charge',
      'charging': 'Charging Active',
      'completed': 'Complete',
      'cancelled': 'Cancelled'
    };
    return descriptions[status] || 'Unknown';
  }

  private generateProgressBar(position: number, maxLength: number): string {
    const filled = Math.max(0, maxLength - position);
    const empty = Math.max(0, position - 1);
    return '🟢'.repeat(filled) + '⚪'.repeat(empty);
  }

  private getQueueTip(queueData: QueuePosition): string {
    if (queueData.status === 'ready') {
      return '🚀 *Your slot is ready!* Please arrive within 15 minutes.';
    } else if (queueData.position === 1) {
      return '🎉 *You\'re next!* Get ready to charge soon.';
    } else if (queueData.position <= 3) {
      return '🔔 *Almost there!* Stay nearby for notifications.';
    } else {
      return '💡 *Perfect time* to grab coffee nearby!';
    }
  }

  // ===============================================
  // DATA RETRIEVAL (TEMPORARY SIMULATION)
  // ===============================================

  private async getQueueData(whatsappId: string, stationId: number): Promise<QueuePosition | null> {
    // TODO: Replace with actual queue service
    const hasQueue = Math.random() > 0.5;
    if (!hasQueue) return null;

    return {
      position: Math.floor(Math.random() * 4) + 1,
      stationId,
      stationName: `Charging Station #${stationId}`,
      estimatedWaitMinutes: Math.floor(Math.random() * 30) + 10,
      status: 'waiting',
      joinedAt: new Date(Date.now() - Math.random() * 1800000)
    };
  }

  private async getSessionData(whatsappId: string, stationId: number): Promise<SessionData | null> {
    // TODO: Replace with actual session service
    const hasSession = Math.random() > 0.7;
    if (!hasSession) return null;

    return {
      sessionId: `session_${Date.now()}`,
      stationId,
      stationName: `Charging Station #${stationId}`,
      startReading: 245.67,
      currentRate: 22.5,
      status: 'active'
    };
  }

  // ===============================================
  // ERROR HANDLING
  // ===============================================

  private async handleUnknownAction(whatsappId: string, actionId: string): Promise<void> {
    logger.warn('Unknown action', { whatsappId, actionId });
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '❓ *Unknown Action*\n\nThat action is not recognized. Please try again or type "help".'
    );

    setTimeout(async () => {
      await this.sendFindStationButtons(whatsappId);
    }, 2000);
  }

  private async handleError(error: any, operation: string, context: Record<string, any>): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Queue webhook ${operation} failed`, { ...context, error: errorMessage });

    const whatsappId = context.whatsappId;
    if (whatsappId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        `❌ ${operation} failed. Please try again.`
      ).catch(sendError => 
        logger.error('Failed to send error message', { whatsappId, sendError })
      );
    }
  }

  // ===============================================
  // HEALTH MONITORING
  // ===============================================

  public getHealthStatus(): {
    status: 'healthy' | 'degraded';
    lastActivity: string;
  } {
    return {
      status: 'healthy',
      lastActivity: new Date().toISOString()
    };
  }
}

export const queueWebhookController = new QueueWebhookController();