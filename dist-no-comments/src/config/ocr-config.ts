

export const OCR_CONFIG = {
  
  
  VALID_RANGE: {
    min: 10,        // Minimum valid kWh reading
    max: 999999,    // Maximum valid kWh reading
  },
  
  
  MAX_DECIMAL_PLACES: 3,
  
  
  CONSUMPTION_RANGE: {
    min: 0.1,      // Minimum consumption (0.1 kWh)
    max: 200,      // Maximum consumption per session (200 kWh)
  },
  
  
  MAX_CHARGE_RATE: {
    normal: 1.0,   // 60 kW max
    fast: 3.0,     // 180 kW max
    ultra: 5.0,    // 300 kW max (future-proofing)
  },

  
  
  
  
  
  MIN_OCR_CONFIDENCE: 60,
  
  
  MIN_DISPLAY_CONFIDENCE: 70,
  
  
  GOOD_CONFIDENCE: 85,
  
  
  MIN_EFFICIENCY: 0.50, // 50% minimum (below = warning)

  
  
  
  
  GOOGLE_VISION: {
    
    languageHints: ['en'],
    
    
    timeout: 30000,
    
    
    features: [
      {
        type: 'TEXT_DETECTION' as const,
        maxResults: 50, // Get multiple text detections for better accuracy
      }
    ],
    
    
    imageContext: {
      languageHints: ['en'],
      
      cropHintsParams: {
        aspectRatios: [1.0, 1.33, 1.77] // Common meter display ratios
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
    threshold: false, // Adaptive thresholding as fallback only
    
    
    targetSize: { 
      width: 1600,  // Vision API works well with higher resolution
      height: 1200
    },
    
    
    aggressive: {
      contrastBoost: 2.0,
      sharpenSigma: 2.0,
      medianRadius: 5,
      gammaCorrection: 1.2
    },
    
    
    minImageSize: { width: 200, height: 200 },
    maxImageSize: { width: 4096, height: 4096 }, // Vision API supports up to 20MB
    maxFileSizeMB: 20, // Vision API limit
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

  
  STATE_EXPIRY_MS: 30 * 60 * 1000, // 30 minutes
  
  
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  
  
  MAX_CONCURRENT_OCR: 10, // Vision API can handle more concurrent requests

  
  
  OCR_TIMEOUT_MS: 30000, // 30 seconds
  
  
  PERFORMANCE_THRESHOLDS: {
    preprocessing: 3000,   // 3 seconds
    ocrProcessing: 10000,  // 10 seconds (Vision API is faster)
    total: 15000           // 15 seconds
  },
  
  
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV !== 'production',
  
  
  SAVE_FAILED_IMAGES: process.env.SAVE_OCR_FAILURES === 'true',
  FAILED_IMAGES_PATH: './failed-ocr-images',

  
  CACHE: {
    enabled: true,
    ttlSeconds: 300, // 5 minutes
    maxSize: 100,    // Maximum cached results
  },
  
  
  PRICING: {
    freeMonthlyQuota: 1000,    // First 1000 requests/month free
    costPerRequest: 0.0015,    // $1.50 per 1000 requests after quota
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
} as const;


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