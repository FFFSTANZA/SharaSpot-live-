import { whatsappService } from '../../services/whatsapp';
import { logger } from '../../utils/logger';
import { LocationContextManager } from './context-manager';

export class LocationDisplayController {
  private contextManager: LocationContextManager;

  constructor(contextManager: LocationContextManager) {
    this.contextManager = contextManager;
  }

  /**
   * Display station search results
   */
  async displayStationResults(whatsappId: string, searchResult: any, startIndex: number): Promise<void> {
    try {
      const { stations, totalCount, hasMore } = searchResult;
      
      if (stations.length === 0) {
        await this.handleNoStationsFound(whatsappId);
        return;
      }

      
      const topStation = stations[0];
      await this.showStationCard(whatsappId, topStation, startIndex + 1, totalCount);

      
      const buttons = [
        { id: `book_station_${topStation.id}`, title: '⚡ Book Now' },
        { id: `station_info_${topStation.id}`, title: '📋 More Info' },
      ];

      if (stations.length > 1) {
        buttons.push({ id: 'next_station', title: '➡️ Next Station' });
      }

      await whatsappService.sendButtonMessage(
        whatsappId,
        `*Station ${startIndex + 1} of ${totalCount}*\n\nWhat would you like to do?`,
        buttons,
        '🎯 Quick Actions'
      );

      
      if (stations.length > 1 || hasMore) {
        setTimeout(async () => {
          await this.showNavigationOptions(whatsappId, stations.length > 1, hasMore);
        }, 1000);
      }

    } catch (error) {
      logger.error('Failed to display station results', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        'Failed to display results. Please try again.'
      );
    }
  }

