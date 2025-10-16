// src/controllers/location/webhook-location.ts - FULLY INTEGRATED & FIXED
import { whatsappService } from '../../services/whatsapp';
import { locationController } from './index';
import { bookingController } from '../booking';
import { queueService } from '../../services/queue';
import { userService } from '../../services/userService';
import { stationSearchService } from '../../services/location/station-search';
import { logger } from '../../utils/logger';
import { db } from '../../config/database';
import { eq } from 'drizzle-orm';

// Standardized button ID patterns - Same as queue webhook for consistency
const BUTTON_ID_PATTERNS = {
  BOOK_STATION: /^book_station_(\d+)$/,
  JOIN_QUEUE: /^join_queue_(\d+)$/,
  STATION_INFO: /^station_info_(\d+)$/,
  SELECT_STATION: /^select_station_(\d+)$/,
  CANCEL_QUEUE: /^cancel_queue_(\d+)$/,
  START_CHARGING: /^start_charging_(\d+)$/,
  RECENT_SEARCH: /^recent_search_(\d+)$/,
  GENERAL_STATION: /^(?:.*_)?station_(\d+)$/,
  GENERAL_ACTION: /^.*_(\d+)$/,
  NUMERIC_ONLY: /^(\d+)$/
};

export class WebhookLocationController {
  /**
   * Handle location-related button responses
   */
  async handleLocationButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    try {
      logger.info('Location button pressed', { whatsappId, buttonId, buttonTitle });

      // Parse button ID for consistent handling
      const { action, stationId } = this.parseButtonId(buttonId);

      // Handle standard navigation and search buttons
      switch (buttonId) {
        // Navigation buttons
        case 'next_station':
          await locationController.handleNextStation(whatsappId);
          break;

        case 'load_more_stations':
          await locationController.loadMoreStations(whatsappId);
          break;

        case 'show_all_results':
        case 'show_all_nearby':
          await locationController.showAllNearbyStations(whatsappId);
          break;

        case 'back_to_top_result':
          await this.backToTopResult(whatsappId);
          break;

        // Search modification buttons
        case 'expand_search':
          await this.expandSearchRadius(whatsappId);
          break;

        case 'remove_filters':
          await this.removeFilters(whatsappId);
          break;

        case 'new_search':
          await this.startNewSearch(whatsappId);
          break;

        // Location input buttons
        case 'share_gps_location':
          await this.requestGPSLocation(whatsappId);
          break;

        case 'try_different_address':
        case 'type_address':
          await this.requestAddressInput(whatsappId);
          break;

        case 'location_help':
          await this.showLocationHelp(whatsappId);
          break;

        // Recent searches
        case 'recent_searches':
          await locationController.showRecentSearches(whatsappId);
          break;

        // Queue management buttons
        case 'check_queue_status':
          await this.handleQueueStatus(whatsappId);
          break;

        case 'notify_when_ready':
          await this.setupNotificationAlerts(whatsappId);
          break;

        case 'find_other_stations':
          await this.findAlternativeStations(whatsappId);
          break;

        case 'back_to_search':
          await this.backToSearch(whatsappId);
          break;

        case 'back_to_list':
          await locationController.showAllNearbyStations(whatsappId);
          break;

        case 'get_directions':
          await this.handleGetDirections(whatsappId);
          break;

        // Handle station-specific actions with parsed IDs
        default:
          await this.handleStationActions(whatsappId, buttonId, action, stationId);
          break;
      }

    } catch (error) {
      logger.error('Failed to handle location button', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
    }
  }

