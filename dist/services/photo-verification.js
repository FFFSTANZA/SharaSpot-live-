"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.photoVerificationService = void 0;
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const whatsapp_1 = require("./whatsapp");
const session_1 = require("./session");
const ocr_processor_1 = __importDefault(require("../utils/ocr-processor"));
const ocr_config_1 = require("../config/ocr-config");
class PhotoVerificationService {
    constructor() {
        this.states = new Map();
        this.ocrMetrics = {
            totalAttempts: 0,
            successfulReads: 0,
            averageConfidence: 0,
            averageProcessingTime: 0,
            visionAPICallsToday: 0,
        };
    }
    cleanupState(userWhatsapp) {
        this.states.delete(userWhatsapp);
        logger_1.logger.debug('Photo verification state cleaned up', { userWhatsapp });
    }
    async initiateStartVerification(userWhatsapp, sessionId, stationId) {
        this.states.set(userWhatsapp, {
            sessionId,
            userWhatsapp,
            stationId,
            type: 'start',
            attemptCount: 0,
            timestamp: new Date(),
            ocrProvider: 'vision',
        });
        await database_1.db
            .update(schema_1.chargingSessions)
            .set({
            verificationStatus: 'awaiting_start_photo',
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId));
        await this.sendStartPhotoRequest(userWhatsapp, 0);
        logger_1.logger.info('✅ START photo requested (Vision API)', { userWhatsapp, sessionId });
    }
    async handleStartPhoto(userWhatsapp, imageBuffer) {
        const state = this.states.get(userWhatsapp);
        if (!state || state.type !== 'start') {
            return { success: false, message: '❌ Not expecting a start photo right now.' };
        }
        state.attemptCount++;
        this.states.set(userWhatsapp, state);
        this.ocrMetrics.totalAttempts++;
        this.ocrMetrics.visionAPICallsToday++;
        logger_1.logger.info('📸 Processing START photo with Vision API', {
            userWhatsapp,
            attempt: state.attemptCount,
            sessionId: state.sessionId,
            bufferSize: imageBuffer.length,
            apiCallsToday: this.ocrMetrics.visionAPICallsToday,
        });
        if (this.ocrMetrics.visionAPICallsToday > ocr_config_1.OCR_CONFIG.PRICING.freeMonthlyQuota * 0.9) {
            logger_1.logger.warn('⚠️ Approaching Vision API quota limit', {
                callsToday: this.ocrMetrics.visionAPICallsToday,
                quota: ocr_config_1.OCR_CONFIG.PRICING.freeMonthlyQuota,
            });
        }
        const startTime = Date.now();
        const ocrResult = await ocr_processor_1.default.extractKwhReading(imageBuffer);
        const processingTime = Date.now() - startTime;
        this.ocrMetrics.averageProcessingTime =
            (this.ocrMetrics.averageProcessingTime + processingTime) / 2;
        logger_1.logger.info('📊 Vision API processing complete', {
            success: ocrResult.success,
            processingTime,
            confidence: ocrResult.confidence,
            reading: ocrResult.reading,
        });
        if (!ocrResult.success || !ocrResult.reading) {
            return await this.handleOCRFailure(userWhatsapp, state, ocrResult.error, processingTime);
        }
        const confidence = ocrResult.confidence || 0;
        if (confidence < ocr_config_1.OCR_CONFIG.MIN_OCR_CONFIDENCE) {
            return await this.handleLowConfidence(userWhatsapp, state, confidence, processingTime);
        }
        this.ocrMetrics.successfulReads++;
        this.ocrMetrics.averageConfidence =
            (this.ocrMetrics.averageConfidence + confidence) / 2;
        state.lastReading = ocrResult.reading;
        state.lastConfidence = confidence;
        this.states.set(userWhatsapp, state);
        await this.sendReadingConfirmation(userWhatsapp, ocrResult.reading, 'start', confidence, processingTime);
        return {
            success: true,
            reading: ocrResult.reading,
            confidence,
            message: 'Reading detected. Awaiting confirmation.',
            processingTime,
        };
    }
    async confirmStartReading(userWhatsapp) {
        const state = this.states.get(userWhatsapp);
        if (!state || state.type !== 'start' || !state.lastReading) {
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, '❌ No reading to confirm. Please take a photo first.');
            return false;
        }
        try {
            const session = await this.getSession(state.sessionId);
            if (!session) {
                logger_1.logger.error('Session not found during START confirmation', {
                    sessionId: state.sessionId,
                    userWhatsapp
                });
                await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, '❌ *Session Not Found*\n\nYour charging session has expired or was cancelled.\n\nPlease start a new charging session.');
                this.states.delete(userWhatsapp);
                return false;
            }
            await database_1.db
                .update(schema_1.chargingSessions)
                .set({
                startMeterReading: state.lastReading.toString(),
                startReadingConfidence: state.lastConfidence?.toString(),
                startVerificationAttempts: state.attemptCount,
                verificationStatus: 'start_verified',
                meterValidated: true,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, state.sessionId));
            logger_1.logger.info('✅ START reading confirmed (Vision API)', {
                userWhatsapp,
                reading: state.lastReading,
                confidence: state.lastConfidence,
                sessionId: state.sessionId,
                attempts: state.attemptCount,
            });
            await session_1.sessionService.startChargingAfterVerification(state.sessionId, state.lastReading);
            const confidenceBadge = ocr_processor_1.default.isGoodConfidence(state.lastConfidence || 0)
                ? '🎯 High accuracy detection'
                : '📊 Reading verified';
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, `⚡ *Charging Started!*\n\n` +
                `📊 *Initial Reading:* ${ocr_processor_1.default.formatReading(state.lastReading)}\n` +
                `${confidenceBadge} (${state.lastConfidence?.toFixed(0)}%)\n` +
                `💰 *Rate:* ₹${session.ratePerKwh}/kWh\n` +
                `🔋 *Target:* 80%\n\n` +
                `When done charging, use:\n🛑 /stop - To end session`);
            this.states.delete(userWhatsapp);
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to confirm START reading', {
                userWhatsapp,
                sessionId: state.sessionId,
                error
            });
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, '❌ *Error Starting Charging*\n\nSomething went wrong. Please try again or contact support.');
            return false;
        }
    }
    async retakeStartPhoto(userWhatsapp) {
        const state = this.states.get(userWhatsapp);
        if (!state) {
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
            return;
        }
        if (state.attemptCount >= ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
            await this.fallbackToManualEntry(userWhatsapp, state);
            return;
        }
        await this.sendStartPhotoRequest(userWhatsapp, state.attemptCount);
    }
    async initiateEndVerification(userWhatsapp, sessionId, stationId) {
        const session = await this.getSession(sessionId);
        if (!session?.startMeterReading) {
            throw new Error('No start reading found for session');
        }
        this.states.set(userWhatsapp, {
            sessionId,
            userWhatsapp,
            stationId,
            type: 'end',
            attemptCount: 0,
            timestamp: new Date(),
            ocrProvider: 'vision',
        });
        await database_1.db
            .update(schema_1.chargingSessions)
            .set({
            verificationStatus: 'awaiting_end_photo',
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId));
        await this.sendEndPhotoRequest(userWhatsapp, 0);
        logger_1.logger.info('✅ END photo requested (Vision API)', { userWhatsapp, sessionId });
    }
    async handleEndPhoto(userWhatsapp, imageBuffer) {
        const state = this.states.get(userWhatsapp);
        if (!state || state.type !== 'end') {
            return { success: false, message: '❌ Not expecting an end photo right now.' };
        }
        state.attemptCount++;
        this.states.set(userWhatsapp, state);
        this.ocrMetrics.totalAttempts++;
        this.ocrMetrics.visionAPICallsToday++;
        logger_1.logger.info('📸 Processing END photo with Vision API', {
            userWhatsapp,
            attempt: state.attemptCount,
            sessionId: state.sessionId,
            bufferSize: imageBuffer.length,
        });
        const startTime = Date.now();
        const ocrResult = await ocr_processor_1.default.extractKwhReading(imageBuffer);
        const processingTime = Date.now() - startTime;
        logger_1.logger.info('📊 Vision API END processing complete', {
            success: ocrResult.success,
            processingTime,
            confidence: ocrResult.confidence,
            reading: ocrResult.reading,
        });
        if (!ocrResult.success || !ocrResult.reading) {
            return await this.handleOCRFailure(userWhatsapp, state, ocrResult.error, processingTime);
        }
        const confidence = ocrResult.confidence || 0;
        if (confidence < ocr_config_1.OCR_CONFIG.MIN_OCR_CONFIDENCE) {
            return await this.handleLowConfidence(userWhatsapp, state, confidence, processingTime);
        }
        const validation = await this.validateConsumption(state.sessionId, ocrResult.reading);
        if (!validation.isValid) {
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, `⚠️ *Validation Issue*\n\n${validation.error}\n\nPlease retake the photo.`);
            return {
                success: false,
                message: validation.error || 'Validation failed',
                shouldRetry: true,
                processingTime,
            };
        }
        this.ocrMetrics.successfulReads++;
        this.ocrMetrics.averageConfidence =
            (this.ocrMetrics.averageConfidence + confidence) / 2;
        state.lastReading = ocrResult.reading;
        state.lastConfidence = confidence;
        this.states.set(userWhatsapp, state);
        await this.sendEndReadingConfirmation(userWhatsapp, ocrResult.reading, validation.consumption, confidence, validation.warnings, processingTime);
        return {
            success: true,
            reading: ocrResult.reading,
            confidence,
            message: 'End reading detected. Awaiting confirmation.',
            processingTime,
        };
    }
    async confirmEndReading(userWhatsapp) {
        const state = this.states.get(userWhatsapp);
        if (!state || state.type !== 'end' || !state.lastReading) {
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, '❌ No reading to confirm. Please take a photo first.');
            return false;
        }
        const session = await this.getSession(state.sessionId);
        if (!session?.startMeterReading) {
            logger_1.logger.error('Start reading not found during END confirmation', { sessionId: state.sessionId });
            return false;
        }
        const startReading = parseFloat(session.startMeterReading);
        const consumption = state.lastReading - startReading;
        await database_1.db
            .update(schema_1.chargingSessions)
            .set({
            endMeterReading: state.lastReading.toString(),
            endReadingConfidence: state.lastConfidence?.toString(),
            endVerificationAttempts: state.attemptCount,
            energyDelivered: consumption.toString(),
            verificationStatus: 'completed',
            meterValidated: true,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, state.sessionId));
        logger_1.logger.info('✅ END reading confirmed (Vision API)', {
            userWhatsapp,
            reading: state.lastReading,
            consumption,
            sessionId: state.sessionId,
            confidence: state.lastConfidence,
        });
        await session_1.sessionService.completeSessionAfterVerification(state.sessionId, state.lastReading, consumption);
        this.states.delete(userWhatsapp);
        return true;
    }
    async retakeEndPhoto(userWhatsapp) {
        const state = this.states.get(userWhatsapp);
        if (!state) {
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
            return;
        }
        if (state.attemptCount >= ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
            await this.fallbackToManualEntry(userWhatsapp, state);
            return;
        }
        await this.sendEndPhotoRequest(userWhatsapp, state.attemptCount);
    }
    async handleManualEntry(userWhatsapp, input) {
        const state = this.states.get(userWhatsapp);
        if (!state)
            return false;
        const reading = parseFloat(input.trim());
        const validation = ocr_processor_1.default.validateReading(reading);
        if (!validation.valid) {
            await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, `❌ *Invalid Reading*\n\n${validation.error}\n\nPlease enter a valid kWh reading.`);
            return false;
        }
        if (state.type === 'end') {
            const consumptionValidation = await this.validateConsumption(state.sessionId, reading);
            if (!consumptionValidation.isValid) {
                await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, `❌ *Validation Failed*\n\n${consumptionValidation.error}\n\nPlease check and re-enter.`);
                return false;
            }
        }
        state.lastReading = reading;
        state.lastConfidence = 0;
        state.ocrProvider = 'manual';
        this.states.set(userWhatsapp, state);
        await this.sendReadingConfirmation(userWhatsapp, reading, state.type, 0);
        logger_1.logger.info('Manual entry accepted', {
            userWhatsapp,
            reading,
            type: state.type,
            sessionId: state.sessionId,
        });
        return true;
    }
    async validateConsumption(sessionId, endReading) {
        const session = await this.getSession(sessionId);
        if (!session?.startMeterReading) {
            return { isValid: false, error: 'Start reading not found' };
        }
        const startReading = parseFloat(session.startMeterReading);
        const result = ocr_processor_1.default.calculateConsumption(startReading, endReading);
        if (!result.valid) {
            return { isValid: false, error: result.error };
        }
        const sessionStartTime = session.startTime || session.startedAt || session.createdAt;
        const durationMinutes = sessionStartTime
            ? Math.floor((Date.now() - sessionStartTime.getTime()) / (1000 * 60))
            : 0;
        if (durationMinutes < 1) {
            logger_1.logger.warn('Charging duration too short for validation', {
                sessionId,
                durationMinutes
            });
            return {
                isValid: true,
                consumption: result.consumption,
                warnings: ['Duration too short for validation - using reading only']
            };
        }
        const chargerPowerKw = session.maxPowerUsed || 50;
        const contextValidation = ocr_processor_1.default.validateConsumptionWithContext(result.consumption, durationMinutes, chargerPowerKw);
        return {
            isValid: contextValidation.valid,
            consumption: result.consumption,
            warnings: contextValidation.warnings,
            error: contextValidation.error,
        };
    }
    async sendStartPhotoRequest(userWhatsapp, attemptCount) {
        const message = attemptCount === 0
            ? `📸 *Please take a photo of your charging dashboard*\n\n` +
                `🎯 *Tips for best results:*\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}\n\n` +
                `📊 We need the *current kWh reading* to start your session.\n`
            : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts})\n\n` +
                `💡 *Please ensure:*\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.steady}`;
        await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
    }
    async sendEndPhotoRequest(userWhatsapp, attemptCount) {
        const message = attemptCount === 0
            ? `📸 *Please take a photo of your FINAL charging reading*\n\n` +
                `*Capture the final kWh display:*\n` +
                `• Same dashboard as start photo\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n\n` +
                `📊 This will calculate your actual consumption.\n`
            : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts})\n\n` +
                `*Please ensure:*\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
                `• ${ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}`;
        await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
    }
    async sendReadingConfirmation(userWhatsapp, reading, type, confidence, processingTime) {
        const formatted = ocr_processor_1.default.formatReading(reading);
        let confidenceIndicator = '';
        if (confidence > 0) {
            if (ocr_processor_1.default.isGoodConfidence(confidence)) {
                confidenceIndicator = `\n*High confidence* (${confidence.toFixed(0)}%)`;
            }
            else if (ocr_processor_1.default.shouldWarnLowConfidence(confidence)) {
                confidenceIndicator = `\n⚠️ *Low confidence* (${confidence.toFixed(0)}%) - Please verify carefully`;
            }
            else {
                confidenceIndicator = `\n📊 *Confidence:* ${confidence.toFixed(0)}%`;
            }
        }
        else {
            confidenceIndicator = '\n📝 *Manual entry*';
        }
        const processingInfo = processingTime
            ? `\n⚡ Processed in ${(processingTime / 1000).toFixed(1)}s`
            : '';
        const message = `*Reading Detected!*\n\n` +
            `📊 *${type === 'start' ? 'Start' : 'Final'} Reading:* ${formatted}` +
            `${confidenceIndicator}${processingInfo}\n\n` +
            `❓ *Is this correct?*`;
        await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, message, [
            { id: `confirm_${type}_reading`, title: '✓ Yes, Correct' },
            { id: `retake_${type}_photo`, title: '✗ Retake Photo' },
        ], '📊 Confirm Reading');
    }
    async sendEndReadingConfirmation(userWhatsapp, endReading, consumption, confidence, warnings, processingTime) {
        let confidenceIndicator = '';
        if (ocr_processor_1.default.isGoodConfidence(confidence)) {
            confidenceIndicator = `🎯 *High confidence* (${confidence.toFixed(0)}%)\n`;
        }
        else if (ocr_processor_1.default.shouldWarnLowConfidence(confidence)) {
            confidenceIndicator = `⚠️ *Low confidence* (${confidence.toFixed(0)}%) - Please verify\n`;
        }
        else {
            confidenceIndicator = `📊 *Confidence:* ${confidence.toFixed(0)}%\n`;
        }
        const processingInfo = processingTime
            ? `⚡ Processed in ${(processingTime / 1000).toFixed(1)}s\n`
            : '';
        let message = `✅ *Final Reading Detected!*\n\n` +
            `${confidenceIndicator}${processingInfo}` +
            `📊 *Reading:* ${ocr_processor_1.default.formatReading(endReading)}\n` +
            `⚡ *Consumption:* ${consumption.toFixed(2)} kWh\n\n`;
        if (warnings?.length) {
            message += `⚠️ *Notices:*\n${warnings.map(w => `• ${w}`).join('\n')}\n\n`;
        }
        message += `❓ *Confirm to complete your session?*`;
        await whatsapp_1.whatsappService.sendButtonMessage(userWhatsapp, message, [
            { id: 'confirm_end_reading', title: '✓ Confirm & Complete' },
            { id: 'retake_end_photo', title: '✗ Retake Photo' },
        ], '📊 Final Confirmation');
    }
    async handleOCRFailure(userWhatsapp, state, error, processingTime) {
        if (state.attemptCount >= ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
            await this.fallbackToManualEntry(userWhatsapp, state);
            return {
                success: false,
                message: 'Max attempts reached. Manual entry required.',
                processingTime,
            };
        }
        const suggestions = ocr_processor_1.default.getRetrySuggestions();
        let errorMessage = error || 'Could not read the display';
        if (error?.includes('PERMISSION_DENIED')) {
            errorMessage = 'Authentication error. Please contact support.';
            logger_1.logger.error('Vision API authentication failed', { userWhatsapp, sessionId: state.sessionId });
        }
        else if (error?.includes('QUOTA_EXCEEDED')) {
            errorMessage = 'Service temporarily unavailable. Please try again shortly.';
            logger_1.logger.error('Vision API quota exceeded', {
                callsToday: this.ocrMetrics.visionAPICallsToday
            });
        }
        const message = `❌ *Couldn't read the display*\n\n${errorMessage}\n\n` +
            `💡 *Tips:*\n${suggestions.join('\n')}\n\n` +
            `📸 *Attempt ${state.attemptCount} of ${ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts}*`;
        await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        return {
            success: false,
            message: errorMessage,
            shouldRetry: true,
            processingTime,
        };
    }
    async handleLowConfidence(userWhatsapp, state, confidence, processingTime) {
        if (state.attemptCount >= ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
            await this.fallbackToManualEntry(userWhatsapp, state);
            return {
                success: false,
                message: 'Max attempts reached. Manual entry required.',
                processingTime,
            };
        }
        const tips = ocr_config_1.OCR_CONFIG.MESSAGES.RETRY_TIPS;
        const message = `⚠️ *Low Reading Confidence*\n\n` +
            `We detected a reading but confidence is low (${confidence.toFixed(0)}%)\n\n` +
            `💡 *Please retake with:*\n` +
            `• ${tips.lighting}\n` +
            `• ${tips.focus}\n` +
            `• ${tips.steady}\n\n` +
            `*Attempt ${state.attemptCount} of ${ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts}*`;
        await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        return {
            success: false,
            message: `Low confidence: ${confidence.toFixed(0)}%`,
            shouldRetry: true,
            processingTime,
        };
    }
    async fallbackToManualEntry(userWhatsapp, state) {
        await database_1.db
            .update(schema_1.chargingSessions)
            .set({
            manualEntryUsed: true,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, state.sessionId));
        const message = `📝 *Manual Entry Required*\n\n` +
            `We couldn't read the display after ${ocr_config_1.OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts} attempts.\n\n` +
            `Please *type* the ${state.type === 'start' ? 'current' : 'final'} kWh reading from your dashboard.\n\n` +
            `📊 *Example:* 1245.8\n\n` +
            `💡 *Make sure to enter the exact reading shown.*`;
        await whatsapp_1.whatsappService.sendTextMessage(userWhatsapp, message);
        logger_1.logger.info('Fallback to manual entry (Vision API)', {
            userWhatsapp,
            type: state.type,
            sessionId: state.sessionId,
            attempts: state.attemptCount,
            apiCallsUsed: this.ocrMetrics.visionAPICallsToday,
        });
    }
    async getSession(sessionId) {
        const sessions = await database_1.db
            .select()
            .from(schema_1.chargingSessions)
            .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId))
            .limit(1);
        return sessions[0] || null;
    }
    isInVerificationFlow(userWhatsapp) {
        const state = this.states.get(userWhatsapp);
        if (!state)
            return false;
        if (Date.now() - state.timestamp.getTime() > ocr_config_1.OCR_CONFIG.STATE_EXPIRY_MS) {
            this.states.delete(userWhatsapp);
            return false;
        }
        return true;
    }
    getVerificationState(userWhatsapp) {
        return this.states.get(userWhatsapp) || null;
    }
    clearVerificationState(userWhatsapp) {
        this.states.delete(userWhatsapp);
    }
    cleanupExpiredStates() {
        const now = Date.now();
        for (const [whatsappId, state] of this.states.entries()) {
            if (now - state.timestamp.getTime() > ocr_config_1.OCR_CONFIG.STATE_EXPIRY_MS) {
                this.states.delete(whatsappId);
                logger_1.logger.info('Cleaned up expired verification state', { whatsappId });
            }
        }
    }
    getOCRMetrics() {
        return { ...this.ocrMetrics };
    }
    getSuccessRate() {
        if (this.ocrMetrics.totalAttempts === 0)
            return 0;
        return (this.ocrMetrics.successfulReads / this.ocrMetrics.totalAttempts) * 100;
    }
    resetDailyAPICounter() {
        this.ocrMetrics.visionAPICallsToday = 0;
        logger_1.logger.info('Vision API daily counter reset');
    }
    estimateMonthlyCost() {
        const dailyAverage = this.ocrMetrics.visionAPICallsToday;
        const monthlyEstimate = dailyAverage * 30;
        if (monthlyEstimate <= ocr_config_1.OCR_CONFIG.PRICING.freeMonthlyQuota) {
            return 0;
        }
        const billableRequests = monthlyEstimate - ocr_config_1.OCR_CONFIG.PRICING.freeMonthlyQuota;
        return billableRequests * ocr_config_1.OCR_CONFIG.PRICING.costPerRequest;
    }
    isApproachingQuota() {
        return this.ocrMetrics.visionAPICallsToday >
            (ocr_config_1.OCR_CONFIG.PRICING.freeMonthlyQuota * 0.8);
    }
    logPerformanceMetrics() {
        logger_1.logger.info('API Performance Metrics', {
            totalAttempts: this.ocrMetrics.totalAttempts,
            successfulReads: this.ocrMetrics.successfulReads,
            successRate: `${this.getSuccessRate().toFixed(1)}%`,
            averageConfidence: `${this.ocrMetrics.averageConfidence.toFixed(1)}%`,
            averageProcessingTime: `${this.ocrMetrics.averageProcessingTime.toFixed(0)}ms`,
            visionAPICallsToday: this.ocrMetrics.visionAPICallsToday,
            estimatedMonthlyCost: `${this.estimateMonthlyCost().toFixed(2)}`,
            approachingQuota: this.isApproachingQuota(),
        });
    }
    getDebugInfo(userWhatsapp) {
        const state = this.states.get(userWhatsapp);
        if (!state)
            return null;
        return {
            sessionId: state.sessionId,
            type: state.type,
            attemptCount: state.attemptCount,
            lastReading: state.lastReading,
            lastConfidence: state.lastConfidence,
            ocrProvider: state.ocrProvider,
            timeSinceStart: Date.now() - state.timestamp.getTime(),
            isExpired: Date.now() - state.timestamp.getTime() > ocr_config_1.OCR_CONFIG.STATE_EXPIRY_MS,
        };
    }
}
exports.photoVerificationService = new PhotoVerificationService();
setInterval(() => {
    exports.photoVerificationService.cleanupExpiredStates();
}, 10 * 60 * 1000);
const resetAtMidnight = () => {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msToMidnight = night.getTime() - now.getTime();
    setTimeout(() => {
        exports.photoVerificationService.resetDailyAPICounter();
        setInterval(() => {
            exports.photoVerificationService.resetDailyAPICounter();
        }, 24 * 60 * 60 * 1000);
    }, msToMidnight);
};
resetAtMidnight();
setInterval(() => {
    exports.photoVerificationService.logPerformanceMetrics();
}, 60 * 60 * 1000);
//# sourceMappingURL=photo-verification.js.map