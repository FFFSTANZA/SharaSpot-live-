// src/controllers/preference.ts - CORRECTED & OPTIMIZED
import { whatsappService } from '../services/whatsapp';
import { preferenceService, type UserContext } from '../services/preference';
import { userService } from '../services/userService';
import { logger } from '../utils/logger';

interface PreferenceData {
  vehicleType?: 'Car' | 'Bike/Scooter' | 'Any';
  evModel?: string;
  connectorType?: string;
  chargingIntent?: string;
  queuePreference?: string;
}

// ✅ Include 'address_input' locally in controller
type PreferenceStep = 'vehicle_type' | 'ev_model' | 'connector_type' | 'charging_intent' | 'queue_preference' | 'address_input' | 'completed';

interface OptimizedUserContext {
  isOnboarding: boolean;
  whatsappId: string;
  preferenceData: PreferenceData;
  currentStep: PreferenceStep;
  timestamp: number;
}

export class PreferenceController {
  private readonly STEPS = {
    VEHICLE_TYPE: 'vehicle_type' as const,
    EV_MODEL: 'ev_model' as const,
    CONNECTOR_TYPE: 'connector_type' as const,
    CHARGING_INTENT: 'charging_intent' as const,
    QUEUE_PREFERENCE: 'queue_preference' as const,
    ADDRESS_INPUT: 'address_input' as const,
    COMPLETED: 'completed' as const
  };

  // INDIAN EV MODELS
  private readonly CAR_MODELS = {
    INDIAN: [
      { id: 'Tata Nexon EV', name: 'Tata Nexon EV', desc: 'Most Popular SUV' },
      { id: 'MG ZS EV', name: 'MG ZS EV', desc: 'Premium SUV' },
      { id: 'Tata Tigor EV', name: 'Tata Tigor EV', desc: 'Compact Sedan' },
      { id: 'Mahindra XUV400', name: 'Mahindra XUV400', desc: 'Electric SUV' },
      { id: 'Hyundai Kona', name: 'Hyundai Kona', desc: 'Global Electric' },
      { id: 'MG Comet EV', name: 'MG Comet EV', desc: 'City Car' },
      { id: 'Tata Punch EV', name: 'Tata Punch EV', desc: 'Micro SUV' },
      { id: 'Citroen eC3', name: 'Citroen eC3', desc: 'Affordable Hatchback' }
    ],
    LUXURY: [
      { id: 'BMW iX', name: 'BMW iX', desc: 'Luxury SUV' },
      { id: 'Mercedes EQC', name: 'Mercedes EQC', desc: 'Premium SUV' },
      { id: 'Audi e-tron GT', name: 'Audi e-tron GT', desc: 'Sports Sedan' },
      { id: 'Volvo XC40 Recharge', name: 'Volvo XC40', desc: 'Compact SUV' },
      { id: 'Jaguar I-PACE', name: 'Jaguar I-PACE', desc: 'Performance SUV' },
      { id: 'Porsche Taycan', name: 'Porsche Taycan', desc: 'Sports Car' }
    ]
  };