  /**
   * Handle location-related list selections
   */
  async handleLocationList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    try {
      logger.info('Location list selected', { whatsappId, listId, listTitle });

      // Parse list ID for consistent handling
      const { action, stationId, additionalData } = this.parseButtonId(listId);

      if (listId.startsWith('select_station_')) {
        await this.handleStationSelection(whatsappId, stationId);
      } else if (listId.startsWith('recent_search_')) {
        const searchIndex = additionalData || stationId;
        await locationController.handleRecentSearchSelection(whatsappId, searchIndex);
      } else {
        logger.warn('Unknown location list selection', { whatsappId, listId });
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown selection. Please try again.'
        );
      }

    } catch (error) {
      logger.error('Failed to handle location list', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
    }
  }

  /**
   * Enhanced button ID parsing - consistent with queue webhook
   * ✅ FIXED: Added handling for start_charging_ pattern
   */
  private parseButtonId(buttonId: string): { action: string; stationId: number; additionalData?: number } {
    if (!buttonId) {
      return { action: '', stationId: 0 };
    }

    try {
      // ✅ FIX: Handle start_charging_123 pattern
      if (buttonId.match(BUTTON_ID_PATTERNS.START_CHARGING)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.START_CHARGING);
        return {
          action: 'start_charging',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle extend session: extend_30_123 -> minutes=30, stationId=123
      if (buttonId.match(/^extend_(\d+)_(\d+)$/)) {
        const match = buttonId.match(/^extend_(\d+)_(\d+)$/);
        return {
          action: 'extend',
          stationId: parseInt(match![2], 10),
          additionalData: parseInt(match![1], 10)
        };
      }

      // Handle rating: rate_5_123 -> rating=5, stationId=123
      if (buttonId.match(/^rate_(\d)_(\d+)$/)) {
        const match = buttonId.match(/^rate_(\d)_(\d+)$/);
        return {
          action: 'rate',
          stationId: parseInt(match![2], 10),
          additionalData: parseInt(match![1], 10)
        };
      }

      // Handle confirm cancel: confirm_cancel_123
      if (buttonId.match(/^confirm_cancel_(\d+)$/)) {
        const match = buttonId.match(/^confirm_cancel_(\d+)$/);
        return {
          action: 'confirm',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle book station: book_station_123
      if (buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION);
        return {
          action: 'book',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle join queue: join_queue_123
      if (buttonId.match(BUTTON_ID_PATTERNS.JOIN_QUEUE)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.JOIN_QUEUE);
        return {
          action: 'join',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle station info: station_info_123
      if (buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO);
        return {
          action: 'info',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle queue status: queue_status_123
      if (buttonId.match(/^queue_status_(\d+)$/)) {
        const match = buttonId.match(/^queue_status_(\d+)$/);
        return {
          action: 'queue',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle session start: start_session_123
      if (buttonId.match(/^start_session_(\d+)$/)) {
        const match = buttonId.match(/^start_session_(\d+)$/);
        return {
          action: 'start',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle cancel queue: cancel_queue_123
      if (buttonId.match(BUTTON_ID_PATTERNS.CANCEL_QUEUE)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.CANCEL_QUEUE);
        return {
          action: 'cancel',
          stationId: parseInt(match![1], 10)
        };
      }

      // Handle select station: select_station_123
      if (buttonId.match(BUTTON_ID_PATTERNS.SELECT_STATION)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.SELECT_STATION);
        return {
          action: 'select',
          stationId: parseInt(match![1], 10)
        };
      }

      // Generic patterns
      const parts = buttonId.split('_');
      const action = parts[0];

      // Try general station pattern
      if (buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION);
        return {
          action,
          stationId: parseInt(match![1], 10)
        };
      }

      // Try general action pattern
      if (buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION);
        return {
          action,
          stationId: parseInt(match![1], 10)
        };
      }

      // Try numeric only pattern
      if (buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY)) {
        const match = buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY);
        return {
          action: 'station',
          stationId: parseInt(match![1], 10)
        };
      }

      logger.warn('Could not parse button ID', { buttonId });
      return { action, stationId: 0 };

    } catch (error) {
      logger.error('Button ID parsing failed', { 
        buttonId, 
        error: error instanceof Error ? error.message : String(error)
      });
      return { action: '', stationId: 0 };
    }
  }

  /**
   * Handle station-specific actions with consistent delegation
   * ✅ FIXED: Added start_charging case
   */
  private async handleStationActions(whatsappId: string, buttonId: string, action: string, stationId: number): Promise<void> {
    if (!stationId) {
      logger.warn('No station ID found in button', { whatsappId, buttonId, action });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ Unknown option. Please try again or type "help".'
      );
      return;
    }

    switch (action) {
      case 'book':
        await this.handleStationBooking(whatsappId, stationId);
        break;
      
      case 'info':
        await this.showStationDetails(whatsappId, stationId);
        break;
      
      case 'join':
        await this.handleQueueJoin(whatsappId, stationId);
        break;
      
      case 'cancel':
        await this.handleQueueCancel(whatsappId, stationId);
        break;
      
      // ✅ FIX: Added explicit handler for start_charging action
      case 'start_charging':
        await this.handleChargingStart(whatsappId, stationId);
        break;
      
      case 'start':
        await this.handleChargingStart(whatsappId, stationId);
        break;
      
      case 'select':
        await this.handleStationSelection(whatsappId, stationId);
        break;
      
      default:
        // Try to handle as station selection if we have a valid ID
        if (stationId > 0) {
          await this.handleStationSelection(whatsappId, stationId);
        } else {
          logger.warn('Unknown station action', { whatsappId, buttonId, action, stationId });
          await whatsappService.sendTextMessage(
            whatsappId,
            '❓ Unknown option. Please try again or type "help".'
          );
        }
        break;
    }
  }

  // ===============================================
  // LOCATION HELPERS
  // ===============================================

  private async backToTopResult(whatsappId: string): Promise<void> {
    await locationController.showBackToTopResult(whatsappId);
  }

  private async expandSearchRadius(whatsappId: string): Promise<void> {
    await locationController.expandSearchRadius(whatsappId);
  }

  private async removeFilters(whatsappId: string): Promise<void> {
    await locationController.removeFilters(whatsappId);
  }

  private async startNewSearch(whatsappId: string): Promise<void> {
    locationController.clearLocationContext(whatsappId);
    
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Start New Search*\n\nWhere would you like to find charging stations?',
      [
        { id: 'share_gps_location', title: '📱 Share Current Location' },
        { id: 'type_address', title: '⌨️ Type Address' },
        { id: 'recent_searches', title: '🕒 Recent Searches' },
      ],
      '🔍 New Search'
    );
  }

  private async requestGPSLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📱 *Share Your GPS Location*\n\n' +
      '1️⃣ Tap the 📎 attachment icon\n' +
      '2️⃣ Select "Location"\n' +
      '3️⃣ Choose "Send your current location"\n' +
      '4️⃣ Tap "Send"\n\n' +
      '🎯 This gives the most accurate results!'
    );
  }

  private async requestAddressInput(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Type Your Address*\n\n' +
      'Enter the location where you need charging:\n\n' +
      '*Examples:*\n' +
      '• Connaught Place, Delhi\n' +
      '• Brigade Road, Bangalore\n' +
      '• Sector 18, Noida\n' +
      '• Phoenix Mall, Chennai\n\n' +
      'Just type the address and press send!'
    );
  }

  private async showLocationHelp(whatsappId: string): Promise<void> {
    await locationController.showLocationHelp(whatsappId);
  }

  private async backToSearch(whatsappId: string): Promise<void> {
    const context = locationController.getLocationContext(whatsappId);
    if (context?.currentLocation) {
      await locationController.showAllNearbyStations(whatsappId);
    } else {
      await this.startNewSearch(whatsappId);
    }
  }

  private async handleGetDirections(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🗺️ *Get Directions*\n\n' +
      'Navigation feature coming soon!\n\n' +
      'For now, you can:\n' +
      '• Copy the station address\n' +
      '• Use your preferred maps app\n' +
      '• Search for the station name'
    );
  }

  // ===============================================
  // STATION HANDLING - FULLY IMPLEMENTED & CONSISTENT
  // ===============================================

  private async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    try {
      if (!stationId || isNaN(stationId) || stationId <= 0) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
        return;
      }

      logger.info('Processing station selection', { whatsappId, stationId });
      await bookingController.handleStationSelection(whatsappId, stationId);

    } catch (error) {
      logger.error('Station selection failed', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to select station. Please try again.'
      );
    }
  }

  // ===============================================
  // BOOKING & QUEUE - CONSISTENT DELEGATION
  // ===============================================

  private async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Processing booking request from location', { whatsappId, stationId });
      await bookingController.handleStationBooking(whatsappId, stationId);
    } catch (error) {
      logger.error('Booking failed from location', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Booking failed. Please try again or join the queue.'
      );
    }
  }

  private async handleQueueJoin(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Processing queue join from location', { whatsappId, stationId });
      await bookingController.processQueueJoin(whatsappId, stationId);
    } catch (error) {
      logger.error('Queue join failed from location', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to join queue. Please try again.'
      );
    }
  }

  private async handleQueueStatus(whatsappId: string): Promise<void> {
    try {
      await bookingController.handleQueueStatus(whatsappId);
    } catch (error) {
      logger.error('Queue status check failed from location', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to get queue status.'
      );
    }
  }

  private async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    try {
      await bookingController.handleQueueCancel(whatsappId, stationId);
    } catch (error) {
      logger.error('Queue cancellation failed from location', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to cancel queue.'
      );
    }
  }

  /**
   * ✅ FIXED: Handle charging session start - Now properly integrated
   */
  private async handleChargingStart(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('🔌 Processing charging start request', { whatsappId, stationId });
      
      // Validate inputs
      if (!whatsappId || !stationId) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Invalid request. Please try again.'
        );
        return;
      }

      // Delegate to booking controller which handles session creation and photo verification
      await bookingController.handleChargingStart(whatsappId, stationId);
      
      logger.info('✅ Charging start request delegated successfully', { whatsappId, stationId });

    } catch (error) {
      logger.error('❌ Charging start failed from location', { 
        whatsappId, 
        stationId, 
        error: error instanceof Error ? error.message : String(error)
      });
      
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to start charging session. Please ensure you have a valid reservation and try again.'
      );
    }
  }

  private async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Showing station details from location', { whatsappId, stationId });
      await bookingController.showStationDetails(whatsappId, stationId);

    } catch (error) {
      logger.error('Failed to show station details from location', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load station details.'
      );
    }
  }

  // ===============================================
  // ADDITIONAL FEATURES
  // ===============================================

  private async setupNotificationAlerts(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔔 *Notification Setup*\n\n' +
      'You will receive updates about:\n' +
      '• Queue position changes\n' +
      '• Station availability\n' +
      '• Charging session status\n' +
      '• Payment confirmations\n\n' +
      '✅ Notifications are now enabled!'
    );

    try {
      await userService.updateUserProfile(whatsappId, { 
        phoneNumber: whatsappId
      });
    } catch (error) {
      logger.warn('Failed to update notification preferences', { whatsappId, error });
    }
  }

  private async findAlternativeStations(whatsappId: string): Promise<void> {
    const context = locationController.getLocationContext(whatsappId);
    if (context?.currentLocation?.latitude && context?.currentLocation?.longitude) {
      await locationController.expandSearchRadius(whatsappId);
    } else {
      await this.startNewSearch(whatsappId);
    }
  }
}

export const webhookLocationController = new WebhookLocationController();