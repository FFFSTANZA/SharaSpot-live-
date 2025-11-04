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
  private readonly CONTEXT_TIMEOUT = 30 * 60 * 1000;

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

  private async handleOwnerText(whatsappId: string, text: string, context: OwnerContext): Promise<void> {
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

  private async handleOwnerButton(whatsappId: string, button: any, context: OwnerContext): Promise<void> {
    const { id: buttonId, title } = button;
    logger.info('🏢 Owner button pressed', { whatsappId, buttonId, title });

    if (buttonId === 'exit_owner_mode') {
      await this.exitOwnerMode(whatsappId);
      return;
    }

    const parsed = parseOwnerButtonId(buttonId);

    switch (parsed.action || buttonId.replace('owner_', '')) {
      case 'register':
        await this.handleOwnerRegistration(whatsappId);
        break;
      case 'login':
        await this.handleOwnerLogin(whatsappId);
        break;
      case 'stations':
        context.currentState = OwnerFlowState.STATION_MANAGEMENT;
        this.updateContext(whatsappId, context);
        await this.showStationManagement(whatsappId);
        break;
      case 'profile':
        context.currentState = OwnerFlowState.PROFILE_MANAGEMENT;
        this.updateContext(whatsappId, context);
        await this.showOwnerProfile(whatsappId);
        break;
      case 'analytics':
        context.currentState = OwnerFlowState.ANALYTICS;
        this.updateContext(whatsappId, context);
        await this.showOwnerAnalytics(whatsappId);
        break;
      case 'settings':
        context.currentState = OwnerFlowState.SETTINGS;
        this.updateContext(whatsappId, context);
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
      case 'view':
      case 'select':
        if (parsed.stationId) {
          await this.handleStationSelection(whatsappId, parsed.stationId);
        }
        break;
      case 'toggle_station':
        if (parsed.stationId) {
          await this.handleStationToggle(whatsappId, parsed.stationId);
        }
        break;
      case 'view_queue':
        if (context.selectedStationId) {
          await this.showStationQueue(whatsappId, context.selectedStationId);
        }
        break;
      case 'view_analytics':
        if (context.selectedStationId) {
          await this.showStationAnalytics(whatsappId, context.selectedStationId);
        }
        break;
      case 'back_to_stations':
        await this.showStationManagement(whatsappId);
        break;
      default:
        await this.sendOwnerError(whatsappId, 'Unknown action. Please try again.');
    }
  }

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
      `Quick Stats:\n` +
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

  private async showStationManagement(whatsappId: string): Promise<void> {
    try {
      const stations = await ownerStationService.getOwnerStations(whatsappId);

      if (!stations || stations.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📭 *No Stations Found*\n\n' +
          'You haven\'t registered any charging stations yet.\n\n' +
          'Contact support to register your first station:\n' +
          '📧 partner@folonite.in\n' +
          '📞 +91-9790294221'
        );
        
        setTimeout(async () => {
          await whatsappService.sendButtonMessage(
            whatsappId,
            'Options',
            [{ id: 'owner_menu', title: '🏠 Main Menu' }]
          );
        }, 1500);
        return;
      }

      const stationList = stations.map((station, index) => 
        `${index + 1}. *${station.name}*\n` +
        `   📍 ${station.address.substring(0, 50)}${station.address.length > 50 ? '...' : ''}\n` +
        `   ${station.isActive ? '🟢 Active' : '🔴 Inactive'} • ` +
        `${station.isOpen ? '🔓 Open' : '🔒 Closed'}\n` +
        `   💡 ${station.availableSlots}/${station.totalSlots} slots • ` +
        `₹${station.pricePerKwh}/kWh\n`
      ).join('\n');

      await whatsappService.sendTextMessage(
        whatsappId,
        `🔌 *Your Charging Stations (${stations.length})*\n\n${stationList}\n\n💡 Select a station to manage:`
      );

      setTimeout(async () => {
        const buttons = stations.slice(0, 3).map(station => ({
          id: `owner_view_station_${station.id}`,
          title: `${station.name.substring(0, 20)}`
        }));

        await whatsappService.sendButtonMessage(whatsappId, 'Select Station', buttons);

        if (stations.length > 3) {
          setTimeout(async () => {
            const moreButtons = stations.slice(3, 6).map(station => ({
              id: `owner_view_station_${station.id}`,
              title: `${station.name.substring(0, 20)}`
            }));
            await whatsappService.sendButtonMessage(whatsappId, 'More Stations', moreButtons);
          }, 1000);
        }

        setTimeout(async () => {
          await whatsappService.sendButtonMessage(
            whatsappId,
            'Navigation',
            [{ id: 'owner_menu', title: '🏠 Main Menu' }]
          );
        }, stations.length > 3 ? 2000 : 1000);
      }, 1500);

    } catch (error) {
      logger.error('Failed to show station management', { whatsappId, error });
      await this.sendOwnerError(whatsappId, 'Failed to load stations. Please try again.');
    }
  }

  private async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    try {
      const context = this.getOwnerContext(whatsappId);
      if (context) {
        context.selectedStationId = stationId;
        this.updateContext(whatsappId, context);
      }

      const station = await ownerStationService.getStationDetails(stationId, whatsappId);
      if (!station) {
        await this.sendOwnerError(whatsappId, 'Station not found or access denied.');
        return;
      }

      const analytics = await ownerStationService.getStationAnalytics(stationId);
      
      const utilizationColor = (analytics?.utilizationRate || 0) > 80 ? '🔴' : 
                               (analytics?.utilizationRate || 0) > 50 ? '🟡' : '🟢';

      await whatsappService.sendTextMessage(
        whatsappId,
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

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Station Actions',
          [
            { id: `owner_toggle_station_${stationId}`, title: station.isActive ? '🔴 Deactivate' : '🟢 Activate' },
            { id: `owner_view_queue_${stationId}`, title: '👥 View Queue' },
            { id: `owner_view_analytics_${stationId}`, title: '📊 Analytics' }
          ]
        );

        setTimeout(async () => {
          await whatsappService.sendButtonMessage(
            whatsappId,
            'Navigation',
            [
              { id: 'owner_back_to_stations', title: '◀️ Back to Stations' },
              { id: 'owner_menu', title: '🏠 Main Menu' }
            ]
          );
        }, 1000);
      }, 1500);

    } catch (error) {
      logger.error('Failed to show station details', { whatsappId, stationId, error });
      await this.sendOwnerError(whatsappId, 'Failed to load station details.');
    }
  }

  private async handleStationToggle(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, '⏳ Updating station status...');

      const success = await ownerStationService.toggleStationStatus(stationId, whatsappId);

      if (success) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '✅ *Station Status Updated*\n\nThe station status has been changed successfully.'
        );
        
        setTimeout(() => this.handleStationSelection(whatsappId, stationId), 1500);
      } else {
        await this.sendOwnerError(whatsappId, 'Failed to update station status. Please try again.');
      }

    } catch (error) {
      logger.error('Failed to toggle station', { whatsappId, stationId, error });
      await this.sendOwnerError(whatsappId, 'An error occurred while updating station status.');
    }
  }

  private async showStationQueue(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '👥 *Queue Status*\n\n' +
        'Real-time queue monitoring coming soon!\n\n' +
        'You will be able to:\n' +
        '• View all users in queue\n' +
        '• See estimated wait times\n' +
        '• Manage queue priority'
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Back',
          [{ id: `owner_view_station_${stationId}`, title: '◀️ Back to Station' }]
        );
      }, 1500);

    } catch (error) {
      logger.error('Failed to show queue', { whatsappId, stationId, error });
      await this.sendOwnerError(whatsappId, 'Failed to load queue information.');
    }
  }

  private async showStationAnalytics(whatsappId: string, stationId: number): Promise<void> {
    try {
      const analytics = await ownerStationService.getStationAnalytics(stationId);

      await whatsappService.sendTextMessage(
        whatsappId,
        `📊 *Station Analytics*\n\n` +
        `🌟 *Today's Performance:*\n` +
        `• ${analytics.todaySessions} charging sessions\n` +
        `• ₹${analytics.todayRevenue} revenue\n` +
        `• ${analytics.todayEnergy} kWh delivered\n` +
        `• ${analytics.averageSessionDuration} min avg duration\n\n` +
        `📈 *Current Status:*\n` +
        `• Queue: ${analytics.queueLength} waiting\n` +
        `• Utilization: ${analytics.utilizationRate}%\n\n` +
        `💡 *Insights:* ${analytics.utilizationRate > 80 ? 'High demand!' : analytics.utilizationRate > 50 ? 'Moderate usage' : 'Low utilization'}`
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Back',
          [{ id: `owner_view_station_${stationId}`, title: '◀️ Back to Station' }]
        );
      }, 1500);

    } catch (error) {
      logger.error('Failed to show station analytics', { whatsappId, stationId, error });
      await this.sendOwnerError(whatsappId, 'Failed to load analytics.');
    }
  }

  private async showOwnerProfile(whatsappId: string): Promise<void> {
    try {
      const profile = await ownerAuthService.getOwnerProfile(whatsappId);

      if (!profile) {
        await this.sendOwnerError(whatsappId, 'Failed to load profile.');
        return;
      }

      const verificationStatus = profile.isVerified ? '✅ Verified' : 
                                 profile.kycStatus === 'pending' ? '⏳ Pending' : 
                                 profile.kycStatus === 'rejected' ? '❌ Rejected' : '📋 Required';

      await whatsappService.sendTextMessage(
        whatsappId,
        `👤 *${profile.name}*\n` +
        `🏢 ${profile.businessName || 'Individual Owner'}\n\n` +
        `📋 *Business Details:*\n` +
        `• Type: ${profile.businessType || 'Not specified'}\n` +
        `• GST: ${profile.gstNumber || 'Not provided'}\n` +
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

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Profile Actions',
          [
            { id: 'owner_menu', title: '🏠 Main Menu' }
          ]
        );
      }, 1500);

    } catch (error) {
      logger.error('Failed to show owner profile', { whatsappId, error });
      await this.sendOwnerError(whatsappId, 'Failed to load profile.');
    }
  }

  private async showOwnerAnalytics(whatsappId: string): Promise<void> {
    try {
      const analytics = await ownerService.getOwnerAnalytics(whatsappId);

      if (!analytics) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📊 *Analytics Dashboard*\n\n' +
          'No analytics data available yet.\n\n' +
          'Start getting customers to see your performance metrics!'
        );
        
        setTimeout(async () => {
          await whatsappService.sendButtonMessage(
            whatsappId,
            'Back',
            [{ id: 'owner_menu', title: '🏠 Main Menu' }]
          );
        }, 1500);
        return;
      }

      const growthEmoji = analytics.weekGrowth > 0 ? '📈' : 
                         analytics.weekGrowth < 0 ? '📉' : '📊';

      await whatsappService.sendTextMessage(
        whatsappId,
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

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Back',
          [{ id: 'owner_menu', title: '🏠 Main Menu' }]
        );
      }, 1500);

    } catch (error) {
      logger.error('Failed to show owner analytics', { whatsappId, error });
      await this.sendOwnerError(whatsappId, 'Failed to load analytics.');
    }
  }

  private async showOwnerSettings(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⚙️ *Settings*\n\n' +
      'Settings management coming soon!\n\n' +
      'You will be able to configure:\n' +
      '• Notification preferences\n' +
      '• Account settings\n' +
      '• Payment methods\n' +
      '• Support & Help'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Back',
        [{ id: 'owner_menu', title: '🏠 Main Menu' }]
      );
    }, 1500);
  }

  private async showOwnerHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '❓ *Owner Help*\n\n' +
      'Available commands:\n' +
      '• "menu" - Main dashboard\n' +
      '• "stations" - Manage stations\n' +
      '• "profile" - View profile\n' +
      '• "analytics" - View analytics\n' +
      '• "help" - This help\n' +
      '• "exit" - Leave owner mode\n\n' +
      '📞 *Support:*\n' +
      '• Email: partner@folonite.in\n' +
      '• Phone: +91-9790294221'
    );
  }

  private async handleOwnerList(whatsappId: string, list: any, context: OwnerContext): Promise<void> {
    await this.sendOwnerError(whatsappId, 'List handling not implemented yet.');
  }

  isInOwnerMode(whatsappId: string): boolean {
    return this.ownerContexts.has(whatsappId);
  }

  private async exitOwnerMode(whatsappId: string): Promise<void> {
    this.ownerContexts.delete(whatsappId);

    await whatsappService.sendTextMessage(
      whatsappId,
      '*Exited Owner Mode*\n\n' +
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