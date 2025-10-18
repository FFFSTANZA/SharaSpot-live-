"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseOwnerButtonId = parseOwnerButtonId;
exports.generateOwnerButtonId = generateOwnerButtonId;
exports.isOwnerButton = isOwnerButton;
const logger_1 = require("./logger");
function parseOwnerButtonId(buttonId) {
    try {
        const cleanId = buttonId.replace(/^owner_/, '');
        const parts = cleanId.split('_');
        const action = parts[0];
        if (['register', 'login', 'help', 'contact_support'].includes(action)) {
            return {
                action,
                category: 'auth'
            };
        }
        if (['stations', 'profile', 'analytics', 'settings', 'main', 'menu'].includes(action)) {
            return {
                action: action === 'menu' ? 'main_menu' : action,
                category: 'main'
            };
        }
        if (['edit', 'update'].includes(action)) {
            const target = parts[1];
            return {
                action: `${action}_${target}`,
                category: target === 'profile' ? 'profile' : 'main'
            };
        }
        if (action === 'station' || parts.includes('station')) {
            const stationIndex = parts.findIndex(part => part === 'station');
            const stationId = stationIndex >= 0 && parts[stationIndex + 1] ?
                parseInt(parts[stationIndex + 1], 10) : undefined;
            return {
                action: parts.slice(0, stationIndex).join('_') || action,
                category: 'station',
                stationId
            };
        }
        if (action === 'toggle' && parts.includes('station')) {
            const stationId = parseInt(parts[parts.length - 1], 10);
            return {
                action: 'toggle_station',
                category: 'station',
                stationId: !isNaN(stationId) ? stationId : undefined
            };
        }
        if (action === 'add' && parts[1] === 'station') {
            return {
                action: 'add_station',
                category: 'station'
            };
        }
        if (['analytics', 'stats', 'reports'].includes(action)) {
            const detail = parts[1];
            return {
                action: detail ? `${action}_${detail}` : action,
                category: 'analytics'
            };
        }
        if (action === 'kyc') {
            return {
                action: parts.join('_'),
                category: 'profile'
            };
        }
        if (['exit', 'back', 'return', 'main'].includes(action)) {
            return {
                action: parts.join('_'),
                category: 'system'
            };
        }
        if (['help', 'contact', 'support'].includes(action)) {
            return {
                action: parts.join('_'),
                category: 'system'
            };
        }
        return {
            action: parts.join('_'),
            category: 'main'
        };
    }
    catch (error) {
        logger_1.logger.error('Owner button ID parsing failed', { buttonId, error });
        return {
            action: 'unknown',
            category: 'system'
        };
    }
}
function generateOwnerButtonId(action, category, stationId, additionalData) {
    let buttonId = `owner_${action}`;
    if (stationId && category === 'station') {
        buttonId += `_station_${stationId}`;
    }
    if (additionalData) {
        buttonId += `_${JSON.stringify(additionalData)}`;
    }
    return buttonId;
}
function isOwnerButton(buttonId) {
    return buttonId.startsWith('owner_');
}
//# sourceMappingURL=owner-button-parser.js.map