import { whatsappService } from './whatsapp';
import { userService } from './userService';
import { logger } from '../utils/logger';
import { type User } from '../db/schema';
/**
 * Type for WhatsApp Business API profile response
 */
interface WhatsAppProfileResponse {
  name?: string;
  profile?: {
    name?: string;
  };
}

export class ProfileService {
  /**
   * Extract and update user profile from WhatsApp
   */
  async updateUserProfileFromWhatsApp(whatsappId: string): Promise<void> {
    try {
      const profileData = await this.fetchWhatsAppProfile(whatsappId);

      if (profileData) {
        await userService.updateUserProfile(whatsappId, {
          name: profileData.name,
          phoneNumber: profileData.phoneNumber,
        });

        logger.info('Profile updated from WhatsApp', { whatsappId, profileData });
      }
    } catch (error) {
      logger.error('Failed to update profile from WhatsApp', { whatsappId, error });
    }
  }

  /**
   * Fetch user profile from WhatsApp Business API
   */
  private async fetchWhatsAppProfile(whatsappId: string): Promise<{ name?: string; phoneNumber?: string } | null> {
    try {
      logger.info('Fetching WhatsApp profile', { whatsappId });

      const profileUrl = `https://graph.facebook.com/v18.0/${whatsappId}`;

      const response = await fetch(profileUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn('WhatsApp profile not found', { whatsappId, status: response.status });
          return { phoneNumber: whatsappId };
        }

        logger.error('WhatsApp API error', {
          whatsappId,
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }

      const data = (await response.json()) as WhatsAppProfileResponse;

      const result = {
        phoneNumber: whatsappId,
        name: data.profile?.name || data.name || undefined,
      };

      logger.info('WhatsApp profile fetched successfully', { whatsappId, hasName: !!result.name });
      return result;
    } catch (error) {
      logger.error('Failed to fetch WhatsApp profile', { whatsappId, error });
      return { phoneNumber: whatsappId };
    }
  }

  /**
   * Request user name if not available
   */
  async requestUserName(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '👋 *What should I call you?*\n\n' +
        'Please tell me your name so I can personalize your experience!\n\n' +
        'Just type your name (e.g., "Ravi" or "Priya")'
    );
  }

  /**
   * Update user name from text input
   */
  async updateUserName(whatsappId: string, name: string): Promise<boolean> {
    try {
      const cleanName = name.trim();
      if (cleanName.length < 2 || cleanName.length > 50) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Please provide a valid name (2-50 characters).'
        );
        return false;
      }

      const updatedUser = await userService.updateUserProfile(whatsappId, { name: cleanName });

      if (updatedUser) {
        await whatsappService.sendTextMessage(
          whatsappId,
          `✅ Nice to meet you, *${cleanName}*! 👋\n\nLet's set up your EV charging preferences.`
        );
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to update user name', { whatsappId, name, error });
      return false;
    }
  }

  /**
   * Show user profile summary (without charging history)
   */
  async showProfileSummary(whatsappId: string): Promise<void> {
    try {
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Profile not found. Please start with "hi".'
        );
        return;
      }

      const profileText = `👤 *Your Profile*\n\n` +
        `📱 Name: ${user.name || 'Not set'}\n` +
        `📞 Phone: ${user.phoneNumber || whatsappId}\n` +
        `🚗 EV Model: ${user.evModel || 'Not specified'}\n` +
        `🔌 Connector: ${user.connectorType || 'Not set'}\n` +
        `⚡ Charging Style: ${user.chargingIntent || 'Not set'}\n` +
        `🚶‍♂️ Queue Preference: ${user.queuePreference || 'Not set'}\n` +
        `✅ Preferences Complete: ${user.preferencesCaptured ? 'Yes' : 'No'}\n` +
        `📅 Member Since: ${user.createdAt ? user.createdAt.toLocaleDateString() : 'Unknown'}`;

      await whatsappService.sendButtonMessage(
        whatsappId,
        profileText,
        [
          { id: 'update_preferences', title: '🔄 Update Preferences' },
          { id: 'update_profile', title: '✏️ Update Name' },
        ],
        '👤 Your Profile'
      );
    } catch (error) {
      logger.error('Failed to show profile summary', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load profile. Please try again.'
      );
    }
  }

  /**
   * Update user profile with new information
   */
 async updateUserProfile(
  whatsappId: string,
  updates: { name?: string; phoneNumber?: string }
): Promise<User | null> {
  try {
    // Call the userService (database layer)
    const updatedUser = await userService.updateUserProfile(whatsappId, updates);
    
    if (updatedUser) {
      logger.info('Profile updated successfully', { whatsappId, updates });
      
      let updateMessage = `✅ *Profile Updated!*\n\nYour profile has been successfully updated.\n\nUpdated information:\n`;
      if (updates.name) updateMessage += `• Name: ${updates.name}\n`;
      if (updates.phoneNumber) updateMessage += `• Phone: ${updates.phoneNumber}\n`;
      updateMessage += `\nType "profile" anytime to view your complete profile.`;
      
      await whatsappService.sendTextMessage(whatsappId, updateMessage);
      return updatedUser;
    }
    
    throw new Error('Update failed: No user returned');
  } catch (error) {
    logger.error('Failed to update user profile', { whatsappId, updates, error });
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ Failed to update your profile. Please try again later.'
    );
    return null;
  }
}
}

export const profileService = new ProfileService();