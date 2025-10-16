// src/controllers/owner-webhook.ts - MINIMAL FIXES ONLY
import { whatsappService } from '../services/whatsapp';
import { ownerService } from '../services/owner-service';
import { ownerStationService } from '../services/owner-station-service';
import { ownerAuthService } from '../services/owner-auth-service';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';
import { parseOwnerButtonId } from '../utils/owner-button-parser';

enum OwnerFlowState {
  AUTH_REQUIRED = 'auth_required',
  MAIN_MENU = 'main_menu',
  STATION_MANAGEMENT = 'station_management',
  PROFILE_MANAGEMENT = 'profile_management',
  ANALYTICS = 'analytics',
  SETTINGS = 'settings'
}

interface OwnerContext {
  whatsappId: string;
  currentState: OwnerFlowState;
  isAuthenticated: boolean;
  ownerId?: number;
  selectedStationId?: number;
  waitingFor?: string;
  sessionData?: any;
  lastActivity: Date;
}

export class OwnerWebhookController {
  private ownerContexts = new Map<string, OwnerContext>();
  private readonly CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  async enterOwnerMode(whatsappId: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID in owner flow', { whatsappId });
      return;
    }

    logger.info('🏢 Owner mode activated', { whatsappId });

    let context = this.getOwnerContext(whatsappId);
    if (!context) {
      context = this.createOwnerContext(whatsappId);
    }

    const isAuthenticated = await ownerAuthService.isAuthenticated(whatsappId);

    if (isAuthenticated) {
      context.isAuthenticated = true;
      context.currentState = OwnerFlowState.MAIN_MENU;
      await this.showOwnerMainMenu(whatsappId);
    } else {
      context.currentState = OwnerFlowState.AUTH_REQUIRED;
      await this.showOwnerAuthentication(whatsappId);
    }

