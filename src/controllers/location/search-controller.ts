import { geocodingService } from '../../services/location/geocoding';
import { stationSearchService, type StationSearchOptions } from '../../services/location/station-search';
import { userService } from '../../services/userService';
import { whatsappService } from '../../services/whatsapp';
import { logger } from '../../utils/logger';
import { LocationContextManager } from './context-manager';
import { LocationDisplayController } from './display-controller';

export class LocationSearchController {
  private contextManager: LocationContextManager;
  private displayController: LocationDisplayController;

  constructor(contextManager: LocationContextManager, displayController: LocationDisplayController) {
    this.contextManager = contextManager;
    this.displayController = displayController;
  }

  /**
   * Search and display stations
   */
  async searchAndShowStations(whatsappId: string, latitude: number, longitude: number, address?: string): Promise<void> {
  try {
    logger.info('🔍 Starting station search', { 
      whatsappId, 
      coordinates: { latitude, longitude }, 
      address 
    });

    
    const user = await userService.getUserByWhatsAppId(whatsappId);
    if (!user) {
      logger.error('User not found for station search', { whatsappId });
      await whatsappService.sendTextMessage(
        whatsappId,
        'User profile not found. Please restart with /start command.'
      );
      return;
    }

    logger.info('User found for search', { 
      whatsappId, 
      userId: user.id, 
      hasPrefs: user.preferencesCaptured 
    });

    
    const searchOptions = {
      userWhatsapp: whatsappId,
      latitude,
      longitude,
      radius: 25, // 25km radius
      maxResults: 5, // Show top 5 initially
      offset: 0,
      availableOnly: user.queuePreference === 'Free Now',
      connectorTypes: user.connectorType ? [user.connectorType] : undefined,
      sortBy: 'availability' as const, // Priority: availability > distance > price
    };

    logger.info('Search options prepared', { whatsappId, searchOptions });

    
    let searchResult;
    try {
      searchResult = await stationSearchService.searchStations(searchOptions);
      
      logger.info('Station search service completed', { 
        whatsappId, 
        stationsFound: searchResult.stations?.length || 0,
        totalCount: searchResult.totalCount,
        hasMore: searchResult.hasMore
      });
      
    } catch (searchServiceError) {
      logger.error('station search service failed', { 
        whatsappId,
        searchOptions,
        error: searchServiceError instanceof Error ? searchServiceError.message : String(searchServiceError)
      });
      throw new Error(`Search service failed: ${searchServiceError}`);
    }

    
    try {
      this.contextManager.updateSearchResults(whatsappId, searchResult);
      logger.info('✅ Search results stored in context', { whatsappId });
    } catch (contextError) {
      logger.warn('⚠️ Failed to store search context', { whatsappId, contextError });
      
    }

    
    if (!searchResult.stations || searchResult.stations.length === 0) {
      logger.info('📍 No stations found', { whatsappId, searchLocation: { latitude, longitude, address } });
      await this.displayController.handleNoStationsFound(whatsappId, address);
      return;
    }

    
    try {
      await this.displayController.displayStationResults(whatsappId, searchResult, 0);
      logger.info('✅ Station results displayed successfully', { 
        whatsappId, 
        stationsShown: searchResult.stations.length 
      });
      
    } catch (displayError) {
      logger.error('❌ Failed to display station results', { 
        whatsappId,
        error: displayError instanceof Error ? displayError.message : String(displayError)
      });
      
      
      await whatsappService.sendTextMessage(
        whatsappId,
        `Found ${searchResult.stations.length} charging stations nearby!\n\n` +
        `Unfortunately, there was an issue displaying the results. Please try "find stations" again.`
      );
    }

  } catch (error) {
    logger.error('❌ Complete search process failed', { 
      whatsappId, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    await whatsappService.sendTextMessage(
      whatsappId,
      'Failed to search for stations. Please try again.\n\n' +
      'Troubleshooting tips:\n' +
      '• Make sure GPS is enabled on your phone\n' +
      '• Try typing your address instead\n' +
      '• Check your internet connection'
    );
  }
}
  /**
   * Handle next station request
   */
  async handleNextStation(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.lastSearchResults) {
        await whatsappService.sendTextMessage(
          whatsappId,
          'No active search. Please share your location first.'
        );
        return;
      }

      const { lastSearchResults } = context;
      const currentIndex = context.currentOffset + 1;

      if (currentIndex < lastSearchResults.stations.length) {
        
        this.contextManager.updateOffset(whatsappId, currentIndex);

        const station = lastSearchResults.stations[currentIndex];
        await this.displayController.showStationCard(whatsappId, station, currentIndex + 1, lastSearchResults.totalCount);
        
        const buttons = [
          { id: `book_station_${station.id}`, title: '⚡ Book Now' },
          { id: `station_info_${station.id}`, title: '📋 More Info' },
        ];

        if (currentIndex + 1 < lastSearchResults.stations.length) {
          buttons.push({ id: 'next_station', title: '➡️ Next Station' });
        }

        await whatsappService.sendButtonMessage(
          whatsappId,
          `*Station ${currentIndex + 1} of ${lastSearchResults.totalCount}*\n\nWhat would you like to do?`,
          buttons,
          'Quick Actions'
        );
      } else {
        
        await this.loadMoreStations(whatsappId);
      }

    } catch (error) {
      logger.error('Failed to handle next station', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load next station. Please try again.'
      );
    }
  }

