// src/config/ocr-config.ts - GOOGLE VISION API CONFIGURATION

export const OCR_CONFIG = {
  // ============================================
  // READING VALIDATION
  // ============================================
  
  // Valid kWh reading range
  VALID_RANGE: {
    min: 10,        // Minimum valid kWh reading
    max: 999999,    // Maximum valid kWh reading
  },
  
  // Maximum decimal places allowed in readings
  MAX_DECIMAL_PLACES: 3,
  
  // ============================================
  // CONSUMPTION VALIDATION
  // ============================================
  
  // Valid consumption range (difference between readings)
  CONSUMPTION_RANGE: {
    min: 0.1,      // Minimum consumption (0.1 kWh)
    max: 200,      // Maximum consumption per session (200 kWh)
  },
  
  // Rate of change limits (kWh per minute)
  MAX_CHARGE_RATE: {
    normal: 1.0,   // 60 kW max
    fast: 3.0,     // 180 kW max
    ultra: 5.0,    // 300 kW max (future-proofing)
  },

  // ============================================
  // CONFIDENCE THRESHOLDS
  // ============================================
  
  // Minimum OCR confidence to accept result (0-100)
  MIN_OCR_CONFIDENCE: 60,
  
  // Confidence level to show warning but still accept
  MIN_DISPLAY_CONFIDENCE: 70,
  
  // Confidence level considered "good"
  GOOD_CONFIDENCE: 85,
  
  // Energy efficiency thresholds (actual vs theoretical)
  MIN_EFFICIENCY: 0.50, // 50% minimum (below = warning)

  // ============================================
  // GOOGLE VISION API SETTINGS
  // ============================================
  
  GOOGLE_VISION: {
    // Language hints for better recognition
    languageHints: ['en'],
    
    // Timeout for API calls (milliseconds)
    timeout: 30000,
    
    // Image features to detect
    features: [
      {
        type: 'TEXT_DETECTION' as const,
        maxResults: 50, // Get multiple text detections for better accuracy
      }
    ],
    
    // Image context configuration
    imageContext: {
      languageHints: ['en'],
      // Crop hints for better focus (optional)
      cropHintsParams: {
        aspectRatios: [1.0, 1.33, 1.77] // Common meter display ratios
      }
    },
    
    // Retry configuration
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
    }
  },

  // ============================================
  // IMAGE PREPROCESSING
  // ============================================
  
  PREPROCESSING: {
    // Standard preprocessing
    enhanceContrast: true,
    denoise: true,
    autoRotate: true,
    threshold: false, // Adaptive thresholding as fallback only
    
    // Target size for OCR (optimal for Vision API)
    targetSize: { 
      width: 1600,  // Vision API works well with higher resolution
      height: 1200
    },
    
    // Aggressive preprocessing (fallback strategy)
    aggressive: {
      contrastBoost: 2.0,
      sharpenSigma: 2.0,
      medianRadius: 5,
      gammaCorrection: 1.2
    },
    
    // Image quality thresholds
    minImageSize: { width: 200, height: 200 },
    maxImageSize: { width: 4096, height: 4096 }, // Vision API supports up to 20MB
    maxFileSizeMB: 20, // Vision API limit
  },

  // ============================================
  // PATTERN MATCHING
  // ============================================
  
  // Keywords that indicate valid meter readings
  METER_KEYWORDS: [
    'KWH', 'KW', 'ENERGY', 'METER', 'READING', 
    'CONSUMPTION', 'DELIVERED', 'TOTAL', 'CUMULATIVE',
    'DISPLAY', 'CHARGE', 'BATTERY', 'POWER'
  ],
  
  // Common OCR mistakes to correct
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

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  // How long to keep verification state in memory
  STATE_EXPIRY_MS: 30 * 60 * 1000, // 30 minutes
  
  // Cleanup interval for expired states
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  
  // Maximum concurrent OCR operations
  MAX_CONCURRENT_OCR: 10, // Vision API can handle more concurrent requests

  // ============================================
  // PERFORMANCE & MONITORING
  // ============================================
  
  // OCR timeout (prevent hanging)
  OCR_TIMEOUT_MS: 30000, // 30 seconds
  
  // Processing time thresholds for monitoring
  PERFORMANCE_THRESHOLDS: {
    preprocessing: 3000,   // 3 seconds
    ocrProcessing: 10000,  // 10 seconds (Vision API is faster)
    total: 15000           // 15 seconds
  },
  
  // Enable detailed logging
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV !== 'production',
  
  // Save failed images for analysis (optional)
  SAVE_FAILED_IMAGES: process.env.SAVE_OCR_FAILURES === 'true',
  FAILED_IMAGES_PATH: './failed-ocr-images',

  // ============================================
  // API COST OPTIMIZATION
  // ============================================
  
  // Cache settings to reduce API calls
  CACHE: {
    enabled: true,
    ttlSeconds: 300, // 5 minutes
    maxSize: 100,    // Maximum cached results
  },
  
  // Vision API pricing awareness
  PRICING: {
    freeMonthlyQuota: 1000,    // First 1000 requests/month free
    costPerRequest: 0.0015,    // $1.50 per 1000 requests after quota
  },

  // ============================================
  // USER MESSAGES
  // ============================================
  
  MESSAGES: {
    // Threshold for suggesting retake
    LOW_CONFIDENCE_THRESHOLD: 50,
    
    // Tips for better photo quality
    RETRY_TIPS: {
      lighting: '💡 Use better lighting - avoid shadows and glare',
      focus: '🔍 Focus clearly on the kWh display numbers',
      steady: '📱 Hold camera steady and move closer to display',
      visible: '🎯 Ensure entire reading is visible in frame',
      numbers: '🔢 Make sure all digits are clear and not blurred',
      angle: '📐 Take photo straight-on, avoid angles',
      background: '🖼️ Minimize background clutter around display',
    },
    
    // Success messages
    SUCCESS: {
      highConfidence: '✅ Reading captured successfully!',
      mediumConfidence: '✅ Reading captured (please verify accuracy)',
      lowConfidence: '⚠️ Reading captured but quality is low',
    },
    
    // Error messages
    ERROR: {
      noText: '❌ Could not detect any text in image',
      noNumbers: '❌ No numbers found in image',
      invalidReading: '❌ Reading value is outside valid range',
      apiError: '❌ OCR service error - please try again',
      authError: '❌ Authentication failed - check API credentials',
      quotaError: '❌ API quota exceeded - try again later',
    }
  },
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get confidence level descriptor
 */
