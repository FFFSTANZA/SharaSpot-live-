"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocationSearchController = void 0;
const station_search_1 = require("../../services/location/station-search");
const userService_1 = require("../../services/userService");
const whatsapp_1 = require("../../services/whatsapp");
const logger_1 = require("../../utils/logger");
class LocationSearchController {
    constructor(contextManager, displayController) {
        this.contextManager = contextManager;
        this.displayController = displayController;
    }
    async searchAndShowStations(whatsappId, latitude, longitude, address) {
        try {
            logger_1.logger.info('🔍 Starting station search', {
                whatsappId,
                coordinates: { latitude, longitude },
                address
            });
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user) {
                logger_1.logger.error('User not found for station search', { whatsappId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'User profile not found. Please restart with /start command.');
                return;
            }
            logger_1.logger.info('User found for search', {
                whatsappId,
                userId: user.id,
                hasPrefs: user.preferencesCaptured
            });
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude,
                longitude,
                radius: 25,
                maxResults: 5,
                offset: 0,
                availableOnly: user.queuePreference === 'Free Now',
                connectorTypes: user.connectorType ? [user.connectorType] : undefined,
                sortBy: 'availability',
            };
            logger_1.logger.info('Search options prepared', { whatsappId, searchOptions });
            let searchResult;
            try {
                searchResult = await station_search_1.stationSearchService.searchStations(searchOptions);
                logger_1.logger.info('Station search service completed', {
                    whatsappId,
                    stationsFound: searchResult.stations?.length || 0,
                    totalCount: searchResult.totalCount,
                    hasMore: searchResult.hasMore
                });
            }
            catch (searchServiceError) {
                logger_1.logger.error('station search service failed', {
                    whatsappId,
                    searchOptions,
                    error: searchServiceError instanceof Error ? searchServiceError.message : String(searchServiceError)
                });
                throw new Error(`Search service failed: ${searchServiceError}`);
            }
            try {
                this.contextManager.updateSearchResults(whatsappId, searchResult);
                logger_1.logger.info('✅ Search results stored in context', { whatsappId });
            }
            catch (contextError) {
                logger_1.logger.warn('⚠️ Failed to store search context', { whatsappId, contextError });
            }
            if (!searchResult.stations || searchResult.stations.length === 0) {
                logger_1.logger.info('📍 No stations found', { whatsappId, searchLocation: { latitude, longitude, address } });
                await this.displayController.handleNoStationsFound(whatsappId, address);
                return;
            }
            try {
                await this.displayController.displayStationResults(whatsappId, searchResult, 0);
                logger_1.logger.info('✅ Station results displayed successfully', {
                    whatsappId,
                    stationsShown: searchResult.stations.length
                });
            }
            catch (displayError) {
                logger_1.logger.error('❌ Failed to display station results', {
                    whatsappId,
                    error: displayError instanceof Error ? displayError.message : String(displayError)
                });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `Found ${searchResult.stations.length} charging stations nearby!\n\n` +
                    `Unfortunately, there was an issue displaying the results. Please try "find stations" again.`);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Complete search process failed', {
                whatsappId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to search for stations. Please try again.\n\n' +
                'Troubleshooting tips:\n' +
                '• Make sure GPS is enabled on your phone\n' +
                '• Try typing your address instead\n' +
                '• Check your internet connection');
        }
    }
    async handleNextStation(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.lastSearchResults) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'No active search. Please share your location first.');
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
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `*Station ${currentIndex + 1} of ${lastSearchResults.totalCount}*\n\nWhat would you like to do?`, buttons, 'Quick Actions');
            }
            else {
                await this.loadMoreStations(whatsappId);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle next station', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load next station. Please try again.');
        }
    }
    async loadMoreStations(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔄 Loading more stations...');
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user)
                return;
            const searchOptions = {
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
            const newResults = await station_search_1.stationSearchService.searchStations(searchOptions);
            if (newResults.stations.length === 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📍 No more stations found in this area.\n\nTry expanding your search or choosing a different location.');
                return;
            }
            this.contextManager.mergeSearchResults(whatsappId, newResults);
            const updatedContext = this.contextManager.getLocationContext(whatsappId);
            if (updatedContext) {
                const newOffset = (updatedContext.lastSearchResults.stations.length || 1) - 1;
                this.contextManager.updateOffset(whatsappId, newOffset);
                const newStation = newResults.stations[0];
                await this.displayController.showStationCard(whatsappId, newStation, newOffset + 1, updatedContext.lastSearchResults.totalCount);
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `*Found ${newResults.stations.length} more stations!*`, [
                    { id: `book_station_${newStation.id}`, title: '⚡ Book Now' },
                    { id: `station_info_${newStation.id}`, title: '📋 More Info' },
                    { id: 'next_station', title: '➡️ Next Station' },
                ], '🎯 Quick Actions');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to load more stations', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load more stations. Please try again.');
        }
    }
    async showAllNearbyStations(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 Loading all nearby stations...');
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user)
                return;
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude: context.currentLocation.latitude,
                longitude: context.currentLocation.longitude,
                radius: 25,
                maxResults: 15,
                offset: 0,
                availableOnly: false,
                connectorTypes: user.connectorType ? [user.connectorType] : undefined,
                sortBy: 'availability',
            };
            const results = await station_search_1.stationSearchService.getAllNearbyStations(searchOptions);
            await this.displayController.showAllNearbyStations(whatsappId, results.stations, results.totalCount);
        }
        catch (error) {
            logger_1.logger.error('Failed to show all nearby stations', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load stations list. Please try again.');
        }
    }
    async expandSearchRadius(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔍 *Expanding search to 50km radius...*\n\nLooking for more charging stations...');
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user)
                return;
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude: context.currentLocation.latitude,
                longitude: context.currentLocation.longitude,
                radius: 50,
                maxResults: 10,
                offset: 0,
                availableOnly: false,
                connectorTypes: user.connectorType ? [user.connectorType] : undefined,
                sortBy: 'distance',
            };
            const results = await station_search_1.stationSearchService.searchStations(searchOptions);
            if (results.stations.length === 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '😔 No stations found even within 50km.\n\nTry a different location or check back later.');
                return;
            }
            this.contextManager.updateSearchResults(whatsappId, results);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🎯 *Found ${results.totalCount} stations within 50km!*\n\nShowing results sorted by distance...`);
            await this.displayController.displayStationResults(whatsappId, results, 0);
        }
        catch (error) {
            logger_1.logger.error('Failed to expand search', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to expand search. Please try again.');
        }
    }
    async removeFilters(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔧 *Removing filters...*\n\nSearching for all charging stations regardless of availability and connector type...');
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude: context.currentLocation.latitude,
                longitude: context.currentLocation.longitude,
                radius: 25,
                maxResults: 10,
                offset: 0,
                availableOnly: false,
                connectorTypes: undefined,
                sortBy: 'distance',
            };
            const results = await station_search_1.stationSearchService.searchStations(searchOptions);
            if (results.stations.length === 0) {
                await this.displayController.handleNoStationsFound(whatsappId);
                return;
            }
            this.contextManager.updateSearchResults(whatsappId, results);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🎯 *Found ${results.totalCount} stations (all types)*\n\nShowing all available options...`);
            await this.displayController.displayStationResults(whatsappId, results, 0);
        }
        catch (error) {
            logger_1.logger.error('Failed to remove filters', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to remove filters. Please try again.');
        }
    }
}
exports.LocationSearchController = LocationSearchController;
//# sourceMappingURL=search-controller.js.map