// src/controllers/webhook.ts - PRODUCTION READY WITH DEDUPLICATION & ERROR FIXES
import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { messageDeduplication } from '../utils/message-deduplication';
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/userService';
import { preferenceService } from '../services/preference';
import { preferenceController } from './preference';
import { profileService } from '../services/profile';
import { locationController } from './location';
import { bookingController } from './booking';
import { queueWebhookController } from './queue-webhook';
import { webhookLocationController } from './location/webhook-location';
import { photoVerificationService } from '../services/photo-verification';
import { WhatsAppWebhook, WhatsAppMessage } from '../types/whatsapp';
import { parseButtonId, ButtonParseResult } from '../utils/button-parser';
import { validateWhatsAppId } from '../utils/validation';
import { ownerWebhookController } from '../controllers/owner-webhook';
import { db } from '../config/database';
import { chargingStations } from '../db/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';

// ===============================================
// EXTENDED WHATSAPP MESSAGE TYPE
// ===============================================

interface ExtendedWhatsAppMessage extends WhatsAppMessage {
  image?: {
    id: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
  };
}

// ===============================================
// PRODUCTION WEBHOOK CONTROLLER WITH DEDUPLICATION & ERROR HANDLING
// ===============================================

export class WebhookController {
  private readonly waitingUsers = new Map<string, 'name' | 'address'>();
  private readonly MAX_WAITING_USERS = 10_000; // Prevent memory exhaustion
  private readonly MAX_PROCESSING_MESSAGES = 5_000; // Prevent processing queue overflow

  // Use message IDs for deduplication and processing tracking - keyed by WhatsApp's unique message ID
  private processingMessages = new Set<string>();

  // ===============================================
  // WEBHOOK VERIFICATION & HANDLING
  // ===============================================

