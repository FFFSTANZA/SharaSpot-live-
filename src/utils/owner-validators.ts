// src/owner/utils/owner-validators.ts - Owner Data Validation
import { z } from 'zod';

export const ownerProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  businessName: z.string().min(2, 'Business name must be at least 2 characters').max(100).optional(),
  phoneNumber: z.string().regex(/^91\d{10}$/, 'Invalid phone number format'),
  email: z.string().email('Invalid email format').optional(),
  businessType: z.enum(['individual', 'partnership', 'company', 'other']).optional(),
  gstNumber: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST format').optional(),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format').optional()
});

export const stationUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  pricePerKwh: z.number().min(0).max(100).optional(),
  operatingHours: z.object({
    open: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
    close: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
    is24x7: z.boolean().optional()
  }).optional(),
  isActive: z.boolean().optional()
});

export function validateOwnerProfile(data: any): { isValid: boolean; errors: string[] } {
  try {
    ownerProfileSchema.parse(data);
    return { isValid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
      };
    }
    return { isValid: false, errors: ['Validation failed'] };
  }
}

export function validateStationUpdate(data: any): { isValid: boolean; errors: string[] } {
  try {
    stationUpdateSchema.parse(data);
    return { isValid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
      };
    }
    return { isValid: false, errors: ['Validation failed'] };
  }
}

// ===============================================
// src/owner/utils/owner-formatters.ts - Message Formatting
// ===============================================

export class OwnerMessageFormatter {
  
  /**
   * Format station status message
   */
  static formatStationStatus(station: any, analytics: any): string {
    const utilizationColor = analytics?.utilizationRate > 80 ? '🔴' : 
                           analytics?.utilizationRate > 50 ? '🟡' : '🟢';
    
    return (
      `🔌 *${station.name}*\n\n` +
      `📊 *Current Status:*\n` +
      `• ${station.isActive ? '🟢 Active' : '🔴 Inactive'} • ${station.isOpen ? 'Open' : 'Closed'}\n` +
      `• Available: ${station.availableSlots}/${station.totalSlots} slots\n` +
      `• Queue: ${analytics?.queueLength || 0} waiting\n` +
      `• Utilization: ${utilizationColor} ${analytics?.utilizationRate || 0}%\n\n` +
      `💰 *Today's Performance:*\n` +
      `• Sessions: ${analytics?.todaySessions || 0}\n` +
      `• Revenue: ₹${analytics?.todayRevenue || 0}\n` +
      `• Energy: ${analytics?.todayEnergy || 0} kWh\n\n` +
      `📍 *Location:* ${station.address}\n` +
      `💡 *Price:* ₹${station.pricePerKwh}/kWh`
    );
  }

  /**
   * Format owner analytics summary
   */
  static formatAnalyticsSummary(analytics: any): string {
    const growthEmoji = analytics.weekGrowth > 0 ? '📈' : 
                       analytics.weekGrowth < 0 ? '📉' : '📊';
    
    return (
      `📊 *Performance Overview*\n\n` +
      `🌟 *Today's Highlights:*\n` +
      `• ${analytics.todaySessions} charging sessions\n` +
      `• ₹${analytics.todayRevenue} revenue earned\n` +
      `• ${analytics.todayEnergy} kWh energy delivered\n` +
      `• ${analytics.avgSessionDuration} min avg duration\n\n` +
      `📅 *Weekly Trends:*\n` +
      `• ${analytics.weekSessions} total sessions\n` +
      `• ₹${analytics.weekRevenue} total revenue\n` +
      `• ${growthEmoji} ${Math.abs(analytics.weekGrowth)}% growth\n\n` +
      `🏆 *Best Performer:*\n` +
      `• Station: ${analytics.bestStationName}\n` +
      `• Avg Utilization: ${analytics.avgUtilization}%\n` +
      `• Peak Hours: ${analytics.peakHours}\n\n` +
      `⭐ *Customer Satisfaction:*\n` +
      `• ${analytics.averageRating}/5.0 rating\n` +
      `• ${analytics.totalReviews} total reviews\n` +
      `• ${analytics.repeatCustomers}% repeat customers`
    );
  }

  /**
   * Format owner profile display
   */
  static formatOwnerProfile(profile: any): string {
    const verificationStatus = profile.isVerified ? '✅ Verified' : 
                             profile.kycStatus === 'pending' ? '⏳ Pending' : 
                             profile.kycStatus === 'rejected' ? '❌ Rejected' : '📋 Required';
    
    return (
      `👤 *${profile.name}*\n` +
      `🏢 ${profile.businessName || 'Individual Owner'}\n\n` +
      `📋 *Business Details:*\n` +
      `• Type: ${profile.businessType || 'Not specified'}\n` +
      `• GST: ${profile.gstNumber || 'Not provided'}\n` +
      `• PAN: ${profile.panNumber || 'Not provided'}\n` +
      `• Phone: ${profile.phoneNumber}\n` +
      `• Email: ${profile.email || 'Not specified'}\n\n` +
      `📊 *Account Status:*\n` +
      `• Status: ${profile.isActive ? '🟢 Active' : '🔴 Inactive'}\n` +
      `• Verification: ${verificationStatus}\n` +
      `• Stations: ${profile.totalStations}\n` +
      `• Total Revenue: ₹${profile.totalRevenue}\n` +
      `• Rating: ${profile.averageRating}/5.0 ⭐\n\n` +
      `📅 *Joined:* ${new Date(profile.createdAt).toLocaleDateString()}`
    );
  }

