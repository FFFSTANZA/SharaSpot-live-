"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookLocationController = exports.WebhookLocationController = void 0;
const whatsapp_1 = require("../../services/whatsapp");
const index_1 = require("./index");
const booking_1 = require("../booking");
const userService_1 = require("../../services/userService");
const logger_1 = require("../../utils/logger");
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
class WebhookLocationController {
    async handleLocationButton(whatsappId, buttonId, buttonTitle) {
        try {
            logger_1.logger.info('Location button pressed', { whatsappId, buttonId, buttonTitle });
            const { action, stationId } = this.parseButtonId(buttonId);
            switch (buttonId) {
                case 'next_station':
                    await index_1.locationController.handleNextStation(whatsappId);
                    break;
                case 'load_more_stations':
                    await index_1.locationController.loadMoreStations(whatsappId);
                    break;
                case 'show_all_results':
                case 'show_all_nearby':
                    await index_1.locationController.showAllNearbyStations(whatsappId);
                    break;
                case 'back_to_top_result':
                    await this.backToTopResult(whatsappId);
                    break;
                case 'expand_search':
                    await this.expandSearchRadius(whatsappId);
                    break;
                case 'remove_filters':
                    await this.removeFilters(whatsappId);
                    break;
                case 'new_search':
                    await this.startNewSearch(whatsappId);
                    break;
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
                case 'recent_searches':
                    await index_1.locationController.showRecentSearches(whatsappId);
                    break;
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
                    await index_1.locationController.showAllNearbyStations(whatsappId);
                    break;
                case 'get_directions':
                    await this.handleGetDirections(whatsappId);
                    break;
                default:
                    await this.handleStationActions(whatsappId, buttonId, action, stationId);
                    break;
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle location button', { whatsappId, buttonId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Please try again.');
        }
    }
    async handleLocationList(whatsappId, listId, listTitle) {
        try {
            logger_1.logger.info('Location list selected', { whatsappId, listId, listTitle });
            const { action, stationId, additionalData } = this.parseButtonId(listId);
            if (listId.startsWith('select_station_')) {
                await this.handleStationSelection(whatsappId, stationId);
            }
            else if (listId.startsWith('recent_search_')) {
                const searchIndex = additionalData || stationId;
                await index_1.locationController.handleRecentSearchSelection(whatsappId, searchIndex);
            }
            else {
                logger_1.logger.warn('Unknown location list selection', { whatsappId, listId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again.');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle location list', { whatsappId, listId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Please try again.');
        }
    }
    parseButtonId(buttonId) {
        if (!buttonId) {
            return { action: '', stationId: 0 };
        }
        try {
            if (buttonId.match(BUTTON_ID_PATTERNS.START_CHARGING)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.START_CHARGING);
                return {
                    action: 'start_charging',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(/^extend_(\d+)_(\d+)$/)) {
                const match = buttonId.match(/^extend_(\d+)_(\d+)$/);
                return {
                    action: 'extend',
                    stationId: parseInt(match[2], 10),
                    additionalData: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(/^rate_(\d)_(\d+)$/)) {
                const match = buttonId.match(/^rate_(\d)_(\d+)$/);
                return {
                    action: 'rate',
                    stationId: parseInt(match[2], 10),
                    additionalData: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(/^confirm_cancel_(\d+)$/)) {
                const match = buttonId.match(/^confirm_cancel_(\d+)$/);
                return {
                    action: 'confirm',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION);
                return {
                    action: 'book',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.JOIN_QUEUE)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.JOIN_QUEUE);
                return {
                    action: 'join',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO);
                return {
                    action: 'info',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(/^queue_status_(\d+)$/)) {
                const match = buttonId.match(/^queue_status_(\d+)$/);
                return {
                    action: 'queue',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(/^start_session_(\d+)$/)) {
                const match = buttonId.match(/^start_session_(\d+)$/);
                return {
                    action: 'start',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.CANCEL_QUEUE)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.CANCEL_QUEUE);
                return {
                    action: 'cancel',
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.SELECT_STATION)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.SELECT_STATION);
                return {
                    action: 'select',
                    stationId: parseInt(match[1], 10)
                };
            }
            const parts = buttonId.split('_');
            const action = parts[0];
            if (buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION);
                return {
                    action,
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION);
                return {
                    action,
                    stationId: parseInt(match[1], 10)
                };
            }
            if (buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY)) {
                const match = buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY);
                return {
                    action: 'station',
                    stationId: parseInt(match[1], 10)
                };
            }
            logger_1.logger.warn('Could not parse button ID', { buttonId });
            return { action, stationId: 0 };
        }
        catch (error) {
            logger_1.logger.error('Button ID parsing failed', {
                buttonId,
                error: error instanceof Error ? error.message : String(error)
            });
            return { action: '', stationId: 0 };
        }
    }
    async handleStationActions(whatsappId, buttonId, action, stationId) {
        if (!stationId) {
            logger_1.logger.warn('No station ID found in button', { whatsappId, buttonId, action });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown option. Please try again or type "help".');
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
                if (stationId > 0) {
                    await this.handleStationSelection(whatsappId, stationId);
                }
                else {
                    logger_1.logger.warn('Unknown station action', { whatsappId, buttonId, action, stationId });
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown option. Please try again or type "help".');
                }
                break;
        }
    }
    async backToTopResult(whatsappId) {
        await index_1.locationController.showBackToTopResult(whatsappId);
    }
    async expandSearchRadius(whatsappId) {
        await index_1.locationController.expandSearchRadius(whatsappId);
    }
    async removeFilters(whatsappId) {
        await index_1.locationController.removeFilters(whatsappId);
    }
    async startNewSearch(whatsappId) {
        index_1.locationController.clearLocationContext(whatsappId);
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Start New Search*\n\nWhere would you like to find charging stations?', [
            { id: 'share_gps_location', title: '📱 Share Current Location' },
            { id: 'type_address', title: '⌨️ Type Address' },
            { id: 'recent_searches', title: '🕒 Recent Searches' },
        ], '🔍 New Search');
    }
    async requestGPSLocation(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📱 *Share Your GPS Location*\n\n' +
            '1️⃣ Tap the 📎 *attachment* icon\n' +
            '2️⃣ Select _Location_\n' +
            '3️⃣ Choose _“Send your current location”_\n' +
            '4️⃣ Tap _Send_\n\n' +
            '🎯 *This gives the most accurate results!*');
    }
    async requestAddressInput(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*Type Your Address*\n\n' +
            'Please enter the location where you need charging:\n\n' +
            '*Examples:*\n' +
            '• Anna Nagar, Chennai\n' +
            '• Brigade Road, Bangalore\n' +
            '• Phoenix Mall, Chennai\n\n' +
            '_Just type the address and press send!_');
    }
    async showLocationHelp(whatsappId) {
        await index_1.locationController.showLocationHelp(whatsappId);
    }
    async backToSearch(whatsappId) {
        const context = index_1.locationController.getLocationContext(whatsappId);
        if (context?.currentLocation) {
            await index_1.locationController.showAllNearbyStations(whatsappId);
        }
        else {
            await this.startNewSearch(whatsappId);
        }
    }
    async handleGetDirections(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🗺️ *Get Directions*\n\n' +
            'Navigation feature coming soon!\n\n' +
            'For now, you can:\n' +
            '• Copy the station address\n' +
            '• Use your preferred maps app\n' +
            '• Search for the station name');
    }
    async handleStationSelection(whatsappId, stationId) {
        try {
            if (!stationId || isNaN(stationId) || stationId <= 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
                return;
            }
            logger_1.logger.info('Processing station selection', { whatsappId, stationId });
            await booking_1.bookingController.handleStationSelection(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Station selection failed', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to select station. Please try again.');
        }
    }
    async handleStationBooking(whatsappId, stationId) {
        try {
            logger_1.logger.info('Processing booking request from location', { whatsappId, stationId });
            await booking_1.bookingController.handleStationBooking(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Booking failed from location', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Booking failed. Please try again or join the queue.');
        }
    }
    async handleQueueJoin(whatsappId, stationId) {
        try {
            logger_1.logger.info('Processing queue join from location', { whatsappId, stationId });
            await booking_1.bookingController.processQueueJoin(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Queue join failed from location', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to join queue. Please try again.');
        }
    }
    async handleQueueStatus(whatsappId) {
        try {
            await booking_1.bookingController.handleQueueStatus(whatsappId);
        }
        catch (error) {
            logger_1.logger.error('Queue status check failed from location', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to get queue status.');
        }
    }
    async handleQueueCancel(whatsappId, stationId) {
        try {
            await booking_1.bookingController.handleQueueCancel(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Queue cancellation failed from location', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to cancel queue.');
        }
    }
    async handleChargingStart(whatsappId, stationId) {
        try {
            logger_1.logger.info('🔌 Processing charging start request', { whatsappId, stationId });
            if (!whatsappId || !stationId) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid request. Please try again.');
                return;
            }
            await booking_1.bookingController.handleChargingStart(whatsappId, stationId);
            logger_1.logger.info('✅ Charging start request delegated successfully', { whatsappId, stationId });
        }
        catch (error) {
            logger_1.logger.error('❌ Charging start failed from location', {
                whatsappId,
                stationId,
                error: error instanceof Error ? error.message : String(error)
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to start charging session. Please ensure you have a valid reservation and try again.');
        }
    }
    async showStationDetails(whatsappId, stationId) {
        try {
            logger_1.logger.info('Showing station details from location', { whatsappId, stationId });
            await booking_1.bookingController.showStationDetails(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Failed to show station details from location', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load station details.');
        }
    }
    async setupNotificationAlerts(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔔 *Notification Setup*\n\n' +
            'You will receive updates about:\n' +
            '• Queue position changes\n' +
            '• Station availability\n' +
            '• Charging session status\n' +
            '• Payment confirmations\n\n' +
            '✅ Notifications are now enabled!');
        try {
            await userService_1.userService.updateUserProfile(whatsappId, {
                phoneNumber: whatsappId
            });
        }
        catch (error) {
            logger_1.logger.warn('Failed to update notification preferences', { whatsappId, error });
        }
    }
    async findAlternativeStations(whatsappId) {
        const context = index_1.locationController.getLocationContext(whatsappId);
        if (context?.currentLocation?.latitude && context?.currentLocation?.longitude) {
            await index_1.locationController.expandSearchRadius(whatsappId);
        }
        else {
            await this.startNewSearch(whatsappId);
        }
    }
}
exports.WebhookLocationController = WebhookLocationController;
exports.webhookLocationController = new WebhookLocationController();
//# sourceMappingURL=webhook-location.js.map