  async verifyWebhook(req: Request, res: Response): Promise<void> {
    try {
      const mode = req.query['hub.mode'] as string;
      const token = req.query['hub.verify_token'] as string;
      const challenge = req.query['hub.challenge'] as string;

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        logger.info('✅ Webhook verified successfully');
        res.status(200).send(challenge);
      } else {
        logger.error('❌ Webhook verification failed', { mode, token: !!token });
        res.status(403).send('Forbidden');
      }
    } catch (error) {
      logger.error('Webhook verification error', { error: (error as Error).message });
      res.status(500).send('Internal Error');
    }
  }

  async handleWebhook(req: Request, res: Response): Promise<void> {
    // ✅ CRITICAL FIX: Send response IMMEDIATELY to prevent timeouts and retries from WhatsApp
    res.status(200).send('EVENT_RECEIVED');

    try {
      const webhookData: WhatsAppWebhook = req.body;

      if (webhookData.object !== 'whatsapp_business_account') {
        logger.debug('Skipping non-WABA webhook', { object: webhookData.object });
        return;
      }

      const allMessages = this.extractMessages(webhookData);
      if (allMessages.length === 0) {
        logger.debug('No messages found in webhook payload');
        return;
      }

      logger.info('📥 Processing webhook', {
        totalMessages: allMessages.length,
      });

      // Process each message independently after the response is sent
      for (const message of allMessages) {
        // Deduplicate based on the unique message ID provided by WhatsApp
        if (messageDeduplication.isDuplicate(message.id)) {
          logger.debug('⏭️ Duplicate message skipped', { messageId: message.id });
          continue;
        }

        // Fire-and-forget processing for the message using setImmediate
        // This ensures errors in processMessage don't affect the main request's response
        setImmediate(async () => {
          try {
            await this.processMessage(message as ExtendedWhatsAppMessage);
          } catch (error) {
            logger.error('💥 Unhandled error during message processing (fire-and-forget)', {
              messageId: message.id,
              whatsappId: message.from,
              error: (error as Error).message
            });
          }
        });
      }

      logger.info('📥 Webhook dispatch completed', { totalDispatched: allMessages.length });

    } catch (error) {
      // This should ideally not happen if the try-catch in setImmediate works correctly,
      // but it's a safety net for synchronous errors in the loop itself.
      logger.error('❌ Unexpected error in handleWebhook top-level (should not happen)', {
        error: (error as Error).message
      });
      // Do NOT send response here - already sent above.
    }
  }

  // ===============================================
  // MESSAGE PROCESSING PIPELINE
  // ===============================================

  private extractMessages(webhookData: WhatsAppWebhook): WhatsAppMessage[] {
    const messages: WhatsAppMessage[] = [];
    for (const entry of webhookData.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages' && Array.isArray(change.value?.messages)) {
          messages.push(...change.value.messages);
        }
      }
    }
    return messages;
  }

  private async processMessage(message: ExtendedWhatsAppMessage): Promise<void> {
    const { id: messageId, from: whatsappId, type } = message;

    if (!validateWhatsAppId(whatsappId)) {
      logger.error('❌ Invalid WhatsApp ID format', { whatsappId, messageId });
      return; // Silently ignore invalid IDs
    }

    try {
      // ✅ Mark as read (non-blocking fire-and-forget)
      whatsappService.markAsRead(messageId).catch(error => {
        logger.debug('Mark as read failed (non-critical)', {
          messageId,
          error: (error as Error).message
        });
      });

      logger.info('📨 Processing message', {
        whatsappId,
        type,
        messageId
      });

      // ✅ Parallel user lookup and preference check
      const [userResult, preferenceResult] = await Promise.allSettled([
        userService.createUser({ whatsappId }),
        preferenceService.isInPreferenceFlow(whatsappId)
      ]);

      const user = userResult.status === 'fulfilled' ? userResult.value : null;
      const isInPreferenceFlow = preferenceResult.status === 'fulfilled' ? preferenceResult.value : false;

      if (!user) {
        logger.error('❌ Failed to get/create user', { whatsappId, messageId });
        await this.sendErrorMessage(whatsappId, 'Failed to initialize session. Please try again.');
        return;
      }

      await this.routeMessage(message, user, isInPreferenceFlow);

    } catch (error) {
      logger.error('❌ Message processing pipeline error', {
        messageId,
        whatsappId,
        error: (error as Error).message
      });
      await this.sendErrorMessage(whatsappId, 'Something went wrong. Please try again or type "help".');
    }
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(
    message: ExtendedWhatsAppMessage,
    user: any,
    isInPreferenceFlow: boolean
  ): Promise<void> {
    const { whatsappId } = user;

    // ✅ PRIORITY 0: Photo verification flow
    const verificationState = photoVerificationService.getVerificationState(whatsappId);
    if (verificationState) {
      logger.info('🔍 User in verification flow', { whatsappId, hasImage: !!message.image });
      if (message.image) {
        await this.handleVerificationPhoto(whatsappId, message, verificationState);
        return;
      } else if (message.type === 'text') {
        await this.handleManualVerificationEntry(whatsappId, message.text?.body || '');
        return;
      }
    }

    // ✅ Route by message type
    switch (message.type) {
      case 'text':
        await this.handleTextMessage(user, message.text?.body || '', isInPreferenceFlow);
        break;
      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          await this.handleButtonMessage(user, message.interactive.button_reply, isInPreferenceFlow);
        } else if (message.interactive?.type === 'list_reply') {
          await this.handleListMessage(user, message.interactive.list_reply, isInPreferenceFlow);
        }
        break;
      case 'location':
        await this.handleLocationMessage(user, message.location);
        break;
      default:
        await whatsappService.sendTextMessage(
          user.whatsappId,
          '❓ Unsupported message type. Please send text, location, or use buttons.'
        );
    }
  }

  // ===============================================
  // PHOTO VERIFICATION HANDLERS
  // ===============================================

  private async handleVerificationPhoto(
    whatsappId: string,
    message: ExtendedWhatsAppMessage,
    state: any
  ): Promise<void> {
    try {
      logger.info('📸 Processing verification photo', {
        whatsappId,
        attempt: state.attemptCount + 1
      });

      const imageBuffer = await this.downloadWhatsAppImage(message.image?.id || '');

      if (!imageBuffer) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Failed to download image. Please try again.'
        );
        return;
      }

      await photoVerificationService.handleStartPhoto(whatsappId, imageBuffer);

    } catch (error) {
      logger.error('❌ Photo verification failed', { whatsappId, error: (error as Error).message });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process photo. Please try again or type the reading manually.'
      );
    }
  }

  private async handleManualVerificationEntry(whatsappId: string, text: string): Promise<void> {
    try {
      await photoVerificationService.handleManualEntry(whatsappId, text.trim());
    } catch (error) {
      logger.error('❌ Manual verification failed', { whatsappId, error: (error as Error).message });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process entry. Please enter a valid kWh reading.'
      );
    }
  }

  private async downloadWhatsAppImage(mediaId: string): Promise<Buffer | null> {
    if (!mediaId) {
        logger.warn('No media ID provided for download');
        return null;
    }

    try {
      const mediaUrlResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${mediaId}`, // Fixed typo: removed extra spaces
        {
          headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}` },
          timeout: 10000
        }
      );

      const mediaUrl = mediaUrlResponse.data?.url;
      if (!mediaUrl) {
        logger.error('No media URL received from Facebook API', { mediaId });
        return null;
      }

      const imageResponse = await axios.get(mediaUrl, {
        headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}` },
        responseType: 'arraybuffer',
        timeout: 15000
      });

      logger.debug('Image downloaded successfully', { mediaId });
      return Buffer.from(imageResponse.data);

    } catch (error) {
      logger.error('❌ Failed to download image from WhatsApp', {
        mediaId,
        error: (error as Error).message
      });
      return null;
    }
  }

  private async handleVerificationButtons(whatsappId: string, buttonId: string): Promise<void> {
    // Define handlers that return Promise<void> to match the Record type
    const handlers: Record<string, () => Promise<void>> = {
      'confirm_start_reading': async () => {
        // Assuming these services return Promise<boolean>
        await photoVerificationService.confirmStartReading(whatsappId);
        // Explicitly return void
      },
      'confirm_end_reading': async () => {
        await photoVerificationService.confirmEndReading(whatsappId);
      },
      'retake_start_photo': async () => {
        await photoVerificationService.retakeStartPhoto(whatsappId);
      },
      'retake_end_photo': async () => {
        await photoVerificationService.retakeEndPhoto(whatsappId);
      },
      'manual_entry': async () => {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📝 *Manual Entry*\n\nPlease type the kWh reading from the meter.\n\nExample: 1245.8'
        );
      }
    };

    const handler = handlers[buttonId];
    if (handler) {
      try {
        await handler();
      } catch (error) {
          logger.error('Error in verification button handler', { buttonId, whatsappId, error: (error as Error).message });
          await this.sendErrorMessage(whatsappId, 'Action failed. Please try again.');
      }
    }
  }


  // ===============================================
  // MESSAGE TYPE HANDLERS
  // ===============================================

  private async handleTextMessage(user: any, text: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const cleanText = text.toLowerCase().trim();

    // Owner mode
    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'text', text);
      return;
    }

    if (cleanText === 'owner') {
      await ownerWebhookController.enterOwnerMode(whatsappId);
      return;
    }

    // Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
      return;
    }

    // Waiting input
    const waitingType = this.waitingUsers.get(whatsappId);
    if (waitingType) {
      await this.handleWaitingInput(whatsappId, text, waitingType);
      return;
    }

    // Commands
    await this.handleCommand(whatsappId, cleanText, text);
  }

  private async handleButtonMessage(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId, title });

    // Verification buttons
    if (photoVerificationService.isInVerificationFlow(whatsappId) && this.isVerificationButton(buttonId)) {
      await this.handleVerificationButtons(whatsappId, buttonId);
      return;
    }

    // Owner mode
    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'button', button);
      return;
    }

    // Session stop (priority)
    if (buttonId.startsWith('session_stop_')) {
      const stationId = parseInt(buttonId.split('_')[2], 10); // Use radix 10
      if (!isNaN(stationId)) {
        await bookingController.handleSessionStop(whatsappId, stationId);
        return;
      }
    }

    // Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
      return;
    }

    // Normal routing
    const parsed = parseButtonId(buttonId);
    await this.routeButtonAction(whatsappId, buttonId, parsed, title);
  }

  private async handleListMessage(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId, title });

    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await whatsappService.sendTextMessage(
        whatsappId,
        'Location sharing not supported in owner mode.'
      );
      return;
    }

    const parsed = parseButtonId(listId);

    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
      return;
    }

    await this.routeListAction(whatsappId, listId, parsed, title);
  }

  private async handleLocationMessage(user: any, location: any): Promise<void> {
    const { whatsappId } = user;

    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await whatsappService.sendTextMessage(
        whatsappId,
        'Location sharing not supported in owner mode.'
      );
      return;
    }

    logger.info('📍 Location received', {
      whatsappId,
      hasLatitude: !!location?.latitude,
      hasLongitude: !!location?.longitude
    });

    try {
      const lat = typeof location?.latitude === 'string'
        ? parseFloat(location.latitude)
        : location?.latitude;

      const lng = typeof location?.longitude === 'string'
        ? parseFloat(location.longitude)
        : location?.longitude;

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
      }

      await locationController.handleGPSLocation(
        whatsappId,
        lat,
        lng,
        location.name || null,
        location.address || null
      );

    } catch (error) {
      logger.error('❌ Location processing failed', { whatsappId, error: (error as Error).message });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid location. Please share your location again or type your address.'
      );
    }
  }

  // ===============================================
  // BUTTON & LIST ROUTING
  // ===============================================

  private async routeButtonAction(
    whatsappId: string,
    buttonId: string,
    parsed: ButtonParseResult,
    title: string
  ): Promise<void> {
    logger.info('🎯 Routing button', { whatsappId, buttonId, parsed });

    if (this.isQueueButton(buttonId)) {
      await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
      return;
    }

    if (this.isLocationButton(buttonId)) {
      await this.handleLocationButton(whatsappId, buttonId);
      return;
    }

    // ✅ ADD THIS - Check for SESSION buttons
    if (this.isSessionButton(buttonId)) {
      await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
      return;
    }

    if (parsed.category === 'station' && parsed.stationId > 0) {
      await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
      return;
    }

    await this.handleCoreButton(whatsappId, buttonId);
  }

  private isSessionButton(buttonId: string): boolean {
  return buttonId.startsWith('start_charging_') || 
         buttonId.startsWith('start_session_') ||
         buttonId.startsWith('session_status_') ||
         buttonId.startsWith('session_stop_') ||
         buttonId.startsWith('extend_');
}

  private async routeListAction(
    whatsappId: string,
    listId: string,
    parsed: ButtonParseResult,
    title: string
  ): Promise<void> {
    if (this.isQueueButton(listId)) {
      await queueWebhookController.handleQueueList(whatsappId, listId, title);
      return;
    }

    // Handle the missing method call
    if (this.isLocationList(listId)) {
      await this.handleLocationList(whatsappId, listId, parsed);
      return;
    }

    if (parsed.category === 'station' && parsed.stationId > 0) {
      await bookingController.handleStationSelection(whatsappId, parsed.stationId);
      return;
    }

    await whatsappService.sendTextMessage(whatsappId, 'Unknown selection. Please try again.');
  }

  // ===============================================
  // SPECIFIC HANDLERS
  // ===============================================

  private async handleStationButton(whatsappId: string, action: string, stationId: number): Promise<void> {
    const handlers: Record<string, () => Promise<void>> = {
      'book': () => bookingController.handleStationBooking(whatsappId, stationId),
      'info': () => bookingController.showStationDetails(whatsappId, stationId),
      'details': () => bookingController.showStationDetails(whatsappId, stationId),
      'directions': () => this.handleGetDirections(whatsappId, stationId)
    };

    const handler = handlers[action];
    if (handler) {
      await handler();
    } else {
      // Default to selection if action is unknown
      await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

  private async handleLocationButton(whatsappId: string, buttonId: string): Promise<void> {
    try {
      await webhookLocationController.handleLocationButton(whatsappId, buttonId, '');
    } catch (error) {
      logger.error('❌ Location button handler failed', { whatsappId, buttonId, error: (error as Error).message });

      // Fallback handlers
      const fallbacks: Record<string, () => Promise<void>> = {
        'share_gps_location': () => this.requestGPSLocation(whatsappId),
        'type_address': () => this.requestAddressInput(whatsappId),
        'location_help': () => this.showLocationHelp(whatsappId),
        'new_search': () => this.startBooking(whatsappId)
      };

      const fallback = fallbacks[buttonId];
      if (fallback) {
        await fallback();
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          'There was an issue. Please try "find" to search for stations.'
        );
      }
    }
  }

  // Added the missing method
  private async handleLocationList(
    whatsappId: string,
    listId: string,
    parsed: ButtonParseResult
  ): Promise<void> {
    if (listId.startsWith('recent_search_') && typeof parsed.index === 'number') {
      await locationController.handleRecentSearchSelection(whatsappId, parsed.index);
    } else {
      logger.warn('Unknown location list selection', { whatsappId, listId, parsed });
      await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
    }
  }


  private async handleCoreButton(whatsappId: string, buttonId: string): Promise<void> {
    const handlers: Record<string, () => Promise<void>> = {
      'help': () => this.showHelp(whatsappId),
      'quick_book': () => this.startBooking(whatsappId),
      'find_stations': () => this.startBooking(whatsappId),
      'view_profile': () => profileService.showProfileSummary(whatsappId),
      'update_profile': () => this.requestProfileUpdate(whatsappId),
      'update_preferences': () => preferenceController.startPreferenceGathering(whatsappId)
    };

    const handler = handlers[buttonId];
    if (handler) {
      await handler();
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ Unknown action. Type "help" for available commands.'
      );
    }
  }

  // ===============================================
  // COMMAND HANDLING
  // ===============================================

  private async handleCommand(whatsappId: string, cleanText: string, originalText: string): Promise<void> {
    const commands: Record<string, () => Promise<void>> = {
      'hi': () => this.handleGreeting(whatsappId),
      'hello': () => this.handleGreeting(whatsappId),
      'hey': () => this.handleGreeting(whatsappId),
      'start': () => this.handleGreeting(whatsappId),
      'help': () => this.showHelp(whatsappId),
      'book': () => this.startBooking(whatsappId),
      'find': () => this.startBooking(whatsappId),
      'search': () => this.startBooking(whatsappId),
      'station': () => this.startBooking(whatsappId),
      'stations': () => this.startBooking(whatsappId),
      'gps': () => this.requestGPSLocation(whatsappId),
      'location': () => this.requestGPSLocation(whatsappId),
      'share': () => this.requestGPSLocation(whatsappId),
      'nearby': () => this.handleNearbyRequest(whatsappId),
      'near': () => this.handleNearbyRequest(whatsappId),
      'around': () => this.handleNearbyRequest(whatsappId),
      'directions': () => this.handleGetDirections(whatsappId),
      'navigate': () => this.handleGetDirections(whatsappId),
      'maps': () => this.handleGetDirections(whatsappId),
      'route': () => this.handleGetDirections(whatsappId),
      'profile': () => profileService.showProfileSummary(whatsappId),
      'preferences': () => preferenceController.startPreferenceGathering(whatsappId),
      'settings': () => preferenceController.startPreferenceGathering(whatsappId)
    };

    const handler = commands[cleanText];
    if (handler) {
      await handler();
    } else {
      // Check if it looks like an address
      if (this.looksLikeAddress(originalText)) {
        await locationController.handleAddressInput(whatsappId, originalText);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ I didn\'t understand that. Type "help" for commands or "find" to search for stations.'
        );
      }
    }
  }

  private async handleWaitingInput(
    whatsappId: string,
    input: string,
    type: 'name' | 'address'
  ): Promise<void> {
    this.waitingUsers.delete(whatsappId);

    if (type === 'name') {
      await this.processNameInput(whatsappId, input.trim());
    } else { // 'address'
      await this.processAddressInput(whatsappId, input.trim());
    }
  }

  // ===============================================
  // LOCATION & ADDRESS HANDLING
  // ===============================================


  private looksLikeAddress(text: string): boolean {
    const indicators = [
      'road', 'street', 'st', 'rd', 'avenue', 'ave', 'nagar', 'colony',
      'sector', 'block', 'phase', 'mall', 'plaza', 'complex', 'society',
      'mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad', 'pune', 'kolkata',
      'noida', 'gurgaon', 'ahmedabad', 'jaipur', 'lucknow', 'patna'
    ];
    const lower = text.toLowerCase();
    return text.length > 5 && // Increased minimum length
           text.length < 100 &&
           /[a-zA-Z]/.test(text) && // Must contain letters
           indicators.some(ind => lower.includes(ind.toLowerCase()));
  }

  private async handleGetDirections(whatsappId: string, stationId?: number): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        'Get Directions\n\nFirst select a charging station, then I can send you the location!'
      );
      return;
    }

    try {
      const [station] = await db
        .select({
          id: chargingStations.id,
          name: chargingStations.name,
          address: chargingStations.address,
          latitude: chargingStations.latitude,
          longitude: chargingStations.longitude
        })
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (!station) {
        await whatsappService.sendTextMessage(whatsappId, 'Station not found.');
        return;
      }

      const lat = Number(station.latitude);
      const lng = Number(station.longitude);

      if (isNaN(lat) || isNaN(lng)) {
          logger.error('Invalid coordinates in DB for station', { stationId, lat, lng });
          await whatsappService.sendTextMessage(whatsappId, 'Failed to get directions for this station.');
          return;
      }

      const locationSent = await whatsappService.sendLocationMessage(
        whatsappId,
        lat,
        lng,
        station.name,
        station.address
      );

      if (locationSent) {
        setTimeout(async () => {
          await whatsappService.sendTextMessage(
            whatsappId,
            `📍 Location sent for ${station.name}\n\nTap the location above to open in your maps app!`
          );
        }, 1000);
      } else {
          logger.warn('Location message was not sent successfully', { stationId, whatsappId });
          await whatsappService.sendTextMessage(whatsappId, 'Could not send directions. Please try again.');
      }

    } catch (error) {
      logger.error('❌ Failed to send directions', { whatsappId, stationId, error: (error as Error).message });
      await whatsappService.sendTextMessage(
        whatsappId,
        'Failed to get directions. Please try again.'
      );
    }
  }

  private async handleNearbyRequest(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '📍 *Find Nearby Stations*\n\nShare your location to find charging stations around you:',
      [
        { id: 'share_gps_location', title: '📱 Share GPS' },
        { id: 'type_address', title: '📝 Type Address' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ],
      '🔍 Location Search'
    );
  }

  // ===============================================
  // USER INTERACTION METHODS
  // ===============================================

  private async handleGreeting(whatsappId: string): Promise<void> {
    const user = await userService.createUser({ whatsappId });

    if (!user?.preferencesCaptured) {
      await preferenceController.startPreferenceGathering(whatsappId);
    } else {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `👋 Welcome back ${user.name || 'there'}! Ready to find charging stations?`,
        [
          { id: 'quick_book', title: '⚡ Find Stations' },
          { id: 'view_profile', title: '👤 Profile' },
          { id: 'help', title: '❓ Help' }
        ],
        '⚡ SharaSpot'
      );
    }
  }

  private async startBooking(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Find Charging Stations*\n\nHow would you like to search?',
      [
        { id: 'share_gps_location', title: '📍 Share Location' },
        { id: 'type_address', title: '📝 Type Address' },
        { id: 'recent_searches', title: '🕒 Recent Searches' }
      ],
      '⚡ Find Stations'
    );
  }

  private async showHelp(whatsappId: string): Promise<void> {
    const helpText = `🔋 *SharaSpot Help*\n\n` +
      `*Quick Commands:*\n` +
      `• "find" or "book" - Find stations\n` +
      `• "gps" or "location" - Share GPS\n` +
      `• "nearby" - Find nearby stations\n` +
      `• "directions" - Get navigation\n` +
      `• "profile" - View your profile\n` +
      `• "preferences" - Update settings\n` +
      `• "help" - Show this help\n` +
      `• "owner" - Access owner portal\n\n` +
      `*How to Find Stations:*\n` +
      `1️⃣ Say "find" or tap "Find Stations"\n` +
      `2️⃣ Share location or type address\n` +
      `3️⃣ Browse and select stations\n` +
      `4️⃣ Book your charging slot\n\n` +
      `*Location Tips:*\n` +
      `📍 GPS gives most accurate results\n` +
      `📝 Type any address directly\n` +
      `🕒 Recent searches saved\n` +
      `🗺️ Use "directions" for navigation\n\n` +
      `Need more help? Just ask!`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  private async showLocationHelp(whatsappId: string): Promise<void> {
    const helpText = `📍 *Location Help*\n\n` +
      `*Share GPS Location:*\n` +
      `1️⃣ Tap 📎 attachment icon\n` +
      `2️⃣ Select "Location"\n` +
      `3️⃣ Choose "Send current location"\n` +
      `4️⃣ Tap "Send"\n\n` +
      `*Type Address:*\n` +
      `Just type your location:\n` +
      `• "Anna Nagar, Chennai"\n` +
      `• "Brigade Road, Bangalore"\n` +
      `• "Sector 18, Noida"\n\n` +
      `*Tips:*\n` +
      `• GPS location is most accurate\n` +
      `• Include city name\n` +
      `• Try nearby landmarks`;

    await whatsappService.sendButtonMessage(
      whatsappId,
      helpText,
      [
        { id: 'share_gps_location', title: '📍 Share GPS' },
        { id: 'type_address', title: '📝 Type Address' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ],
      '📍 Location Help'
    );
  }

  // ===============================================
  // INPUT REQUEST METHODS
  // ===============================================

  private async requestGPSLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📱 *Share Your GPS Location*\n\n' +
      '1️⃣ Tap 📎 attachment icon\n' +
      '2️⃣ Select "Location"\n' +
      '3️⃣ Choose "Send your current location"\n' +
      '4️⃣ Tap "Send"\n\n' +
      '🎯 This gives the most accurate results!\n\n' +
      '📝 Or type your address if you prefer'
    );
  }

  private async requestAddressInput(whatsappId: string): Promise<void> {
    if (this.waitingUsers.size >= this.MAX_WAITING_USERS) {
        logger.warn('Waiting users queue is full', { whatsappId });
        await whatsappService.sendTextMessage(whatsappId, 'System busy. Please try again later.');
        return;
    }

    this.waitingUsers.set(whatsappId, 'address');
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Type Your Address*\n\n' +
      'Enter the location where you need charging:\n\n' +
      '*Examples:*\n' +
      '• Anna Nagar, Chennai\n' +
      '• Brigade Road, Bangalore\n' +
      '• Sector 18, Noida\n' +
      '• Phoenix Mall, Mumbai\n\n' +
      'Just type the address!'
    );
  }

  private async requestProfileUpdate(whatsappId: string): Promise<void> {
    if (this.waitingUsers.size >= this.MAX_WAITING_USERS) {
        logger.warn('Waiting users queue is full', { whatsappId });
        await whatsappService.sendTextMessage(whatsappId, 'System busy. Please try again later.');
        return;
    }

    this.waitingUsers.set(whatsappId, 'name');
    await whatsappService.sendTextMessage(
      whatsappId,
      '✏️ *Update Your Name*\n\n' +
      'What would you like me to call you?\n\n' +
      '💡 Examples: Ravi Kumar, Ashreya, Pooja\n\n' +
      'Type your preferred name:'
    );
  }

  // ===============================================
  // INPUT PROCESSING
  // ===============================================

  private async processNameInput(whatsappId: string, name: string): Promise<void> {
    if (name.length < 2 || name.length > 50) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Please provide a valid name (2-50 characters).\n\nTry again:'
      );
      // Re-queue for name input if validation fails
      this.waitingUsers.set(whatsappId, 'name');
      return;
    }

    try {
      // Assuming updateUserName returns Promise<boolean>
      const success = await profileService.updateUserName(whatsappId, name);
      if (!success) {
        logger.error('Name update failed in service layer', { whatsappId, name });
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Failed to update name in the system. Please try again.'
        );
        this.waitingUsers.set(whatsappId, 'name'); // Retry
        return;
      }
      // Success: Name updated, no further action needed here.
      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Your name has been updated to *${name}*!`
      );
    } catch (error) {
      logger.error('❌ Name update process failed', { whatsappId, error: (error as Error).message });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to update name. Please try again.'
      );
      this.waitingUsers.set(whatsappId, 'name'); // Retry
    }
  }


  private async processAddressInput(whatsappId: string, address: string): Promise<void> {
    if (address.length < 5) { // Increased minimum length
      await whatsappService.sendTextMessage(whatsappId, '❌ Please provide a more specific address.');
      return;
    }

    await locationController.handleAddressInput(whatsappId, address);
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private isVerificationButton(buttonId: string): boolean {
    return [
      'confirm_start_reading',
      'confirm_end_reading',
      'retake_start_photo',
      'retake_end_photo',
      'manual_entry'
    ].includes(buttonId);
  }

  private isQueueButton(buttonId: string): boolean {
    const patterns = [
      'join_queue_', 'queue_status_', 'cancel_queue_', 'confirm_cancel_',
      'start_session_', 'session_stop_', 'session_status_', 'extend_',
      'nearby_alternatives_', 'cheaper_options_', 'faster_charging_',
      'smart_recommendation_', 'notify_when_ready_', 'live_updates_',
      'rate_1_', 'rate_2_', 'rate_3_', 'rate_4_', 'rate_5_'
    ];
    return patterns.some(p => buttonId.startsWith(p));
  }

  private isLocationButton(buttonId: string): boolean {
    const coreButtons = [
      'share_gps_location', 'type_address', 'try_different_address',
      'location_help', 'recent_searches', 'new_search',
      'next_station', 'load_more_stations', 'show_all_nearby',
      'show_all_results', 'back_to_search', 'back_to_list',
      'back_to_top_result', 'expand_search', 'remove_filters',
      'get_directions', 'directions_help'
    ];

    if (coreButtons.includes(buttonId)) return true;

    const prefixes = [
      'recent_search_', 'location_', 'search_',
      'station_info_', 'select_station_', 'book_station_'
    ];
    return prefixes.some(p => buttonId.startsWith(p));
  }

  private isLocationList(listId: string): boolean {
    const exactLists = ['recent_searches', 'location_options', 'search_results'];
    if (exactLists.includes(listId)) return true;

    const prefixes = ['recent_search_', 'location_', 'search_', 'select_station_'];
    return prefixes.some(p => listId.startsWith(p));
  }

  private async sendErrorMessage(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
    } catch (error) {
      logger.error('❌ Failed to send error message', {
        whatsappId,
        message,
        error: (error as Error).message
      });
    }
  }

  // ===============================================
  // MONITORING & CLEANUP
  // ===============================================

  public getStats() {
    return {
      waitingUsers: this.waitingUsers.size,
      processingMessages: this.processingMessages.size,
      deduplication: messageDeduplication.getStats()
    };
  }

  public cleanup(): void {
    this.waitingUsers.clear();
    this.processingMessages.clear();
    logger.info('✅ Webhook controller cleanup completed');
  }

  public getHealthStatus() {
    return {
      status: 'healthy' as const,
      waitingUsers: this.waitingUsers.size,
      processingMessages: this.processingMessages.size,
      uptime: Math.floor(process.uptime()) // More readable uptime in seconds
    };
  }
}

export const webhookController = new WebhookController();