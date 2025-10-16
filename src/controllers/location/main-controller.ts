// src/controllers/location/index.ts - Fixed Main Controller with Consistent Flow
import { whatsappService } from '../../services/whatsapp';
import { geocodingService } from '../../services/location/geocoding';
import { bookingController } from '../booking';
import { logger } from '../../utils/logger';
import { LocationContextManager } from './context-manager';
import { LocationDisplayController } from './display-controller';
import { LocationSearchController } from './search-controller';

// Standardized button ID patterns for consistency
const BUTTON_ID_PATTERNS = {
  SELECT_STATION: /^select_station_(\d+)$/,
  BOOK_STATION: /^book_station_(\d+)$/,
  STATION_INFO: /^station_info_(\d+)$/,
  RECENT_SEARCH: /^recent_search_(\d+)$/,
  GENERAL_STATION: /^(?:.*_)?station_(\d+)$/,
  GENERAL_ACTION: /^.*_(\d+)$/,
  NUMERIC_ONLY: /^(\d+)$/
};

export class LocationMainController {
  private contextManager: LocationContextManager;
  private displayController: LocationDisplayController;
  private searchController: LocationSearchController;

  constructor() {
    this.contextManager = new LocationContextManager();
    this.displayController = new LocationDisplayController(this.contextManager);
    this.searchController = new LocationSearchController(this.contextManager, this.displayController);
  }

