"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueWebhookController = exports.QueueWebhookController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const booking_1 = require("./booking");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
const button_parser_1 = require("../utils/button-parser");
const queue_1 = require("../services/queue");
class QueueWebhookController {
    async handleQueueButton(whatsappId, buttonId, buttonTitle) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID', { whatsappId });
            return;
        }
        try {
            logger_1.logger.info('🎯 Processing queue button', {
                whatsappId,
                buttonId,
                buttonTitle
            });
            const parsed = (0, button_parser_1.parseButtonId)(buttonId);
            logger_1.logger.info('📋 Button parsed', {
                whatsappId,
                buttonId,
                parsed: {
                    action: parsed.action,
                    category: parsed.category,
                    stationId: parsed.stationId
                }
            });
            if (parsed.category === 'queue' && parsed.action === 'status') {
                if (!parsed.stationId || parsed.stationId <= 0) {
                    logger_1.logger.error('❌ Invalid stationId from button parser', {
                        whatsappId,
                        buttonId,
                        parsed
                    });
                    const match = buttonId.match(/queue_status_(\d+)/);
                    if (match && match[1]) {
                        parsed.stationId = parseInt(match[1], 10);
                        logger_1.logger.info('✅ Manually extracted stationId from buttonId', {
                            whatsappId,
                            buttonId,
                            extractedStationId: parsed.stationId
                        });
                    }
                }
            }
            await this.routeAction(whatsappId, buttonId, parsed, buttonTitle);
        }
        catch (error) {
            logger_1.logger.error('❌ handleQueueButton failed', {
                whatsappId,
                buttonId,
                buttonTitle,
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack
                } : error
            });
            await this.handleError(error, 'queue button', { whatsappId, buttonId });
        }
    }
    async handleQueueList(whatsappId, listId, listTitle) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID', { whatsappId });
            return;
        }
        try {
            logger_1.logger.info('📋 Processing queue list selection', {
                whatsappId,
                listId,
                listTitle
            });
            const parsed = (0, button_parser_1.parseButtonId)(listId);
            logger_1.logger.info('📋 List parsed', {
                whatsappId,
                listId,
                parsed: {
                    action: parsed.action,
                    category: parsed.category,
                    stationId: parsed.stationId
                }
            });
            await this.routeAction(whatsappId, listId, parsed, listTitle);
        }
        catch (error) {
            logger_1.logger.error('❌ handleQueueList failed', {
                whatsappId,
                listId,
                listTitle,
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack
                } : error
            });
            await this.handleError(error, 'queue list', { whatsappId, listId });
        }
    }
    async routeAction(whatsappId, actionId, parsed, title) {
        const { action, category, stationId } = parsed;
        switch (category) {
            case 'queue':
                await this.handleQueueCategory(whatsappId, action, stationId);
                break;
            case 'session':
                await this.handleSessionCategory(whatsappId, action, stationId);
                break;
            case 'station':
                await this.handleStationCategory(whatsappId, action, stationId);
                break;
            default:
                await this.handleSpecificActions(whatsappId, actionId, stationId);
        }
    }
    async handleQueueCategory(whatsappId, action, stationId) {
        switch (action) {
            case 'status':
                await this.handleQueueStatus(whatsappId, stationId);
                break;
            case 'cancel':
                await this.handleQueueCancel(whatsappId, stationId);
                break;
            case 'confirm_cancel':
                await this.handleConfirmCancel(whatsappId, stationId);
                break;
            case 'join':
                await this.handleJoinQueue(whatsappId, stationId);
                break;
            default:
                await this.handleUnknownAction(whatsappId, action);
        }
    }
    async handleSessionCategory(whatsappId, action, stationId) {
        switch (action) {
            case 'start':
            case 'start_charging':
                await booking_1.bookingController.handleChargingStart(whatsappId, stationId);
                break;
            case 'status':
                await this.handleSessionStatus(whatsappId, stationId);
                break;
            case 'stop':
                await booking_1.bookingController.handleSessionStop(whatsappId, stationId);
                break;
            default:
                await this.handleUnknownAction(whatsappId, action);
        }
    }
    async handleStationCategory(whatsappId, action, stationId) {
        switch (action) {
            case 'book':
                await booking_1.bookingController.handleStationBooking(whatsappId, stationId);
                break;
            case 'info':
            case 'details':
                await booking_1.bookingController.showStationDetails(whatsappId, stationId);
                break;
            case 'directions':
                await booking_1.bookingController.handleGetDirections(whatsappId, stationId);
                break;
            case 'alternatives':
                await booking_1.bookingController.handleFindAlternatives(whatsappId, stationId);
                break;
            case 'rate':
                await this.handleStationRating(whatsappId, stationId);
                break;
            default:
                await booking_1.bookingController.handleStationSelection(whatsappId, stationId);
        }
    }
    async handleSpecificActions(whatsappId, actionId, stationId) {
        if (actionId.startsWith('notify_')) {
            await this.handleNotificationActions(whatsappId, stationId);
        }
        else if (actionId.startsWith('rate_')) {
            await this.handleStationRating(whatsappId, stationId);
        }
        else {
            await this.handleUnknownAction(whatsappId, actionId);
        }
    }
    async handleQueueStatus(whatsappId, stationId) {
        try {
            logger_1.logger.info('🔍 handleQueueStatus called', {
                whatsappId,
                stationId,
                stationIdType: typeof stationId,
                isValidStationId: stationId > 0
            });
            if (!stationId || stationId <= 0) {
                logger_1.logger.error('❌ Invalid stationId received', { whatsappId, stationId });
                const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
                if (userQueues.length === 0) {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 *No Active Queue*\n\nYou are not currently in any queue.\n\n🔍 Ready to find a charging station?');
                    setTimeout(async () => {
                        await this.sendFindStationButtons(whatsappId);
                    }, 2000);
                    return;
                }
                stationId = userQueues[0].stationId;
                logger_1.logger.info('✅ Using stationId from user\'s active queue', {
                    whatsappId,
                    stationId,
                    queueCount: userQueues.length
                });
            }
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            logger_1.logger.info('📊 Retrieved user queues', {
                whatsappId,
                stationId,
                queueCount: userQueues.length,
                queues: userQueues.map(q => ({
                    stationId: q.stationId,
                    position: q.position,
                    status: q.status
                }))
            });
            const queueData = stationId
                ? userQueues.find(q => q.stationId === stationId)
                : userQueues[0];
            if (!queueData) {
                logger_1.logger.warn('⚠️ No queue found for user', {
                    whatsappId,
                    stationId,
                    totalQueues: userQueues.length
                });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 *No Active Queue*\n\nYou are not currently in any queue at this station.\n\n🔍 Ready to find a charging station?');
                setTimeout(async () => {
                    await this.sendFindStationButtons(whatsappId);
                }, 2000);
                return;
            }
            logger_1.logger.info('✅ Queue found, formatting status', {
                whatsappId,
                queueId: queueData.id,
                position: queueData.position,
                status: queueData.status,
                stationName: queueData.stationName
            });
            const statusMessage = this.formatQueueStatus(queueData);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, statusMessage);
            setTimeout(async () => {
                await this.sendQueueManagementButtons(whatsappId, queueData);
            }, 2000);
            logger_1.logger.info('✅ Queue status sent successfully', { whatsappId, stationId });
        }
        catch (error) {
            logger_1.logger.error('❌ handleQueueStatus failed', {
                whatsappId,
                stationId,
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : error
            });
            await this.handleError(error, 'queue status', { whatsappId, stationId });
        }
    }
    async handleJoinQueue(whatsappId, stationId) {
        try {
            await booking_1.bookingController.handleJoinQueue(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'join queue', { whatsappId, stationId });
        }
    }
    async handleQueueCancel(whatsappId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '❓ *Cancel Queue Position*\n\nAre you sure you want to cancel your booking?\n\n⚠️ Your position will be released.', [
                { id: `confirm_cancel_${stationId}`, title: '✅ Yes, Cancel' },
                { id: `queue_status_${stationId}`, title: '❌ Keep Position' },
                { id: `get_directions_${stationId}`, title: '🗺️ Directions' }
            ]);
        }
        catch (error) {
            await this.handleError(error, 'queue cancel', { whatsappId, stationId });
        }
    }
    async handleConfirmCancel(whatsappId, stationId) {
        try {
            await booking_1.bookingController.handleQueueCancel(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'confirm cancel', { whatsappId, stationId });
        }
    }
    async handleSessionStatus(whatsappId, stationId) {
        try {
            const sessionData = await this.getSessionData(whatsappId, stationId);
            if (!sessionData) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 *No Active Session*\n\nYou don\'t have an active charging session.\n\n⚡ Ready to start charging?');
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔋 *Next Steps:*', [
                        { id: `start_charging_${stationId}`, title: '⚡ Start Charging' },
                        { id: 'find_nearby_stations', title: '🔍 Find Stations' },
                        { id: 'help', title: '❓ Help' }
                    ]);
                }, 2000);
                return;
            }
            const statusMessage = this.formatSessionStatus(sessionData);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, statusMessage);
            setTimeout(async () => {
                await this.sendSessionControls(whatsappId, sessionData);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'session status', { whatsappId, stationId });
        }
    }
    async handleNotificationActions(whatsappId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔔 *Notifications Enabled*\n\n' +
                'You\'ll receive updates for:\n' +
                '• Queue position changes\n' +
                '• Slot availability\n' +
                '• Session completion\n\n' +
                '✅ All set!');
        }
        catch (error) {
            await this.handleError(error, 'notifications', { whatsappId, stationId });
        }
    }
    async handleStationRating(whatsappId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⭐ *Rate Your Experience*\n\nHow would you rate this charging station?', [
                { id: `rate_5_${stationId}`, title: '⭐⭐⭐⭐⭐ Excellent' },
                { id: `rate_4_${stationId}`, title: '⭐⭐⭐⭐ Good' },
                { id: `rate_3_${stationId}`, title: '⭐⭐⭐ Average' }
            ]);
        }
        catch (error) {
            await this.handleError(error, 'station rating', { whatsappId, stationId });
        }
    }
    formatQueueStatus(queueData) {
        const statusEmoji = this.getQueueStatusEmoji(queueData.status);
        const progressBar = this.generateProgressBar(queueData.position, 5);
        const joinedTime = queueData.createdAt
            ? new Date(queueData.createdAt).toLocaleTimeString()
            : 'Unknown';
        return `${statusEmoji} *Queue Status*\n\n` +
            `📍 *${queueData.stationName || 'Charging Station'}*\n` +
            `👥 *Position:* #${queueData.position}\n` +
            `${progressBar}\n` +
            `⏱️ *Estimated Wait:* ${queueData.estimatedWaitMinutes} minutes\n` +
            `📅 *Joined:* ${joinedTime}\n` +
            `🔄 *Status:* ${this.getStatusDescription(queueData.status)}\n\n` +
            `${this.getQueueTip(queueData)}`;
    }
    formatSessionStatus(sessionData) {
        let message = `⚡ *Charging Session*\n\n` +
            `*${sessionData.stationName}*\n` +
            `*Rate:* ₹${sessionData.currentRate}/kWh\n` +
            `*Status:* ${sessionData.status.toUpperCase()}\n\n`;
        if (sessionData.status === 'active' && sessionData.startReading) {
            message += `📊 *Initial Reading:* ${sessionData.startReading.toFixed(2)} kWh\n\n`;
        }
        message += sessionData.status === 'active'
            ? `🔋 *Charging in progress...*\n\nWhen done, use /stop to end session.`
            : `⏳ *Waiting for photo verification...*`;
        return message;
    }
    async sendQueueManagementButtons(whatsappId, queueData) {
        const buttons = queueData.position === 1
            ? [
                { id: `start_charging_${queueData.stationId}`, title: '⚡ Start Charging' },
                { id: `queue_status_${queueData.stationId}`, title: '🔄 Refresh Status' },
                { id: `cancel_queue_${queueData.stationId}`, title: '❌ Cancel' }
            ]
            : [
                { id: `queue_status_${queueData.stationId}`, title: '🔄 Refresh Status' },
                { id: `get_directions_${queueData.stationId}`, title: '🗺️ Directions' },
                { id: `cancel_queue_${queueData.stationId}`, title: '❌ Cancel' }
            ];
        const headerText = queueData.position === 1
            ? '⚡ *Ready to Charge!*'
            : '📱 *Queue Management:*';
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, headerText, buttons);
    }
    async sendSessionControls(whatsappId, sessionData) {
        const buttons = sessionData.status === 'active'
            ? [
                { id: `session_status_${sessionData.stationId}`, title: '📊 Refresh Status' },
                { id: `session_stop_${sessionData.stationId}`, title: '🛑 Stop Session' }
            ]
            : [
                { id: `session_status_${sessionData.stationId}`, title: '📊 Check Status' }
            ];
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚡ *Session Controls:*', buttons, 'Simple controls for your session');
    }
    async sendFindStationButtons(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Find Charging Stations:*', [
            { id: 'share_gps_location', title: '📍 Share Location' },
            { id: 'new_search', title: '🆕 New Search' },
            { id: 'recent_searches', title: '🕒 Recent' }
        ]);
    }
    getQueueStatusEmoji(status) {
        const emojiMap = {
            'waiting': '⏳',
            'reserved': '✅',
            'ready': '🎯',
            'charging': '⚡',
            'completed': '✅',
            'cancelled': '❌'
        };
        return emojiMap[status] || '📍';
    }
    getStatusDescription(status) {
        const descriptions = {
            'waiting': 'In Queue',
            'reserved': 'Slot Reserved',
            'ready': 'Ready to Charge',
            'charging': 'Charging Active',
            'completed': 'Complete',
            'cancelled': 'Cancelled'
        };
        return descriptions[status] || 'Unknown';
    }
    generateProgressBar(position, maxLength) {
        const filled = Math.max(0, maxLength - position);
        const empty = Math.max(0, position - 1);
        return '🟢'.repeat(filled) + '⚪'.repeat(empty);
    }
    getQueueTip(queueData) {
        if (queueData.status === 'reserved') {
            return '✅ *Your slot is reserved!* Arrive within 15 minutes.';
        }
        else if (queueData.status === 'ready') {
            return '🚀 *Your slot is ready!* Please arrive within 15 minutes.';
        }
        else if (queueData.position === 1) {
            return '🎉 *You\'re next!* Get ready to charge soon.';
        }
        else if (queueData.position <= 3) {
            return '🔔 *Almost there!* Stay nearby for notifications.';
        }
        else {
            return '💡 *Perfect time* to grab coffee nearby!';
        }
    }
    async getQueueData(whatsappId, stationId) {
        const hasQueue = Math.random() > 0.5;
        if (!hasQueue)
            return null;
        return {
            id: Math.floor(Math.random() * 1000),
            userWhatsapp: whatsappId,
            position: Math.floor(Math.random() * 4) + 1,
            stationId,
            stationName: `Charging Station #${stationId}`,
            estimatedWaitMinutes: Math.floor(Math.random() * 30) + 10,
            status: 'waiting',
            isReserved: false,
            createdAt: new Date(Date.now() - Math.random() * 1800000)
        };
    }
    async getSessionData(whatsappId, stationId) {
        const hasSession = Math.random() > 0.7;
        if (!hasSession)
            return null;
        return {
            sessionId: `session_${Date.now()}`,
            stationId,
            stationName: `Charging Station #${stationId}`,
            startReading: 245.67,
            currentRate: 22.5,
            status: 'active'
        };
    }
    async handleUnknownAction(whatsappId, actionId) {
        logger_1.logger.warn('Unknown action', { whatsappId, actionId });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ *Unknown Action*\n\nThat action is not recognized. Please try again or type "help".');
        setTimeout(async () => {
            await this.sendFindStationButtons(whatsappId);
        }, 2000);
    }
    async handleError(error, operation, context) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error(`Queue webhook ${operation} failed`, { ...context, error: errorMessage });
        const whatsappId = context.whatsappId;
        if (whatsappId) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${operation} failed. Please try again.`).catch(sendError => logger_1.logger.error('Failed to send error message', { whatsappId, sendError }));
        }
    }
    getHealthStatus() {
        return {
            status: 'healthy',
            lastActivity: new Date().toISOString()
        };
    }
}
exports.QueueWebhookController = QueueWebhookController;
exports.queueWebhookController = new QueueWebhookController();
//# sourceMappingURL=queue-webhook.js.map