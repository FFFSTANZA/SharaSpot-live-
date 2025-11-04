"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OwnerPermissionLevel = exports.StationManagementAction = exports.OwnerAuthMethod = exports.OwnerFlowState = exports.OwnerMessageFormatter = exports.stationUpdateSchema = exports.ownerProfileSchema = void 0;
exports.validateOwnerProfile = validateOwnerProfile;
exports.validateStationUpdate = validateStationUpdate;
const zod_1 = require("zod");
exports.ownerProfileSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters').max(100),
    businessName: zod_1.z.string().min(2, 'Business name must be at least 2 characters').max(100).optional(),
    phoneNumber: zod_1.z.string().regex(/^91\d{10}$/, 'Invalid phone number format'),
    email: zod_1.z.string().email('Invalid email format').optional(),
    businessType: zod_1.z.enum(['individual', 'partnership', 'company', 'other']).optional(),
    gstNumber: zod_1.z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST format').optional(),
    panNumber: zod_1.z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format').optional()
});
exports.stationUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(100).optional(),
    pricePerKwh: zod_1.z.number().min(0).max(100).optional(),
    operatingHours: zod_1.z.object({
        open: zod_1.z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
        close: zod_1.z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
        is24x7: zod_1.z.boolean().optional()
    }).optional(),
    isActive: zod_1.z.boolean().optional()
});
function validateOwnerProfile(data) {
    try {
        exports.ownerProfileSchema.parse(data);
        return { isValid: true, errors: [] };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                isValid: false,
                errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
            };
        }
        return { isValid: false, errors: ['Validation failed'] };
    }
}
function validateStationUpdate(data) {
    try {
        exports.stationUpdateSchema.parse(data);
        return { isValid: true, errors: [] };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                isValid: false,
                errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
            };
        }
        return { isValid: false, errors: ['Validation failed'] };
    }
}
class OwnerMessageFormatter {
    static formatStationStatus(station, analytics) {
        const utilizationColor = analytics?.utilizationRate > 80 ? '🔴' :
            analytics?.utilizationRate > 50 ? '🟡' : '🟢';
        return (`🔌 *${station.name}*\n\n` +
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
            `💡 *Price:* ₹${station.pricePerKwh}/kWh`);
    }
    static formatAnalyticsSummary(analytics) {
        const growthEmoji = analytics.weekGrowth > 0 ? '📈' :
            analytics.weekGrowth < 0 ? '📉' : '📊';
        return (`📊 *Performance Overview*\n\n` +
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
            `• ${analytics.repeatCustomers}% repeat customers`);
    }
    static formatOwnerProfile(profile) {
        const verificationStatus = profile.isVerified ? '✅ Verified' :
            profile.kycStatus === 'pending' ? '⏳ Pending' :
                profile.kycStatus === 'rejected' ? '❌ Rejected' : '📋 Required';
        return (`👤 *${profile.name}*\n` +
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
            `📅 *Joined:* ${new Date(profile.createdAt).toLocaleDateString()}`);
    }
    static formatStationList(stations) {
        if (!stations.length) {
            return '📭 *No Stations Found*\n\nYou haven\'t registered any charging stations yet.';
        }
        const stationList = stations.map((station, index) => `${index + 1}. *${station.name}*\n` +
            `   📍 ${station.address.substring(0, 50)}${station.address.length > 50 ? '...' : ''}\n` +
            `   ${station.isActive ? '🟢 Active' : '🔴 Inactive'} • ` +
            `${station.isOpen ? '🔓 Open' : '🔒 Closed'}\n` +
            `   💡 ${station.availableSlots}/${station.totalSlots} slots • ` +
            `₹${station.pricePerKwh}/kWh\n`).join('\n');
        return (`🔌 *Your Charging Stations (${stations.length})*\n\n` +
            stationList +
            `\n💡 Select a station below to manage it.`);
    }
    static formatError(error, context) {
        const contextText = context ? `\n\n📍 *Context:* ${context}` : '';
        return (`🏢 *Owner Portal Error*\n\n` +
            `❌ ${error}${contextText}\n\n` +
            `💡 *Need help?* Type "help" or contact support.`);
    }
    static formatSuccess(message, details) {
        const detailsText = details ? `\n\n📋 *Details:* ${details}` : '';
        return (`🏢 *Owner Portal*\n\n` +
            `✅ ${message}${detailsText}\n\n` +
            `🎉 Changes have been applied successfully!`);
    }
}
exports.OwnerMessageFormatter = OwnerMessageFormatter;
var OwnerFlowState;
(function (OwnerFlowState) {
    OwnerFlowState["AUTH_REQUIRED"] = "auth_required";
    OwnerFlowState["AUTHENTICATING"] = "authenticating";
    OwnerFlowState["MAIN_MENU"] = "main_menu";
    OwnerFlowState["STATION_MANAGEMENT"] = "station_management";
    OwnerFlowState["STATION_DETAILS"] = "station_details";
    OwnerFlowState["STATION_SETTINGS"] = "station_settings";
    OwnerFlowState["PROFILE_MANAGEMENT"] = "profile_management";
    OwnerFlowState["PROFILE_EDIT"] = "profile_edit";
    OwnerFlowState["ANALYTICS"] = "analytics";
    OwnerFlowState["ANALYTICS_DETAILED"] = "analytics_detailed";
    OwnerFlowState["SETTINGS"] = "settings";
    OwnerFlowState["HELP"] = "help";
    OwnerFlowState["EXITING"] = "exiting";
})(OwnerFlowState || (exports.OwnerFlowState = OwnerFlowState = {}));
var OwnerAuthMethod;
(function (OwnerAuthMethod) {
    OwnerAuthMethod["BUSINESS_NAME"] = "business_name";
    OwnerAuthMethod["PHONE_NUMBER"] = "phone_number";
    OwnerAuthMethod["EMAIL"] = "email";
    OwnerAuthMethod["OWNER_ID"] = "owner_id";
})(OwnerAuthMethod || (exports.OwnerAuthMethod = OwnerAuthMethod = {}));
var StationManagementAction;
(function (StationManagementAction) {
    StationManagementAction["VIEW_STATUS"] = "view_status";
    StationManagementAction["TOGGLE_ACTIVE"] = "toggle_active";
    StationManagementAction["UPDATE_PRICE"] = "update_price";
    StationManagementAction["UPDATE_HOURS"] = "update_hours";
    StationManagementAction["VIEW_QUEUE"] = "view_queue";
    StationManagementAction["VIEW_ANALYTICS"] = "view_analytics";
    StationManagementAction["EDIT_DETAILS"] = "edit_details";
})(StationManagementAction || (exports.StationManagementAction = StationManagementAction = {}));
var OwnerPermissionLevel;
(function (OwnerPermissionLevel) {
    OwnerPermissionLevel["OWNER"] = "owner";
    OwnerPermissionLevel["MANAGER"] = "manager";
    OwnerPermissionLevel["OPERATOR"] = "operator";
    OwnerPermissionLevel["VIEWER"] = "viewer";
})(OwnerPermissionLevel || (exports.OwnerPermissionLevel = OwnerPermissionLevel = {}));
//# sourceMappingURL=owner-validators.js.map