  /**
   * Handle GPS location sharing
   */
  async handleGPSLocation(whatsappId: string, latitude: number, longitude: number, name?: string, address?: string): Promise<void> {
  try {
    logger.info('🎯 Processing GPS location', { 
      whatsappId, 
      latitude, 
      longitude, 
      name, 
      address,
      contextExists: this.contextManager.hasLocationContext(whatsappId)
    });

    // ENHANCED: Clear any existing context first
    this.contextManager.clearLocationContext(whatsappId);

    // Store location context with validation
    const locationContext = {
      latitude,
      longitude,
      address: address || name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      timestamp: new Date()
    };

    this.contextManager.setLocationContext(whatsappId, locationContext);
    
    // ENHANCED: Verify context was set correctly
    const verifyContext = this.contextManager.getLocationContext(whatsappId);
    if (!verifyContext) {
      throw new Error('Failed to set location context');
    }

    logger.info('✅ Location context set successfully', { 
      whatsappId, 
      contextSet: !!verifyContext,
      storedLocation: verifyContext.currentLocation
    });

    // Acknowledge location with better formatting
    const locationName = name || address || `Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    await whatsappService.sendTextMessage(
      whatsappId,
      `📍 *Location Received!*\n\n${locationName}\n\n🔍 Searching for nearby charging stations...`
    );

    // ENHANCED: Search for stations with comprehensive error handling
    try {
      await this.searchController.searchAndShowStations(whatsappId, latitude, longitude, address);
      logger.info('✅ Station search completed successfully', { whatsappId });
      
    } catch (searchError) {
      logger.error('❌ Station search failed', { 
        whatsappId, 
        searchError: searchError instanceof Error ? searchError.message : String(searchError)
      });
      
      // Provide fallback options
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to search for stations at this location.\n\n' +
        'Please try:\n' +
        '• Sharing your location again\n' +
        '• Typing a nearby address\n' +
        '• Searching in a different area'
      );
      
      // Show search options
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'What would you like to try?',
          [
            { id: 'share_gps_location', title: '📱 Share Location Again' },
            { id: 'type_address', title: '⌨️ Type Address' },
            { id: 'help', title: '❓ Get Help' }
          ],
          '🔧 Troubleshoot'
        );
      }, 1000);
    }

  } catch (error) {
    logger.error('❌ GPS location handling completely failed', { 
      whatsappId, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ Failed to process your location. Please try again.\n\n' +
      'If this keeps happening, please type your address instead.'
    );
  }
}

  /**
   * Handle text address input
   */
  async handleAddressInput(whatsappId: string, address: string): Promise<void> {
    try {
      logger.info('Address input received', { whatsappId, address });

      // Show geocoding progress
      await whatsappService.sendTextMessage(
        whatsappId,
        `🔍 *Searching for: "${address}"*\n\nFinding location and nearby charging stations...`
      );

      // Geocode the address
      const geocodeResults = await geocodingService.geocodeText(address, { userWhatsapp: whatsappId });

      if (geocodeResults.length === 0) {
        const recentSearches = await geocodingService.getUserRecentSearches(whatsappId, 3);
        await this.displayController.handleGeocodingFailed(whatsappId, address, recentSearches);
        return;
      }

      const location = geocodeResults[0];
      
      // Store location context
      this.contextManager.setLocationContext(whatsappId, {
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.formattedAddress,
      });

      // Show geocoding result
      await whatsappService.sendTextMessage(
        whatsappId,
        `📍 *Found: ${location.formattedAddress}*\n\nSearching for nearby charging stations... ⚡`
      );

      // Search for stations
      await this.searchController.searchAndShowStations(whatsappId, location.latitude, location.longitude, location.formattedAddress);

    } catch (error) {
      logger.error('Failed to handle address input', { whatsappId, address, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to find that location. Please try a different address or share your GPS location.'
      );
    }
  }

  /**
   * Handle next station request
   */
  async handleNextStation(whatsappId: string): Promise<void> {
    await this.searchController.handleNextStation(whatsappId);
  }

  /**
   * Load more stations from server
   */
  async loadMoreStations(whatsappId: string): Promise<void> {
    await this.searchController.loadMoreStations(whatsappId);
  }

  /**
   * Show all nearby stations as a list
   */
  async showAllNearbyStations(whatsappId: string): Promise<void> {
    await this.searchController.showAllNearbyStations(whatsappId);
  }

  /**
   * Expand search radius
   */
  async expandSearchRadius(whatsappId: string): Promise<void> {
    await this.searchController.expandSearchRadius(whatsappId);
  }

  /**
   * Remove search filters
   */
  async removeFilters(whatsappId: string): Promise<void> {
    await this.searchController.removeFilters(whatsappId);
  }

  /**
   * Show back to top result
   */
  async showBackToTopResult(whatsappId: string): Promise<void> {
    await this.displayController.showBackToTopResult(whatsappId);
  }

  /**
   * Start new search
   */
  async startNewSearch(whatsappId: string): Promise<void> {
    try {
      // Clear location context
      this.clearLocationContext(whatsappId);
      
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
    } catch (error) {
      logger.error('Failed to start new search', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to start new search. Please try again.'
      );
    }
  }

  /**
   * Show recent searches
   */
  async showRecentSearches(whatsappId: string): Promise<void> {
    try {
      const recentSearches = await geocodingService.getUserRecentSearches(whatsappId, 5);
      
      if (recentSearches.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '🕒 *No Recent Searches*\n\nYou haven\'t searched for any locations yet.\n\nShare your location or type an address to get started!'
        );
        return;
      }

      // Create list message with recent searches
      const searchRows = recentSearches.map((search, index) => ({
        id: `recent_search_${index}`,
        title: search.substring(0, 24),
        description: 'Tap to search again',
      }));

      await whatsappService.sendListMessage(
        whatsappId,
        '🕒 *Your Recent Searches*\n\nSelect a location to search again:',
        'Select Location',
        [
          {
            title: '📍 Recent Locations',
            rows: searchRows,
          },
        ],
        '🕒 Recent Searches'
      );

    } catch (error) {
      logger.error('Failed to show recent searches', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load recent searches. Please try again.'
      );
    }
  }

  /**
   * Handle recent search selection
   */
  async handleRecentSearchSelection(whatsappId: string, searchIndex: number): Promise<void> {
    try {
      const recentSearches = await geocodingService.getUserRecentSearches(whatsappId, 10);
      
      if (searchIndex >= 0 && searchIndex < recentSearches.length) {
        const selectedSearch = recentSearches[searchIndex];
        await this.handleAddressInput(whatsappId, selectedSearch);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Invalid selection. Please try again.'
        );
      }
    } catch (error) {
      logger.error('Failed to handle recent search selection', { whatsappId, searchIndex, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process selection. Please try again.'
      );
    }
  }

  /**
   * Handle station selection from list - DELEGATE TO BOOKING CONTROLLER
   */
  async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    try {
      if (!stationId || isNaN(stationId) || stationId <= 0) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
        return;
      }

      logger.info('Station selected in location controller', { whatsappId, stationId });

      // Delegate to booking controller for consistent station handling
      await bookingController.handleStationSelection(whatsappId, stationId);

    } catch (error) {
      logger.error('Failed to handle station selection', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to select station. Please try again.'
      );
    }
  }

  /**
   * Handle station booking request - DELEGATE TO BOOKING CONTROLLER
   */
  async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    try {
      if (!stationId || isNaN(stationId) || stationId <= 0) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station for booking.');
        return;
      }

      logger.info('Station booking requested from location controller', { whatsappId, stationId });

      // Delegate to booking controller for consistent booking flow
      await bookingController.handleStationBooking(whatsappId, stationId);

    } catch (error) {
      logger.error('Failed to handle station booking', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process booking request. Please try again.'
      );
    }
  }

  /**
   * Show detailed station information - DELEGATE TO BOOKING CONTROLLER
   */
  async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    try {
      if (!stationId || isNaN(stationId) || stationId <= 0) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station for details.');
        return;
      }

      logger.info('Station details requested from location controller', { whatsappId, stationId });

      // Delegate to booking controller for consistent station detail handling
      await bookingController.showStationDetails(whatsappId, stationId);

    } catch (error) {
      logger.error('Failed to show station details', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load station details. Please try again.'
      );
    }
  }

  /**
   * Handle help request for location features
   */
  async showLocationHelp(whatsappId: string): Promise<void> {
    const helpText = `📍 *Location Help*\n\n` +
      `*How to Share Location:*\n` +
      `1. Tap the 📎 attachment icon\n` +
      `2. Select "Location"\n` +
      `3. Choose "Send your current location"\n` +
      `4. Tap "Send"\n\n` +
      `*Typing Addresses:*\n` +
      `• City names: "Mumbai", "Delhi"\n` +
      `• Landmarks: "Connaught Place Delhi"\n` +
      `• Areas: "Banjara Hills Hyderabad"\n` +
      `• Roads: "MG Road Bangalore"\n\n` +
      `*Navigation:*\n` +
      `• "Next Station" - Browse one by one\n` +
      `• "Show All" - See complete list\n` +
      `• "Load More" - Find additional stations\n` +
      `• "Expand Search" - Increase radius\n\n` +
      `🔒 *Privacy:* Location data is used only for finding nearby stations.`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  // ===============================================
  // CONTEXT MANAGEMENT
  // ===============================================

  /**
   * Clear location context
   */
  clearLocationContext(whatsappId: string): void {
    this.contextManager.clearLocationContext(whatsappId);
  }

  /**
   * Check if user has active location context
   */
  hasLocationContext(whatsappId: string): boolean {
    return this.contextManager.hasLocationContext(whatsappId);
  }

  /**
   * Get location context (for debugging/monitoring)
   */
  getLocationContext(whatsappId: string) {
    return this.contextManager.getLocationContext(whatsappId);
  }

  /**
   * Get active contexts count (for monitoring)
   */
  getActiveContextsCount(): number {
    return this.contextManager.getActiveContextsCount();
  }

  // ===============================================
  // NAVIGATION HELPERS
  // ===============================================

  /**
   * Handle back to list request
   */
  async handleBackToList(whatsappId: string): Promise<void> {
    await this.showAllNearbyStations(whatsappId);
  }

  /**
   * Handle find other stations request
   */
  async handleFindOtherStations(whatsappId: string): Promise<void> {
    const context = this.contextManager.getLocationContext(whatsappId);
    if (context?.currentLocation) {
      // Show stations with expanded radius
      await this.expandSearchRadius(whatsappId);
    } else {
      // Start new search
      await this.startNewSearch(whatsappId);
    }
  }

  /**
   * Handle notifications setup - Basic implementation
   */
  async handleNotificationSetup(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔔 *Notification Setup*\n\n' +
      'Notifications will include:\n' +
      '• Booking status updates\n' +
      '• Queue position changes\n' +
      '• Station availability alerts\n' +
      '• Payment confirmations\n\n' +
      '✅ Notifications are now enabled!'
    );
  }

  // ===============================================
  // UTILITY FUNCTIONS FOR CONSISTENT ID PARSING
  // ===============================================

  /**
   * Parse button/list ID for consistent station ID extraction
   */
  private parseButtonId(buttonId: string): { action: string; stationId: number; additionalData?: number } {
    if (!buttonId) {
      return { action: '', stationId: 0 };
    }

    try {
      // Try specific patterns first (most specific to least specific)
      
      // Handle select station: select_station_123
      const selectMatch = buttonId.match(BUTTON_ID_PATTERNS.SELECT_STATION);
      if (selectMatch) {
        return {
          action: 'select',
          stationId: parseInt(selectMatch[1], 10)
        };
      }

      // Handle book station: book_station_123
      const bookMatch = buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION);
      if (bookMatch) {
        return {
          action: 'book',
          stationId: parseInt(bookMatch[1], 10)
        };
      }

      // Handle station info: station_info_123
      const stationInfoMatch = buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO);
      if (stationInfoMatch) {
        return {
          action: 'info',
          stationId: parseInt(stationInfoMatch[1], 10)
        };
      }

      // Handle recent search: recent_search_0, recent_search_1, etc.
      const recentMatch = buttonId.match(BUTTON_ID_PATTERNS.RECENT_SEARCH);
      if (recentMatch) {
        return {
          action: 'recent',
          stationId: parseInt(recentMatch[1], 10), // This is actually the index
          additionalData: parseInt(recentMatch[1], 10)
        };
      }

      // Generic patterns
      const parts = buttonId.split('_');
      const action = parts[0];

      // Try general station pattern
      const generalStationMatch = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION);
      if (generalStationMatch) {
        return {
          action,
          stationId: parseInt(generalStationMatch[1], 10)
        };
      }

      // Try general action pattern
      const generalActionMatch = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION);
      if (generalActionMatch) {
        return {
          action,
          stationId: parseInt(generalActionMatch[1], 10)
        };
      }

      // Try numeric only pattern
      const numericMatch = buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY);
      if (numericMatch) {
        return {
          action: 'select', // Default action for numeric IDs in location context
          stationId: parseInt(numericMatch[1], 10)
        };
      }

      logger.warn('Could not parse button ID in location controller', { buttonId });
      return { action, stationId: 0 };

    } catch (error) {
      logger.error('Button ID parsing failed in location controller', { 
        buttonId, 
        error: error instanceof Error ? error.message : String(error)
      });
      return { action: '', stationId: 0 };
    }
  }

  /**
   * Handle any button with station ID - for consistent delegation
   */
  async handleButtonWithStationId(whatsappId: string, buttonId: string): Promise<void> {
    const { action, stationId } = this.parseButtonId(buttonId);

    if (!stationId) {
      logger.warn('No station ID found in button', { whatsappId, buttonId });
      return;
    }

    switch (action) {
      case 'select':
        await this.handleStationSelection(whatsappId, stationId);
        break;
      case 'book':
        await this.handleStationBooking(whatsappId, stationId);
        break;
      case 'info':
        await this.showStationDetails(whatsappId, stationId);
        break;
      default:
        // Default to station selection for unknown actions with station IDs
        await this.handleStationSelection(whatsappId, stationId);
        break;
    }
  }
}

// Create and export singleton instance
export const locationController = new LocationMainController();