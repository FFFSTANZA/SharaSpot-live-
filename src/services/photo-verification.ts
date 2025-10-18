// src/services/photo-verification.ts - GOOGLE VISION API VERSION
import { db } from '../config/database';
import { chargingSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { whatsappService } from './whatsapp';
import { sessionService } from './session';
import ocrProcessor from '../utils/ocr-processor';
import { OCR_CONFIG } from '../config/ocr-config';

/**
 * Photo Verification Service - Google Vision API Enhanced
 * Handles START and END photo verification with superior OCR accuracy
 * NO IMAGE STORAGE - Only extracts and validates kWh readings
 * BLOCKS session activation until START photo confirmed
 */


interface VerificationState {
  sessionId: string;
  userWhatsapp: string;
  stationId: number;
  type: 'start' | 'end';
  attemptCount: number;
  lastReading?: number;
  lastConfidence?: number;
  timestamp: Date;
  ocrProvider: 'vision' | 'manual';
}

interface PhotoResult {
  success: boolean;
  reading?: number;
  confidence?: number;
  message: string;
  shouldRetry?: boolean;
  processingTime?: number;
}

interface ConsumptionValidation {
  isValid: boolean;
  consumption?: number;
  warnings?: string[];
  error?: string;
}

interface OCRMetrics {
  totalAttempts: number;
  successfulReads: number;
  averageConfidence: number;
  averageProcessingTime: number;
  visionAPICallsToday: number;
}

// ==================== SERVICE CLASS ====================

class PhotoVerificationService {
  private states = new Map<string, VerificationState>();
  private ocrMetrics: OCRMetrics = {
    totalAttempts: 0,
    successfulReads: 0,
    averageConfidence: 0,
    averageProcessingTime: 0,
    visionAPICallsToday: 0,
  };

  /**
 * ✅ Cleanup verification state for a user
 */
cleanupState(userWhatsapp: string): void {
  this.states.delete(userWhatsapp);
  logger.debug('Photo verification state cleaned up', { userWhatsapp });
}

  // ==================== START PHOTO FLOW ====================

  /**
   * ✅ Step 1: Initiate START photo - Session stays 'initiated'
   */
  async initiateStartVerification(
    userWhatsapp: string,
    sessionId: string,
    stationId: number
  ): Promise<void> {
    this.states.set(userWhatsapp, {
      sessionId,
      userWhatsapp,
      stationId,
      type: 'start',
      attemptCount: 0,
      timestamp: new Date(),
      ocrProvider: 'vision',
    });

    await db
      .update(chargingSessions)
      .set({
        verificationStatus: 'awaiting_start_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    await this.sendStartPhotoRequest(userWhatsapp, 0);
    logger.info('✅ START photo requested (Vision API)', { userWhatsapp, sessionId });
  }

  /**
   * ✅ Step 2: Handle START photo upload with Google Vision API
   */
  async handleStartPhoto(userWhatsapp: string, imageBuffer: Buffer): Promise<PhotoResult> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'start') {
      return { success: false, message: '❌ Not expecting a start photo right now.' };
    }

    state.attemptCount++;
    this.states.set(userWhatsapp, state);

    // Track API usage
    this.ocrMetrics.totalAttempts++;
    this.ocrMetrics.visionAPICallsToday++;

    logger.info('📸 Processing START photo with Vision API', {
      userWhatsapp,
      attempt: state.attemptCount,
      sessionId: state.sessionId,
      bufferSize: imageBuffer.length,
      apiCallsToday: this.ocrMetrics.visionAPICallsToday,
    });

    // Check API quota (warning only)
    if (this.ocrMetrics.visionAPICallsToday > OCR_CONFIG.PRICING.freeMonthlyQuota * 0.9) {
      logger.warn('⚠️ Approaching Vision API quota limit', {
        callsToday: this.ocrMetrics.visionAPICallsToday,
        quota: OCR_CONFIG.PRICING.freeMonthlyQuota,
      });
    }

    const startTime = Date.now();
    const ocrResult = await ocrProcessor.extractKwhReading(imageBuffer);
    const processingTime = Date.now() - startTime;

    // Update metrics
    this.ocrMetrics.averageProcessingTime = 
      (this.ocrMetrics.averageProcessingTime + processingTime) / 2;

    logger.info('📊 Vision API processing complete', {
      success: ocrResult.success,
      processingTime,
      confidence: ocrResult.confidence,
      reading: ocrResult.reading,
    });

    if (!ocrResult.success || !ocrResult.reading) {
      return await this.handleOCRFailure(
        userWhatsapp, 
        state, 
        ocrResult.error,
        processingTime
      );
    }

    const confidence = ocrResult.confidence || 0;

    // Vision API typically has higher confidence, so we can be more lenient
    if (confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      return await this.handleLowConfidence(
        userWhatsapp, 
        state, 
        confidence,
        processingTime
      );
    }

    // Update success metrics
    this.ocrMetrics.successfulReads++;
    this.ocrMetrics.averageConfidence = 
      (this.ocrMetrics.averageConfidence + confidence) / 2;

    state.lastReading = ocrResult.reading;
    state.lastConfidence = confidence;
    this.states.set(userWhatsapp, state);

    await this.sendReadingConfirmation(
      userWhatsapp, 
      ocrResult.reading, 
      'start', 
      confidence,
      processingTime
    );

    return {
      success: true,
      reading: ocrResult.reading,
      confidence,
      message: 'Reading detected. Awaiting confirmation.',
      processingTime,
    };
  }

  /**
   * ✅ Step 3: Confirm START reading - ACTIVATES charging
   */
  async confirmStartReading(userWhatsapp: string): Promise<boolean> {
  const state = this.states.get(userWhatsapp);
  if (!state || state.type !== 'start' || !state.lastReading) {
    await whatsappService.sendTextMessage(
      userWhatsapp,
      '❌ No reading to confirm. Please take a photo first.'
    );
    return false;
  }

  try {
    // ✅ Get session before updating
    const session = await this.getSession(state.sessionId);
    if (!session) {
      logger.error('Session not found during START confirmation', { 
        sessionId: state.sessionId,
        userWhatsapp 
      });
      
      // ✅ Send user-friendly error message
      await whatsappService.sendTextMessage(
        userWhatsapp,
        '❌ *Session Not Found*\n\nYour charging session has expired or was cancelled.\n\nPlease start a new charging session.'
      );
      
      // ✅ Clean up verification state
      this.states.delete(userWhatsapp);
      return false;
    }

    // ✅ Update session with START reading
    await db
      .update(chargingSessions)
      .set({
        startMeterReading: state.lastReading.toString(),
        startReadingConfidence: state.lastConfidence?.toString(),
        startVerificationAttempts: state.attemptCount,
        verificationStatus: 'start_verified',
        meterValidated: true,
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    logger.info('✅ START reading confirmed (Vision API)', {
      userWhatsapp,
      reading: state.lastReading,
      confidence: state.lastConfidence,
      sessionId: state.sessionId,
      attempts: state.attemptCount,
    });

    // ✅ CRITICAL: Activate charging ONLY after confirmation
    await sessionService.startChargingAfterVerification(state.sessionId, state.lastReading);

    // ✅ Send enhanced activation message
    const confidenceBadge = ocrProcessor.isGoodConfidence(state.lastConfidence || 0) 
      ? '🎯 High accuracy detection' 
      : '📊 Reading verified';

    await whatsappService.sendTextMessage(
      userWhatsapp,
      `⚡ *Charging Started!*\n\n` +
      `📊 *Initial Reading:* ${ocrProcessor.formatReading(state.lastReading)}\n` +
      `${confidenceBadge} (${state.lastConfidence?.toFixed(0)}%)\n` +
      `💰 *Rate:* ₹${session.ratePerKwh}/kWh\n` +
      `🔋 *Target:* 80%\n\n` +
      `When done charging, use:\n🛑 /stop - To end session`
    );

    // ✅ Clean up verification state
    this.states.delete(userWhatsapp);
    return true;
    
  } catch (error) {
    logger.error('Failed to confirm START reading', { 
      userWhatsapp, 
      sessionId: state.sessionId, 
      error 
    });
    
    await whatsappService.sendTextMessage(
      userWhatsapp,
      '❌ *Error Starting Charging*\n\nSomething went wrong. Please try again or contact support.'
    );
    
    return false;
  }
}
  /**
   * Retry START photo
   */
  async retakeStartPhoto(userWhatsapp: string): Promise<void> {
    const state = this.states.get(userWhatsapp);
    if (!state) {
      await whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
      return;
    }

    if (state.attemptCount >= OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return;
    }

    await this.sendStartPhotoRequest(userWhatsapp, state.attemptCount);
  }

  // ==================== END PHOTO FLOW ====================

  /**
   * ✅ Step 1: Initiate END photo
   */
  async initiateEndVerification(
    userWhatsapp: string,
    sessionId: string,
    stationId: number
  ): Promise<void> {
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

    await db
      .update(chargingSessions)
      .set({
        verificationStatus: 'awaiting_end_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    await this.sendEndPhotoRequest(userWhatsapp, 0);
    logger.info('✅ END photo requested (Vision API)', { userWhatsapp, sessionId });
  }

  /**
   * ✅ Step 2: Handle END photo upload with Google Vision API
   */
  async handleEndPhoto(userWhatsapp: string, imageBuffer: Buffer): Promise<PhotoResult> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'end') {
      return { success: false, message: '❌ Not expecting an end photo right now.' };
    }

    state.attemptCount++;
    this.states.set(userWhatsapp, state);

    // Track API usage
    this.ocrMetrics.totalAttempts++;
    this.ocrMetrics.visionAPICallsToday++;

    logger.info('📸 Processing END photo with Vision API', {
      userWhatsapp,
      attempt: state.attemptCount,
      sessionId: state.sessionId,
      bufferSize: imageBuffer.length,
    });

    const startTime = Date.now();
    const ocrResult = await ocrProcessor.extractKwhReading(imageBuffer);
    const processingTime = Date.now() - startTime;

    logger.info('📊 Vision API END processing complete', {
      success: ocrResult.success,
      processingTime,
      confidence: ocrResult.confidence,
      reading: ocrResult.reading,
    });

    if (!ocrResult.success || !ocrResult.reading) {
      return await this.handleOCRFailure(
        userWhatsapp, 
        state, 
        ocrResult.error,
        processingTime
      );
    }

    const confidence = ocrResult.confidence || 0;

    if (confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      return await this.handleLowConfidence(
        userWhatsapp, 
        state, 
        confidence,
        processingTime
      );
    }

    // ✅ Validate consumption
    const validation = await this.validateConsumption(state.sessionId, ocrResult.reading);
    if (!validation.isValid) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        `⚠️ *Validation Issue*\n\n${validation.error}\n\nPlease retake the photo.`
      );
      return { 
        success: false, 
        message: validation.error || 'Validation failed', 
        shouldRetry: true,
        processingTime,
      };
    }

    // Update success metrics
    this.ocrMetrics.successfulReads++;
    this.ocrMetrics.averageConfidence = 
      (this.ocrMetrics.averageConfidence + confidence) / 2;

    state.lastReading = ocrResult.reading;
    state.lastConfidence = confidence;
    this.states.set(userWhatsapp, state);

    await this.sendEndReadingConfirmation(
      userWhatsapp,
      ocrResult.reading,
      validation.consumption!,
      confidence,
      validation.warnings,
      processingTime
    );

    return {
      success: true,
      reading: ocrResult.reading,
      confidence,
      message: 'End reading detected. Awaiting confirmation.',
      processingTime,
    };
  }

  /**
   * ✅ Step 3: Confirm END reading - COMPLETES session
   */
  async confirmEndReading(userWhatsapp: string): Promise<boolean> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'end' || !state.lastReading) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        '❌ No reading to confirm. Please take a photo first.'
      );
      return false;
    }

    const session = await this.getSession(state.sessionId);
    if (!session?.startMeterReading) {
      logger.error('Start reading not found during END confirmation', { sessionId: state.sessionId });
      return false;
    }

    const startReading = parseFloat(session.startMeterReading);
    const consumption = state.lastReading - startReading;

    // ✅ Update session with END reading (Vision API)
    await db
      .update(chargingSessions)
      .set({
        endMeterReading: state.lastReading.toString(),
        endReadingConfidence: state.lastConfidence?.toString(),
        endVerificationAttempts: state.attemptCount,
        energyDelivered: consumption.toString(),
        verificationStatus: 'completed',
        meterValidated: true,
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    logger.info('✅ END reading confirmed (Vision API)', {
      userWhatsapp,
      reading: state.lastReading,
      consumption,
      sessionId: state.sessionId,
      confidence: state.lastConfidence,
    });

    // ✅ CRITICAL: Complete session with consumption
    await sessionService.completeSessionAfterVerification(
      state.sessionId,
      state.lastReading,
      consumption
    );

    this.states.delete(userWhatsapp);
    return true;
  }

  /**
   * Retry END photo
   */
  async retakeEndPhoto(userWhatsapp: string): Promise<void> {
    const state = this.states.get(userWhatsapp);
    if (!state) {
      await whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
      return;
    }

    if (state.attemptCount >= OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return;
    }

    await this.sendEndPhotoRequest(userWhatsapp, state.attemptCount);
  }

  // ==================== MANUAL ENTRY ====================

  async handleManualEntry(userWhatsapp: string, input: string): Promise<boolean> {
    const state = this.states.get(userWhatsapp);
    if (!state) return false;

    const reading = parseFloat(input.trim());
    const validation = ocrProcessor.validateReading(reading);

    if (!validation.valid) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        `❌ *Invalid Reading*\n\n${validation.error}\n\nPlease enter a valid kWh reading.`
      );
      return false;
    }

    if (state.type === 'end') {
      const consumptionValidation = await this.validateConsumption(state.sessionId, reading);
      if (!consumptionValidation.isValid) {
        await whatsappService.sendTextMessage(
          userWhatsapp,
          `❌ *Validation Failed*\n\n${consumptionValidation.error}\n\nPlease check and re-enter.`
        );
        return false;
      }
    }

    state.lastReading = reading;
    state.lastConfidence = 0;
    state.ocrProvider = 'manual';
    this.states.set(userWhatsapp, state);

    await this.sendReadingConfirmation(userWhatsapp, reading, state.type, 0);
    
    logger.info('Manual entry accepted', {
      userWhatsapp,
      reading,
      type: state.type,
      sessionId: state.sessionId,
    });

    return true;
  }

  // ==================== VALIDATION ====================

  private async validateConsumption(sessionId: string, endReading: number): Promise<ConsumptionValidation> {
  const session = await this.getSession(sessionId);
  if (!session?.startMeterReading) {
    return { isValid: false, error: 'Start reading not found' };
  }

  const startReading = parseFloat(session.startMeterReading);
  const result = ocrProcessor.calculateConsumption(startReading, endReading);

  if (!result.valid) {
    return { isValid: false, error: result.error };
  }

  // ✅ FIX: Use actual session start time from database
  const sessionStartTime = session.startTime || session.startedAt || session.createdAt;
  const durationMinutes = sessionStartTime 
    ? Math.floor((Date.now() - sessionStartTime.getTime()) / (1000 * 60))
    : 0;
  
  // ✅ FIX: If duration is 0 or negative, skip context validation
  if (durationMinutes < 1) {
    logger.warn('Charging duration too short for validation', { 
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
  const contextValidation = ocrProcessor.validateConsumptionWithContext(
    result.consumption!,
    durationMinutes,
    chargerPowerKw
  );

  return {
    isValid: contextValidation.valid,
    consumption: result.consumption,
    warnings: contextValidation.warnings,
    error: contextValidation.error,
  };
}

  // ==================== MESSAGING ====================

  private async sendStartPhotoRequest(
    userWhatsapp: string, 
    attemptCount: number
  ): Promise<void> {
    const message = attemptCount === 0
      ? `📸 *Please take a photo of your charging dashboard*\n\n` +
        `🎯 *Tips for best results:*\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}\n\n` +
        `📊 We need the *current kWh reading* to start your session.\n` 
        
      : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts})\n\n` +
        `💡 *Please ensure:*\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.steady}`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
  }

  private async sendEndPhotoRequest(
    userWhatsapp: string, 
    attemptCount: number
  ): Promise<void> {
    const message = attemptCount === 0
      ? `📸 *Please take a photo of your FINAL charging reading*\n\n` +
        `*Capture the final kWh display:*\n` +
        `• Same dashboard as start photo\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n\n` +
        `📊 This will calculate your actual consumption.\n` 
        
      : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts})\n\n` +
        `*Please ensure:*\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
  }

  private async sendReadingConfirmation(
    userWhatsapp: string,
    reading: number,
    type: 'start' | 'end',
    confidence: number,
    processingTime?: number
  ): Promise<void> {
    const formatted = ocrProcessor.formatReading(reading);
    
    let confidenceIndicator = '';
    if (confidence > 0) {
      if (ocrProcessor.isGoodConfidence(confidence)) {
        confidenceIndicator = `\n*High confidence* (${confidence.toFixed(0)}%)`;
      } else if (ocrProcessor.shouldWarnLowConfidence(confidence)) {
        confidenceIndicator = `\n⚠️ *Low confidence* (${confidence.toFixed(0)}%) - Please verify carefully`;
      } else {
        confidenceIndicator = `\n📊 *Confidence:* ${confidence.toFixed(0)}%`;
      }
    } else {
      confidenceIndicator = '\n📝 *Manual entry*';
    }

    const processingInfo = processingTime 
      ? `\n⚡ Processed in ${(processingTime / 1000).toFixed(1)}s` 
      : '';

    const message = `*Reading Detected!*\n\n` +
      `📊 *${type === 'start' ? 'Start' : 'Final'} Reading:* ${formatted}` +
      `${confidenceIndicator}${processingInfo}\n\n` +
      `❓ *Is this correct?*`;

    await whatsappService.sendButtonMessage(
      userWhatsapp,
      message,
      [
        { id: `confirm_${type}_reading`, title: '✓ Yes, Correct' },
        { id: `retake_${type}_photo`, title: '✗ Retake Photo' },
      ],
      '📊 Confirm Reading'
    );
  }

  private async sendEndReadingConfirmation(
    userWhatsapp: string,
    endReading: number,
    consumption: number,
    confidence: number,
    warnings?: string[],
    processingTime?: number
  ): Promise<void> {
    let confidenceIndicator = '';
    if (ocrProcessor.isGoodConfidence(confidence)) {
      confidenceIndicator = `🎯 *High confidence* (${confidence.toFixed(0)}%)\n`;
    } else if (ocrProcessor.shouldWarnLowConfidence(confidence)) {
      confidenceIndicator = `⚠️ *Low confidence* (${confidence.toFixed(0)}%) - Please verify\n`;
    } else {
      confidenceIndicator = `📊 *Confidence:* ${confidence.toFixed(0)}%\n`;
    }

    const processingInfo = processingTime 
      ? `⚡ Processed in ${(processingTime / 1000).toFixed(1)}s\n` 
      : '';

    let message = `✅ *Final Reading Detected!*\n\n` +
      `${confidenceIndicator}${processingInfo}` +
      `📊 *Reading:* ${ocrProcessor.formatReading(endReading)}\n` +
      `⚡ *Consumption:* ${consumption.toFixed(2)} kWh\n\n`;

    if (warnings?.length) {
      message += `⚠️ *Notices:*\n${warnings.map(w => `• ${w}`).join('\n')}\n\n`;
    }

    message += `❓ *Confirm to complete your session?*`;

    await whatsappService.sendButtonMessage(
      userWhatsapp,
      message,
      [
        { id: 'confirm_end_reading', title: '✓ Confirm & Complete' },
        { id: 'retake_end_photo', title: '✗ Retake Photo' },
      ],
      '📊 Final Confirmation'
    );
  }

  // ==================== ERROR HANDLING ====================

  private async handleOCRFailure(
    userWhatsapp: string,
    state: VerificationState,
    error?: string,
    processingTime?: number
  ): Promise<PhotoResult> {
    if (state.attemptCount >= OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return { 
        success: false, 
        message: 'Max attempts reached. Manual entry required.',
        processingTime,
      };
    }

    const suggestions = ocrProcessor.getRetrySuggestions();
    
    // Check for Vision API specific errors
    let errorMessage = error || 'Could not read the display';
    if (error?.includes('PERMISSION_DENIED')) {
      errorMessage = 'Authentication error. Please contact support.';
      logger.error('Vision API authentication failed', { userWhatsapp, sessionId: state.sessionId });
    } else if (error?.includes('QUOTA_EXCEEDED')) {
      errorMessage = 'Service temporarily unavailable. Please try again shortly.';
      logger.error('Vision API quota exceeded', { 
        callsToday: this.ocrMetrics.visionAPICallsToday 
      });
    }

    const message = `❌ *Couldn't read the display*\n\n${errorMessage}\n\n` +
      `💡 *Tips:*\n${suggestions.join('\n')}\n\n` +
      `📸 *Attempt ${state.attemptCount} of ${OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts}*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    
    return { 
      success: false, 
      message: errorMessage, 
      shouldRetry: true,
      processingTime,
    };
  }

  private async handleLowConfidence(
    userWhatsapp: string,
    state: VerificationState,
    confidence: number,
    processingTime?: number
  ): Promise<PhotoResult> {
    if (state.attemptCount >= OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return { 
        success: false, 
        message: 'Max attempts reached. Manual entry required.',
        processingTime,
      };
    }

    const tips = OCR_CONFIG.MESSAGES.RETRY_TIPS;
    const message = `⚠️ *Low Reading Confidence*\n\n` +
      `We detected a reading but confidence is low (${confidence.toFixed(0)}%)\n\n` +
      `💡 *Please retake with:*\n` +
      `• ${tips.lighting}\n` +
      `• ${tips.focus}\n` +
      `• ${tips.steady}\n\n` +
      `*Attempt ${state.attemptCount} of ${OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts}*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    
    return { 
      success: false, 
      message: `Low confidence: ${confidence.toFixed(0)}%`, 
      shouldRetry: true,
      processingTime,
    };
  }

  private async fallbackToManualEntry(
    userWhatsapp: string, 
    state: VerificationState
  ): Promise<void> {
    await db
      .update(chargingSessions)
      .set({
        manualEntryUsed: true,
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    const message = `📝 *Manual Entry Required*\n\n` +
      `We couldn't read the display after ${OCR_CONFIG.GOOGLE_VISION.retry.maxAttempts} attempts.\n\n` +
      `Please *type* the ${state.type === 'start' ? 'current' : 'final'} kWh reading from your dashboard.\n\n` +
      `📊 *Example:* 1245.8\n\n` +
      `💡 *Make sure to enter the exact reading shown.*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    
    logger.info('Fallback to manual entry (Vision API)', {
      userWhatsapp,
      type: state.type,
      sessionId: state.sessionId,
      attempts: state.attemptCount,
      apiCallsUsed: this.ocrMetrics.visionAPICallsToday,
    });
  }

  // ==================== UTILITIES ====================

  private async getSession(sessionId: string) {
    const sessions = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    return sessions[0] || null;
  }

  isInVerificationFlow(userWhatsapp: string): boolean {
    const state = this.states.get(userWhatsapp);
    if (!state) return false;
    
    // Check if expired
    if (Date.now() - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS) {
      this.states.delete(userWhatsapp);
      return false;
    }
    return true;
  }

  getVerificationState(userWhatsapp: string): VerificationState | null {
    return this.states.get(userWhatsapp) || null;
  }

  clearVerificationState(userWhatsapp: string): void {
    this.states.delete(userWhatsapp);
  }

  cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [whatsappId, state] of this.states.entries()) {
      if (now - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS) {
        this.states.delete(whatsappId);
        logger.info('Cleaned up expired verification state', { whatsappId });
      }
    }
  }

  // ==================== ANALYTICS & MONITORING ====================

  /**
   * Get OCR metrics for monitoring
   */
  getOCRMetrics(): OCRMetrics {
    return { ...this.ocrMetrics };
  }

  /**
   * Get success rate percentage
   */
  getSuccessRate(): number {
    if (this.ocrMetrics.totalAttempts === 0) return 0;
    return (this.ocrMetrics.successfulReads / this.ocrMetrics.totalAttempts) * 100;
  }

  /**
   * Reset daily API call counter (call this at midnight)
   */
  resetDailyAPICounter(): void {
    this.ocrMetrics.visionAPICallsToday = 0;
    logger.info('Vision API daily counter reset');
  }

  /**
   * Estimate monthly cost based on current usage
   */
  estimateMonthlyCost(): number {
    const dailyAverage = this.ocrMetrics.visionAPICallsToday;
    const monthlyEstimate = dailyAverage * 30;
    
    if (monthlyEstimate <= OCR_CONFIG.PRICING.freeMonthlyQuota) {
      return 0;
    }
    
    const billableRequests = monthlyEstimate - OCR_CONFIG.PRICING.freeMonthlyQuota;
    return billableRequests * OCR_CONFIG.PRICING.costPerRequest;
  }

  /**
   * Check if approaching quota limit
   */
  isApproachingQuota(): boolean {
    return this.ocrMetrics.visionAPICallsToday > 
      (OCR_CONFIG.PRICING.freeMonthlyQuota * 0.8);
  }

  /**
   * Log performance metrics
   */
  logPerformanceMetrics(): void {
    logger.info('API Performance Metrics', {
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

  /**
   * Get detailed state for debugging
   */
  getDebugInfo(userWhatsapp: string): any {
    const state = this.states.get(userWhatsapp);
    if (!state) return null;

    return {
      sessionId: state.sessionId,
      type: state.type,
      attemptCount: state.attemptCount,
      lastReading: state.lastReading,
      lastConfidence: state.lastConfidence,
      ocrProvider: state.ocrProvider,
      timeSinceStart: Date.now() - state.timestamp.getTime(),
      isExpired: Date.now() - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS,
    };
  }
}

// ==================== EXPORT ====================

export const photoVerificationService = new PhotoVerificationService();



// Cleanup expired states every 10 minutes
setInterval(() => {
  photoVerificationService.cleanupExpiredStates();
}, 10 * 60 * 1000);

// Reset daily API counter at midnight
const resetAtMidnight = () => {
  const now = new Date();
  const night = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1, // tomorrow
    0, 0, 0 // midnight
  );
  const msToMidnight = night.getTime() - now.getTime();

  setTimeout(() => {
    photoVerificationService.resetDailyAPICounter();
    // Schedule next reset
    setInterval(() => {
      photoVerificationService.resetDailyAPICounter();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, msToMidnight);
};

resetAtMidnight();

// Log performance metrics every hour
setInterval(() => {
  photoVerificationService.logPerformanceMetrics();
}, 60 * 60 * 1000);

// ==================== ADDITIONAL EXPORTS ====================

export type { 
  VerificationState, 
  PhotoResult, 
  ConsumptionValidation,
  OCRMetrics 
};