  /**
   * Load more stations from server
   */
  async loadMoreStations(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔄 Loading more stations...'
      );

      
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) return;

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 25,
        maxResults: 5,
        offset: (context.lastSearchResults?.stations.length || 0),
        availableOnly: user.queuePreference === 'Free Now',
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'availability',
      };

      const newResults = await stationSearchService.searchStations(searchOptions);

      if (newResults.stations.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📍 No more stations found in this area.\n\nTry expanding your search or choosing a different location.'
        );
        return;
      }

      
      this.contextManager.mergeSearchResults(whatsappId, newResults);
      
      const updatedContext = this.contextManager.getLocationContext(whatsappId);
      if (updatedContext) {
        const newOffset = (updatedContext.lastSearchResults.stations.length || 1) - 1;
        this.contextManager.updateOffset(whatsappId, newOffset);

        
        const newStation = newResults.stations[0];
        await this.displayController.showStationCard(whatsappId, newStation, newOffset + 1, updatedContext.lastSearchResults.totalCount);
        
        await whatsappService.sendButtonMessage(
          whatsappId,
          `*Found ${newResults.stations.length} more stations!*`,
          [
            { id: `book_station_${newStation.id}`, title: '⚡ Book Now' },
            { id: `station_info_${newStation.id}`, title: '📋 More Info' },
            { id: 'next_station', title: '➡️ Next Station' },
          ],
          '🎯 Quick Actions'
        );
      }

    } catch (error) {
      logger.error('Failed to load more stations', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load more stations. Please try again.'
      );
    }
  }

  /**
   * Show all nearby stations
   */
  async showAllNearbyStations(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '📋 Loading all nearby stations...'
      );

      
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) return;

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 25,
        maxResults: 15, // Show more in list view
        offset: 0,
        availableOnly: false, // Show all stations
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'availability',
      };

      const results = await stationSearchService.getAllNearbyStations(searchOptions);

      await this.displayController.showAllNearbyStations(whatsappId, results.stations, results.totalCount);

    } catch (error) {
      logger.error('Failed to show all nearby stations', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load stations list. Please try again.'
      );
    }
  }

  /**
   * Expand search radius
   */
  async expandSearchRadius(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 *Expanding search to 50km radius...*\n\nLooking for more charging stations...'
      );

      
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) return;

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 50, // Expanded radius
        maxResults: 10,
        offset: 0,
        availableOnly: false, // Show all stations in expanded search
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'distance', // Sort by distance for expanded search
      };

      const results = await stationSearchService.searchStations(searchOptions);

      if (results.stations.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '😔 No stations found even within 50km.\n\nTry a different location or check back later.'
        );
        return;
      }

      
      this.contextManager.updateSearchResults(whatsappId, results);

      await whatsappService.sendTextMessage(
        whatsappId,
        `🎯 *Found ${results.totalCount} stations within 50km!*\n\nShowing results sorted by distance...`
      );

      
      await this.displayController.displayStationResults(whatsappId, results, 0);

    } catch (error) {
      logger.error('Failed to expand search', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to expand search. Please try again.'
      );
    }
  }

  /**
   * Remove search filters
   */
  async removeFilters(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔧 *Removing filters...*\n\nSearching for all charging stations regardless of availability and connector type...'
      );

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 25,
        maxResults: 10,
        offset: 0,
        availableOnly: false, // Remove availability filter
        connectorTypes: undefined, // Remove connector filter
        sortBy: 'distance',
      };

      const results = await stationSearchService.searchStations(searchOptions);

      if (results.stations.length === 0) {
        await this.displayController.handleNoStationsFound(whatsappId);
        return;
      }

      
      this.contextManager.updateSearchResults(whatsappId, results);

      await whatsappService.sendTextMessage(
        whatsappId,
        `🎯 *Found ${results.totalCount} stations (all types)*\n\nShowing all available options...`
      );

      
      await this.displayController.displayStationResults(whatsappId, results, 0);

    } catch (error) {
      logger.error('Failed to remove filters', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to remove filters. Please try again.'
      );
    }
  }
}
