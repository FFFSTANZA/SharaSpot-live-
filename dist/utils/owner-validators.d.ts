import { z } from 'zod';
export declare const ownerProfileSchema: z.ZodObject<{
    name: z.ZodString;
    businessName: z.ZodOptional<z.ZodString>;
    phoneNumber: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    businessType: z.ZodOptional<z.ZodEnum<["individual", "partnership", "company", "other"]>>;
    gstNumber: z.ZodOptional<z.ZodString>;
    panNumber: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    phoneNumber: string;
    email?: string | undefined;
    businessName?: string | undefined;
    businessType?: "individual" | "partnership" | "company" | "other" | undefined;
    gstNumber?: string | undefined;
    panNumber?: string | undefined;
}, {
    name: string;
    phoneNumber: string;
    email?: string | undefined;
    businessName?: string | undefined;
    businessType?: "individual" | "partnership" | "company" | "other" | undefined;
    gstNumber?: string | undefined;
    panNumber?: string | undefined;
}>;
export declare const stationUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    pricePerKwh: z.ZodOptional<z.ZodNumber>;
    operatingHours: z.ZodOptional<z.ZodObject<{
        open: z.ZodString;
        close: z.ZodString;
        is24x7: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        close: string;
        open: string;
        is24x7?: boolean | undefined;
    }, {
        close: string;
        open: string;
        is24x7?: boolean | undefined;
    }>>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    isActive?: boolean | undefined;
    pricePerKwh?: number | undefined;
    operatingHours?: {
        close: string;
        open: string;
        is24x7?: boolean | undefined;
    } | undefined;
}, {
    name?: string | undefined;
    isActive?: boolean | undefined;
    pricePerKwh?: number | undefined;
    operatingHours?: {
        close: string;
        open: string;
        is24x7?: boolean | undefined;
    } | undefined;
}>;
export declare function validateOwnerProfile(data: any): {
    isValid: boolean;
    errors: string[];
};
export declare function validateStationUpdate(data: any): {
    isValid: boolean;
    errors: string[];
};
export declare class OwnerMessageFormatter {
    static formatStationStatus(station: any, analytics: any): string;
    static formatAnalyticsSummary(analytics: any): string;
    static formatOwnerProfile(profile: any): string;
    static formatStationList(stations: any[]): string;
    static formatError(error: string, context?: string): string;
    static formatSuccess(message: string, details?: string): string;
}
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
export declare enum OwnerFlowState {
    AUTH_REQUIRED = "auth_required",
    AUTHENTICATING = "authenticating",
    MAIN_MENU = "main_menu",
    STATION_MANAGEMENT = "station_management",
    STATION_DETAILS = "station_details",
    STATION_SETTINGS = "station_settings",
    PROFILE_MANAGEMENT = "profile_management",
    PROFILE_EDIT = "profile_edit",
    ANALYTICS = "analytics",
    ANALYTICS_DETAILED = "analytics_detailed",
    SETTINGS = "settings",
    HELP = "help",
    EXITING = "exiting"
}
export declare enum OwnerAuthMethod {
    BUSINESS_NAME = "business_name",
    PHONE_NUMBER = "phone_number",
    EMAIL = "email",
    OWNER_ID = "owner_id"
}
export declare enum StationManagementAction {
    VIEW_STATUS = "view_status",
    TOGGLE_ACTIVE = "toggle_active",
    UPDATE_PRICE = "update_price",
    UPDATE_HOURS = "update_hours",
    VIEW_QUEUE = "view_queue",
    VIEW_ANALYTICS = "view_analytics",
    EDIT_DETAILS = "edit_details"
}
export declare enum OwnerPermissionLevel {
    OWNER = "owner",
    MANAGER = "manager",
    OPERATOR = "operator",
    VIEWER = "viewer"
}
//# sourceMappingURL=owner-validators.d.ts.map