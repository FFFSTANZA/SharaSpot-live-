export declare const OCR_CONFIG: {
    readonly VALID_RANGE: {
        readonly min: 10;
        readonly max: 999999;
    };
    readonly MAX_DECIMAL_PLACES: 3;
    readonly CONSUMPTION_RANGE: {
        readonly min: 0.1;
        readonly max: 200;
    };
    readonly MAX_CHARGE_RATE: {
        readonly normal: 1;
        readonly fast: 3;
        readonly ultra: 5;
    };
    readonly MIN_OCR_CONFIDENCE: 60;
    readonly MIN_DISPLAY_CONFIDENCE: 70;
    readonly GOOD_CONFIDENCE: 85;
    readonly MIN_EFFICIENCY: 0.5;
    readonly GOOGLE_VISION: {
        readonly languageHints: readonly ["en"];
        readonly timeout: 30000;
        readonly features: readonly [{
            readonly type: "TEXT_DETECTION";
            readonly maxResults: 50;
        }];
        readonly imageContext: {
            readonly languageHints: readonly ["en"];
            readonly cropHintsParams: {
                readonly aspectRatios: readonly [1, 1.33, 1.77];
            };
        };
        readonly retry: {
            readonly maxAttempts: 3;
            readonly initialDelayMs: 1000;
            readonly maxDelayMs: 5000;
        };
    };
    readonly PREPROCESSING: {
        readonly enhanceContrast: true;
        readonly denoise: true;
        readonly autoRotate: true;
        readonly threshold: false;
        readonly targetSize: {
            readonly width: 1600;
            readonly height: 1200;
        };
        readonly aggressive: {
            readonly contrastBoost: 2;
            readonly sharpenSigma: 2;
            readonly medianRadius: 5;
            readonly gammaCorrection: 1.2;
        };
        readonly minImageSize: {
            readonly width: 200;
            readonly height: 200;
        };
        readonly maxImageSize: {
            readonly width: 4096;
            readonly height: 4096;
        };
        readonly maxFileSizeMB: 20;
    };
    readonly METER_KEYWORDS: readonly ["KWH", "KW", "ENERGY", "METER", "READING", "CONSUMPTION", "DELIVERED", "TOTAL", "CUMULATIVE", "DISPLAY", "CHARGE", "BATTERY", "POWER"];
    readonly OCR_CORRECTIONS: {
        readonly O: "0";
        readonly o: "0";
        readonly I: "1";
        readonly l: "1";
        readonly L: "1";
        readonly S: "5";
        readonly s: "5";
        readonly Z: "2";
        readonly z: "2";
        readonly B: "8";
        readonly b: "8";
        readonly G: "6";
        readonly g: "6";
    };
    readonly STATE_EXPIRY_MS: number;
    readonly CLEANUP_INTERVAL_MS: number;
    readonly MAX_CONCURRENT_OCR: 10;
    readonly OCR_TIMEOUT_MS: 30000;
    readonly PERFORMANCE_THRESHOLDS: {
        readonly preprocessing: 3000;
        readonly ocrProcessing: 10000;
        readonly total: 15000;
    };
    readonly ENABLE_DEBUG_LOGS: boolean;
    readonly SAVE_FAILED_IMAGES: boolean;
    readonly FAILED_IMAGES_PATH: "./failed-ocr-images";
    readonly CACHE: {
        readonly enabled: true;
        readonly ttlSeconds: 300;
        readonly maxSize: 100;
    };
    readonly PRICING: {
        readonly freeMonthlyQuota: 1000;
        readonly costPerRequest: 0.0015;
    };
    readonly MESSAGES: {
        readonly LOW_CONFIDENCE_THRESHOLD: 50;
        readonly RETRY_TIPS: {
            readonly lighting: "💡 Use better lighting - avoid shadows and glare";
            readonly focus: "🔍 Focus clearly on the kWh display numbers";
            readonly steady: "📱 Hold camera steady and move closer to display";
            readonly visible: "🎯 Ensure entire reading is visible in frame";
            readonly numbers: "🔢 Make sure all digits are clear and not blurred";
            readonly angle: "📐 Take photo straight-on, avoid angles";
            readonly background: "🖼️ Minimize background clutter around display";
        };
        readonly SUCCESS: {
            readonly highConfidence: "✅ Reading captured successfully!";
            readonly mediumConfidence: "✅ Reading captured (please verify accuracy)";
            readonly lowConfidence: "⚠️ Reading captured but quality is low";
        };
        readonly ERROR: {
            readonly noText: "❌ Could not detect any text in image";
            readonly noNumbers: "❌ No numbers found in image";
            readonly invalidReading: "❌ Reading value is outside valid range";
            readonly apiError: "❌ OCR service error - please try again";
            readonly authError: "❌ Authentication failed - check API credentials";
            readonly quotaError: "❌ API quota exceeded - try again later";
        };
    };
};
export declare function getConfidenceLevel(confidence: number): 'low' | 'medium' | 'high';
export declare function getConfidenceMessage(confidence: number): string;
export declare function isValidImageSize(sizeBytes: number): boolean;
export declare function isAcceptableProcessingTime(timeMs: number, stage: keyof typeof OCR_CONFIG.PERFORMANCE_THRESHOLDS): boolean;
export declare function estimateAPICost(requests: number): number;
//# sourceMappingURL=ocr-config.d.ts.map