  private readonly BIKE_MODELS = [
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

  private readonly CONNECTOR_TYPES = {
    CAR: [
      { id: 'CCS2', name: 'CCS2', desc: 'Most Indian EVs (Tata, MG)' },
      { id: 'CHAdeMO', name: 'CHAdeMO', desc: 'Nissan, Mahindra' },
      { id: 'Type2', name: 'Type2', desc: 'AC Charging (BMW, Audi)' },
      { id: 'Bharat DC001', name: 'Bharat DC', desc: 'Indian Standard DC' }
    ],
    BIKE: [
      { id: 'Type2', name: 'Standard Plug', desc: 'Most Indian Scooters' },
      { id: 'Proprietary', name: 'Brand Specific', desc: 'Ather, Ola Custom' },
      { id: '3-Pin', name: '3-Pin Socket', desc: 'Home Charging' },
      { id: 'Fast Charge', name: 'Fast Charge', desc: 'DC Fast Charging' }
    ]
  };

  private contexts = new Map<string, OptimizedUserContext>();
  private lastCleanup = Date.now();

  async startPreferenceGathering(whatsappId: string, isOnboarding = false): Promise<void> {
    try {
      this.maybeCleanupContexts();
      await preferenceService.startPreferenceFlow(whatsappId, isOnboarding);
      await this.initializeContext(whatsappId, isOnboarding);
      await this.showWelcomeMessage(whatsappId, isOnboarding);
    } catch (error) {
      logger.error('Failed to start preferences', { whatsappId, error });
      await this.sendError(whatsappId, 'Failed to start setup. Try "hi" again.');
    }
  }

  private async showWelcomeMessage(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const welcomeText = isOnboarding 
      ? '🚗⚡ *Welcome to SharaSpot!*\n\nIndia\'s smartest EV charging network. Let\'s set up your profile in 30 seconds!' 
      : '🔄 *Updating Your EV Profile*\n\nLet\'s optimize your charging experience!';

    await whatsappService.sendTextMessage(whatsappId, welcomeText);
    
    setTimeout(async () => {
      await this.showVehicleTypeStep(whatsappId);
    }, 1000);
  }

  async handlePreferenceResponse(whatsappId: string, responseType: 'button' | 'text' | 'list', responseValue: string): Promise<void> {
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
          await whatsappService.sendTextMessage(whatsappId, '❓ Unknown step. Type "hi" to restart.');
      }
    } catch (error) {
      logger.error('Failed to handle response', { whatsappId, error });
      await this.sendError(whatsappId, 'Something went wrong. Type "hi" to restart.');
    }
  }

  private async showVehicleTypeStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 1/5: Vehicle Type* 🚗\n\nWhat do you drive?',
      [
        { id: 'Car', title: '🚗 Car' },
        { id: 'Bike/Scooter', title: '🛵 Bike/Scooter' },
        { id: 'Any', title: '🔀 Multiple/Any' }
      ],
      '🚗 Vehicle Selection'
    );
  }

  private async handleVehicleType(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validTypes = ['Car', 'Bike/Scooter', 'Any'];
    if (!validTypes.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid vehicle type.');
      return;
    }

    context.preferenceData.vehicleType = responseValue as any;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Vehicle: *${responseValue}*`);
    
    await this.moveToStep(whatsappId, context, this.STEPS.EV_MODEL);
    
    if (responseValue === 'Car') {
      await this.showCarModelsStep(whatsappId);
    } else if (responseValue === 'Bike/Scooter') {
      await this.showBikeModelsStep(whatsappId);
    } else {
      await this.moveToStep(whatsappId, context, this.STEPS.CONNECTOR_TYPE);
    }
  }

  private async showCarModelsStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 2/5: Car Model* 🚗\n\nChoose your category:',
      [
        { id: 'indian_cars', title: '🇮🇳 Indian Cars' },
        { id: 'luxury_cars', title: '✨ Luxury Cars' },
        { id: 'type_custom', title: '⌨️ Type Model' }
      ],
      '🚗 Car Categories'
    );
  }

  private async showBikeModelsStep(whatsappId: string): Promise<void> {
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

    await whatsappService.sendListMessage(
      whatsappId,
      '*Step 2/5: Bike/Scooter Model* 🛵\n\nSelect your model:',
      'Select Model',
      [{ title: '🛵 Popular Models', rows }]
    );
  }

  async showCarCategory(whatsappId: string, category: 'indian' | 'luxury'): Promise<void> {
    const models = category === 'indian' ? this.CAR_MODELS.INDIAN : this.CAR_MODELS.LUXURY;
    const title = category === 'indian' ? '*Indian Electric Cars* 🇮🇳' : '*Luxury Electric Cars* ✨';
    
    const rows = [
      ...models.map(car => ({ id: car.id, title: car.name, description: car.desc })),
      { id: 'type_custom', title: '⌨️ Other Model', description: 'Type manually' },
      { id: 'back_categories', title: '⬅️ Back', description: 'Back to categories' }
    ];

    await whatsappService.sendListMessage(whatsappId, title, 'Select Car', [{ title: 'Models', rows }]);
  }

  private async handleEVModel(whatsappId: string, responseType: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
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
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid model name.');
    }
  }

  private async setModel(whatsappId: string, context: OptimizedUserContext, model: string): Promise<void> {
    context.preferenceData.evModel = model;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Model: *${model}*`);
    await this.moveToStep(whatsappId, context, this.STEPS.CONNECTOR_TYPE);
  }

  private async requestCustomModel(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⌨️ *Type Your EV Model*\n\nExamples:\n• Tata Nexon EV Max\n• Ather 450X Gen3\n• Tesla Model Y\n\nJust type the name:'
    );
  }

  private async showConnectorTypeStep(whatsappId: string): Promise<void> {
    const context = this.getValidatedContext(whatsappId);
    if (!context) return;
    
    const isBike = context.preferenceData.vehicleType === 'Bike/Scooter';
    const connectors = isBike ? this.CONNECTOR_TYPES.BIKE : this.CONNECTOR_TYPES.CAR;
    
    const buttons = connectors.slice(0, 3).map(conn => ({ 
      id: conn.id, 
      title: `🔌 ${conn.name}` 
    }));

    await whatsappService.sendButtonMessage(
      whatsappId,
      `*Step 3/5: Charging Port* 🔌\n\nWhat connector does your ${isBike ? 'scooter' : 'car'} use?\n\n${connectors.map(c => `🔌 *${c.name}* - ${c.desc}`).join('\n')}`,
      [...buttons, { id: 'Any', title: '🔀 Not Sure' }],
      '🔌 Connector Type'
    );
  }

  private async handleConnectorType(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validConnectors = ['CCS2', 'CHAdeMO', 'Type2', 'Bharat DC001', 'Proprietary', '3-Pin', 'Fast Charge', 'Any'];
    
    if (!validConnectors.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid connector type.');
      return;
    }
    
    context.preferenceData.connectorType = responseValue;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Connector: *${responseValue}*`);
    await this.moveToStep(whatsappId, context, this.STEPS.CHARGING_INTENT);
  }

  private async showChargingIntentStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 4/5: Charging Style* ⚡\n\nHow do you usually charge?',
      [
        { id: 'Quick Top-up', title: '⚡ Quick (15-30min)' },
        { id: 'Full Charge', title: '🔋 Full (1-3hrs)' },
        { id: 'Emergency', title: '🚨 Emergency Only' }
      ],
      '⚡ Charging Style'
    );
  }

  private async handleChargingIntent(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validIntents = ['Quick Top-up', 'Full Charge', 'Emergency'];
    
    if (!validIntents.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a charging style.');
      return;
    }
    
    context.preferenceData.chargingIntent = responseValue;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Style: *${responseValue}*`);
    await this.moveToStep(whatsappId, context, this.STEPS.QUEUE_PREFERENCE);
  }

  private async showQueuePreferenceStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 5/5: Wait Time* 🕐\n\nHow long can you wait if stations are busy?',
      [
        { id: 'Free Now', title: '🟢 Free Now Only' },
        { id: 'Wait 15m', title: '🟡 Up to 15min' },
        { id: 'Wait 30m', title: '🟠 Up to 30min' }
      ],
      '🕐 Queue Preference'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(whatsappId, 'Or:', [{ id: 'Any Queue', title: '🔀 Flexible' }]);
    }, 1000);
  }

  private async handleQueuePreference(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validPreferences = ['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'];
    
    if (!validPreferences.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a wait preference.');
      return;
    }
    
    context.preferenceData.queuePreference = responseValue;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Wait time: *${responseValue}*`);
    await this.completePreferenceSetup(whatsappId, context);
  }

  private async completePreferenceSetup(whatsappId: string, context: OptimizedUserContext): Promise<void> {
    try {
      const validation = this.validatePreferenceData(context.preferenceData);
      if (!validation.isValid) {
        await this.sendError(whatsappId, `Invalid data: ${validation.errors.join(', ')}`);
        return;
      }
      
      context.currentStep = this.STEPS.COMPLETED;
      this.updateContext(whatsappId, context);
      
      const updatedUser = await preferenceService.savePreferences(whatsappId);
      
      if (!updatedUser) {
        await this.sendError(whatsappId, 'Failed to save. Please try again.');
        return;
      }

      await this.sendSuccessMessage(whatsappId, context.preferenceData, context.isOnboarding);

    } catch (error) {
      logger.error('Failed to complete setup', { whatsappId, error });
      await this.sendError(whatsappId, 'Setup failed. Please try "hi" again.');
    }
  }

  private async sendSuccessMessage(whatsappId: string, data: PreferenceData, isOnboarding: boolean): Promise<void> {
    const summary = `🎉 *Setup Complete!*\n\n` +
      `╭─ 📋 *Your EV Profile* ─╮\n` +
      `│ 🚗 Vehicle: ${data.vehicleType}\n` +
      `│ 🏷️ Model: ${data.evModel || 'Any'}\n` +
      `│ 🔌 Port: ${data.connectorType}\n` +
      `│ ⚡ Style: ${data.chargingIntent}\n` +
      `│ 🕐 Wait: ${data.queuePreference}\n` +
      `╰────────────────────╯\n\n` +
      `✅ *Profile saved!*`;

    await whatsappService.sendTextMessage(whatsappId, summary);

    setTimeout(async () => {
      await this.requestLocation(whatsappId, isOnboarding);
    }, 2000);
  }

  private async requestLocation(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const text = isOnboarding 
      ? '📍 *Let\'s Find Your First Charging Station!*' 
      : '📍 *Ready to Find Stations Near You!*';

    await whatsappService.sendTextMessage(whatsappId, `${text}\n\n🎯 Choose your location method:`);

    await whatsappService.sendButtonMessage(
      whatsappId,
      'How would you like to share location?',
      [
        { id: 'share_gps_location', title: '📱 Share GPS' },
        { id: 'type_address', title: '📝 Type Address' }
      ],
      '📍 Location Method'
    );
  }

  private async handleAddressInput(whatsappId: string, address: string, context: OptimizedUserContext): Promise<void> {
    if (address.trim().length < 3) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please provide a detailed address.');
      return;
    }

    await whatsappService.sendTextMessage(whatsappId, `📍 Searching near: *${address.trim()}*\n\n🔍 Please wait...`);
    
    context.currentStep = this.STEPS.COMPLETED;
    this.updateContext(whatsappId, context);
  }

  private async initializeContext(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const context: OptimizedUserContext = {
      isOnboarding,
      whatsappId,
      currentStep: this.STEPS.VEHICLE_TYPE,
      preferenceData: {},
      timestamp: Date.now()
    };
    this.contexts.set(whatsappId, context);
  }

  private async moveToStep(whatsappId: string, context: OptimizedUserContext, step: PreferenceStep): Promise<void> {
    context.currentStep = step;
    this.updateContext(whatsappId, context);
    
    if (step === this.STEPS.CONNECTOR_TYPE) {
      await this.showConnectorTypeStep(whatsappId);
    } else if (step === this.STEPS.CHARGING_INTENT) {
      await this.showChargingIntentStep(whatsappId);
    } else if (step === this.STEPS.QUEUE_PREFERENCE) {
      await this.showQueuePreferenceStep(whatsappId);
    }
  }

  private getValidatedContext(whatsappId: string): OptimizedUserContext | null {
    return this.contexts.get(whatsappId) || null;
  }

  private updateContext(whatsappId: string, context: OptimizedUserContext): void {
    context.timestamp = Date.now();
    this.contexts.set(whatsappId, context);
    
    // ✅ Fix 1: Don't pass 'address_input' to service context
    const serviceContext = this.convertToServiceContext(context);
    preferenceService.updateUserContext(whatsappId, serviceContext);
  }

  // ✅ Fix 1: Map 'address_input' to a valid step
  private convertToServiceContext(context: OptimizedUserContext): UserContext {
    // Map controller-specific steps to service-compatible ones
    let step: UserContext['currentStep'] = 'ev_model';

    if (context.currentStep === 'vehicle_type') step = 'ev_model';
    else if (context.currentStep === 'completed') step = 'completed';
    else if (['ev_model', 'connector_type', 'charging_intent', 'queue_preference'].includes(context.currentStep)) {
      step = context.currentStep as any;
    } else {
      // For 'address_input', we can map to 'completed' or keep last valid step
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

  private validatePreferenceData(data: PreferenceData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

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

  private async sendConfirmation(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `✅ ${message}`);
  }

  private async sendError(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
  }

  private async sendSessionExpired(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, '⏱️ Session expired. Type "hi" to start again.');
  }

  private maybeCleanupContexts(): void {
    const now = Date.now();
    if (now - this.lastCleanup < 10 * 60 * 1000) return;
    
    this.lastCleanup = now;
    const oneHourAgo = now - (60 * 60 * 1000);
    
    for (const [whatsappId, context] of this.contexts.entries()) {
      if (context.timestamp < oneHourAgo) {
        this.contexts.delete(whatsappId);
      }
    }
  }

  async showPreferenceSummary(whatsappId: string): Promise<void> {
    try {
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user?.preferencesCaptured) {
        await whatsappService.sendTextMessage(whatsappId, '❓ No preferences set. Type "hi" to set up.');
        return;
      }

      const summary = `📋 *Your EV Profile*\n\n` +
        `🚗 Vehicle: ${user.vehicleType || 'Any'}\n` +
        `🏷️ Model: ${user.evModel || 'Not set'}\n` +
        `🔌 Connector: ${user.connectorType || 'Any'}\n` +
        `⚡ Style: ${user.chargingIntent || 'Any'}\n` +
        `🕐 Wait: ${user.queuePreference || 'Flexible'}\n\n` +
        `💡 Type "settings" to update.`;

      await whatsappService.sendTextMessage(whatsappId, summary);
    } catch (error) {
      logger.error('Error showing summary', { whatsappId, error });
      await this.sendError(whatsappId, 'Unable to load preferences.');
    }
  }

  // ✅ Fix 2: Use existing method or create fallback
  async resetPreferences(whatsappId: string): Promise<void> {
    try {
      this.contexts.delete(whatsappId);

      // ✅ Check if reset method exists — if not, use savePreferences with defaults
      if (typeof (preferenceService as any).resetUserPreferences === 'function') {
        await (preferenceService as any).resetUserPreferences(whatsappId);
      } else {
        // Fallback: update with empty preferences
        await preferenceService.savePreferences(whatsappId);
      }

      await whatsappService.sendTextMessage(whatsappId, '🔄 Preferences cleared. Type "hi" to set up again.');
    } catch (error) {
      logger.error('Error resetting preferences', { whatsappId, error });
      await this.sendError(whatsappId, 'Unable to reset preferences.');
    }
  }

  getActiveContextsCount(): number {
    return this.contexts.size;
  }
}

export const preferenceController = new PreferenceController();