"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OCR_CONFIG = void 0;
exports.getConfidenceLevel = getConfidenceLevel;
exports.getConfidenceMessage = getConfidenceMessage;
exports.isValidImageSize = isValidImageSize;
exports.isAcceptableProcessingTime = isAcceptableProcessingTime;
exports.estimateAPICost = estimateAPICost;
exports.OCR_CONFIG = {
    VALID_RANGE: {
        min: 10,
        max: 999999,
    },
    MAX_DECIMAL_PLACES: 3,
    CONSUMPTION_RANGE: {
        min: 0.1,
        max: 200,
    },
    MAX_CHARGE_RATE: {
        normal: 1.0,
        fast: 3.0,
        ultra: 5.0,
    },
    MIN_OCR_CONFIDENCE: 60,
    MIN_DISPLAY_CONFIDENCE: 70,
    GOOD_CONFIDENCE: 85,
    MIN_EFFICIENCY: 0.50,
    GOOGLE_VISION: {
        languageHints: ['en'],
        timeout: 30000,
        features: [
            {
                type: 'TEXT_DETECTION',
                maxResults: 50,
            }
        ],
        imageContext: {
            languageHints: ['en'],
            cropHintsParams: {
                aspectRatios: [1.0, 1.33, 1.77]
            }
        },
        retry: {
            maxAttempts: 3,
            initialDelayMs: 1000,
            maxDelayMs: 5000,
        }
    },
    PREPROCESSING: {
        enhanceContrast: true,
        denoise: true,
        autoRotate: true,
        threshold: false,
        targetSize: {
            width: 1600,
            height: 1200
        },
        aggressive: {
            contrastBoost: 2.0,
            sharpenSigma: 2.0,
            medianRadius: 5,
            gammaCorrection: 1.2
        },
        minImageSize: { width: 200, height: 200 },
        maxImageSize: { width: 4096, height: 4096 },
        maxFileSizeMB: 20,
    },
    METER_KEYWORDS: [
        'KWH', 'KW', 'ENERGY', 'METER', 'READING',
        'CONSUMPTION', 'DELIVERED', 'TOTAL', 'CUMULATIVE',
        'DISPLAY', 'CHARGE', 'BATTERY', 'POWER'
    ],
    OCR_CORRECTIONS: {
        'O': '0',
        'o': '0',
        'I': '1',
        'l': '1',
        'L': '1',
        'S': '5',
        's': '5',
        'Z': '2',
        'z': '2',
        'B': '8',
        'b': '8',
        'G': '6',
        'g': '6',
    },
    STATE_EXPIRY_MS: 30 * 60 * 1000,
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
    MAX_CONCURRENT_OCR: 10,
    OCR_TIMEOUT_MS: 30000,
    PERFORMANCE_THRESHOLDS: {
        preprocessing: 3000,
        ocrProcessing: 10000,
        total: 15000
    },
    ENABLE_DEBUG_LOGS: process.env.NODE_ENV !== 'production',
    SAVE_FAILED_IMAGES: process.env.SAVE_OCR_FAILURES === 'true',
    FAILED_IMAGES_PATH: './failed-ocr-images',
    CACHE: {
        enabled: true,
        ttlSeconds: 300,
        maxSize: 100,
    },
    PRICING: {
        freeMonthlyQuota: 1000,
        costPerRequest: 0.0015,
    },
    MESSAGES: {
        LOW_CONFIDENCE_THRESHOLD: 50,
        RETRY_TIPS: {
            lighting: '💡 Use better lighting - avoid shadows and glare',
            focus: '🔍 Focus clearly on the kWh display numbers',
            steady: '📱 Hold camera steady and move closer to display',
            visible: '🎯 Ensure entire reading is visible in frame',
            numbers: '🔢 Make sure all digits are clear and not blurred',
            angle: '📐 Take photo straight-on, avoid angles',
            background: '🖼️ Minimize background clutter around display',
        },
        SUCCESS: {
            highConfidence: '✅ Reading captured successfully!',
            mediumConfidence: '✅ Reading captured (please verify accuracy)',
            lowConfidence: '⚠️ Reading captured but quality is low',
        },
        ERROR: {
            noText: '❌ Could not detect any text in image',
            noNumbers: '❌ No numbers found in image',
            invalidReading: '❌ Reading value is outside valid range',
            apiError: '❌ OCR service error - please try again',
            authError: '❌ Authentication failed - check API credentials',
            quotaError: '❌ API quota exceeded - try again later',
        }
    },
};
function getConfidenceLevel(confidence) {
    if (confidence >= exports.OCR_CONFIG.GOOD_CONFIDENCE)
        return 'high';
    if (confidence >= exports.OCR_CONFIG.MIN_DISPLAY_CONFIDENCE)
        return 'medium';
    return 'low';
}
function getConfidenceMessage(confidence) {
    const level = getConfidenceLevel(confidence);
    return exports.OCR_CONFIG.MESSAGES.SUCCESS[level === 'low' ? 'lowConfidence' :
        level === 'medium' ? 'mediumConfidence' : 'highConfidence'];
}
function isValidImageSize(sizeBytes) {
    const sizeMB = sizeBytes / (1024 * 1024);
    return sizeMB <= exports.OCR_CONFIG.PREPROCESSING.maxFileSizeMB;
}
function isAcceptableProcessingTime(timeMs, stage) {
    return timeMs <= exports.OCR_CONFIG.PERFORMANCE_THRESHOLDS[stage];
}
function estimateAPICost(requests) {
    const billableRequests = Math.max(0, requests - exports.OCR_CONFIG.PRICING.freeMonthlyQuota);
    return billableRequests * exports.OCR_CONFIG.PRICING.costPerRequest;
}
//# sourceMappingURL=ocr-config.js.map