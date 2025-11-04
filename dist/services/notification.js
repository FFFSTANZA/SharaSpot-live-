"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const whatsapp_1 = require("./whatsapp");
const logger_1 = require("../utils/logger");
const schema_1 = require("../db/schema");
const connection_1 = require("../db/connection");
const drizzle_orm_1 = require("drizzle-orm");
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
}
function toRad(degrees) {
    return degrees * (Math.PI / 180);
}
class NotificationService {
    constructor() {
        this.scheduledNotifications = new Map();
    }
    async sendQueueJoinedNotification(userWhatsapp, queuePosition) {
        try {
            const station = await this.getStationDetails(queuePosition.stationId);
            const message = this.formatQueueJoinedMessage(queuePosition, station);
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendListMessage(userWhatsapp, '⚡ *Queue Management Options*', 'Choose an action for your booking:', [
                    {
                        title: '📊 Queue Status',
                        rows: [
                            { id: `queue_status_${queuePosition.stationId}`, title: '📍 My Position', description: 'Check current queue status' },
                            { id: `queue_estimate_${queuePosition.stationId}`, title: '⏱️ Time Estimate', description: 'Get updated wait time' },
                            { id: `queue_analytics_${queuePosition.stationId}`, title: '📈 Queue Analytics', description: 'View station insights' }
                        ]
                    },
                    {
                        title: '🔧 Queue Actions',
                        rows: [
                            { id: `queue_remind_${queuePosition.stationId}`, title: '🔔 Reminder', description: 'Get notified 10 min before' },
                            { id: `queue_cancel_${queuePosition.stationId}`, title: '❌ Leave Queue', description: 'Cancel your booking' },
                            { id: `queue_share_${queuePosition.stationId}`, title: '📤 Share Status', description: 'Share with someone' }
                        ]
                    }
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send queue joined notification', { userWhatsapp, error });
        }
    }
    async sendReservationConfirmation(userWhatsapp, stationId, reservationMinutes) {
        try {
            const station = await this.getStationDetails(stationId);
            const expiryTime = new Date(Date.now() + reservationMinutes * 60 * 1000);
            const message = `🎉 *SLOT RESERVED!*\n\n` +
                `📍 *${station?.name || 'Charging Station'}*\n` +
                `📍 ${station?.address || 'Loading address...'}\n\n` +
                `⏰ *Reservation Expires:* ${expiryTime.toLocaleTimeString()}\n` +
                `⏳ *You have ${reservationMinutes} minutes* to arrive\n\n` +
                `🚗 *Next Steps:*\n` +
                `• Navigate to the station now\n` +
                `• Scan QR code or tap "Start Charging"\n` +
                `• Your charging slot is secured!\n\n` +
                `💡 *Pro Tip:* Enable location sharing for real-time navigation assistance`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            if (station?.latitude && station?.longitude) {
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendLocationMessage(userWhatsapp, station.latitude, station.longitude, `${station.name} - Your Reserved Slot`, station.address || '');
                }, 1000);
            }
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, `🚀 *Ready to charge?*\n\nArrive at the station and select an option:`, [
                    { id: `start_charging_${stationId}`, title: '⚡ Start Charging' },
                    { id: `extend_reservation_${stationId}`, title: '⏰ Extend Time' },
                    { id: `cancel_reservation_${stationId}`, title: '❌ Cancel' }
                ]);
            }, 1000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send reservation confirmation', { userWhatsapp, stationId, error });
        }
    }
    async sendChargingStartedNotification(userWhatsapp, session) {
        try {
            const station = await this.getStationDetails(session.stationId);
            const pricePerKwh = station?.pricePerKwh || session.pricePerKwh || '12.5';
            const startReading = session.startMeterReading || 0;
            const message = `⚡ *CHARGING ACTIVE*\n\n` +
                `📍 *${station?.name || 'Charging Station'}*\n` +
                `✅ Session started successfully\n\n` +
                `📊 *Initial Reading:* ${startReading} kWh\n` +
                `💰 *Rate:* ₹${pricePerKwh}/kWh\n` +
                `🔌 *Connector:* ${session.connectorType || 'Standard'}\n\n` +
                `🛑 *To stop:* Use /stop command or button below`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, '🎛️ *Session Control:*', [
                    { id: `session_status_${session.stationId}`, title: '📊 Check Status' },
                    { id: `session_stop_${session.stationId}`, title: '🛑 Stop Charging' }
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send charging started notification', { userWhatsapp, session, error });
        }
    }
    async sendChargingCompletedNotification(userWhatsapp, session, summary) {
        try {
            const stationName = session?.stationName || 'Charging Station';
            const duration = summary?.duration || 'N/A';
            const energyDelivered = summary?.energyDelivered || session?.energyDelivered || 0;
            const totalCost = summary?.totalCost || session?.totalCost || 0;
            const startReading = session?.startMeterReading || 0;
            const endReading = session?.endMeterReading || 0;
            const message = `✅ *CHARGING COMPLETE!*\n\n` +
                `📍 *${stationName}*\n` +
                `⏱️ *Duration:* ${duration}\n` +
                `⚡ *Energy Delivered:* ${energyDelivered} kWh\n` +
                `💰 *Total Cost:* ₹${totalCost}\n\n` +
                `📊 *Meter Readings:*\n` +
                `• Start: ${startReading} kWh\n` +
                `• End: ${endReading} kWh\n\n` +
                `🎯 *Thank you for using SharaSpot!*`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, '📊 *What\'s Next?*', [
                    { id: `rate_session_5_${session.stationId}`, title: '⭐ Rate 5 Stars' },
                    { id: 'find_nearby_stations', title: '🔍 Find Stations' },
                    { id: 'view_session_history', title: '📜 View History' }
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send charging completed notification', {
                userWhatsapp,
                session,
                summary,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    async sendQueueLeftNotification(userWhatsapp, stationId, reason) {
        try {
            const station = await this.getStationDetails(stationId);
            let message = '';
            switch (reason) {
                case 'user_cancelled':
                    message = `✅ *BOOKING CANCELLED*\n\n` +
                        `📍 *${station?.name || 'Charging Station'}*\n` +
                        `🕐 *Cancelled:* ${new Date().toLocaleTimeString()}\n\n` +
                        `Your queue position has been released.\n` +
                        `Other users have been automatically promoted.\n\n` +
                        `💡 *Need another station?* Let's find you alternatives!`;
                    break;
                case 'expired':
                    message = `⏰ *RESERVATION EXPIRED*\n\n` +
                        `📍 *${station?.name || 'Charging Station'}*\n` +
                        `🕐 *Expired:* ${new Date().toLocaleTimeString()}\n\n` +
                        `Your 15-minute reservation window has ended.\n` +
                        `The slot has been released to the next user.\n\n` +
                        `🔄 *Want to try again?* You can rejoin the queue!`;
                    break;
                default:
                    message = `📝 *QUEUE STATUS UPDATED*\n\n` +
                        `📍 *${station?.name || 'Charging Station'}*\n` +
                        `Your booking status has been updated.\n\n` +
                        `💡 *Looking for alternatives?* We can help!`;
            }
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, '🔍 *What would you like to do next?*', [
                    { id: `rejoin_queue_${stationId}`, title: '🔄 Rejoin Queue' },
                    { id: 'find_alternatives', title: '🗺️ Find Alternatives' },
                    { id: 'schedule_later', title: '⏰ Schedule Later' }
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send queue left notification', { userWhatsapp, stationId, reason, error });
        }
    }
    async sendQueueProgressNotification(userWhatsapp, stationId, position, waitTime) {
        try {
            const station = await this.getStationDetails(stationId);
            const expectedTime = new Date(Date.now() + waitTime * 60 * 1000).toLocaleTimeString();
            let emoji = '📈';
            let message = '';
            if (position === 1) {
                emoji = '🎯';
                message = `${emoji} *YOU'RE NEXT!*\n\n` +
                    `📍 *${station?.name || 'Charging Station'}*\n` +
                    `🏆 *Position:* #${position} (FIRST!)\n` +
                    `⏱️ *Expected:* ${expectedTime}\n\n` +
                    `🚀 *Get ready!* Your slot will be reserved automatically.\n` +
                    `Start heading to the station now!`;
            }
            else if (position === 2) {
                emoji = '🔥';
                message = `${emoji} *ALMOST THERE!*\n\n` +
                    `📍 *${station?.name || 'Charging Station'}*\n` +
                    `🎯 *Position:* #${position}\n` +
                    `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
                    `🕐 *Expected:* ${expectedTime}\n\n` +
                    `🎉 *You're next in line!* Stay nearby for quick notifications.`;
            }
            else {
                message = `${emoji} *QUEUE PROGRESS UPDATE*\n\n` +
                    `📍 *${station?.name || 'Charging Station'}*\n` +
                    `📍 *Your Position:* #${position}\n` +
                    `⏱️ *Updated Wait:* ${waitTime} minutes\n` +
                    `🕐 *Expected:* ${expectedTime}\n\n` +
                    `🚶‍♂️ *Queue is moving!* ${this.getProgressTip(position, waitTime)}`;
            }
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            if (position <= 3) {
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, position === 1 ? '🎯 *Your turn is coming!*' : '📊 *Manage your booking:*', [
                        { id: `live_status_${stationId}`, title: '📡 Live Status' },
                        { id: `share_position_${stationId}`, title: '📤 Share Position' },
                        { id: `cancel_booking_${stationId}`, title: '❌ Cancel' }
                    ]);
                }, 1500);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to send queue progress notification', { userWhatsapp, stationId, position, waitTime, error });
        }
    }
    async scheduleReservationExpiry(userWhatsapp, stationId, expiryTime) {
        try {
            const notificationKey = `expiry_${userWhatsapp}_${stationId}`;
            const existing = this.scheduledNotifications.get(notificationKey);
            if (existing)
                clearTimeout(existing);
            const warningTime = new Date(expiryTime.getTime() - 5 * 60 * 1000);
            const warningDelay = warningTime.getTime() - Date.now();
            if (warningDelay > 0) {
                const warningTimeout = setTimeout(async () => {
                    await this.sendReservationWarning(userWhatsapp, stationId, 5);
                }, warningDelay);
                this.scheduledNotifications.set(`warning_${notificationKey}`, warningTimeout);
            }
            const expiryDelay = expiryTime.getTime() - Date.now();
            if (expiryDelay > 0) {
                const expiryTimeout = setTimeout(async () => {
                    await this.sendReservationExpired(userWhatsapp, stationId);
                    this.scheduledNotifications.delete(notificationKey);
                }, expiryDelay);
                this.scheduledNotifications.set(notificationKey, expiryTimeout);
            }
            logger_1.logger.info('Reservation expiry notifications scheduled', { userWhatsapp, stationId, expiryTime });
        }
        catch (error) {
            logger_1.logger.error('Failed to schedule reservation expiry', { userWhatsapp, stationId, expiryTime, error });
        }
    }
    async sendReservationWarning(userWhatsapp, stationId, minutesLeft) {
        try {
            const station = await this.getStationDetails(stationId);
            const message = `⚠️ *RESERVATION EXPIRING SOON!*\n\n` +
                `📍 *${station?.name || 'Charging Station'}*\n` +
                `⏰ *${minutesLeft} minutes left* to arrive\n\n` +
                `🚗 *Please hurry!* Your reserved slot will be released if you don't arrive in time.\n\n` +
                `📍 *Need directions?* Tap below for navigation.`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, '⚡ *Quick Actions:*', [
                    { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
                    { id: `extend_time_${stationId}`, title: '⏰ Extend Time' },
                    { id: `cancel_urgent_${stationId}`, title: '❌ Cancel Now' }
                ]);
            }, 1000);
            if (station?.latitude && station?.longitude) {
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendLocationMessage(userWhatsapp, station.latitude, station.longitude, `🚨 ${station.name} - HURRY! ${minutesLeft} min left`, 'Your reserved charging slot');
                }, 2000);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to send reservation warning', { userWhatsapp, stationId, minutesLeft, error });
        }
    }
    async sendReservationExpired(userWhatsapp, stationId) {
        try {
            const station = await this.getStationDetails(stationId);
            const message = `💔 *RESERVATION EXPIRED*\n\n` +
                `📍 *${station?.name || 'Charging Station'}*\n` +
                `🕐 *Expired:* ${new Date().toLocaleTimeString()}\n\n` +
                `⏰ *Time's up!* Your 15-minute reservation window has ended.\n` +
                `The charging slot has been automatically released.\n\n` +
                `🔄 *Don't worry!* You can rejoin the queue or find alternatives.`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, '🔄 *What would you like to do?*', [
                    { id: `rejoin_queue_${stationId}`, title: '🔄 Rejoin Queue' },
                    { id: 'find_nearby_alternatives', title: '🗺️ Find Nearby' },
                    { id: 'schedule_for_later', title: '⏰ Schedule Later' }
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send reservation expired notification', { userWhatsapp, stationId, error });
        }
    }
    async notifyStationOwner(stationId, eventType, data) {
        try {
            const station = await this.getStationDetails(stationId);
            const ownerWhatsapp = station?.ownerWhatsappId;
            if (!ownerWhatsapp) {
                logger_1.logger.warn('No owner WhatsApp ID found for station', { stationId });
                return;
            }
            let message = '';
            switch (eventType) {
                case 'queue_joined':
                    message = `📈 *New Customer*\n\n` +
                        `🏢 *${station.name}*\n` +
                        `👤 Customer joined queue\n` +
                        `📍 Position: #${data.position}\n` +
                        `🕐 ${new Date().toLocaleTimeString()}`;
                    break;
                case 'queue_left':
                    message = `📉 *Customer Left*\n\n` +
                        `🏢 *${station.name}*\n` +
                        `👤 Customer left queue\n` +
                        `📍 Was position: #${data.position}\n` +
                        `📝 Reason: ${data.reason}`;
                    break;
                case 'slot_reserved':
                    message = `🎯 *Slot Reserved*\n\n` +
                        `🏢 *${station.name}*\n` +
                        `👤 Customer reserved slot\n` +
                        `⏰ Expires: ${data.expiryTime.toLocaleTimeString()}`;
                    break;
                case 'charging_started':
                    message = `⚡ *Charging Started*\n\n` +
                        `🏢 *${station.name}*\n` +
                        `👤 Customer started charging\n` +
                        `🕐 ${new Date().toLocaleTimeString()}`;
                    break;
                case 'charging_completed':
                    message = `✅ *Session Complete*\n\n` +
                        `🏢 *${station.name}*\n` +
                        `👤 Customer completed charging\n` +
                        `🕐 ${new Date().toLocaleTimeString()}`;
                    break;
            }
            if (message) {
                await whatsapp_1.whatsappService.sendTextMessage(ownerWhatsapp, message);
                logger_1.logger.info('Station owner notified', { stationId, ownerWhatsapp, eventType });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to notify station owner', { stationId, eventType, data, error });
        }
    }
    async sendSessionStartNotification(userWhatsapp, session) {
        await this.sendChargingStartedNotification(userWhatsapp, session);
    }
    async sendSessionPausedNotification(userWhatsapp, session) {
        try {
            const message = `⏸️ *CHARGING PAUSED*\n\n` +
                `📍 *${session.stationName}*\n` +
                `🕐 *Paused:* ${new Date().toLocaleTimeString()}\n\n` +
                `⏰ *Your slot is reserved for 10 minutes*\n` +
                `🔄 *Charging will auto-resume if not manually stopped*\n\n` +
                `💡 *Resume anytime from your session controls*`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send session paused notification', { userWhatsapp, session, error });
        }
    }
    async sendSessionResumedNotification(userWhatsapp, session) {
        try {
            const message = `▶️ *CHARGING RESUMED*\n\n` +
                `📍 *${session.stationName}*\n` +
                `🕐 *Resumed:* ${new Date().toLocaleTimeString()}\n\n` +
                `⚡ *Charging is now active again*\n` +
                `🛑 *To stop:* Use /stop or button`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send session resumed notification', { userWhatsapp, session, error });
        }
    }
    async sendSessionProgressNotification(userWhatsapp, session, progress) {
        try {
            const message = `📊 *CHARGING PROGRESS*\n\n` +
                `📍 *${session.stationName}*\n` +
                `🔋 *Battery:* ${progress.currentBatteryLevel}%\n` +
                `⚡ *Power:* ${progress.chargingRate} kW\n` +
                `💰 *Cost so far:* ₹${progress.currentCost}\n` +
                `⏱️ *Est. completion:* ${progress.estimatedCompletion}\n\n` +
                `${progress.statusMessage}`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send session progress notification', { userWhatsapp, session, progress, error });
        }
    }
    async sendSessionCompletedNotification(userWhatsapp, session, summary) {
        await this.sendChargingCompletedNotification(userWhatsapp, session, summary);
    }
    async sendSessionExtendedNotification(userWhatsapp, session, newTarget) {
        try {
            const message = `⏰ *SESSION EXTENDED*\n\n` +
                `📍 *${session.stationName}*\n` +
                `🎯 *New Target:* ${newTarget}%\n` +
                `🔋 *Current:* ${session.currentBatteryLevel}%\n\n` +
                `⚡ *Charging will continue to your new target*\n` +
                `📊 *Updated estimates will be sent*`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send session extended notification', { userWhatsapp, session, newTarget, error });
        }
    }
    async sendAnomalyAlert(userWhatsapp, session, status) {
        try {
            const message = `⚠️ *CHARGING ANOMALY DETECTED*\n\n` +
                `📍 *${session.stationName}*\n` +
                `📊 *Issue:* Lower than expected charging rate\n` +
                `⚡ *Current Rate:* ${status.chargingRate} kW\n` +
                `📈 *Expected:* ${session.chargingRate} kW\n\n` +
                `🔧 *Station team has been notified*\n` +
                `📞 *Contact support if issues persist*`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send anomaly alert', { userWhatsapp, session, status, error });
        }
    }
    async sendAvailabilityAlert(userWhatsapp, stationId, analytics) {
        try {
            const station = await this.getStationDetails(stationId);
            const message = `🚨 *STATION AVAILABLE!*\n\n` +
                `📍 *${station?.name}*\n` +
                `🟢 *Queue Length:* ${analytics.currentQueueLength} people\n` +
                `⏱️ *Wait Time:* ${analytics.estimatedWaitTime} minutes\n\n` +
                `⚡ *Perfect time to charge!*\n` +
                `🚀 *Book now for quick access*`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, '🎯 *Quick Actions:*', [
                    { id: `quick_book_${stationId}`, title: '⚡ Book Now' },
                    { id: `get_directions_${stationId}`, title: '🗺️ Directions' },
                    { id: `dismiss_alert_${stationId}`, title: '❌ Dismiss' }
                ]);
            }, 1000);
        }
        catch (error) {
            logger_1.logger.error('Failed to send availability alert', { userWhatsapp, stationId, analytics, error });
        }
    }
    async sendPromotionNotification(userWhatsapp, stationId, newPosition) {
        try {
            const station = await this.getStationDetails(stationId);
            const message = `📈 *QUEUE POSITION UPDATED!*\n\n` +
                `📍 *${station?.name}*\n` +
                `🎯 *New Position:* #${newPosition}\n` +
                `⏱️ *You moved up in the queue!*\n\n` +
                (newPosition === 1
                    ? '🎉 *You\'re next!* Get ready for your slot.'
                    : newPosition === 2
                        ? '🔥 *Almost there!* You\'re second in line.'
                        : '📊 *Progress!* You\'re getting closer.');
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send promotion notification', { userWhatsapp, stationId, newPosition, error });
        }
    }
    async sendSessionReminder(userWhatsapp, stationId, status) {
        try {
            const message = `🔔 *CHARGING REMINDER*\n\n` +
                `🔋 *Your battery is now ${status.currentBatteryLevel}%*\n` +
                `⏱️ *Est. completion:* ${status.estimatedCompletion}\n\n` +
                `💡 *Your EV is almost ready!*\n` +
                `🚗 *Plan your departure accordingly*`;
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send session reminder', { userWhatsapp, stationId, status, error });
        }
    }
    async getStationDetails(stationId, userLat, userLng) {
        try {
            const station = await connection_1.db
                .select({
                id: schema_1.chargingStations.id,
                name: schema_1.chargingStations.name,
                address: schema_1.chargingStations.address,
                latitude: schema_1.chargingStations.latitude,
                longitude: schema_1.chargingStations.longitude,
                totalSlots: schema_1.chargingStations.totalSlots,
                availableSlots: schema_1.chargingStations.availableSlots,
                totalPorts: schema_1.chargingStations.totalPorts,
                availablePorts: schema_1.chargingStations.availablePorts,
                pricePerKwh: schema_1.chargingStations.pricePerKwh,
                connectorTypes: schema_1.chargingStations.connectorTypes,
                amenities: schema_1.chargingStations.amenities,
                operatingHours: schema_1.chargingStations.operatingHours,
                rating: schema_1.chargingStations.rating,
                averageRating: schema_1.chargingStations.averageRating,
                totalReviews: schema_1.chargingStations.totalReviews,
                reviewCount: schema_1.chargingStations.reviewCount,
                isActive: schema_1.chargingStations.isActive,
                updatedAt: schema_1.chargingStations.updatedAt,
                ownerWhatsappId: schema_1.chargingStations.ownerWhatsappId,
            })
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            if (station.length === 0) {
                logger_1.logger.warn('Station not found', { stationId });
                return null;
            }
            const data = station[0];
            let distance = null;
            if (userLat != null && userLng != null && data.latitude && data.longitude) {
                distance = calculateDistance(userLat, userLng, Number(data.latitude), Number(data.longitude));
            }
            const total = data.totalSlots || data.totalPorts || 1;
            const available = data.availableSlots || data.availablePorts || 0;
            const utilization = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
            return {
                ...data,
                distance,
                utilization,
                availability: available > 0 ? 'Available' : total > 0 ? 'Queue Available' : 'Unavailable',
                isAvailable: available > 0,
                isBusy: utilization > 80,
                priceDisplay: `₹${data.pricePerKwh || 0}/kWh`,
                distanceDisplay: distance !== null ? `${distance} km` : 'Unknown',
                ratingDisplay: data.rating || data.averageRating
                    ? `${Number(data.rating || data.averageRating).toFixed(1)} ⭐`
                    : 'No ratings',
                slotsDisplay: `${available}/${total} available`,
                finalRating: data.rating || data.averageRating || 0,
                finalReviews: data.totalReviews || data.reviewCount || 0,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get station details', { stationId, error });
            return null;
        }
    }
    formatQueueJoinedMessage(queuePosition, station) {
        const waitTime = queuePosition.estimatedWaitMinutes;
        const expectedTime = new Date(Date.now() + waitTime * 60 * 1000).toLocaleTimeString();
        return `🎉 *BOOKING CONFIRMED!*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `🎯 *Your Position:* #${queuePosition.position}\n` +
            `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
            `🕐 *Expected Time:* ${expectedTime}\n\n` +
            `✨ *What happens next:*\n` +
            `• Live position updates every 5 minutes\n` +
            `• Auto-reservation when you're #1\n` +
            `• Navigation assistance when ready\n` +
            `• Smart notifications throughout\n\n` +
            `🎮 *Manage your booking with options below* ⬇️`;
    }
    async generateSessionSummary(userWhatsapp, stationId) {
        return {
            energyDelivered: 25.5,
            duration: 45,
            totalCost: 306,
            batteryLevel: 85,
        };
    }
    getProgressTip(position, waitTime) {
        if (position <= 3)
            return 'Stay nearby for quick notifications!';
        if (waitTime < 30)
            return 'Great time to grab a coffee nearby!';
        if (waitTime < 60)
            return 'Perfect for a quick meal or errands!';
        return 'Consider exploring nearby attractions!';
    }
    clearUserNotifications(userWhatsapp) {
        for (const [key, timeout] of this.scheduledNotifications.entries()) {
            if (key.includes(userWhatsapp)) {
                clearTimeout(timeout);
                this.scheduledNotifications.delete(key);
            }
        }
        logger_1.logger.info('Cleared scheduled notifications for user', { userWhatsapp });
    }
    getNotificationStats() {
        return {
            scheduledNotifications: this.scheduledNotifications.size,
            activeKeys: Array.from(this.scheduledNotifications.keys()),
        };
    }
}
exports.notificationService = new NotificationService();
//# sourceMappingURL=notification.js.map