    this.updateContext(whatsappId, context);
  }

  async handleOwnerMessage(whatsappId: string, messageType: string, content: any): Promise<void> {
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
    } catch (error) {
      logger.error('Owner message handling failed', { whatsappId, error });
      await this.sendOwnerError(whatsappId, 'Something went wrong. Please try again.');
    }
  }

  // FIX 1: Proper text handling with exit command
  private async handleOwnerText(whatsappId: string, text: string, context: OwnerContext): Promise<void> {
    const cleanText = text.toLowerCase().trim();

    // FIXED: Exit command handling
    if (cleanText === 'exit' || cleanText === 'quit' || cleanText === 'back') {
      await this.exitOwnerMode(whatsappId);
      return;
    }

    // Handle login input
    if (context.waitingFor === 'business_name') {
      const trimmedText = text.trim();
      
      if (trimmedText.length < 3) {
        await this.sendOwnerError(whatsappId, 'Please provide valid business information (minimum 3 characters).');
        return;
      }

      await whatsappService.sendTextMessage(whatsappId, '🔍 Authenticating...');

      const authenticated = await ownerAuthService.authenticateByBusinessName(whatsappId, trimmedText);

      if (authenticated) {
        context.isAuthenticated = true;
        context.currentState = OwnerFlowState.MAIN_MENU;
        context.waitingFor = undefined;
        this.updateContext(whatsappId, context);

        await whatsappService.sendTextMessage(whatsappId, '✅ Authentication successful!');
        setTimeout(() => this.showOwnerMainMenu(whatsappId), 1000);
      } else {
        context.waitingFor = undefined;
        this.updateContext(whatsappId, context);
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Authentication failed. Please check your business name or contact support.'
        );
        setTimeout(() => this.showOwnerAuthentication(whatsappId), 2000);
      }
      return;
    }

    // Handle other commands
    const commands: Record<string, () => Promise<void>> = {
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
    } else {
      await this.sendOwnerError(whatsappId, `Unknown command. Type "help" or "exit" to leave.`);
    }
  }

  // FIX 2: Proper button handling
  private async handleOwnerButton(whatsappId: string, button: any, context: OwnerContext): Promise<void> {
    const { id: buttonId, title } = button;
    logger.info('🏢 Owner button pressed', { whatsappId, buttonId, title });

    // FIXED: Exit button handling
    if (buttonId === 'exit_owner_mode') {
      await this.exitOwnerMode(whatsappId);
      return;
    }

    // Parse button for routing
    const parsed = parseOwnerButtonId(buttonId);

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

  // FIX 3: Proper authentication screen
  private async showOwnerAuthentication(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🏢 *SharaSpot Owner Portal*\n\n' +
      '🔐 Authentication Required\n\n' +
      'Choose an option:'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔐 Owner Authentication',
        [
          { id: 'owner_register', title: '📝 Register' },
          { id: 'owner_login', title: '🔑 Login' },
          { id: 'exit_owner_mode', title: '🚪 Exit' }
        ]
      );
    }, 1000);
  }

  // FIX 4: Proper registration handler
  private async handleOwnerRegistration(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Owner Registration*\n\n' +
      'Registration is handled by our support team.\n\n' +
      '📞 Contact:\n' +
      '• Email: partner@folonite.in\n' +
      '• Phone: +91-9790294221'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '📝 Registration',
        [
          { id: 'owner_login', title: '🔑 Try Login' },
          { id: 'exit_owner_mode', title: '🚪 Exit' }
        ]
      );
    }, 2000);
  }

  // FIX 5: Proper login handler
  private async handleOwnerLogin(whatsappId: string): Promise<void> {
    const context = this.getOwnerContext(whatsappId);
    if (context) {
      context.waitingFor = 'business_name';
      this.updateContext(whatsappId, context);
    }

    await whatsappService.sendTextMessage(
      whatsappId,
      '🔑 *Owner Login*\n\n' +
      'Please provide your registered business name.\n\n' +
      'Example: "SharaSpot Parking Private Limited"\n\n' +
      'Type your business name:'
    );
  }

  private async showOwnerMainMenu(whatsappId: string): Promise<void> {
    const context = this.getOwnerContext(whatsappId);
    if (!context?.isAuthenticated) {
      await this.showOwnerAuthentication(whatsappId);
      return;
    }

    const ownerProfile = await ownerService.getOwnerProfile(whatsappId);

    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *Welcome ${ownerProfile?.name || 'Owner'}*\n\n` +
      `📊 Quick Stats:\n` +
      `• Stations: ${ownerProfile?.totalStations || 0}\n` +
      `• Status: ${ownerProfile?.isActive ? '🟢 Active' : '🔴 Inactive'}\n\n` +
      `What would you like to manage?`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎛️ Owner Dashboard',
        [
          { id: 'owner_stations', title: '🔌 My Stations' },
          { id: 'owner_profile', title: '👤 Profile' },
          { id: 'owner_analytics', title: '📊 Analytics' }
        ]
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '⚙️ More Options',
          [
            { id: 'owner_settings', title: '⚙️ Settings' },
            { id: 'owner_help_menu', title: '❓ Help' },
            { id: 'exit_owner_mode', title: '🚪 Exit' }
          ]
        );
      }, 1000);
    }, 1500);
  }

  // Placeholder methods (existing functionality)
  private async showStationManagement(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, '🔌 Station Management - Coming soon');
  }

  private async showOwnerProfile(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, '👤 Owner Profile - Coming soon');
  }

  private async showOwnerAnalytics(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, '📊 Analytics - Coming soon');
  }

  private async showOwnerSettings(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, '⚙️ Settings - Coming soon');
  }

  private async showOwnerHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '❓ *Owner Help*\n\n' +
      'Available commands:\n' +
      '• "menu" - Main dashboard\n' +
      '• "stations" - Manage stations\n' +
      '• "profile" - View profile\n' +
      '• "help" - This help\n' +
      '• "exit" - Leave owner mode'
    );
  }

  private async handleOwnerList(whatsappId: string, list: any, context: OwnerContext): Promise<void> {
    // Placeholder for list handling
    await this.sendOwnerError(whatsappId, 'List handling not implemented yet.');
  }

  // Utility methods
  isInOwnerMode(whatsappId: string): boolean {
    return this.ownerContexts.has(whatsappId);
  }

  // FIX 6: Proper exit functionality
  private async exitOwnerMode(whatsappId: string): Promise<void> {
    this.ownerContexts.delete(whatsappId);

    await whatsappService.sendTextMessage(
      whatsappId,
      '👋 *Exited Owner Mode*\n\n' +
      'You are now back to the regular interface.\n\n' +
      'Type "owner" to re-enter owner mode.\n' +
      'Type "help" for regular commands.'
    );

    logger.info('Owner mode exited', { whatsappId });
  }

  private async sendOwnerError(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *Owner Portal*\n\n❌ ${message}\n\n💡 Type "help" or "exit" to leave.`
    );
  }

  // Context management
  private getOwnerContext(whatsappId: string): OwnerContext | null {
    const context = this.ownerContexts.get(whatsappId);
    if (context && Date.now() - context.lastActivity.getTime() > this.CONTEXT_TIMEOUT) {
      this.ownerContexts.delete(whatsappId);
      return null;
    }
    return context || null;
  }

  private createOwnerContext(whatsappId: string): OwnerContext {
    const context: OwnerContext = {
      whatsappId,
      currentState: OwnerFlowState.AUTH_REQUIRED,
      isAuthenticated: false,
      lastActivity: new Date()
    };
    this.ownerContexts.set(whatsappId, context);
    return context;
  }

  private updateContext(whatsappId: string, context: OwnerContext): void {
    context.lastActivity = new Date();
    this.ownerContexts.set(whatsappId, context);
  }

  // Cleanup methods
  cleanupExpiredContexts(): void {
    const now = Date.now();
    for (const [whatsappId, context] of this.ownerContexts.entries()) {
      if (now - context.lastActivity.getTime() > this.CONTEXT_TIMEOUT) {
        this.ownerContexts.delete(whatsappId);
        logger.info('Owner context expired and cleaned up', { whatsappId });
      }
    }
  }

  getActiveContextsCount(): number {
    return this.ownerContexts.size;
  }
}

export const ownerWebhookController = new OwnerWebhookController();