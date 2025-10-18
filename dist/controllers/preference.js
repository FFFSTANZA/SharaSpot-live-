"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferenceController = exports.PreferenceController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const preference_1 = require("../services/preference");
const userService_1 = require("../services/userService");
const logger_1 = require("../utils/logger");
class PreferenceController {
    constructor() {
        this.STEPS = {
            VEHICLE_TYPE: 'vehicle_type',
            EV_MODEL: 'ev_model',
            CONNECTOR_TYPE: 'connector_type',
            CHARGING_INTENT: 'charging_intent',
            QUEUE_PREFERENCE: 'queue_preference',
            ADDRESS_INPUT: 'address_input',
            COMPLETED: 'completed'
        };
        this.CAR_MODELS = {
            INDIAN: [
                { id: 'Tata Nexon EV', name: 'Tata Nexon EV', desc: 'India’s best-selling EV SUV' },
                { id: 'Tata Punch EV', name: 'Tata Punch EV', desc: 'Affordable micro-SUV with great range' },
                { id: 'MG ZS EV', name: 'MG ZS EV', desc: 'Popular premium electric SUV' },
                { id: 'Tata Tiago EV', name: 'Tata Tiago EV', desc: 'Compact city hatchback' },
                { id: 'Mahindra XUV400', name: 'Mahindra XUV400', desc: 'Spacious electric SUV' },
                { id: 'MG Comet EV', name: 'MG Comet EV', desc: 'Compact 4-seater city car' },
                { id: 'Citroen eC3', name: 'Citroen eC3', desc: 'Budget-friendly electric hatchback' },
                { id: 'BYD Atto 3', name: 'BYD Atto 3', desc: 'Modern SUV with global tech' }
            ],
            LUXURY: [
                { id: 'BMW iX', name: 'BMW iX', desc: 'Flagship luxury electric SUV' },
                { id: 'Volvo XC40 Recharge', name: 'Volvo XC40 Recharge', desc: 'Premium compact SUV' },
                { id: 'Mercedes EQB', name: 'Mercedes EQB', desc: '7-seater luxury EV (available in India)' }
            ]
        };
        this.BIKE_MODELS = [
            { id: 'Ather 450X', name: 'Ather 450X', desc: 'Premium Smart Scooter' },
            { id: 'Ather 450 Plus', name: 'Ather 450 Plus', desc: 'Smart Scooter' },
            { id: 'Ola S1 Pro', name: 'Ola S1 Pro', desc: 'High Performance' },
            { id: 'Ola S1', name: 'Ola S1', desc: 'Affordable Performance' },
            { id: 'TVS iQube', name: 'TVS iQube', desc: 'Connected Scooter' },
            { id: 'Bajaj Chetak', name: 'Bajaj Chetak', desc: 'Classic Electric' },
            { id: 'Hero Vida V1 Pro', name: 'Hero Vida V1 Pro', desc: 'Premium Scooter' },
            { id: 'Simple One', name: 'Simple One', desc: 'Long Range Scooter' },
            { id: 'Revolt RV400', name: 'Revolt RV400', desc: 'Electric Motorcycle' },
            { id: 'Okinawa Praise Pro', name: 'Okinawa Praise', desc: 'Budget Scooter' },
            { id: 'Ampere Magnus EX', name: 'Ampere Magnus', desc: 'Affordable Scooter' },
            { id: 'Ather 450S', name: 'Ather 450S', desc: 'Entry Smart Scooter' }
        ];
        this.CONNECTOR_TYPES = {
            CAR: [
                { id: 'CCS2', name: 'CCS2', desc: 'Standard for most new EVs (Tata, MG, BYD)' },
                { id: 'Bharat DC001', name: 'Bharat DC', desc: 'Indian DC fast-charging standard' },
                { id: 'Type2', name: 'Type 2', desc: 'AC slow charging (used by many EVs at home/public)' },
                { id: 'CHAdeMO', name: 'CHAdeMO', desc: 'Legacy support (rare; older Mahindra/Nissan)' }
            ],
            BIKE: [
                { id: '3-Pin', name: '3-Pin Plug', desc: 'Standard home socket (most scooters)' },
                { id: 'Proprietary', name: 'Brand-Specific Port', desc: 'Ather, Ola, TVS iQube' },
                { id: 'Fast Charge', name: 'DC Fast Charging', desc: 'Used at select public stations' },
                { id: 'Type2', name: 'Type 2', desc: 'Rare on bikes; some premium models' }
            ]
        };
        this.contexts = new Map();
        this.lastCleanup = Date.now();
    }
    async startPreferenceGathering(whatsappId, isOnboarding = false) {
        try {
            this.maybeCleanupContexts();
            await preference_1.preferenceService.startPreferenceFlow(whatsappId, isOnboarding);
            await this.initializeContext(whatsappId, isOnboarding);
            await this.showWelcomeMessage(whatsappId, isOnboarding);
        }
        catch (error) {
            logger_1.logger.error('Failed to start preferences', { whatsappId, error });
            await this.sendError(whatsappId, 'Failed to start setup. Try "hi" again.');
        }
    }
    async showWelcomeMessage(whatsappId, isOnboarding) {
        const welcomeText = isOnboarding
            ? '*Welcome to SharaSpot!*\n\nIndia\'s smartest EV charging network. Let\'s set up your profile in 30 seconds!'
            : '*Updating Your EV Profile*\n\nLet\'s optimize your charging experience!';
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, welcomeText);
        setTimeout(async () => {
            await this.showVehicleTypeStep(whatsappId);
        }, 1000);
    }
    async handlePreferenceResponse(whatsappId, responseType, responseValue) {
        try {
            const context = this.getValidatedContext(whatsappId);
            if (!context) {
                await this.sendSessionExpired(whatsappId);
                return;
            }
            switch (context.currentStep) {
                case this.STEPS.VEHICLE_TYPE:
                    await this.handleVehicleType(whatsappId, responseValue, context);
                    break;
                case this.STEPS.EV_MODEL:
                    await this.handleEVModel(whatsappId, responseType, responseValue, context);
                    break;
                case this.STEPS.CONNECTOR_TYPE:
                    await this.handleConnectorType(whatsappId, responseValue, context);
                    break;
                case this.STEPS.CHARGING_INTENT:
                    await this.handleChargingIntent(whatsappId, responseValue, context);
                    break;
                case this.STEPS.QUEUE_PREFERENCE:
                    await this.handleQueuePreference(whatsappId, responseValue, context);
                    break;
                case this.STEPS.ADDRESS_INPUT:
                    await this.handleAddressInput(whatsappId, responseValue, context);
                    break;
                default:
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown step. Type "hi" to restart.');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle response', { whatsappId, error });
            await this.sendError(whatsappId, 'Something went wrong. Type "hi" to restart.');
        }
    }
    async showVehicleTypeStep(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Step 1/5: Vehicle Type* \n\nWhat do you drive?', [
            { id: 'Car', title: 'Car' },
            { id: 'Bike/Scooter', title: 'Bike/Scooter' },
            { id: 'Any', title: 'Multiple/Any' }
        ], '🚗 Vehicle Selection');
    }
    async handleVehicleType(whatsappId, responseValue, context) {
        const validTypes = ['Car', 'Bike/Scooter', 'Any'];
        if (!validTypes.includes(responseValue)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid vehicle type.');
            return;
        }
        context.preferenceData.vehicleType = responseValue;
        this.updateContext(whatsappId, context);
        await this.sendConfirmation(whatsappId, `Vehicle: *${responseValue}*`);
        await this.moveToStep(whatsappId, context, this.STEPS.EV_MODEL);
        if (responseValue === 'Car') {
            await this.showCarModelsStep(whatsappId);
        }
        else if (responseValue === 'Bike/Scooter') {
            await this.showBikeModelsStep(whatsappId);
        }
        else {
            await this.moveToStep(whatsappId, context, this.STEPS.CONNECTOR_TYPE);
        }
    }
    async showCarModelsStep(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Step 2/5: Car Model*\n\nChoose your category:', [
            { id: 'indian_cars', title: '🇮Indian Cars' },
            { id: 'luxury_cars', title: 'Luxury Cars' },
            { id: 'type_custom', title: 'Type Model' }
        ], '🚗 Car Categories');
    }
    async showBikeModelsStep(whatsappId) {
        const popularBikes = this.BIKE_MODELS.slice(0, 8);
        const rows = [
            ...popularBikes.map(bike => ({
                id: bike.id,
                title: bike.name,
                description: bike.desc
            })),
            { id: 'type_custom', title: '⌨️ Other Model', description: 'Type manually' },
            { id: 'skip_model', title: '⏭️ Skip', description: 'Set later' }
        ];
        await whatsapp_1.whatsappService.sendListMessage(whatsappId, '*Step 2/5: Bike/Scooter Model* \n\nSelect your model:', 'Select Model', [{ title: ' Popular Models', rows }]);
    }
    async showCarCategory(whatsappId, category) {
        const models = category === 'indian' ? this.CAR_MODELS.INDIAN : this.CAR_MODELS.LUXURY;
        const title = category === 'indian' ? '*Indian Electric Cars* 🇮🇳' : '*Luxury Electric Cars* ✨';
        const rows = [
            ...models.map(car => ({ id: car.id, title: car.name, description: car.desc })),
            { id: 'type_custom', title: '⌨️ Other Model', description: 'Type manually' },
            { id: 'back_categories', title: '⬅️ Back', description: 'Back to categories' }
        ];
        await whatsapp_1.whatsappService.sendListMessage(whatsappId, title, 'Select Car', [{ title: 'Models', rows }]);
    }
    async handleEVModel(whatsappId, responseType, responseValue, context) {
        if (responseValue === 'indian_cars') {
            await this.showCarCategory(whatsappId, 'indian');
            return;
        }
        if (responseValue === 'luxury_cars') {
            await this.showCarCategory(whatsappId, 'luxury');
            return;
        }
        if (responseValue === 'type_custom') {
            await this.requestCustomModel(whatsappId);
            return;
        }
        if (responseValue === 'skip_model') {
            await this.setModel(whatsappId, context, 'Not specified');
            return;
        }
        if (responseValue === 'back_categories') {
            await this.showCarModelsStep(whatsappId);
            return;
        }
        const model = responseValue.trim();
        if (model.length >= 2) {
            await this.setModel(whatsappId, context, model);
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid model name.');
        }
    }
    async setModel(whatsappId, context, model) {
        context.preferenceData.evModel = model;
        this.updateContext(whatsappId, context);
        await this.sendConfirmation(whatsappId, `Model: *${model}*`);
        await this.moveToStep(whatsappId, context, this.STEPS.CONNECTOR_TYPE);
    }
    async requestCustomModel(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⌨️ *Type Your EV Model*\n\nExamples:\n• Tata Nexon EV Max\n• Ather 450X Gen3\n• Tesla Model Y\n\nJust type the name:');
    }
    async showConnectorTypeStep(whatsappId) {
        const context = this.getValidatedContext(whatsappId);
        if (!context)
            return;
        const isBike = context.preferenceData.vehicleType === 'Bike/Scooter';
        const connectors = isBike ? this.CONNECTOR_TYPES.BIKE : this.CONNECTOR_TYPES.CAR;
        const buttons = connectors.slice(0, 3).map(conn => ({
            id: conn.id,
            title: `🔌 ${conn.name}`
        }));
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `*Step 3/5: Charging Port* 🔌\n\nWhat connector does your ${isBike ? 'scooter' : 'car'} use?\n\n${connectors.map(c => `🔌 *${c.name}* - ${c.desc}`).join('\n')}`, [...buttons, { id: 'Any', title: '🔀 Not Sure' }], '🔌 Connector Type');
    }
    async handleConnectorType(whatsappId, responseValue, context) {
        const validConnectors = ['CCS2', 'CHAdeMO', 'Type2', 'Bharat DC001', 'Proprietary', '3-Pin', 'Fast Charge', 'Any'];
        if (!validConnectors.includes(responseValue)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid connector type.');
            return;
        }
        context.preferenceData.connectorType = responseValue;
        this.updateContext(whatsappId, context);
        await this.sendConfirmation(whatsappId, `Connector: *${responseValue}*`);
        await this.moveToStep(whatsappId, context, this.STEPS.CHARGING_INTENT);
    }
    async showChargingIntentStep(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Step 4/5: Charging Style* \n\nHow do you usually charge?', [
            { id: 'Quick Top-up', title: '⚡ Quick (15-30min)' },
            { id: 'Full Charge', title: '🔋 Full (1-3hrs)' },
            { id: 'Emergency', title: '🚨 Emergency Only' }
        ], '⚡ Charging Style');
    }
    async handleChargingIntent(whatsappId, responseValue, context) {
        const validIntents = ['Quick Top-up', 'Full Charge', 'Emergency'];
        if (!validIntents.includes(responseValue)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a charging style.');
            return;
        }
        context.preferenceData.chargingIntent = responseValue;
        this.updateContext(whatsappId, context);
        await this.sendConfirmation(whatsappId, `Style: *${responseValue}*`);
        await this.moveToStep(whatsappId, context, this.STEPS.QUEUE_PREFERENCE);
    }
    async showQueuePreferenceStep(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Step 5/5: Wait Time* \n\nHow long can you wait if stations are busy?', [
            { id: 'Free Now', title: '🟢 Free Now Only' },
            { id: 'Wait 15m', title: '🟡 Up to 15min' },
            { id: 'Wait 30m', title: '🟠 Up to 30min' }
        ], 'Queue Preference');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Or:', [{ id: 'Any Queue', title: '🔀 Flexible' }]);
        }, 1000);
    }
    async handleQueuePreference(whatsappId, responseValue, context) {
        const validPreferences = ['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'];
        if (!validPreferences.includes(responseValue)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a wait preference.');
            return;
        }
        context.preferenceData.queuePreference = responseValue;
        this.updateContext(whatsappId, context);
        await this.sendConfirmation(whatsappId, `Wait time: *${responseValue}*`);
        await this.completePreferenceSetup(whatsappId, context);
    }
    async completePreferenceSetup(whatsappId, context) {
        try {
            const validation = this.validatePreferenceData(context.preferenceData);
            if (!validation.isValid) {
                await this.sendError(whatsappId, `Invalid data: ${validation.errors.join(', ')}`);
                return;
            }
            context.currentStep = this.STEPS.COMPLETED;
            this.updateContext(whatsappId, context);
            const updatedUser = await preference_1.preferenceService.savePreferences(whatsappId);
            if (!updatedUser) {
                await this.sendError(whatsappId, 'Failed to save. Please try again.');
                return;
            }
            await this.sendSuccessMessage(whatsappId, context.preferenceData, context.isOnboarding);
        }
        catch (error) {
            logger_1.logger.error('Failed to complete setup', { whatsappId, error });
            await this.sendError(whatsappId, 'Setup failed. Please try "hi" again.');
        }
    }
    async sendSuccessMessage(whatsappId, data, isOnboarding) {
        const summary = `🎉 *Setup Complete!*\n\n` +
            `╭─ 📋 *Your EV Profile* ─╮\n` +
            `│ 🚗 Vehicle: ${data.vehicleType}\n` +
            `│ 🏷️ Model: ${data.evModel || 'Any'}\n` +
            `│ 🔌 Port: ${data.connectorType}\n` +
            `│ ⚡ Style: ${data.chargingIntent}\n` +
            `│ 🕐 Wait: ${data.queuePreference}\n` +
            `╰────────────────────╯\n\n` +
            `✅ *Profile saved!*`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, summary);
        setTimeout(async () => {
            await this.requestLocation(whatsappId, isOnboarding);
        }, 2000);
    }
    async requestLocation(whatsappId, isOnboarding) {
        const text = isOnboarding
            ? '*Let\'s Find Your First Charging Station!*'
            : '*Ready to Find Stations Near You!*';
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `${text}\n\n🎯 Choose your location method:`);
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'How would you like to share location?', [
            { id: 'share_gps_location', title: '📱 Share GPS' },
            { id: 'type_address', title: '📝 Type Address' }
        ], '📍 Location Method');
    }
    async handleAddressInput(whatsappId, address, context) {
        if (address.trim().length < 3) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please provide a detailed address.');
            return;
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 Searching near: *${address.trim()}*\n\n🔍 Please wait...`);
        context.currentStep = this.STEPS.COMPLETED;
        this.updateContext(whatsappId, context);
    }
    async initializeContext(whatsappId, isOnboarding) {
        const context = {
            isOnboarding,
            whatsappId,
            currentStep: this.STEPS.VEHICLE_TYPE,
            preferenceData: {},
            timestamp: Date.now()
        };
        this.contexts.set(whatsappId, context);
    }
    async moveToStep(whatsappId, context, step) {
        context.currentStep = step;
        this.updateContext(whatsappId, context);
        if (step === this.STEPS.CONNECTOR_TYPE) {
            await this.showConnectorTypeStep(whatsappId);
        }
        else if (step === this.STEPS.CHARGING_INTENT) {
            await this.showChargingIntentStep(whatsappId);
        }
        else if (step === this.STEPS.QUEUE_PREFERENCE) {
            await this.showQueuePreferenceStep(whatsappId);
        }
    }
    getValidatedContext(whatsappId) {
        return this.contexts.get(whatsappId) || null;
    }
    updateContext(whatsappId, context) {
        context.timestamp = Date.now();
        this.contexts.set(whatsappId, context);
        const serviceContext = this.convertToServiceContext(context);
        preference_1.preferenceService.updateUserContext(whatsappId, serviceContext);
    }
    convertToServiceContext(context) {
        let step = 'ev_model';
        if (context.currentStep === 'vehicle_type')
            step = 'ev_model';
        else if (context.currentStep === 'completed')
            step = 'completed';
        else if (['ev_model', 'connector_type', 'charging_intent', 'queue_preference'].includes(context.currentStep)) {
            step = context.currentStep;
        }
        else {
            step = 'completed';
        }
        return {
            whatsappId: context.whatsappId,
            isOnboarding: context.isOnboarding,
            currentStep: step,
            preferenceData: {
                vehicleType: context.preferenceData.vehicleType,
                evModel: context.preferenceData.evModel || '',
                connectorType: context.preferenceData.connectorType || '',
                chargingIntent: context.preferenceData.chargingIntent || '',
                queuePreference: context.preferenceData.queuePreference || ''
            }
        };
    }
    validatePreferenceData(data) {
        const errors = [];
        if (data.vehicleType && !['Car', 'Bike/Scooter', 'Any'].includes(data.vehicleType)) {
            errors.push('Invalid vehicle type');
        }
        if (data.connectorType && !['CCS2', 'CHAdeMO', 'Type2', 'Bharat DC001', 'Proprietary', '3-Pin', 'Fast Charge', 'Any'].includes(data.connectorType)) {
            errors.push('Invalid connector type');
        }
        if (data.chargingIntent && !['Quick Top-up', 'Full Charge', 'Emergency'].includes(data.chargingIntent)) {
            errors.push('Invalid charging intent');
        }
        if (data.queuePreference && !['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'].includes(data.queuePreference)) {
            errors.push('Invalid queue preference');
        }
        return { isValid: errors.length === 0, errors };
    }
    async sendConfirmation(whatsappId, message) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ ${message}`);
    }
    async sendError(whatsappId, message) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
    }
    async sendSessionExpired(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⏱️ Session expired. Type "hi" to start again.');
    }
    maybeCleanupContexts() {
        const now = Date.now();
        if (now - this.lastCleanup < 10 * 60 * 1000)
            return;
        this.lastCleanup = now;
        const oneHourAgo = now - (60 * 60 * 1000);
        for (const [whatsappId, context] of this.contexts.entries()) {
            if (context.timestamp < oneHourAgo) {
                this.contexts.delete(whatsappId);
            }
        }
    }
    async showPreferenceSummary(whatsappId) {
        try {
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user?.preferencesCaptured) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No preferences set. Type "hi" to set up.');
                return;
            }
            const summary = `*Your EV Profile*\n\n` +
                `Vehicle: ${user.vehicleType || 'Any'}\n` +
                `Model: ${user.evModel || 'Not set'}\n` +
                `Connector: ${user.connectorType || 'Any'}\n` +
                `Charging style: ${user.chargingIntent || 'Any'}\n` +
                `Wait preference: ${user.queuePreference || 'Flexible'}\n\n` +
                `Type "settings" to update your preferences.`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, summary);
        }
        catch (error) {
            logger_1.logger.error('Error showing summary', { whatsappId, error });
            await this.sendError(whatsappId, 'Unable to load preferences.');
        }
    }
    async resetPreferences(whatsappId) {
        try {
            this.contexts.delete(whatsappId);
            if (typeof preference_1.preferenceService.resetUserPreferences === 'function') {
                await preference_1.preferenceService.resetUserPreferences(whatsappId);
            }
            else {
                await preference_1.preferenceService.savePreferences(whatsappId);
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔄 Preferences cleared. Type "hi" to set up again.');
        }
        catch (error) {
            logger_1.logger.error('Error resetting preferences', { whatsappId, error });
            await this.sendError(whatsappId, 'Unable to reset preferences.');
        }
    }
    getActiveContextsCount() {
        return this.contexts.size;
    }
}
exports.PreferenceController = PreferenceController;
exports.preferenceController = new PreferenceController();
//# sourceMappingURL=preference.js.map