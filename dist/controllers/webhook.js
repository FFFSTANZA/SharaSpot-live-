"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookController = exports.WebhookController = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const message_deduplication_1 = require("../utils/message-deduplication");
const whatsapp_1 = require("../services/whatsapp");
const userService_1 = require("../services/userService");
const preference_1 = require("../services/preference");
const preference_2 = require("./preference");
const profile_1 = require("../services/profile");
const location_1 = require("./location");
const booking_1 = require("./booking");
const queue_webhook_1 = require("./queue-webhook");
const webhook_location_1 = require("./location/webhook-location");
const photo_verification_1 = require("../services/photo-verification");
const button_parser_1 = require("../utils/button-parser");
const validation_1 = require("../utils/validation");
const owner_webhook_1 = require("../controllers/owner-webhook");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const axios_1 = __importDefault(require("axios"));
class WebhookController {
    constructor() {
        this.waitingUsers = new Map();
        this.MAX_WAITING_USERS = 10000;
        this.MAX_PROCESSING_MESSAGES = 5000;
        this.processingMessages = new Set();
    }
    async verifyWebhook(req, res) {
        try {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            if (mode === 'subscribe' && token === env_1.env.VERIFY_TOKEN) {
                logger_1.logger.info('✅ Webhook verified successfully');
                res.status(200).send(challenge);
            }
            else {
                logger_1.logger.error('❌ Webhook verification failed', { mode, token: !!token });
                res.status(403).send('Forbidden');
            }
        }
        catch (error) {
            logger_1.logger.error('Webhook verification error', { error: error.message });
            res.status(500).send('Internal Error');
        }
    }
    async handleWebhook(req, res) {
        res.status(200).send('EVENT_RECEIVED');
        try {
            const webhookData = req.body;
            if (webhookData.object !== 'whatsapp_business_account') {
                logger_1.logger.debug('Skipping non-WABA webhook', { object: webhookData.object });
                return;
            }
            const allMessages = this.extractMessages(webhookData);
            if (allMessages.length === 0) {
                logger_1.logger.debug('No messages found in webhook payload');
                return;
            }
            logger_1.logger.info('📥 Processing webhook', {
                totalMessages: allMessages.length,
            });
            for (const message of allMessages) {
                if (message_deduplication_1.messageDeduplication.isDuplicate(message.id)) {
                    logger_1.logger.debug('⏭️ Duplicate message skipped', { messageId: message.id });
                    continue;
                }
                setImmediate(async () => {
                    try {
                        await this.processMessage(message);
                    }
                    catch (error) {
                        logger_1.logger.error('💥 Unhandled error during message processing (fire-and-forget)', {
                            messageId: message.id,
                            whatsappId: message.from,
                            error: error.message
                        });
                    }
                });
            }
            logger_1.logger.info('📥 Webhook dispatch completed', { totalDispatched: allMessages.length });
        }
        catch (error) {
            logger_1.logger.error('❌ Unexpected error in handleWebhook top-level (should not happen)', {
                error: error.message
            });
        }
    }
    extractMessages(webhookData) {
        const messages = [];
        for (const entry of webhookData.entry || []) {
            for (const change of entry.changes || []) {
                if (change.field === 'messages' && Array.isArray(change.value?.messages)) {
                    messages.push(...change.value.messages);
                }
            }
        }
        return messages;
    }
    async processMessage(message) {
        const { id: messageId, from: whatsappId, type } = message;
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('❌ Invalid WhatsApp ID format', { whatsappId, messageId });
            return;
        }
        try {
            whatsapp_1.whatsappService.markAsRead(messageId).catch(error => {
                logger_1.logger.debug('Mark as read failed (non-critical)', {
                    messageId,
                    error: error.message
                });
            });
            logger_1.logger.info('📨 Processing message', {
                whatsappId,
                type,
                messageId
            });
            const [userResult, preferenceResult] = await Promise.allSettled([
                userService_1.userService.createUser({ whatsappId }),
                preference_1.preferenceService.isInPreferenceFlow(whatsappId)
            ]);
            const user = userResult.status === 'fulfilled' ? userResult.value : null;
            const isInPreferenceFlow = preferenceResult.status === 'fulfilled' ? preferenceResult.value : false;
            if (!user) {
                logger_1.logger.error('❌ Failed to get/create user', { whatsappId, messageId });
                await this.sendErrorMessage(whatsappId, 'Failed to initialize session. Please try again.');
                return;
            }
            await this.routeMessage(message, user, isInPreferenceFlow);
        }
        catch (error) {
            logger_1.logger.error('❌ Message processing pipeline error', {
                messageId,
                whatsappId,
                error: error.message
            });
            await this.sendErrorMessage(whatsappId, 'Something went wrong. Please try again or type "help".');
        }
    }
    async routeMessage(message, user, isInPreferenceFlow) {
        const { whatsappId } = user;
        const verificationState = photo_verification_1.photoVerificationService.getVerificationState(whatsappId);
        if (verificationState) {
            logger_1.logger.info('🔍 User in verification flow', { whatsappId, hasImage: !!message.image });
            if (message.image) {
                await this.handleVerificationPhoto(whatsappId, message, verificationState);
                return;
            }
            else if (message.type === 'text') {
                await this.handleManualVerificationEntry(whatsappId, message.text?.body || '');
                return;
            }
        }
        switch (message.type) {
            case 'text':
                await this.handleTextMessage(user, message.text?.body || '', isInPreferenceFlow);
                break;
            case 'interactive':
                if (message.interactive?.type === 'button_reply') {
                    await this.handleButtonMessage(user, message.interactive.button_reply, isInPreferenceFlow);
                }
                else if (message.interactive?.type === 'list_reply') {
                    await this.handleListMessage(user, message.interactive.list_reply, isInPreferenceFlow);
                }
                break;
            case 'location':
                await this.handleLocationMessage(user, message.location);
                break;
            default:
                await whatsapp_1.whatsappService.sendTextMessage(user.whatsappId, '❓ Unsupported message type. Please send text, location, or use buttons.');
        }
    }
    async handleVerificationPhoto(whatsappId, message, state) {
        try {
            logger_1.logger.info('📸 Processing verification photo', {
                whatsappId,
                attempt: state.attemptCount + 1,
                type: state.type
            });
            const imageBuffer = await this.downloadWhatsAppImage(message.image?.id || '');
            if (!imageBuffer) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to download image. Please try again.');
                return;
            }
            if (state.type === 'start') {
                await photo_verification_1.photoVerificationService.handleStartPhoto(whatsappId, imageBuffer);
            }
            else if (state.type === 'end') {
                await photo_verification_1.photoVerificationService.handleEndPhoto(whatsappId, imageBuffer);
            }
            else {
                logger_1.logger.error('Unknown verification type', { whatsappId, type: state.type });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid verification type. Please try again.');
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Photo verification failed', {
                whatsappId,
                type: state.type,
                error: error.message
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process photo. Please try again or type the reading manually.');
        }
    }
    async handleManualVerificationEntry(whatsappId, text) {
        try {
            await photo_verification_1.photoVerificationService.handleManualEntry(whatsappId, text.trim());
        }
        catch (error) {
            logger_1.logger.error('❌ Manual verification failed', { whatsappId, error: error.message });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process entry. Please enter a valid kWh reading.');
        }
    }
    async downloadWhatsAppImage(mediaId) {
        if (!mediaId) {
            logger_1.logger.warn('No media ID provided for download');
            return null;
        }
        try {
            const mediaUrlResponse = await axios_1.default.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${env_1.env.WHATSAPP_TOKEN}` },
                timeout: 10000
            });
            const mediaUrl = mediaUrlResponse.data?.url;
            if (!mediaUrl) {
                logger_1.logger.error('No media URL received from Facebook API', { mediaId });
                return null;
            }
            const imageResponse = await axios_1.default.get(mediaUrl, {
                headers: { 'Authorization': `Bearer ${env_1.env.WHATSAPP_TOKEN}` },
                responseType: 'arraybuffer',
                timeout: 15000
            });
            logger_1.logger.debug('Image downloaded successfully', { mediaId });
            return Buffer.from(imageResponse.data);
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to download image from WhatsApp', {
                mediaId,
                error: error.message
            });
            return null;
        }
    }
    async handleVerificationButtons(whatsappId, buttonId) {
        const handlers = {
            'confirm_start_reading': async () => {
                await photo_verification_1.photoVerificationService.confirmStartReading(whatsappId);
            },
            'confirm_end_reading': async () => {
                await photo_verification_1.photoVerificationService.confirmEndReading(whatsappId);
            },
            'retake_start_photo': async () => {
                await photo_verification_1.photoVerificationService.retakeStartPhoto(whatsappId);
            },
            'retake_end_photo': async () => {
                await photo_verification_1.photoVerificationService.retakeEndPhoto(whatsappId);
            },
            'manual_entry': async () => {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📝 *Manual Entry*\n\nPlease type the kWh reading from the meter.\n\nExample: 1245.8');
            }
        };
        const handler = handlers[buttonId];
        if (handler) {
            try {
                await handler();
            }
            catch (error) {
                logger_1.logger.error('Error in verification button handler', { buttonId, whatsappId, error: error.message });
                await this.sendErrorMessage(whatsappId, 'Action failed. Please try again.');
            }
        }
    }
    async handleTextMessage(user, text, isInPreferenceFlow) {
        const { whatsappId } = user;
        const cleanText = text.toLowerCase().trim();
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await owner_webhook_1.ownerWebhookController.handleOwnerMessage(whatsappId, 'text', text);
            return;
        }
        if (cleanText === 'owner') {
            await owner_webhook_1.ownerWebhookController.enterOwnerMode(whatsappId);
            return;
        }
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
            return;
        }
        const waitingType = this.waitingUsers.get(whatsappId);
        if (waitingType) {
            await this.handleWaitingInput(whatsappId, text, waitingType);
            return;
        }
        await this.handleCommand(whatsappId, cleanText, text);
    }
    async handleButtonMessage(user, button, isInPreferenceFlow) {
        const { whatsappId } = user;
        const { id: buttonId, title } = button;
        logger_1.logger.info('🔘 Button pressed', { whatsappId, buttonId, title });
        if (photo_verification_1.photoVerificationService.isInVerificationFlow(whatsappId) && this.isVerificationButton(buttonId)) {
            await this.handleVerificationButtons(whatsappId, buttonId);
            return;
        }
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await owner_webhook_1.ownerWebhookController.handleOwnerMessage(whatsappId, 'button', button);
            return;
        }
        if (buttonId.startsWith('session_stop_')) {
            const stationId = parseInt(buttonId.split('_')[2], 10);
            if (!isNaN(stationId)) {
                await booking_1.bookingController.handleSessionStop(whatsappId, stationId);
                return;
            }
        }
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
            return;
        }
        const parsed = (0, button_parser_1.parseButtonId)(buttonId);
        await this.routeButtonAction(whatsappId, buttonId, parsed, title);
    }
    async handleListMessage(user, list, isInPreferenceFlow) {
        const { whatsappId } = user;
        const { id: listId, title } = list;
        logger_1.logger.info('📋 List selected', { whatsappId, listId, title });
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Location sharing not supported in owner mode.');
            return;
        }
        const parsed = (0, button_parser_1.parseButtonId)(listId);
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
            return;
        }
        await this.routeListAction(whatsappId, listId, parsed, title);
    }
    async handleLocationMessage(user, location) {
        const { whatsappId } = user;
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Location sharing not supported in owner mode.');
            return;
        }
        logger_1.logger.info('📍 Location received', {
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
            await location_1.locationController.handleGPSLocation(whatsappId, lat, lng, location.name || null, location.address || null);
        }
        catch (error) {
            logger_1.logger.error('❌ Location processing failed', { whatsappId, error: error.message });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid location. Please share your location again or type your address.');
        }
    }
    async routeButtonAction(whatsappId, buttonId, parsed, title) {
        logger_1.logger.info('🎯 Routing button', { whatsappId, buttonId, parsed });
        if (this.isQueueButton(buttonId)) {
            await queue_webhook_1.queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
            return;
        }
        if (this.isLocationButton(buttonId)) {
            await this.handleLocationButton(whatsappId, buttonId);
            return;
        }
        if (this.isSessionButton(buttonId)) {
            await queue_webhook_1.queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
            return;
        }
        if (parsed.category === 'station' && parsed.stationId > 0) {
            await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
            return;
        }
        await this.handleCoreButton(whatsappId, buttonId);
    }
    isSessionButton(buttonId) {
        return buttonId.startsWith('start_charging_') ||
            buttonId.startsWith('start_session_') ||
            buttonId.startsWith('session_status_') ||
            buttonId.startsWith('session_stop_') ||
            buttonId.startsWith('extend_');
    }
    async routeListAction(whatsappId, listId, parsed, title) {
        if (this.isQueueButton(listId)) {
            await queue_webhook_1.queueWebhookController.handleQueueList(whatsappId, listId, title);
            return;
        }
        if (this.isLocationList(listId)) {
            await this.handleLocationList(whatsappId, listId, parsed);
            return;
        }
        if (parsed.category === 'station' && parsed.stationId > 0) {
            await booking_1.bookingController.handleStationSelection(whatsappId, parsed.stationId);
            return;
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Unknown selection. Please try again.');
    }
    async handleStationButton(whatsappId, action, stationId) {
        const handlers = {
            'book': () => booking_1.bookingController.handleStationBooking(whatsappId, stationId),
            'info': () => booking_1.bookingController.showStationDetails(whatsappId, stationId),
            'details': () => booking_1.bookingController.showStationDetails(whatsappId, stationId),
            'directions': () => this.handleGetDirections(whatsappId, stationId)
        };
        const handler = handlers[action];
        if (handler) {
            await handler();
        }
        else {
            await booking_1.bookingController.handleStationSelection(whatsappId, stationId);
        }
    }
    async handleLocationButton(whatsappId, buttonId) {
        try {
            await webhook_location_1.webhookLocationController.handleLocationButton(whatsappId, buttonId, '');
        }
        catch (error) {
            logger_1.logger.error('❌ Location button handler failed', { whatsappId, buttonId, error: error.message });
            const fallbacks = {
                'share_gps_location': () => this.requestGPSLocation(whatsappId),
                'type_address': () => this.requestAddressInput(whatsappId),
                'location_help': () => this.showLocationHelp(whatsappId),
                'new_search': () => this.startBooking(whatsappId)
            };
            const fallback = fallbacks[buttonId];
            if (fallback) {
                await fallback();
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'There was an issue. Please try "find" to search for stations.');
            }
        }
    }
    async handleLocationList(whatsappId, listId, parsed) {
        if (listId.startsWith('recent_search_') && typeof parsed.index === 'number') {
            await location_1.locationController.handleRecentSearchSelection(whatsappId, parsed.index);
        }
        else {
            logger_1.logger.warn('Unknown location list selection', { whatsappId, listId, parsed });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
        }
    }
    async handleCoreButton(whatsappId, buttonId) {
        const handlers = {
            'help': () => this.showHelp(whatsappId),
            'quick_book': () => this.startBooking(whatsappId),
            'find_stations': () => this.startBooking(whatsappId),
            'view_profile': () => profile_1.profileService.showProfileSummary(whatsappId),
            'update_profile': () => this.requestProfileUpdate(whatsappId),
            'update_preferences': () => preference_2.preferenceController.startPreferenceGathering(whatsappId)
        };
        const handler = handlers[buttonId];
        if (handler) {
            await handler();
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown action. Type "help" for available commands.');
        }
    }
    async handleCommand(whatsappId, cleanText, originalText) {
        const commands = {
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
            'profile': () => profile_1.profileService.showProfileSummary(whatsappId),
            'preferences': () => preference_2.preferenceController.startPreferenceGathering(whatsappId),
            'settings': () => preference_2.preferenceController.startPreferenceGathering(whatsappId)
        };
        const handler = commands[cleanText];
        if (handler) {
            await handler();
        }
        else {
            if (this.looksLikeAddress(originalText)) {
                await location_1.locationController.handleAddressInput(whatsappId, originalText);
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ I didn\'t understand that. Type "help" for commands or "find" to search for stations.');
            }
        }
    }
    async handleWaitingInput(whatsappId, input, type) {
        this.waitingUsers.delete(whatsappId);
        if (type === 'name') {
            await this.processNameInput(whatsappId, input.trim());
        }
        else {
            await this.processAddressInput(whatsappId, input.trim());
        }
    }
    looksLikeAddress(text) {
        const indicators = [
            'road', 'street', 'st', 'rd', 'avenue', 'ave', 'lane', 'layout',
            'nagar', 'puram', 'colony', 'society', 'layout', 'block', 'sector',
            'phase', 'mall', 'plaza', 'complex', 'tower', 'building', 'estate',
            'salai', 'veedhi', 'koil street', 'temple', 'church', 'mosque',
            'bus stand', 'railway station', 'metro', 'junction', 'circle',
            'chennai', 'coimbatore', 'madurai', 'tiruchirappalli', 'salem',
            'tirunelveli', 'erode', 'vellore', 'thoothukudi', 'dindigul',
            'kanchipuram', 'karur', 'hospet', 'nagercoil', 'pollachi',
            'mumbai', 'delhi', 'bangalore', 'hyderabad', 'pune', 'kolkata',
            'ahmedabad', 'jaipur', 'lucknow', 'patna', 'bhubaneswar', 'visakhapatnam',
            'agraharam', 'pettai', 'ur', 'pudur', 'palayam', 'kottai',
            'chavadi', 'medu', 'theru', 'kara', 'valavu'
        ];
        const lower = text.toLowerCase();
        return text.length > 5 &&
            text.length < 100 &&
            /[a-zA-Z]/.test(text) &&
            indicators.some(ind => lower.includes(ind.toLowerCase()));
    }
    async handleGetDirections(whatsappId, stationId) {
        if (!stationId) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Get Directions\n\nFirst select a charging station, then I can send you the location!');
            return;
        }
        try {
            const [station] = await database_1.db
                .select({
                id: schema_1.chargingStations.id,
                name: schema_1.chargingStations.name,
                address: schema_1.chargingStations.address,
                latitude: schema_1.chargingStations.latitude,
                longitude: schema_1.chargingStations.longitude
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            if (!station) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Station not found.');
                return;
            }
            const lat = Number(station.latitude);
            const lng = Number(station.longitude);
            if (isNaN(lat) || isNaN(lng)) {
                logger_1.logger.error('Invalid coordinates in DB for station', { stationId, lat, lng });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to get directions for this station.');
                return;
            }
            const locationSent = await whatsapp_1.whatsappService.sendLocationMessage(whatsappId, lat, lng, station.name, station.address);
            if (locationSent) {
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 Location sent for ${station.name}\n\nTap the location above to open in your maps app!`);
                }, 1000);
            }
            else {
                logger_1.logger.warn('Location message was not sent successfully', { stationId, whatsappId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Could not send directions. Please try again.');
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send directions', { whatsappId, stationId, error: error.message });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to get directions. Please try again.');
        }
    }
    async handleNearbyRequest(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📍 *Find Nearby Stations*\n\nShare your location to find charging stations around you:', [
            { id: 'share_gps_location', title: '📱 Share GPS' },
            { id: 'type_address', title: '📝 Type Address' },
            { id: 'recent_searches', title: '🕒 Recent' }
        ], '🔍 Location Search');
    }
    async handleGreeting(whatsappId) {
        const user = await userService_1.userService.createUser({ whatsappId });
        if (!user?.preferencesCaptured) {
            await preference_2.preferenceController.startPreferenceGathering(whatsappId);
        }
        else {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `👋 Welcome back ${user.name || 'there'}! Ready to find charging stations?`, [
                { id: 'quick_book', title: '⚡ Find Stations' },
                { id: 'view_profile', title: '👤 Profile' },
                { id: 'help', title: '❓ Help' }
            ], '⚡ SharaSpot');
        }
    }
    async startBooking(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Find Charging Stations*\n\nHow would you like to search?', [
            { id: 'share_gps_location', title: '📍 Share Location' },
            { id: 'type_address', title: '📝 Type Address' },
            { id: 'recent_searches', title: '🕒 Recent Searches' }
        ], '⚡ Find Stations');
    }
    async showHelp(whatsappId) {
        const helpText = `*SharaSpot Help*\n\n` +
            `*Quick Commands*\n` +
            `• "find" or "book" – Find stations\n` +
            `• "gps" or "location" – Share your location\n` +
            `• "nearby" – Find nearby stations\n` +
            `• "directions" – Get navigation\n` +
            `• "profile" – View your EV profile\n` +
            `• "preferences" – Update settings\n` +
            `• "help" – Show this menu\n` +
            `• "owner" – Access owner portal\n\n` +
            `*How to Find Stations*\n` +
            `1. Say "find" or tap "Find Stations"\n` +
            `2. Share your location or type an address\n` +
            `3. Browse available stations\n` +
            `4. Book your charging slot\n\n` +
            `*Tips*\n` +
            `• GPS gives the most accurate results\n` +
            `• You can type any address directly\n` +
            `• Recent searches are saved\n` +
            `• Use "directions" for turn-by-turn navigation\n\n` +
            `Need more help? Just ask!`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, helpText);
    }
    async showLocationHelp(whatsappId) {
        const helpText = `*Location Help*\n\n` +
            `*Share Your Location via GPS*\n` +
            `1. Tap the attachment icon (📎)\n` +
            `2. Select "Location"\n` +
            `3. Choose "Send your current location"\n` +
            `4. Tap "Send"\n\n` +
            `*Or Type an Address*\n` +
            `Just send a message with your location, for example:\n` +
            `• Anna Nagar, Chennai\n` +
            `• Brigade Road, Bangalore\n` +
            `• Sector 18, Noida\n\n` +
            `*Tips*\n` +
            `• GPS gives the most accurate results\n` +
            `• Always include the city name\n` +
            `• Landmarks like malls or stations also work`;
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, helpText, [
            { id: 'share_gps_location', title: '📍 Share GPS' },
            { id: 'type_address', title: '📝 Type Address' },
            { id: 'recent_searches', title: '🕒 Recent' }
        ], '📍 Location Help');
    }
    async requestGPSLocation(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Share Your Location*\n\n` +
            `To get the most accurate results, share your GPS location:\n\n` +
            `1. Tap the attachment icon\n` +
            `2. Select "Location"\n` +
            `3. Choose "Send your current location"\n` +
            `4. Tap "Send"\n\n` +
            `Or simply type your address (e.g., "Anna Nagar, Chennai")`);
    }
    async requestAddressInput(whatsappId) {
        if (this.waitingUsers.size >= this.MAX_WAITING_USERS) {
            logger_1.logger.warn('Waiting users queue is full', { whatsappId });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'System busy. Please try again later.');
            return;
        }
        this.waitingUsers.set(whatsappId, 'address');
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*Type Your Address*\n\n' +
            'Enter the location where you need charging:\n\n' +
            '*Examples:*\n' +
            '• Anna Nagar, Chennai\n' +
            '• Brigade Road, Bangalore\n' +
            'Just type the address!');
    }
    async requestProfileUpdate(whatsappId) {
        if (this.waitingUsers.size >= this.MAX_WAITING_USERS) {
            logger_1.logger.warn('Waiting users queue is full', { whatsappId });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'System busy. Please try again later.');
            return;
        }
        this.waitingUsers.set(whatsappId, 'name');
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*Update Your Name*\n\n' +
            'What would you like me to call you?\n\n' +
            'Examples: Ravi Kumar, Ashreya, Pooja\n\n' +
            'Type your preferred name:');
    }
    async processNameInput(whatsappId, name) {
        if (name.length < 2 || name.length > 50) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid name (2-50 characters).\n\nTry again:');
            this.waitingUsers.set(whatsappId, 'name');
            return;
        }
        try {
            const success = await profile_1.profileService.updateUserName(whatsappId, name);
            if (!success) {
                logger_1.logger.error('Name update failed in service layer', { whatsappId, name });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to update name in the system. Please try again.');
                this.waitingUsers.set(whatsappId, 'name');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `Your name has been updated to *${name}*!`);
        }
        catch (error) {
            logger_1.logger.error('❌ Name update process failed', { whatsappId, error: error.message });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to update name. Please try again.');
            this.waitingUsers.set(whatsappId, 'name');
        }
    }
    async processAddressInput(whatsappId, address) {
        if (address.length < 5) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Please provide a more specific address.');
            return;
        }
        await location_1.locationController.handleAddressInput(whatsappId, address);
    }
    isVerificationButton(buttonId) {
        return [
            'confirm_start_reading',
            'confirm_end_reading',
            'retake_start_photo',
            'retake_end_photo',
            'manual_entry'
        ].includes(buttonId);
    }
    isQueueButton(buttonId) {
        const patterns = [
            'join_queue_', 'queue_status_', 'cancel_queue_', 'confirm_cancel_',
            'start_session_', 'session_stop_', 'session_status_', 'extend_',
            'nearby_alternatives_', 'cheaper_options_', 'faster_charging_',
            'smart_recommendation_', 'notify_when_ready_', 'live_updates_',
            'rate_1_', 'rate_2_', 'rate_3_', 'rate_4_', 'rate_5_'
        ];
        return patterns.some(p => buttonId.startsWith(p));
    }
    isLocationButton(buttonId) {
        const coreButtons = [
            'share_gps_location', 'type_address', 'try_different_address',
            'location_help', 'recent_searches', 'new_search',
            'next_station', 'load_more_stations', 'show_all_nearby',
            'show_all_results', 'back_to_search', 'back_to_list',
            'back_to_top_result', 'expand_search', 'remove_filters',
            'get_directions', 'directions_help'
        ];
        if (coreButtons.includes(buttonId))
            return true;
        const prefixes = [
            'recent_search_', 'location_', 'search_',
            'station_info_', 'select_station_', 'book_station_'
        ];
        return prefixes.some(p => buttonId.startsWith(p));
    }
    isLocationList(listId) {
        const exactLists = ['recent_searches', 'location_options', 'search_results'];
        if (exactLists.includes(listId))
            return true;
        const prefixes = ['recent_search_', 'location_', 'search_', 'select_station_'];
        return prefixes.some(p => listId.startsWith(p));
    }
    async sendErrorMessage(whatsappId, message) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send error message', {
                whatsappId,
                message,
                error: error.message
            });
        }
    }
    getStats() {
        return {
            waitingUsers: this.waitingUsers.size,
            processingMessages: this.processingMessages.size,
            deduplication: message_deduplication_1.messageDeduplication.getStats()
        };
    }
    cleanup() {
        this.waitingUsers.clear();
        this.processingMessages.clear();
        logger_1.logger.info('✅ Webhook controller cleanup completed');
    }
    getHealthStatus() {
        return {
            status: 'healthy',
            waitingUsers: this.waitingUsers.size,
            processingMessages: this.processingMessages.size,
            uptime: Math.floor(process.uptime())
        };
    }
}
exports.WebhookController = WebhookController;
exports.webhookController = new WebhookController();
//# sourceMappingURL=webhook.js.map