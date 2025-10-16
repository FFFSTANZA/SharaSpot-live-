// src/utils/button-parser.ts - UNIFIED BUTTON ID PARSER WITH START_CHARGING FIX
import { logger } from './logger';

// ===============================================
// TYPES & INTERFACES
// ===============================================

export interface ButtonParseResult {
  action: string;
  category: 'station' | 'queue' | 'session' | 'location' | 'system' | 'unknown';
  stationId: number;
  additionalData?: number;
  index?: number;
}

// ===============================================
// BUTTON ID PATTERNS
// ===============================================

const BUTTON_PATTERNS = {
  // Station patterns
  BOOK_STATION: /^book_station_(\d+)$/,
  STATION_INFO: /^station_info_(\d+)$/,
  SELECT_STATION: /^select_station_(\d+)$/,
  GET_DIRECTIONS: /^get_directions_(\d+)$/,
  FIND_ALTERNATIVES: /^find_alternatives_(\d+)$/,
  
  // Queue patterns
  JOIN_QUEUE: /^join_queue_(\d+)$/,
  QUEUE_STATUS: /^queue_status_(\d+)$/,
  CANCEL_QUEUE: /^cancel_queue_(\d+)$/,
  CONFIRM_CANCEL: /^confirm_cancel_(\d+)$/,
  
  // Session patterns
  START_SESSION: /^start_session_(\d+)$/,
  START_CHARGING: /^start_charging_(\d+)$/,  // ✅ ADDED - Critical fix
  SESSION_STATUS: /^session_status_(\d+)$/,
  SESSION_STOP: /^session_stop_(\d+)$/,
  EXTEND_SESSION: /^extend_(\d+)_(\d+)$/, // extend_minutes_stationId
  
  // Location patterns
  RECENT_SEARCH: /^recent_search_(\d+)$/,
  
  // Rating patterns
  RATE_STATION: /^rate_(\d)_(\d+)$/, // rate_score_stationId
  
  // General patterns (less specific)
  GENERAL_STATION: /^(?:.*_)?station_(\d+)$/,
  GENERAL_ACTION: /^.*_(\d+)$/,
  NUMERIC_ONLY: /^(\d+)$/
};

// ===============================================
// MAIN PARSER FUNCTION
// ===============================================

/**
 * Parse button ID into structured result
 */
