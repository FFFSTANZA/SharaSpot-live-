"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerWebhookController = exports.OwnerWebhookController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const owner_service_1 = require("../services/owner-service");
const owner_auth_service_1 = require("../services/owner-auth-service");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
const owner_button_parser_1 = require("../utils/owner-button-parser");
var OwnerFlowState;
(function (OwnerFlowState) {
    OwnerFlowState["AUTH_REQUIRED"] = "auth_required";
    OwnerFlowState["MAIN_MENU"] = "main_menu";
    OwnerFlowState["STATION_MANAGEMENT"] = "station_management";
    OwnerFlowState["PROFILE_MANAGEMENT"] = "profile_management";
    OwnerFlowState["ANALYTICS"] = "analytics";
    OwnerFlowState["SETTINGS"] = "settings";
})(OwnerFlowState || (OwnerFlowState = {}));
class OwnerWebhookController {
    constructor() {
        this.ownerContexts = new Map();
        this.CONTEXT_TIMEOUT = 30 * 60 * 1000;
    }
    async enterOwnerMode(whatsappId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID in owner flow', { whatsappId });
            return;
        }
        logger_1.logger.info('🏢 Owner mode activated', { whatsappId });
        let context = this.getOwnerContext(whatsappId);
        if (!context) {
            context = this.createOwnerContext(whatsappId);
        }
        const isAuthenticated = await owner_auth_service_1.ownerAuthService.isAuthenticated(whatsappId);
        if (isAuthenticated) {
            context.isAuthenticated = true;
            context.currentState = OwnerFlowState.MAIN_MENU;
            await this.showOwnerMainMenu(whatsappId);
        }
        else {
            context.currentState = OwnerFlowState.AUTH_REQUIRED;
            await this.showOwnerAuthentication(whatsappId);
        }
        this.updateContext(whatsappId, context);
    }
    async handleOwnerMessage(whatsappId, messageType, content) {
        const context = this.getOwnerContext(whatsappId);
        if (!context) {
            return;
        }
        try {
            context.lastActivity = new Date();
            this.updateContext(whatsappId, context);
            switch (messageType) {
                case 'text':
                    await this.handleOwnerText(whatsappId, content, context);
                    break;
                case 'button':
                    await this.handleOwnerButton(whatsappId, content, context);
                    break;
                case 'list':
                    await this.handleOwnerList(whatsappId, content, context);
                    break;
                default:
                    await this.sendOwnerError(whatsappId, 'Unsupported message type in owner mode.');
            }
        }
        catch (error) {
            logger_1.logger.error('Owner message handling failed', { whatsappId, error });
            await this.sendOwnerError(whatsappId, 'Something went wrong. Please try again.');
        }
    }
    async handleOwnerText(whatsappId, text, context) {
        const cleanText = text.toLowerCase().trim();
        if (cleanText === 'exit' || cleanText === 'quit' || cleanText === 'back') {
            await this.exitOwnerMode(whatsappId);
            return;
        }
        if (context.waitingFor === 'business_name') {
            const trimmedText = text.trim();
            if (trimmedText.length < 3) {
                await this.sendOwnerError(whatsappId, 'Please provide valid business information (minimum 3 characters).');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔍 Authenticating...');
            const authenticated = await owner_auth_service_1.ownerAuthService.authenticateByBusinessName(whatsappId, trimmedText);
            if (authenticated) {
                context.isAuthenticated = true;
                context.currentState = OwnerFlowState.MAIN_MENU;
                context.waitingFor = undefined;
                this.updateContext(whatsappId, context);
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '✅ Authentication successful!');
                setTimeout(() => this.showOwnerMainMenu(whatsappId), 1000);
            }
            else {
                context.waitingFor = undefined;
                this.updateContext(whatsappId, context);
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Authentication failed. Please check your business name or contact support.');
                setTimeout(() => this.showOwnerAuthentication(whatsappId), 2000);
            }
            return;
        }
        const commands = {
            'help': () => this.showOwnerHelp(whatsappId),
            'menu': () => this.showOwnerMainMenu(whatsappId),
            'stations': () => this.showStationManagement(whatsappId),
            'profile': () => this.showOwnerProfile(whatsappId),
            'analytics': () => this.showOwnerAnalytics(whatsappId),
            'settings': () => this.showOwnerSettings(whatsappId)
        };
        const commandHandler = commands[cleanText];
        if (commandHandler) {
            await commandHandler();
        }
        else {
            await this.sendOwnerError(whatsappId, `Unknown command. Type "help" or "exit" to leave.`);
        }
    }
    async handleOwnerButton(whatsappId, button, context) {
        const { id: buttonId, title } = button;
        logger_1.logger.info('🏢 Owner button pressed', { whatsappId, buttonId, title });
        if (buttonId === 'exit_owner_mode') {
            await this.exitOwnerMode(whatsappId);
            return;
        }
        const parsed = (0, owner_button_parser_1.parseOwnerButtonId)(buttonId);
        switch (parsed.action || buttonId.replace('owner_', '')) {
            case 'register':
                await this.handleOwnerRegistration(whatsappId);
                break;
            case 'login':
                await this.handleOwnerLogin(whatsappId);
                break;
            case 'stations':
                await this.showStationManagement(whatsappId);
                break;
            case 'profile':
                await this.showOwnerProfile(whatsappId);
                break;
            case 'analytics':
                await this.showOwnerAnalytics(whatsappId);
                break;
            case 'settings':
                await this.showOwnerSettings(whatsappId);
                break;
            case 'main_menu':
            case 'menu':
                await this.showOwnerMainMenu(whatsappId);
                break;
            case 'help':
            case 'help_menu':
                await this.showOwnerHelp(whatsappId);
                break;
            default:
                await this.sendOwnerError(whatsappId, 'Unknown action. Please try again.');
        }
    }
    async showOwnerAuthentication(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🏢 *SharaSpot Owner Portal*\n\n' +
            '🔐 Authentication Required\n\n' +
            'Choose an option:');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔐 Owner Authentication', [
                { id: 'owner_register', title: '📝 Register' },
                { id: 'owner_login', title: '🔑 Login' },
                { id: 'exit_owner_mode', title: '🚪 Exit' }
            ]);
        }, 1000);
    }
    async handleOwnerRegistration(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📝 *Owner Registration*\n\n' +
            'Registration is handled by our support team.\n\n' +
            '📞 Contact:\n' +
            '• Email: partner@folonite.in\n' +
            '• Phone: +91-9790294221');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📝 Registration', [
                { id: 'owner_login', title: '🔑 Try Login' },
                { id: 'exit_owner_mode', title: '🚪 Exit' }
            ]);
        }, 2000);
    }
    async handleOwnerLogin(whatsappId) {
        const context = this.getOwnerContext(whatsappId);
        if (context) {
            context.waitingFor = 'business_name';
            this.updateContext(whatsappId, context);
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔑 *Owner Login*\n\n' +
            'Please provide your registered business name.\n\n' +
            'Example: "SharaSpot Parking Private Limited"\n\n' +
            'Type your business name:');
    }
    async showOwnerMainMenu(whatsappId) {
        const context = this.getOwnerContext(whatsappId);
        if (!context?.isAuthenticated) {
            await this.showOwnerAuthentication(whatsappId);
            return;
        }
        const ownerProfile = await owner_service_1.ownerService.getOwnerProfile(whatsappId);
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🏢 *Welcome ${ownerProfile?.name || 'Owner'}*\n\n` +
            `Quick Stats:\n` +
            `• Stations: ${ownerProfile?.totalStations || 0}\n` +
            `• Status: ${ownerProfile?.isActive ? '🟢 Active' : '🔴 Inactive'}\n\n` +
            `What would you like to manage?`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎛️ Owner Dashboard', [
                { id: 'owner_stations', title: '🔌 My Stations' },
                { id: 'owner_profile', title: '👤 Profile' },
                { id: 'owner_analytics', title: '📊 Analytics' }
            ]);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚙️ More Options', [
                    { id: 'owner_settings', title: '⚙️ Settings' },
                    { id: 'owner_help_menu', title: '❓ Help' },
                    { id: 'exit_owner_mode', title: '🚪 Exit' }
                ]);
            }, 1000);
        }, 1500);
    }
    async showStationManagement(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔌 Station Management - Coming soon');
    }
    async showOwnerProfile(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '👤 Owner Profile - Coming soon');
    }
    async showOwnerAnalytics(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📊 Analytics - Coming soon');
    }
    async showOwnerSettings(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⚙️ Settings - Coming soon');
    }
    async showOwnerHelp(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ *Owner Help*\n\n' +
            'Available commands:\n' +
            '• "menu" - Main dashboard\n' +
            '• "stations" - Manage stations\n' +
            '• "profile" - View profile\n' +
            '• "help" - This help\n' +
            '• "exit" - Leave owner mode');
    }
    async handleOwnerList(whatsappId, list, context) {
        await this.sendOwnerError(whatsappId, 'List handling not implemented yet.');
    }
    isInOwnerMode(whatsappId) {
        return this.ownerContexts.has(whatsappId);
    }
    async exitOwnerMode(whatsappId) {
        this.ownerContexts.delete(whatsappId);
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*Exited Owner Mode*\n\n' +
            'You are now back to the regular interface.\n\n' +
            'Type "owner" to re-enter owner mode.\n' +
            'Type "help" for regular commands.');
        logger_1.logger.info('Owner mode exited', { whatsappId });
    }
    async sendOwnerError(whatsappId, message) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🏢 *Owner Portal*\n\n❌ ${message}\n\n💡 Type "help" or "exit" to leave.`);
    }
    getOwnerContext(whatsappId) {
        const context = this.ownerContexts.get(whatsappId);
        if (context && Date.now() - context.lastActivity.getTime() > this.CONTEXT_TIMEOUT) {
            this.ownerContexts.delete(whatsappId);
            return null;
        }
        return context || null;
    }
    createOwnerContext(whatsappId) {
        const context = {
            whatsappId,
            currentState: OwnerFlowState.AUTH_REQUIRED,
            isAuthenticated: false,
            lastActivity: new Date()
        };
        this.ownerContexts.set(whatsappId, context);
        return context;
    }
    updateContext(whatsappId, context) {
        context.lastActivity = new Date();
        this.ownerContexts.set(whatsappId, context);
    }
    cleanupExpiredContexts() {
        const now = Date.now();
        for (const [whatsappId, context] of this.ownerContexts.entries()) {
            if (now - context.lastActivity.getTime() > this.CONTEXT_TIMEOUT) {
                this.ownerContexts.delete(whatsappId);
                logger_1.logger.info('Owner context expired and cleaned up', { whatsappId });
            }
        }
    }
    getActiveContextsCount() {
        return this.ownerContexts.size;
    }
}
exports.OwnerWebhookController = OwnerWebhookController;
exports.ownerWebhookController = new OwnerWebhookController();
//# sourceMappingURL=owner-webhook.js.map