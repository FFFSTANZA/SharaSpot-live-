// src/owner/utils/owner-button-parser.ts
import { logger } from './logger';

export interface OwnerButtonParseResult {
  action: string;
  category: 'auth' | 'main' | 'station' | 'profile' | 'analytics' | 'system';
  stationId?: number;
  additionalData?: any;
}

/**
 * Parse owner-specific button IDs to extract action and context
 */
export function parseOwnerButtonId(buttonId: string): OwnerButtonParseResult {
  try {
    // Remove 'owner_' prefix if present
    const cleanId = buttonId.replace(/^owner_/, '');
    
    // Split by underscore
    const parts = cleanId.split('_');
    const action = parts[0];

    // Authentication actions
    if (['register', 'login', 'help', 'contact_support'].includes(action)) {
      return {
        action,
        category: 'auth'
      };
    }

    // Main menu actions
    if (['stations', 'profile', 'analytics', 'settings', 'main', 'menu'].includes(action)) {
      return {
        action: action === 'menu' ? 'main_menu' : action,
        category: 'main'
      };
    }

    // Edit actions
    if (['edit', 'update'].includes(action)) {
      const target = parts[1];
      return {
        action: `${action}_${target}`,
        category: target === 'profile' ? 'profile' : 'main'
      };
    }

    // Station-specific actions
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

    // Toggle actions with station ID
    if (action === 'toggle' && parts.includes('station')) {
      const stationId = parseInt(parts[parts.length - 1], 10);
      return {
        action: 'toggle_station',
        category: 'station',
        stationId: !isNaN(stationId) ? stationId : undefined
      };
    }

    // Add station action
    if (action === 'add' && parts[1] === 'station') {
      return {
        action: 'add_station',
        category: 'station'
      };
    }

    // Analytics actions
    if (['analytics', 'stats', 'reports'].includes(action)) {
      const detail = parts[1];
      return {
        action: detail ? `${action}_${detail}` : action,
        category: 'analytics'
      };
    }

    // KYC actions
    if (action === 'kyc') {
      return {
        action: parts.join('_'),
        category: 'profile'
      };
    }

    // Navigation actions
    if (['exit', 'back', 'return', 'main'].includes(action)) {
      return {
        action: parts.join('_'),
        category: 'system'
      };
    }

    // System actions
    if (['help', 'contact', 'support'].includes(action)) {
      return {
        action: parts.join('_'),
        category: 'system'
      };
    }

    // Default parsing for unknown patterns
    return {
      action: parts.join('_'),
      category: 'main'
    };

  } catch (error) {
    logger.error('Owner button ID parsing failed', { buttonId, error });
    return {
      action: 'unknown',
      category: 'system'
    };
  }
}

/**
 * Generate button ID for owner actions
 */
export function generateOwnerButtonId(
  action: string, 
  category: 'auth' | 'main' | 'station' | 'profile' | 'analytics' | 'system',
  stationId?: number,
  additionalData?: any
): string {
  let buttonId = `owner_${action}`;
  
  if (stationId && category === 'station') {
    buttonId += `_station_${stationId}`;
  }
  
  if (additionalData) {
    buttonId += `_${JSON.stringify(additionalData)}`;
  }
  
  return buttonId;
}

/**
 * Check if button ID is for owner flow
 */
export function isOwnerButton(buttonId: string): boolean {
  return buttonId.startsWith('owner_');
}