  /**
   * Format station list for selection
   */
  static formatStationList(stations: any[]): string {
    if (!stations.length) {
      return '📭 *No Stations Found*\n\nYou haven\'t registered any charging stations yet.';
    }

    const stationList = stations.map((station, index) => 
      `${index + 1}. *${station.name}*\n` +
      `   📍 ${station.address.substring(0, 50)}${station.address.length > 50 ? '...' : ''}\n` +
      `   ${station.isActive ? '🟢 Active' : '🔴 Inactive'} • ` +
      `${station.isOpen ? '🔓 Open' : '🔒 Closed'}\n` +
      `   💡 ${station.availableSlots}/${station.totalSlots} slots • ` +
      `₹${station.pricePerKwh}/kWh\n`
    ).join('\n');

    return (
      `🔌 *Your Charging Stations (${stations.length})*\n\n` +
      stationList +
      `\n💡 Select a station below to manage it.`
    );
  }

  /**
   * Format error messages for owner flow
   */
  static formatError(error: string, context?: string): string {
    const contextText = context ? `\n\n📍 *Context:* ${context}` : '';
    return (
      `🏢 *Owner Portal Error*\n\n` +
      `❌ ${error}${contextText}\n\n` +
      `💡 *Need help?* Type "help" or contact support.`
    );
  }

  /**
   * Format success messages
   */
  static formatSuccess(message: string, details?: string): string {
    const detailsText = details ? `\n\n📋 *Details:* ${details}` : '';
    return (
      `🏢 *Owner Portal*\n\n` +
      `✅ ${message}${detailsText}\n\n` +
      `🎉 Changes have been applied successfully!`
    );
  }
}

// ===============================================
// src/owner/types/owner-interfaces.ts - TypeScript Interfaces
// ===============================================

export interface OwnerContext {
  whatsappId: string;
  currentState: OwnerFlowState;
  isAuthenticated: boolean;
  ownerId?: number;
  selectedStationId?: number;
  waitingFor?: string;
  sessionData?: Record<string, any>;
  lastActivity: Date;
  preferences?: OwnerPreferences;
}

export interface OwnerPreferences {
  notifications: {
    sessionStart: boolean;
    sessionEnd: boolean;
    queueUpdates: boolean;
    dailyReport: boolean;
    weeklyReport: boolean;
  };
  dashboard: {
    defaultView: 'overview' | 'stations' | 'analytics';
    autoRefresh: boolean;
    refreshInterval: number;
  };
  alerts: {
    lowUtilization: boolean;
    highQueue: boolean;
    stationOffline: boolean;
    revenueThreshold: number;
  };
}

export interface StationManagementOptions {
  stationId: number;
  action: 'toggle_status' | 'update_price' | 'update_hours' | 'view_queue' | 'view_analytics';
  newValue?: any;
}

export interface OwnerAnalyticsFilter {
  timeRange: 'today' | 'week' | 'month' | 'custom';
  stationIds?: number[];
  metrics: ('sessions' | 'revenue' | 'energy' | 'utilization')[];
  customRange?: {
    startDate: Date;
    endDate: Date;
  };
}

// ===============================================
// src/owner/types/owner-enums.ts - Enums
// ===============================================

export enum OwnerFlowState {
  AUTH_REQUIRED = 'auth_required',
  AUTHENTICATING = 'authenticating',
  MAIN_MENU = 'main_menu',
  STATION_MANAGEMENT = 'station_management',
  STATION_DETAILS = 'station_details',
  STATION_SETTINGS = 'station_settings',
  PROFILE_MANAGEMENT = 'profile_management',
  PROFILE_EDIT = 'profile_edit',
  ANALYTICS = 'analytics',
  ANALYTICS_DETAILED = 'analytics_detailed',
  SETTINGS = 'settings',
  HELP = 'help',
  EXITING = 'exiting'
}

export enum OwnerAuthMethod {
  BUSINESS_NAME = 'business_name',
  PHONE_NUMBER = 'phone_number',
  EMAIL = 'email',
  OWNER_ID = 'owner_id'
}

export enum StationManagementAction {
  VIEW_STATUS = 'view_status',
  TOGGLE_ACTIVE = 'toggle_active',
  UPDATE_PRICE = 'update_price',
  UPDATE_HOURS = 'update_hours',
  VIEW_QUEUE = 'view_queue',
  VIEW_ANALYTICS = 'view_analytics',
  EDIT_DETAILS = 'edit_details'
}

export enum OwnerPermissionLevel {
  OWNER = 'owner',
  MANAGER = 'manager',
  OPERATOR = 'operator',
  VIEWER = 'viewer'
}

