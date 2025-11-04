"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingController = exports.BookingController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const userService_1 = require("../services/userService");
const queue_1 = require("../services/queue");
const session_1 = require("../services/session");
const notification_1 = require("../services/notification");
const photo_verification_1 = require("../services/photo-verification");
const logger_1 = require("../utils/logger");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const validation_1 = require("../utils/validation");
const booking_payment_integration_1 = require("./booking-payment-integration");
const stationCache = new Map();
const CACHE_TTL_MS = 30000;
class BookingController {
    constructor() {
        this.recentButtonActions = new Map();
    }
    async handleMessage(message) {
        const whatsappId = message.from;
        const verificationState = photo_verification_1.photoVerificationService.getVerificationState(whatsappId);
        if (message.type === 'image' && verificationState) {
            await this.handleVerificationPhoto(whatsappId, message, verificationState);
            return;
        }
        if (message.type === 'text' && verificationState) {
            await photo_verification_1.photoVerificationService.handleManualEntry(whatsappId, message.text.body);
            return;
        }
    }
    async handleVerificationPhoto(whatsappId, message, state) {
        try {
            const imageBuffer = await this.downloadWhatsAppImageWithRetry(message.image.id, 2);
            if (state.waitingFor === 'start_photo') {
                await photo_verification_1.photoVerificationService.handleStartPhoto(whatsappId, imageBuffer);
            }
            else if (state.waitingFor === 'end_photo') {
                await photo_verification_1.photoVerificationService.handleEndPhoto(whatsappId, imageBuffer);
            }
        }
        catch (error) {
            logger_1.logger.error('Photo processing failed', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process photo. Please ensure good lighting and clear view of the meter. Try again.');
        }
    }
    async downloadWhatsAppImageWithRetry(mediaId, retries = 2) {
        let lastError = null;
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
                });
                const data = (await response.json());
                if (!data.url)
                    throw new Error('Media URL not found');
                const imageResponse = await fetch(data.url, {
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
                });
                return Buffer.from(await imageResponse.arrayBuffer());
            }
            catch (error) {
                lastError = error;
                if (i < retries)
                    await new Promise(res => setTimeout(res, 1000 * (i + 1)));
            }
        }
        throw lastError;
    }
    async handleButtonClick(buttonId, whatsappId) {
        const lastActionKey = `last_button_${whatsappId}`;
        const lastAction = this.recentButtonActions.get(lastActionKey);
        if (lastAction === buttonId) {
            logger_1.logger.warn('Duplicate button click ignored', { whatsappId, buttonId });
            return;
        }
        this.recentButtonActions.set(lastActionKey, buttonId);
        setTimeout(() => this.recentButtonActions.delete(lastActionKey), 5000);
        if (buttonId === 'confirm_start_reading') {
            const success = await photo_verification_1.photoVerificationService.confirmStartReading(whatsappId);
            if (success) {
                const state = photo_verification_1.photoVerificationService.getVerificationState(whatsappId);
                if (state?.sessionId && state.lastReading !== undefined) {
                    await session_1.sessionService.startChargingAfterVerification(state.sessionId, state.lastReading);
                }
            }
            return;
        }
        if (buttonId === 'confirm_end_reading') {
            const success = await photo_verification_1.photoVerificationService.confirmEndReading(whatsappId);
            if (success) {
                await this.sendSessionSummary(whatsappId);
            }
            return;
        }
        if (buttonId === 'retake_start_photo') {
            await photo_verification_1.photoVerificationService.retakeStartPhoto(whatsappId);
            return;
        }
        if (buttonId === 'retake_end_photo') {
            await photo_verification_1.photoVerificationService.retakeEndPhoto(whatsappId);
            return;
        }
        if (buttonId.startsWith('session_start_')) {
            const stationId = parseInt(buttonId.replace('session_start_', ''));
            await this.handleChargingStart(whatsappId, stationId);
            return;
        }
        if (buttonId.startsWith('session_stop_')) {
            const stationId = parseInt(buttonId.replace('session_stop_', ''));
            await this.handleSessionStop(whatsappId, stationId);
            return;
        }
        await this.routeButtonAction(buttonId, whatsappId);
    }
    async routeButtonAction(buttonId, whatsappId) {
        const [action, ...params] = buttonId.split('_');
        const stationId = params.length > 0 ? parseInt(params[params.length - 1]) : 0;
        switch (action) {
            case 'book':
                await this.handleStationBooking(whatsappId, stationId);
                break;
            case 'join':
                await this.handleJoinQueue(whatsappId, stationId);
                break;
            case 'queue':
                await this.handleQueueStatus(whatsappId, stationId);
                break;
            case 'cancel':
                await this.handleQueueCancel(whatsappId, stationId);
                break;
            case 'directions':
                await this.handleGetDirections(whatsappId, stationId);
                break;
            case 'alternatives':
                await this.handleFindAlternatives(whatsappId, stationId);
                break;
            case 'status':
                await this.handleSessionStatus(whatsappId, stationId);
                break;
            case 'extend':
                const minutes = params[0] === '30' ? 30 : 60;
                await this.handleSessionExtend(whatsappId, stationId, minutes);
                break;
            default:
                logger_1.logger.warn('Unknown button action', { buttonId, whatsappId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown action. Please try again.');
        }
    }
    async handleStationSelection(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found');
                return;
            }
            await this.showStationOverview(whatsappId, station);
        }
        catch (error) {
            await this.handleError(error, 'station selection', { whatsappId, stationId });
        }
    }
    async handleStationBooking(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const [user, station] = await Promise.all([
                userService_1.userService.getUserByWhatsAppId(whatsappId),
                this.getStationDetails(stationId)
            ]);
            if (!user) {
                await this.sendError(whatsappId, 'User not found. Please register first.');
                return;
            }
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found');
                return;
            }
            const existingQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            if (existingQueues.length > 0) {
                await this.handleExistingBooking(whatsappId, existingQueues[0]);
                return;
            }
            if (!station.isAvailable || !this.isStationBookable(station)) {
                await this.handleUnavailableStation(whatsappId, station);
                return;
            }
            logger_1.logger.info('🎫 Initiating booking payment', { whatsappId, stationId, stationName: station.name });
            await (0, booking_payment_integration_1.handleBookingWithPayment)(whatsappId, stationId, station.name, 50);
            logger_1.logger.info(' Booking payment link sent successfully', { whatsappId, stationId });
        }
        catch (error) {
            logger_1.logger.error('❌ Station booking failed', {
                whatsappId,
                stationId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            await this.handleError(error, 'station booking', { whatsappId, stationId });
        }
    }
    async showStationDetails(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not available');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, this.formatStationDetails(station));
            setTimeout(() => this.sendStationActionButtons(whatsappId, station), 2000);
        }
        catch (error) {
            await this.handleError(error, 'station details', { whatsappId, stationId });
        }
    }
    async handleJoinQueue(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found');
                return;
            }
            const existingQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            const existingQueue = existingQueues.find(q => q.stationId === stationId);
            if (existingQueue) {
                await this.showExistingQueueStatus(whatsappId, existingQueue);
                return;
            }
            const queuePosition = await queue_1.queueService.joinQueue(whatsappId, stationId);
            if (!queuePosition) {
                await this.handleQueueJoinFailure(whatsappId, station);
                return;
            }
            await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
        }
        catch (error) {
            await this.handleError(error, 'join queue', { whatsappId, stationId });
        }
    }
    async handleQueueStatus(whatsappId, stationId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId))
            return;
        try {
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            if (userQueues.length === 0) {
                await this.showNoActiveQueues(whatsappId);
                return;
            }
            for (const queue of userQueues) {
                await this.displayQueueStatus(whatsappId, queue);
            }
            setTimeout(() => this.sendQueueManagementButtons(whatsappId, userQueues), 2000);
        }
        catch (error) {
            await this.handleError(error, 'queue status', { whatsappId });
        }
    }
    async handleQueueCancel(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const activeSession = await session_1.sessionService.getActiveSession(whatsappId, stationId);
            if (activeSession && ['initiated', 'active'].includes(activeSession.status)) {
                logger_1.logger.info('Cancelling active charging session during queue cancellation', {
                    whatsappId,
                    stationId,
                    sessionId: activeSession.id,
                    sessionStatus: activeSession.status
                });
                try {
                    await database_1.db
                        .update(schema_1.chargingSessions)
                        .set({
                        status: 'cancelled',
                        verificationStatus: 'cancelled',
                        endTime: new Date(),
                        endedAt: new Date(),
                        updatedAt: new Date(),
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, activeSession.id));
                    session_1.sessionService.getActiveSessions().delete(activeSession.id);
                    logger_1.logger.info('✅ Charging session cancelled successfully', {
                        whatsappId,
                        stationId,
                        sessionId: activeSession.id
                    });
                    photo_verification_1.photoVerificationService.cleanupState(whatsappId);
                }
                catch (sessionError) {
                    logger_1.logger.error('Failed to cancel charging session, continuing with queue cancellation', {
                        whatsappId,
                        stationId,
                        sessionError
                    });
                }
            }
            const success = await queue_1.queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
            if (!success) {
                await this.sendError(whatsappId, 'No active queue found');
                return;
            }
            await this.handleSuccessfulCancellation(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'queue cancel', { whatsappId, stationId });
        }
    }
    async handleChargingStart(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            const reservedQueue = userQueues.find(q => q.stationId === stationId && ['reserved', 'waiting'].includes(q.status));
            if (!reservedQueue) {
                await this.handleNoValidReservation(whatsappId, stationId);
                return;
            }
            const session = await session_1.sessionService.startSession(whatsappId, stationId, reservedQueue.id);
            if (!session) {
                await this.handleSessionStartFailure(whatsappId, stationId);
                return;
            }
            await queue_1.queueService.startCharging(whatsappId, stationId).catch(err => logger_1.logger.warn('Failed to update queue status', { whatsappId, stationId, err }));
        }
        catch (error) {
            await this.handleError(error, 'charging start', { whatsappId, stationId });
        }
    }
    async handleSessionStatus(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const activeSession = await session_1.sessionService.getActiveSession(whatsappId, stationId);
            if (!activeSession) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⚡ *No Active Session*\nNo active charging session found at this station.');
                return;
            }
            await this.displayBasicSessionInfo(whatsappId, activeSession);
        }
        catch (error) {
            await this.handleError(error, 'session status', { whatsappId, stationId });
        }
    }
    async handleSessionStop(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const activeSession = await session_1.sessionService.getActiveSession(whatsappId, stationId);
            if (!activeSession) {
                await this.sendError(whatsappId, 'No active session found');
                return;
            }
            const success = await session_1.sessionService.stopSession(whatsappId, stationId);
            if (!success) {
                await this.sendError(whatsappId, 'Failed to stop session');
                return;
            }
            await queue_1.queueService.completeCharging(whatsappId, stationId).catch(err => logger_1.logger.warn('Failed to complete queue', { whatsappId, stationId, err }));
        }
        catch (error) {
            await this.handleError(error, 'session stop', { whatsappId, stationId });
        }
    }
    async handleSessionExtend(whatsappId, stationId, minutes) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const activeSession = await session_1.sessionService.getActiveSession(whatsappId, stationId);
            if (!activeSession) {
                await this.sendError(whatsappId, 'No active session to extend');
                return;
            }
            const newTargetBattery = Math.min(100, (activeSession.targetBatteryLevel || 80) + Math.floor(minutes / 30) * 10);
            const extendedTime = new Date(Date.now() + minutes * 60000);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Session Extended*\n` +
                `+${minutes} minutes\n` +
                `New target: ${newTargetBattery}%\n` +
                `Expected completion: ${extendedTime.toLocaleTimeString()}`);
        }
        catch (error) {
            await this.handleError(error, 'session extend', { whatsappId, stationId });
        }
    }
    async sendSessionSummary(whatsappId) {
        try {
            const [session] = await database_1.db.select()
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, whatsappId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.verificationStatus, 'completed')))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.chargingSessions.createdAt))
                .limit(1);
            if (!session)
                return;
            const consumption = parseFloat(session.energyDelivered || '0');
            const totalCost = parseFloat(session.totalCost || '0');
            const duration = session.duration || 0;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🎉 *Charging Complete!*\n` +
                `📊 *Summary:*\n` +
                `⚡ Energy: ${consumption.toFixed(2)} kWh\n` +
                `⏱️ Duration: ${Math.floor(duration / 60)}h ${duration % 60}m\n` +
                `💰 Total: ₹${totalCost.toFixed(2)}\n` +
                `📈 *Meter Readings:*\n` +
                `Start: ${session.startMeterReading} kWh\n` +
                `End: ${session.endMeterReading} kWh\n` +
                `Payment processing...\n`);
        }
        catch (error) {
            logger_1.logger.error('Failed to send session summary', { whatsappId, error });
        }
    }
    async handleInstantBooking(whatsappId, station, user) {
        try {
            const queuePosition = await queue_1.queueService.joinQueue(whatsappId, station.id);
            if (!queuePosition) {
                await this.handleQueueBooking(whatsappId, station, user);
                return;
            }
            const reserved = await queue_1.queueService.reserveSlot(whatsappId, station.id, 15);
            if (reserved) {
                await this.showInstantBookingSuccess(whatsappId, station, user);
            }
            else {
                await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
            }
        }
        catch (error) {
            logger_1.logger.error('Instant booking failed', { whatsappId, stationId: station.id, error });
            await this.handleQueueBooking(whatsappId, station, user);
        }
    }
    async handleQueueBooking(whatsappId, station, user) {
        const queueStats = await queue_1.queueService.getQueueStats(station.id);
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Join Queue at ${station.name}?*\n\n` +
            `📊 *People in queue:* ${queueStats.totalInQueue}\n` +
            `⏱️ *Avg. wait time:* ${queueStats.averageWaitTime} min\n` +
            `💰 *Rate:* ${station.priceDisplay}\n` +
            `💵 *Estimated cost:* ~₹${this.estimateCost(station, user)}\n\n` +
            `_Tap “Yes” to confirm or “No” to cancel._`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Proceed?*', [
            { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
            { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' },
            { id: `get_directions_${station.id}`, title: '🗺️ Directions' }
        ]), 2000);
    }
    async handleExistingBooking(whatsappId, existingQueue) {
        const statusMap = {
            reserved: '✅ Reserved',
            waiting: '⏳ In Queue',
            charging: '⚡ Active'
        };
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⚠️ *Existing Booking*\n` +
            `📍 ${existingQueue.stationName}\n` +
            `📊 Status: ${statusMap[existingQueue.status] || 'Active'}\n` +
            `👥 Position: #${existingQueue.position}\n` +
            `💡 Only one booking allowed at a time.`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Manage Booking:*', [
            { id: `queue_status_${existingQueue.stationId}`, title: '📊 Status' },
            { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel' },
            { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Directions' }
        ]), 2000);
    }
    async showInstantBookingSuccess(whatsappId, station, user) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Slot Reserved!*\n\n` +
            `*Location:* ${station.name}\n` +
            `*Reserved for:* 15 minutes\n` +
            `*Rate:* ${station.priceDisplay}\n` +
            `*Estimated cost:* ~₹${this.estimateCost(station, user)}\n\n` +
            `*Please arrive within 15 minutes to secure your slot!*`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚡ *Ready to Start?*', [
            { id: `start_charging_${station.id}`, title: '⚡ Start Charging' },
            { id: `get_directions_${station.id}`, title: '🗺️ Navigate' },
            { id: `cancel_queue_${station.id}`, title: '❌ Cancel' }
        ]), 2000);
    }
    async handleSuccessfulQueueJoin(whatsappId, queuePosition) {
        const waitAdvice = queuePosition.estimatedWaitMinutes > 30
            ? '\n Long wait. Consider alternatives.'
            : '\n Reasonable wait time!';
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Joined Queue Successfully!*\n\n` +
            `Location: ${queuePosition.stationName}\n` +
            `Position: #${queuePosition.position}\n` +
            `Estimated wait: ~${queuePosition.estimatedWaitMinutes} min\n` +
            `Live updates enabled${waitAdvice}`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Manage Queue:*', [
            { id: `queue_status_${queuePosition.stationId}`, title: '📊 Refresh Status' },
            { id: `get_directions_${queuePosition.stationId}`, title: '🗺️ Navigate' },
            { id: `cancel_queue_${queuePosition.stationId}`, title: '❌ Cancel' }
        ]), 2000);
    }
    async handleSuccessfulCancellation(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ *Queue Cancelled*\nBooking cancelled successfully.\nNo charges applied.\n💡 Find another station?`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Next Steps:*', [
            { id: 'new_search', title: '🆕 New Search' },
            { id: 'recent_searches', title: '🕒 Recent' }
        ]), 2000);
    }
    async handleQueueJoinFailure(whatsappId, station) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ *Queue Full*\nUnable to join queue at ${station.name}.\n🔍 Find alternatives?`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Options:*', [
            { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' },
            { id: 'find_nearby_stations', title: '🗺️ Nearby' },
            { id: 'new_search', title: '🆕 Search' }
        ]), 2000);
    }
    async handleSessionStartFailure(whatsappId, stationId) {
        try {
            const [userQueues, activeSession] = await Promise.all([
                queue_1.queueService.getUserQueueStatus(whatsappId).catch(() => []),
                session_1.sessionService.getActiveSession(whatsappId, stationId).catch(() => null)
            ]);
            const queueAtStation = userQueues.find(q => q.stationId === stationId);
            let message;
            let buttons;
            if (activeSession) {
                message = `⚠️ *Session Already Active*\n\n` +
                    `You already have an active charging session at this station.\n\n` +
                    `📊 Current Status: ${activeSession.status}\n` +
                    `🔌 Use the session controls below to manage it.`;
                buttons = [
                    { id: `session_status_${stationId}`, title: '📊 Check Status' },
                    { id: `session_stop_${stationId}`, title: '🛑 Stop Session' },
                    { id: 'help', title: '❓ Help' }
                ];
            }
            else if (queueAtStation) {
                message = `❌ *Session Start Failed*\n\n` +
                    `Queue Position: #${queueAtStation.position}\n` +
                    `Status: ${queueAtStation.status}\n\n` +
                    `⚠️ *Possible Reasons:*\n` +
                    `• Station is currently offline\n` +
                    `• Technical maintenance in progress\n` +
                    `• Connectivity issues\n\n` +
                    `💡 Please wait a moment and try again.`;
                buttons = [
                    { id: `start_charging_${stationId}`, title: '🔄 Retry Start' },
                    { id: `queue_status_${stationId}`, title: '📊 Queue Status' },
                    { id: 'help', title: '📞 Contact Support' }
                ];
            }
            else {
                message = `❌ *Failed to Start Session*\n\n` +
                    `Unable to create charging session.\n\n` +
                    `⚠️ *Possible Issues:*\n` +
                    `• No active reservation found\n` +
                    `• Station connectivity problems\n` +
                    `• Technical maintenance\n\n` +
                    `💡 Try joining the queue first, then start charging.`;
                buttons = [
                    { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
                    { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
                    { id: 'help', title: '❓ Get Help' }
                ];
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔧 *What would you like to do?*', buttons);
            }, 2000);
            logger_1.logger.error('Session start failure handled', {
                whatsappId,
                stationId,
                hasQueue: !!queueAtStation,
                queueStatus: queueAtStation?.status,
                hasActiveSession: !!activeSession
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to handle session start failure', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ *Failed to Start Charging*\n\n` +
                `Unable to create charging session.\n\n` +
                `⚠️ *Common Reasons:*\n` +
                `• Station connectivity issues\n` +
                `• No valid reservation\n` +
                `• Technical maintenance in progress\n\n` +
                `💡 *Recommended Actions:*\n` +
                `1. Check your queue status\n` +
                `2. Verify station is available\n` +
                `3. Try again in a few moments\n` +
                `4. Contact support if issue persists`);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔧 *Actions:*', [
                    { id: `queue_status_${stationId}`, title: '📊 Check Queue' },
                    { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
                    { id: 'help', title: '📞 Support' }
                ]);
            }, 2000);
        }
    }
    async handleNoValidReservation(whatsappId, stationId) {
        try {
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            const queueAtStation = userQueues.find(q => q.stationId === stationId);
            let message;
            let buttons;
            if (queueAtStation) {
                message = `⚠️ *Reservation Not Ready*\n\n` +
                    `Your queue position: #${queueAtStation.position}\n` +
                    `Status: ${queueAtStation.status}\n\n` +
                    `⏳ Please wait until your slot is ready.\n` +
                    `You'll receive a notification when it's your turn!`;
                buttons = [
                    { id: `queue_status_${stationId}`, title: '🔄 Refresh Status' },
                    { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
                    { id: `cancel_queue_${stationId}`, title: '❌ Cancel Queue' }
                ];
            }
            else {
                message = `❌ *No Active Reservation*\n\n` +
                    `You need an active queue position to start charging at this station.\n\n` +
                    ` *Next Steps:*\n` +
                    `• Join the queue first\n` +
                    `• Wait for your turn\n` +
                    `• You'll be notified when ready`;
                buttons = [
                    { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
                    { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
                    { id: 'find_nearby_stations', title: '🔍 Find Alternatives' }
                ];
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *What would you like to do?*', buttons);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle no valid reservation', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ *No Valid Reservation*\n\n' +
                'You need an active reservation to start charging.\n' +
                'Please join the queue or book a slot first.');
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Next Steps:*', [
                    { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
                    { id: `station_info_${stationId}`, title: 'ℹ️ Station Info' },
                    { id: 'new_search', title: '🔍 New Search' }
                ]);
            }, 2000);
        }
    }
    async handleUnavailableStation(whatsappId, station) {
        let reason = '❌ Station unavailable';
        let suggestion = 'Try another station';
        if (!station.isActive) {
            reason = '🚫 Station offline for maintenance';
            suggestion = 'Check back later';
        }
        else if (!station.isOpen) {
            reason = '🕐 Station closed';
            suggestion = `Hours: ${this.formatOperatingHours(station.operatingHours)}`;
        }
        else if (station.availableSlots === 0) {
            reason = '🔴 All slots occupied';
            suggestion = 'Join queue or find alternatives';
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `${reason}\n${suggestion}`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Options:*', [
            { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
            { id: 'find_nearby_stations', title: '🗺️ Nearby' },
            { id: 'new_search', title: '🆕 Search' }
        ]), 2000);
    }
    async displayQueueStatus(whatsappId, queue) {
        const statusEmoji = {
            waiting: '⏳', reserved: '✅', charging: '⚡',
            ready: '🎯', completed: '✅', cancelled: '❌'
        };
        const emoji = statusEmoji[queue.status] || '📋';
        const timeInfo = queue.status === 'reserved' && queue.reservationExpiry
            ? `⏰ Expires: ${new Date(queue.reservationExpiry).toLocaleTimeString()}`
            : `⏱️ Wait: ~${queue.estimatedWaitMinutes} min`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `${emoji} *Queue Status*\n` +
            `${queue.stationName}\n` +
            `Status: ${this.capitalizeFirst(queue.status)}\n` +
            `Position: #${queue.position}\n` +
            `${timeInfo}\n` +
            `Joined: ${new Date(queue.createdAt).toLocaleString()}`);
    }
    async displayBasicSessionInfo(whatsappId, session) {
        const startTime = session.startTime || new Date();
        const duration = Math.floor((Date.now() - startTime.getTime()) / 60000);
        const durationText = duration > 60
            ? `${Math.floor(duration / 60)}h ${duration % 60}m`
            : `${duration}m`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Active Charging Session*\n\n` +
            `Location: ${session.stationName || 'Charging Station'}\n` +
            `Current battery: ${session.currentBatteryLevel || 0}%\n` +
            `Target battery: ${session.targetBatteryLevel || 80}%\n` +
            `Charging rate: ${session.chargingRate || 0} kW\n` +
            `Price: ₹${session.pricePerKwh || 0}/kWh\n` +
            `Duration: ${durationText}\n` +
            `Estimated cost: ₹${session.totalCost?.toFixed(2) || '0.00'}\n` +
            `Session status: Active`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎛️ *Session Controls:*', [
            { id: `extend_30_${session.stationId}`, title: '⏰ +30min' },
            { id: `extend_60_${session.stationId}`, title: '⏰ +1hr' },
            { id: `session_stop_${session.stationId}`, title: '🛑 Stop Session' }
        ]), 2000);
    }
    async showNoActiveQueues(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 *Your Bookings*\nNo active bookings found.\n🔍 Ready to find a station?');
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚡ *Find Stations:*', [
            { id: 'new_search', title: '🆕 Search' },
            { id: 'recent_searches', title: '🕒 Recent' }
        ]), 2000);
    }
    async showExistingQueueStatus(whatsappId, existingQueue) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Already in Queue*\n` +
            `You're already queued at this station.\n` +
            `👥 Position: #${existingQueue.position}\n` +
            `⏱️ Wait: ~${existingQueue.estimatedWaitMinutes} min\n` +
            `💡 Updates coming as your position changes.`);
        setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Manage:*', [
            { id: `queue_status_${existingQueue.stationId}`, title: '📊 Refresh' },
            { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Navigate' },
            { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel' }
        ]), 2000);
    }
    async sendQueueManagementButtons(whatsappId, queues) {
        if (queues.length === 0)
            return;
        const primaryQueue = queues[0];
        const buttons = [];
        if (primaryQueue.status === 'reserved') {
            buttons.push({ id: `session_start_${primaryQueue.stationId}`, title: '⚡ Start' });
        }
        buttons.push({ id: `get_directions_${primaryQueue.stationId}`, title: '🗺️ Navigate' }, { id: `cancel_queue_${primaryQueue.stationId}`, title: '❌ Cancel' });
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎛️ *Queue Management:*', buttons.slice(0, 3));
    }
    async handleGetDirections(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found');
                return;
            }
            const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(station.name + ' ' + station.address)}`;
            const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(station.name + ' ' + station.address)}`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🗺️ *Directions to ${station.name}*\n` +
                `${station.address}\n` +
                `🔗 *Navigate:*\n` +
                `Google Maps: ${googleMapsUrl}\n` +
                `Waze: ${wazeUrl}\n` +
                `*Tips:*\n` +
                `• Save location for quick access\n` +
                `• Check hours before travel\n` +
                `• Arrive 5 min early for reservations`);
            setTimeout(() => whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *While traveling:*', [
                { id: `queue_status_${station.id}`, title: '📊 Check Queue' },
                { id: `station_info_${station.id}`, title: '📋 Details' },
                { id: 'help', title: '❓ Support' }
            ]), 2000);
        }
        catch (error) {
            await this.handleError(error, 'get directions', { whatsappId, stationId });
        }
    }
    async handleFindAlternatives(whatsappId, stationId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId))
            return;
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*Finding Alternatives...*\n' +
                'Searching for nearby options with:\n' +
                '• Similar charging speeds\n• Compatible connectors\n• Shorter waits\n• Better rates');
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🎯 *Alternative Strategies:*\n` +
                    `**Quick Options:**\n` +
                    `Expand search radius\n` +
                    `Find shorter queues\n` +
                    `Better rate stations\n` +
                    `**Smart Tips:**\n` +
                    `${user?.connectorType ? `🔌 ${user.connectorType} compatible\n` : ''}` +
                    `📊 Off-peak hours (10 PM - 8 AM)\n` +
                    `🏢 Try commercial areas`);
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Next Move:*', [
                    { id: 'expand_search', title: 'Expand Area' },
                    { id: 'find_nearby_stations', title: 'Find Nearby' },
                    { id: 'new_search', title: 'New Search' }
                ]);
            }, 3000);
        }
        catch (error) {
            await this.handleError(error, 'find alternatives', { whatsappId, stationId });
        }
    }
    async getStationDetails(stationId) {
        const now = Date.now();
        const cached = stationCache.get(stationId);
        if (cached && cached.expiry > now) {
            return cached.data;
        }
        try {
            const [station] = await database_1.db
                .select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            if (!station) {
                logger_1.logger.warn('Station not found', { stationId });
                return null;
            }
            const processed = this.processStationData(station);
            stationCache.set(stationId, { data: processed, expiry: now + CACHE_TTL_MS });
            return processed;
        }
        catch (error) {
            logger_1.logger.error('Database query failed', { stationId, error });
            return null;
        }
    }
    processStationData(station) {
        const isActive = station.isActive ?? false;
        const isOpen = station.isOpen ?? false;
        const availableSlots = Number(station.availableSlots || station.availablePorts) || 0;
        const totalSlots = Number(station.totalSlots || station.totalPorts) || 1;
        const distance = Number(station.distance) || 0;
        const price = Number(station.pricePerKwh) || 0;
        const rating = Number(station.rating || station.averageRating) || 0;
        const reviews = Number(station.totalReviews || station.reviewCount) || 0;
        const utilization = totalSlots > 0
            ? Math.round(((totalSlots - availableSlots) / totalSlots) * 100)
            : 0;
        const isAvailable = availableSlots > 0 && isActive && isOpen;
        let availability = 'Offline';
        if (isActive && isOpen) {
            availability = availableSlots > 0 ? 'Available' : 'Full';
        }
        return {
            ...station,
            distance: station.distance || '0',
            totalSlots,
            availableSlots,
            totalPorts: station.totalPorts || totalSlots,
            availablePorts: station.availablePorts || availableSlots,
            isActive,
            isOpen,
            isAvailable,
            utilization,
            availability,
            priceDisplay: price > 0 ? `₹${price.toFixed(2)}/kWh` : 'N/A',
            distanceDisplay: distance > 0 ? `${distance.toFixed(1)} km` : 'N/A',
            ratingDisplay: rating > 0 ? `${rating.toFixed(1)} ⭐` : 'No ratings',
            slotsDisplay: `${availableSlots}/${totalSlots} available`,
            finalRating: rating,
            finalReviews: reviews
        };
    }
    async showStationOverview(whatsappId, station) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🏢 *${station.name}*\n` +
            `${station.address}\n` +
            `${station.distanceDisplay}\n` +
            `${station.slotsDisplay}\n` +
            `${station.priceDisplay}\n` +
            `${station.ratingDisplay} (${station.finalReviews} reviews)\n` +
            `*Connectors:* ${this.formatConnectorTypes(station.connectorTypes)}\n` +
            `*Hours:* ${this.formatOperatingHours(station.operatingHours)}\n` +
            `*Status:* ${this.getStatusWithEmoji(station.availability)} ${station.availability}`);
        setTimeout(() => this.sendStationActionButtons(whatsappId, station), 2000);
    }
    formatStationDetails(station) {
        let details = `🏢 *${station.name}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `*Location:*\n${station.address}\n` +
            `⚡ *Charging:*\n` +
            `• Slots: ${station.slotsDisplay}\n` +
            `• Price: ${station.priceDisplay}\n` +
            `• Connectors: ${this.formatConnectorTypes(station.connectorTypes)}\n` +
            `*Hours:*\n${this.formatOperatingHours(station.operatingHours)}\n` +
            `⭐ *Rating:* ${station.ratingDisplay}\n` +
            `📊 *Utilization:* ${station.utilization}%\n`;
        if (station.amenities && Array.isArray(station.amenities) && station.amenities.length > 0) {
            details += `\n🎯 *Amenities:*\n${station.amenities.map((a) => `• ${this.capitalizeFirst(a)}`).join('\n')}\n`;
        }
        details += `\n${this.getStatusWithEmoji(station.availability)} *Status:* ${station.availability}`;
        return details;
    }
    async sendStationActionButtons(whatsappId, station) {
        const buttons = [];
        if (station.isAvailable) {
            buttons.push({ id: `book_station_${station.id}`, title: '⚡ Book Now' }, { id: `station_info_${station.id}`, title: '📊 Details' });
        }
        else {
            buttons.push({ id: `join_queue_${station.id}`, title: '📋 Join Queue' }, { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' });
        }
        buttons.push({ id: `get_directions_${station.id}`, title: '🗺️ Navigate' });
        if (buttons.length > 0) {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `🎯 *Actions for ${station.name}:*`, buttons.slice(0, 3), '🏢 Station Menu');
        }
    }
    validateInput(whatsappId, stationId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID', { whatsappId });
            return false;
        }
        if (!stationId || isNaN(stationId) || stationId <= 0) {
            logger_1.logger.error('Invalid station ID', { stationId, whatsappId });
            whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid station. Try again.');
            return false;
        }
        return true;
    }
    isStationBookable(station) {
        return station.isActive === true && station.isOpen === true;
    }
    formatConnectorTypes(connectorTypes) {
        if (Array.isArray(connectorTypes)) {
            return connectorTypes.length > 0 ? connectorTypes.join(', ') : 'Standard';
        }
        return connectorTypes || 'Standard';
    }
    formatOperatingHours(operatingHours) {
        if (typeof operatingHours === 'object' && operatingHours !== null) {
            const allDay = Object.values(operatingHours).every(h => h === '24/7');
            if (allDay)
                return '24/7';
            return 'Varies by day';
        }
        return operatingHours || '24/7';
    }
    getStatusWithEmoji(availability) {
        const map = {
            Available: '✅', Full: '🔴', Offline: '⚫'
        };
        return map[availability] || '❓';
    }
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    estimateCost(station, user) {
        const basePrice = Number(station.pricePerKwh) || 12;
        const estimatedKwh = user.connectorType === 'CCS2' ? 25 : 15;
        return (basePrice * estimatedKwh).toFixed(0);
    }
    async handleError(error, operation, context) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger_1.logger.error(`${operation} failed`, { ...context, error: errorMsg });
        if (context.whatsappId) {
            await this.sendError(context.whatsappId, `Failed to ${operation}. Please try again.`);
        }
    }
    async sendError(whatsappId, message) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to send error', { whatsappId, error });
        }
    }
    async sendNotFound(whatsappId, message) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🔍 ${message}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to send not found', { whatsappId, error });
        }
    }
    getHealthStatus() {
        return {
            status: 'healthy',
            activeOperations: 0,
            lastActivity: new Date().toISOString(),
            integrations: {
                queueService: !!queue_1.queueService,
                sessionService: !!session_1.sessionService,
                notificationService: !!notification_1.notificationService,
                photoVerification: !!photo_verification_1.photoVerificationService
            }
        };
    }
    async processQueueJoin(whatsappId, stationId) {
        return this.handleJoinQueue(whatsappId, stationId);
    }
}
exports.BookingController = BookingController;
exports.bookingController = new BookingController();
//# sourceMappingURL=booking.js.map