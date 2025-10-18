"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseButtonId = parseButtonId;
exports.isValidButtonId = isValidButtonId;
exports.hasValidStationId = hasValidStationId;
exports.isQueueButton = isQueueButton;
exports.isLocationButton = isLocationButton;
exports.isStationButton = isStationButton;
exports.isSessionButton = isSessionButton;
exports.getButtonDescription = getButtonDescription;
exports.logButtonParsing = logButtonParsing;
const logger_1 = require("./logger");
const BUTTON_PATTERNS = {
    BOOK_STATION: /^book_station_(\d+)$/,
    STATION_INFO: /^station_info_(\d+)$/,
    SELECT_STATION: /^select_station_(\d+)$/,
    GET_DIRECTIONS: /^get_directions_(\d+)$/,
    FIND_ALTERNATIVES: /^find_alternatives_(\d+)$/,
    JOIN_QUEUE: /^join_queue_(\d+)$/,
    QUEUE_STATUS: /^queue_status_(\d+)$/,
    CANCEL_QUEUE: /^cancel_queue_(\d+)$/,
    CONFIRM_CANCEL: /^confirm_cancel_(\d+)$/,
    START_SESSION: /^start_session_(\d+)$/,
    START_CHARGING: /^start_charging_(\d+)$/,
    SESSION_STATUS: /^session_status_(\d+)$/,
    SESSION_STOP: /^session_stop_(\d+)$/,
    EXTEND_SESSION: /^extend_(\d+)_(\d+)$/,
    RECENT_SEARCH: /^recent_search_(\d+)$/,
    RATE_STATION: /^rate_(\d)_(\d+)$/,
    GENERAL_STATION: /^(?:.*_)?station_(\d+)$/,
    GENERAL_ACTION: /^.*_(\d+)$/,
    NUMERIC_ONLY: /^(\d+)$/
};
function parseButtonId(buttonId) {
    if (!buttonId) {
        return createEmptyResult();
    }
    try {
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
        match = buttonId.match(BUTTON_PATTERNS.START_SESSION);
        if (match) {
            return {
                action: 'start',
                category: 'session',
                stationId: parseInt(match[1], 10)
            };
        }
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
                additionalData: parseInt(match[1], 10)
            };
        }
        match = buttonId.match(BUTTON_PATTERNS.RECENT_SEARCH);
        if (match) {
            return {
                action: 'recent_search',
                category: 'location',
                stationId: 0,
                index: parseInt(match[1], 10)
            };
        }
        match = buttonId.match(BUTTON_PATTERNS.RATE_STATION);
        if (match) {
            return {
                action: 'rate',
                category: 'station',
                stationId: parseInt(match[2], 10),
                additionalData: parseInt(match[1], 10)
            };
        }
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
        return parseSystemButton(buttonId);
    }
    catch (error) {
        logger_1.logger.error('Button ID parsing failed', {
            buttonId,
            error: error instanceof Error ? error.message : String(error)
        });
        return createEmptyResult();
    }
}
function createEmptyResult() {
    return {
        action: 'unknown',
        category: 'unknown',
        stationId: 0
    };
}
function determineCategory(action) {
    const categoryMap = {
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
        'charging': 'session'
    };
    return categoryMap[action] || 'unknown';
}
function parseSystemButton(buttonId) {
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
function isValidButtonId(buttonId) {
    if (!buttonId || typeof buttonId !== 'string') {
        return false;
    }
    return /^[a-zA-Z0-9_-]+$/.test(buttonId) && buttonId.length <= 50;
}
function hasValidStationId(result) {
    return result.stationId > 0 && !isNaN(result.stationId);
}
function isQueueButton(buttonId) {
    const queuePrefixes = [
        'queue_', 'session_', 'join_', 'start_', 'extend_',
        'live_', 'rate_', 'share_', 'cancel_', 'confirm_',
        'nearby_', 'cheaper_', 'faster_', 'smart_', 'notify_'
    ];
    return queuePrefixes.some(prefix => buttonId.startsWith(prefix));
}
function isLocationButton(buttonId) {
    const locationButtons = [
        'share_gps_location', 'type_address', 'try_different_address',
        'location_help', 'recent_searches', 'next_station',
        'load_more_stations', 'show_all_nearby', 'show_all_results',
        'expand_search', 'remove_filters', 'new_search'
    ];
    return locationButtons.includes(buttonId) || buttonId.startsWith('recent_search_');
}
function isStationButton(buttonId) {
    const stationPrefixes = [
        'book_station_', 'station_info_', 'select_station_',
        'get_directions_', 'find_alternatives_', 'rate_'
    ];
    return stationPrefixes.some(prefix => buttonId.startsWith(prefix));
}
function isSessionButton(buttonId) {
    const sessionPrefixes = [
        'start_session_', 'start_charging_', 'session_status_',
        'session_stop_', 'extend_'
    ];
    return sessionPrefixes.some(prefix => buttonId.startsWith(prefix));
}
function getButtonDescription(result) {
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
function logButtonParsing(buttonId, result) {
    if (process.env.NODE_ENV === 'development') {
        logger_1.logger.debug('Button parsed', {
            buttonId,
            result,
            description: getButtonDescription(result)
        });
    }
}
//# sourceMappingURL=button-parser.js.map