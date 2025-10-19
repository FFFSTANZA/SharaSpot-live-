"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locationController = exports.LocationMainController = void 0;
const whatsapp_1 = require("../../services/whatsapp");
const geocoding_1 = require("../../services/location/geocoding");
const booking_1 = require("../booking");
const logger_1 = require("../../utils/logger");
const context_manager_1 = require("./context-manager");
const display_controller_1 = require("./display-controller");
const search_controller_1 = require("./search-controller");
const BUTTON_ID_PATTERNS = {
    SELECT_STATION: /^select_station_(\d+)$/,
    BOOK_STATION: /^book_station_(\d+)$/,
    STATION_INFO: /^station_info_(\d+)$/,
    RECENT_SEARCH: /^recent_search_(\d+)$/,
    GENERAL_STATION: /^(?:.*_)?station_(\d+)$/,
    GENERAL_ACTION: /^.*_(\d+)$/,
    NUMERIC_ONLY: /^(\d+)$/
};
class LocationMainController {
    constructor() {
        this.contextManager = new context_manager_1.LocationContextManager();
        this.displayController = new display_controller_1.LocationDisplayController(this.contextManager);
        this.searchController = new search_controller_1.LocationSearchController(this.contextManager, this.displayController);
    }
    async handleGPSLocation(whatsappId, latitude, longitude, name, address) {
        try {
            logger_1.logger.info('🎯 Processing GPS location', {
                whatsappId,
                latitude,
                longitude,
                name,
                address,
                contextExists: this.contextManager.hasLocationContext(whatsappId)
            });
            this.contextManager.clearLocationContext(whatsappId);
            const locationContext = {
                latitude,
                longitude,
                address: address || name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                timestamp: new Date()
            };
            this.contextManager.setLocationContext(whatsappId, locationContext);
            const verifyContext = this.contextManager.getLocationContext(whatsappId);
            if (!verifyContext) {
                throw new Error('Failed to set location context');
            }
            logger_1.logger.info('✅ Location context set successfully', {
                whatsappId,
                contextSet: !!verifyContext,
                storedLocation: verifyContext.currentLocation
            });
            const locationName = name || address || `Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 *Location Received!*\n\n${locationName}\n\n🔍 Searching for nearby charging stations...`);
            try {
                await this.searchController.searchAndShowStations(whatsappId, latitude, longitude, address);
                logger_1.logger.info('✅ Station search completed successfully', { whatsappId });
            }
            catch (searchError) {
                logger_1.logger.error('❌ Station search failed', {
                    whatsappId,
                    searchError: searchError instanceof Error ? searchError.message : String(searchError)
                });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to search for stations at this location.\n\n' +
                    'Please try:\n' +
                    '• Sharing your location again\n' +
                    '• Typing a nearby address\n' +
                    '• Searching in a different area');
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'What would you like to try?', [
                        { id: 'share_gps_location', title: '📱 Share Location Again' },
                        { id: 'type_address', title: '⌨️ Type Address' },
                        { id: 'help', title: '❓ Get Help' }
                    ], '🔧 Troubleshoot');
                }, 1000);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ GPS location handling completely failed', {
                whatsappId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process your location. Please try again.\n\n' +
                'If this keeps happening, please type your address instead.');
        }
    }
    async handleAddressInput(whatsappId, address) {
        try {
            logger_1.logger.info('Address input received', { whatsappId, address });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🔍 *Searching for: "${address}"*\n\nFinding location and nearby charging stations...`);
            const geocodeResults = await geocoding_1.geocodingService.geocodeText(address, { userWhatsapp: whatsappId });
            if (geocodeResults.length === 0) {
                const recentSearches = await geocoding_1.geocodingService.getUserRecentSearches(whatsappId, 3);
                await this.displayController.handleGeocodingFailed(whatsappId, address, recentSearches);
                return;
            }
            const location = geocodeResults[0];
            this.contextManager.setLocationContext(whatsappId, {
                latitude: location.latitude,
                longitude: location.longitude,
                address: location.formattedAddress,
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Found: ${location.formattedAddress}*\n\nSearching for nearby charging stations... ⚡`);
            await this.searchController.searchAndShowStations(whatsappId, location.latitude, location.longitude, location.formattedAddress);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle address input', { whatsappId, address, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to find that location. Please try a different address or share your GPS location.');
        }
    }
    async handleNextStation(whatsappId) {
        await this.searchController.handleNextStation(whatsappId);
    }
    async loadMoreStations(whatsappId) {
        await this.searchController.loadMoreStations(whatsappId);
    }
    async showAllNearbyStations(whatsappId) {
        await this.searchController.showAllNearbyStations(whatsappId);
    }
    async expandSearchRadius(whatsappId) {
        await this.searchController.expandSearchRadius(whatsappId);
    }
    async removeFilters(whatsappId) {
        await this.searchController.removeFilters(whatsappId);
    }
    async showBackToTopResult(whatsappId) {
        await this.displayController.showBackToTopResult(whatsappId);
    }
    async startNewSearch(whatsappId) {
        try {
            this.clearLocationContext(whatsappId);
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Start New Search*\n\nWhere would you like to find charging stations?', [
                { id: 'share_gps_location', title: '📱 Share Current Location' },
                { id: 'type_address', title: '⌨️ Type Address' },
                { id: 'recent_searches', title: '🕒 Recent Searches' },
            ], '🔍 New Search');
        }
        catch (error) {
            logger_1.logger.error('Failed to start new search', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to start new search. Please try again.');
        }
    }
    async showRecentSearches(whatsappId) {
        try {
            const recentSearches = await geocoding_1.geocodingService.getUserRecentSearches(whatsappId, 5);
            if (recentSearches.length === 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*No Recent Searches*\n\nYou haven\'t searched for any locations yet.\n\nShare your location or type an address to get started!');
                return;
            }
            const searchRows = recentSearches.map((search, index) => ({
                id: `recent_search_${index}`,
                title: search.substring(0, 24),
                description: 'Tap to search again',
            }));
            await whatsapp_1.whatsappService.sendListMessage(whatsappId, '*Your Recent Searches*\n\nSelect a location to search again:', 'Select Location', [
                {
                    title: '📍 Recent Locations',
                    rows: searchRows,
                },
            ], '🕒 Recent Searches');
        }
        catch (error) {
            logger_1.logger.error('Failed to show recent searches', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to load recent searches. Please try again.');
        }
    }
    async handleRecentSearchSelection(whatsappId, searchIndex) {
        try {
            const recentSearches = await geocoding_1.geocodingService.getUserRecentSearches(whatsappId, 10);
            if (searchIndex >= 0 && searchIndex < recentSearches.length) {
                const selectedSearch = recentSearches[searchIndex];
                await this.handleAddressInput(whatsappId, selectedSearch);
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Invalid selection. Please try again.');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle recent search selection', { whatsappId, searchIndex, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process selection. Please try again.');
        }
    }
    async handleStationSelection(whatsappId, stationId) {
        try {
            if (!stationId || isNaN(stationId) || stationId <= 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
                return;
            }
            logger_1.logger.info('Station selected in location controller', { whatsappId, stationId });
            await booking_1.bookingController.handleStationSelection(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle station selection', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to select station. Please try again.');
        }
    }
    async handleStationBooking(whatsappId, stationId) {
        try {
            if (!stationId || isNaN(stationId) || stationId <= 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid station for booking.');
                return;
            }
            logger_1.logger.info('Station booking requested from location controller', { whatsappId, stationId });
            await booking_1.bookingController.handleStationBooking(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle station booking', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process booking request. Please try again.');
        }
    }
    async showStationDetails(whatsappId, stationId) {
        try {
            if (!stationId || isNaN(stationId) || stationId <= 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid station for details.');
                return;
            }
            logger_1.logger.info('Station details requested from location controller', { whatsappId, stationId });
            await booking_1.bookingController.showStationDetails(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Failed to show station details', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load station details. Please try again.');
        }
    }
    async showLocationHelp(whatsappId) {
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
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, helpText);
    }
    clearLocationContext(whatsappId) {
        this.contextManager.clearLocationContext(whatsappId);
    }
    hasLocationContext(whatsappId) {
        return this.contextManager.hasLocationContext(whatsappId);
    }
    getLocationContext(whatsappId) {
        return this.contextManager.getLocationContext(whatsappId);
    }
    getActiveContextsCount() {
        return this.contextManager.getActiveContextsCount();
    }
    async handleBackToList(whatsappId) {
        await this.showAllNearbyStations(whatsappId);
    }
    async handleFindOtherStations(whatsappId) {
        const context = this.contextManager.getLocationContext(whatsappId);
        if (context?.currentLocation) {
            await this.expandSearchRadius(whatsappId);
        }
        else {
            await this.startNewSearch(whatsappId);
        }
    }
    async handleNotificationSetup(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔔 *Notification Setup*\n\n' +
            'Notifications will include:\n' +
            '• Booking status updates\n' +
            '• Queue position changes\n' +
            '• Station availability alerts\n' +
            '• Payment confirmations\n\n' +
            '✅ Notifications are now enabled!');
    }
    parseButtonId(buttonId) {
        if (!buttonId) {
            return { action: '', stationId: 0 };
        }
        try {
            const selectMatch = buttonId.match(BUTTON_ID_PATTERNS.SELECT_STATION);
            if (selectMatch) {
                return {
                    action: 'select',
                    stationId: parseInt(selectMatch[1], 10)
                };
            }
            const bookMatch = buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION);
            if (bookMatch) {
                return {
                    action: 'book',
                    stationId: parseInt(bookMatch[1], 10)
                };
            }
            const stationInfoMatch = buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO);
            if (stationInfoMatch) {
                return {
                    action: 'info',
                    stationId: parseInt(stationInfoMatch[1], 10)
                };
            }
            const recentMatch = buttonId.match(BUTTON_ID_PATTERNS.RECENT_SEARCH);
            if (recentMatch) {
                return {
                    action: 'recent',
                    stationId: parseInt(recentMatch[1], 10),
                    additionalData: parseInt(recentMatch[1], 10)
                };
            }
            const parts = buttonId.split('_');
            const action = parts[0];
            const generalStationMatch = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION);
            if (generalStationMatch) {
                return {
                    action,
                    stationId: parseInt(generalStationMatch[1], 10)
                };
            }
            const generalActionMatch = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION);
            if (generalActionMatch) {
                return {
                    action,
                    stationId: parseInt(generalActionMatch[1], 10)
                };
            }
            const numericMatch = buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY);
            if (numericMatch) {
                return {
                    action: 'select',
                    stationId: parseInt(numericMatch[1], 10)
                };
            }
            logger_1.logger.warn('Could not parse button ID in location controller', { buttonId });
            return { action, stationId: 0 };
        }
        catch (error) {
            logger_1.logger.error('Button ID parsing failed in location controller', {
                buttonId,
                error: error instanceof Error ? error.message : String(error)
            });
            return { action: '', stationId: 0 };
        }
    }
    async handleButtonWithStationId(whatsappId, buttonId) {
        const { action, stationId } = this.parseButtonId(buttonId);
        if (!stationId) {
            logger_1.logger.warn('No station ID found in button', { whatsappId, buttonId });
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
                await this.handleStationSelection(whatsappId, stationId);
                break;
        }
    }
}
exports.LocationMainController = LocationMainController;
exports.locationController = new LocationMainController();
//# sourceMappingURL=main-controller.js.map