export function parseButtonId(buttonId: string): ButtonParseResult {
  if (!buttonId) {
    return createEmptyResult();
  }

  try {
    // Try specific patterns first (most specific to least specific)
    
    // Station patterns
    let match = buttonId.match(BUTTON_PATTERNS.BOOK_STATION);
    if (match) {
      return {
        action: 'book',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.STATION_INFO);
    if (match) {
      return {
        action: 'info',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.SELECT_STATION);
    if (match) {
      return {
        action: 'select',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.GET_DIRECTIONS);
    if (match) {
      return {
        action: 'directions',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.FIND_ALTERNATIVES);
    if (match) {
      return {
        action: 'alternatives',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    // Queue patterns
    match = buttonId.match(BUTTON_PATTERNS.JOIN_QUEUE);
    if (match) {
      return {
        action: 'join',
        category: 'queue',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.QUEUE_STATUS);
    if (match) {
      return {
        action: 'status',
        category: 'queue',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.CANCEL_QUEUE);
    if (match) {
      return {
        action: 'cancel',
        category: 'queue',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.CONFIRM_CANCEL);
    if (match) {
      return {
        action: 'confirm_cancel',
        category: 'queue',
        stationId: parseInt(match[1], 10)
      };
    }

    // Session patterns
    match = buttonId.match(BUTTON_PATTERNS.START_SESSION);
    if (match) {
      return {
        action: 'start',
        category: 'session',
        stationId: parseInt(match[1], 10)
      };
    }

    // ✅ CRITICAL FIX: Handle start_charging pattern
    match = buttonId.match(BUTTON_PATTERNS.START_CHARGING);
    if (match) {
      return {
        action: 'start_charging',
        category: 'session',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.SESSION_STATUS);
    if (match) {
      return {
        action: 'status',
        category: 'session',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.SESSION_STOP);
    if (match) {
      return {
        action: 'stop',
        category: 'session',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.EXTEND_SESSION);
    if (match) {
      return {
        action: 'extend',
        category: 'session',
        stationId: parseInt(match[2], 10),
        additionalData: parseInt(match[1], 10) // minutes
      };
    }

    // Location patterns
    match = buttonId.match(BUTTON_PATTERNS.RECENT_SEARCH);
    if (match) {
      return {
        action: 'recent_search',
        category: 'location',
        stationId: 0,
        index: parseInt(match[1], 10)
      };
    }

    // Rating patterns
    match = buttonId.match(BUTTON_PATTERNS.RATE_STATION);
    if (match) {
      return {
        action: 'rate',
        category: 'station',
        stationId: parseInt(match[2], 10),
        additionalData: parseInt(match[1], 10) // rating score
      };
    }

    // Generic patterns (fallback)
    match = buttonId.match(BUTTON_PATTERNS.GENERAL_STATION);
    if (match) {
      const parts = buttonId.split('_');
      return {
        action: parts[0] || 'unknown',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.GENERAL_ACTION);
    if (match) {
      const parts = buttonId.split('_');
      return {
        action: parts[0] || 'unknown',
        category: determineCategory(parts[0] || ''),
        stationId: parseInt(match[1], 10)
      };
    }

    match = buttonId.match(BUTTON_PATTERNS.NUMERIC_ONLY);
    if (match) {
      return {
        action: 'select',
        category: 'station',
        stationId: parseInt(match[1], 10)
      };
    }

    // No pattern matched - check for system buttons
    return parseSystemButton(buttonId);

  } catch (error) {
    logger.error('Button ID parsing failed', { 
      buttonId, 
      error: error instanceof Error ? error.message : String(error)
    });
    return createEmptyResult();
  }
}

// ===============================================
// HELPER FUNCTIONS
// ===============================================

/**
 * Create empty parsing result
 */
function createEmptyResult(): ButtonParseResult {
  return {
    action: 'unknown',
    category: 'unknown',
    stationId: 0
  };
}

/**
 * Determine category from action prefix
 */
function determineCategory(action: string): ButtonParseResult['category'] {
  const categoryMap: Record<string, ButtonParseResult['category']> = {
    'queue': 'queue',
    'session': 'session',
    'book': 'station',
    'station': 'station',
    'join': 'queue',
    'start': 'session',
    'extend': 'session',
    'cancel': 'queue',
    'rate': 'station',
    'share': 'location',
    'recent': 'location',
    'charging': 'session'  // ✅ Added for start_charging fallback
  };

  return categoryMap[action] || 'unknown';
}

/**
 * Parse system buttons (no station ID)
 */
function parseSystemButton(buttonId: string): ButtonParseResult {
  const systemButtons = [
    'help', 'profile', 'preferences', 'settings',
    'quick_book', 'find_stations', 'view_profile', 'update_profile',
    'share_gps_location', 'type_address', 'location_help',
    'recent_searches', 'next_station', 'load_more_stations',
    'show_all_nearby', 'expand_search', 'remove_filters', 'new_search'
  ];

  if (systemButtons.includes(buttonId)) {
    return {
      action: buttonId,
      category: 'system',
      stationId: 0
    };
  }

  // Check for location buttons
  const locationButtons = [
    'share_gps_location', 'type_address', 'location_help',
    'recent_searches', 'next_station', 'load_more_stations',
    'show_all_nearby', 'expand_search', 'remove_filters', 'new_search'
  ];

  if (locationButtons.includes(buttonId)) {
    return {
      action: buttonId.replace(/^(show_all_|load_more_|expand_|remove_|new_)/, ''),
      category: 'location',
      stationId: 0
    };
  }

  return createEmptyResult();
}

// ===============================================
// VALIDATION FUNCTIONS
// ===============================================

/**
 * Check if button ID is valid format
 */
export function isValidButtonId(buttonId: string): boolean {
  if (!buttonId || typeof buttonId !== 'string') {
    return false;
  }

  // Basic format validation
  return /^[a-zA-Z0-9_-]+$/.test(buttonId) && buttonId.length <= 50;
}

/**
 * Check if parsed result has valid station ID
 */
export function hasValidStationId(result: ButtonParseResult): boolean {
  return result.stationId > 0 && !isNaN(result.stationId);
}

/**
 * Check if button is queue/booking related
 */
export function isQueueButton(buttonId: string): boolean {
  const queuePrefixes = [
    'queue_', 'session_', 'join_', 'start_', 'extend_',
    'live_', 'rate_', 'share_', 'cancel_', 'confirm_',
    'nearby_', 'cheaper_', 'faster_', 'smart_', 'notify_'
  ];
  return queuePrefixes.some(prefix => buttonId.startsWith(prefix));
}

/**
 * Check if button is location related
 */
export function isLocationButton(buttonId: string): boolean {
  const locationButtons = [
    'share_gps_location', 'type_address', 'try_different_address',
    'location_help', 'recent_searches', 'next_station',
    'load_more_stations', 'show_all_nearby', 'show_all_results',
    'expand_search', 'remove_filters', 'new_search'
  ];
  
  // ✅ REMOVED 'start_charging' from location buttons - it's a session button
  return locationButtons.includes(buttonId) || buttonId.startsWith('recent_search_');
}

/**
 * Check if button is station related
 */
export function isStationButton(buttonId: string): boolean {
  const stationPrefixes = [
    'book_station_', 'station_info_', 'select_station_',
    'get_directions_', 'find_alternatives_', 'rate_'
  ];
  return stationPrefixes.some(prefix => buttonId.startsWith(prefix));
}

/**
 * ✅ NEW: Check if button is session related
 */
export function isSessionButton(buttonId: string): boolean {
  const sessionPrefixes = [
    'start_session_', 'start_charging_', 'session_status_', 
    'session_stop_', 'extend_'
  ];
  return sessionPrefixes.some(prefix => buttonId.startsWith(prefix));
}

// ===============================================
// DEBUGGING UTILITIES
// ===============================================

/**
 * Get human-readable description of parsed button
 */
export function getButtonDescription(result: ButtonParseResult): string {
  const { action, category, stationId, additionalData } = result;
  
  let description = `${action} action in ${category} category`;
  
  if (stationId > 0) {
    description += ` for station ${stationId}`;
  }
  
  if (additionalData !== undefined) {
    description += ` with data ${additionalData}`;
  }
  
  return description;
}

/**
 * Log button parsing for debugging
 */
export function logButtonParsing(buttonId: string, result: ButtonParseResult): void {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Button parsed', {
      buttonId,
      result,
      description: getButtonDescription(result)
    });
  }
}