export function getConfidenceLevel(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence >= OCR_CONFIG.GOOD_CONFIDENCE) return 'high';
  if (confidence >= OCR_CONFIG.MIN_DISPLAY_CONFIDENCE) return 'medium';
  return 'low';
}

/**
 * Get user-friendly confidence message
 */
export function getConfidenceMessage(confidence: number): string {
  const level = getConfidenceLevel(confidence);
  return OCR_CONFIG.MESSAGES.SUCCESS[
    level === 'low' ? 'lowConfidence' : 
    level === 'medium' ? 'mediumConfidence' : 'highConfidence'
  ];
}

/**
 * Validate image file size
 */
export function isValidImageSize(sizeBytes: number): boolean {
  const sizeMB = sizeBytes / (1024 * 1024);
  return sizeMB <= OCR_CONFIG.PREPROCESSING.maxFileSizeMB;
}

/**
 * Check if processing time is acceptable
 */
export function isAcceptableProcessingTime(
  timeMs: number, 
  stage: keyof typeof OCR_CONFIG.PERFORMANCE_THRESHOLDS
): boolean {
  return timeMs <= OCR_CONFIG.PERFORMANCE_THRESHOLDS[stage];
}

/**
 * Estimate API cost for number of requests
 */
export function estimateAPICost(requests: number): number {
  const billableRequests = Math.max(0, requests - OCR_CONFIG.PRICING.freeMonthlyQuota);
  return billableRequests * OCR_CONFIG.PRICING.costPerRequest;
}