  /**
   * Show detailed station card
   */
  async showStationCard(whatsappId: string, station: any, position: number, total: number): Promise<void> {
    try {
      const {
        name,
        address,
        distance,
        availablePorts,
        totalPorts,
        connectorTypes,
        maxPowerKw,
        pricePerKwh,
        isAvailable,
        estimatedWaitMinutes,
        matchScore
      } = station;

      
      let statusIcon = '🔴';
      let statusText = 'Busy';
      
      if (isAvailable) {
        statusIcon = '🟢';
        statusText = 'Available';
      } else if (estimatedWaitMinutes <= 15) {
        statusIcon = '🟡';
        statusText = `~${estimatedWaitMinutes}min wait`;
      }

      
      const connectorDisplay = Array.isArray(connectorTypes) 
        ? connectorTypes.join(' • ')
        : connectorTypes || 'Multiple';

      
      let matchIcon = '⭐';
      if (matchScore >= 85) matchIcon = '🌟';
      else if (matchScore >= 70) matchIcon = '⭐';
      else if (matchScore >= 50) matchIcon = '✨';

      const stationCard = `${statusIcon} *${name}* ${matchIcon}\n\n` +
        `${address}\n` +
        `${distance}km away\n\n` +
        `${connectorDisplay}\n` +
        `${maxPowerKw}kW • ₹${pricePerKwh}/kWh\n` +
        `${availablePorts}/${totalPorts} ports ${statusText}\n\n` +
        `Match Score: ${matchScore}%`;

      await whatsappService.sendTextMessage(whatsappId, stationCard);

    } catch (error) {
      logger.error('Failed to show station card', { whatsappId, station, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load station details. Please try again.'
      );
    }
  }

  /**
   * Show navigation options
   */
  private async showNavigationOptions(whatsappId: string, hasMultiple: boolean, hasMore: boolean): Promise<void> {
    const navButtons = [];
    
    if (hasMultiple) {
      navButtons.push({ id: 'show_all_results', title: '📋 Show All Results' });
    }
    
    if (hasMore) {
      navButtons.push({ id: 'load_more_stations', title: '🔄 Load More Stations' });
    }
    
    navButtons.push({ id: 'new_search', title: '🔍 New Search' });

    if (navButtons.length > 0) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Or explore more options:',
        navButtons
      );
    }
  }

  /**
   * Show all nearby stations as a list
   */
  async showAllNearbyStations(whatsappId: string, stations: any[], totalCount: number): Promise<void> {
    try {
      if (stations.length === 0) {
        await this.handleNoStationsFound(whatsappId);
        return;
      }

      
      const stationRows = stations.slice(0, 10).map((station) => {
        const statusIcon = station.isAvailable ? '🟢' : station.estimatedWaitMinutes <= 15 ? '🟡' : '🔴';
        const title = `${statusIcon} ${station.name}`;
        const description = `${station.distance}km • ₹${station.pricePerKwh}/kWh • ${station.availablePorts}/${station.totalPorts} ports`;
        
        return {
          id: `select_station_${station.id}`,
          title: title.substring(0, 24), // WhatsApp title limit
          description: description.substring(0, 72), // WhatsApp description limit
        };
      });

      await whatsappService.sendListMessage(
        whatsappId,
        `📋 *${totalCount} stations found near you*\n\n🟢 Available • 🟡 Short wait • 🔴 Busy\n\nSelect a station to book:`,
        'Choose Station',
        [
          {
            title: '⚡ Available Stations',
            rows: stationRows,
          },
        ],
        '📋 All Nearby Stations'
      );

      
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Or:',
          [
            { id: 'back_to_top_result', title: '⬆️ Back to Top Result' },
            { id: 'new_search', title: '🔍 New Search' },
          ]
        );
      }, 1000);

    } catch (error) {
      logger.error('Failed to show all nearby stations', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load stations list. Please try again.'
      );
    }
  }

  /**
   * Handle no stations found
   */
  async handleNoStationsFound(whatsappId: string, address?: string): Promise<void> {
    const locationText = address ? `near "${address}"` : 'in this area';
    
    await whatsappService.sendButtonMessage(
      whatsappId,
      `😔 *No charging stations found ${locationText}*\n\nTry:\n• Expanding search radius\n• Different location\n• Removing filters`,
      [
        { id: 'expand_search', title: '🔍 Expand Search (50km)' },
        { id: 'new_search', title: '📍 Try Different Location' },
        { id: 'remove_filters', title: '🔧 Remove Filters' },
      ],
      '🔍 No Results'
    );
  }

  /**
   * Handle geocoding failed
   */
  async handleGeocodingFailed(whatsappId: string, address: string, recentSearches: string[]): Promise<void> {
    let message = `❓ *Couldn't find "${address}"*\n\nTry:\n• More specific address\n• City name only\n• Share GPS location instead`;
    
    if (recentSearches.length > 0) {
      message += `\n\n*Recent searches:*\n${recentSearches.map(s => `• ${s}`).join('\n')}`;
    }

    await whatsappService.sendButtonMessage(
      whatsappId,
      message,
      [
        { id: 'share_gps_location', title: '📱 Share GPS Location' },
        { id: 'try_different_address', title: '📝 Try Different Address' },
        { id: 'location_help', title: '❓ Location Help' },
      ],
      '🗺️ Location Not Found'
    );
  }

  /**
   * Show back to top result
   */
  async showBackToTopResult(whatsappId: string): Promise<void> {
    const context = this.contextManager.getLocationContext(whatsappId);
    if (!context?.lastSearchResults) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ No search results found. Please start a new search.'
      );
      return;
    }

    const topStation = context.lastSearchResults.stations[0];
    await this.showStationCard(whatsappId, topStation, 1, context.lastSearchResults.totalCount);
    
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Back to top result*',
      [
        { id: `book_station_${topStation.id}`, title: '⚡ Book Now' },
        { id: `station_info_${topStation.id}`, title: '📋 More Info' },
        { id: 'next_station', title: '➡️ Next Station' },
      ],
      '🎯 Quick Actions'
    );
  }
}