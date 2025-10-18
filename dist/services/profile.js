"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileService = exports.ProfileService = void 0;
const whatsapp_1 = require("./whatsapp");
const userService_1 = require("./userService");
const logger_1 = require("../utils/logger");
class ProfileService {
    async updateUserProfileFromWhatsApp(whatsappId) {
        try {
            const profileData = await this.fetchWhatsAppProfile(whatsappId);
            if (profileData) {
                await userService_1.userService.updateUserProfile(whatsappId, {
                    name: profileData.name,
                    phoneNumber: profileData.phoneNumber,
                });
                logger_1.logger.info('Profile updated from WhatsApp', { whatsappId, profileData });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to update profile from WhatsApp', { whatsappId, error });
        }
    }
    async fetchWhatsAppProfile(whatsappId) {
        try {
            logger_1.logger.info('Fetching WhatsApp profile', { whatsappId });
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
                    logger_1.logger.warn('WhatsApp profile not found', { whatsappId, status: response.status });
                    return { phoneNumber: whatsappId };
                }
                logger_1.logger.error('WhatsApp API error', {
                    whatsappId,
                    status: response.status,
                    statusText: response.statusText,
                });
                return null;
            }
            const data = (await response.json());
            const result = {
                phoneNumber: whatsappId,
                name: data.profile?.name || data.name || undefined,
            };
            logger_1.logger.info('WhatsApp profile fetched successfully', { whatsappId, hasName: !!result.name });
            return result;
        }
        catch (error) {
            logger_1.logger.error('Failed to fetch WhatsApp profile', { whatsappId, error });
            return { phoneNumber: whatsappId };
        }
    }
    async requestUserName(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '👋 *What should I call you?*\n\n' +
            'Please tell me your name so I can personalize your experience!\n\n' +
            'Just type your name (e.g., "Ravi" or "Priya")');
    }
    async updateUserName(whatsappId, name) {
        try {
            const cleanName = name.trim();
            if (cleanName.length < 2 || cleanName.length > 50) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid name (2-50 characters).');
                return false;
            }
            const updatedUser = await userService_1.userService.updateUserProfile(whatsappId, { name: cleanName });
            if (updatedUser) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ Nice to meet you, *${cleanName}*! 👋\n\nLet's set up your EV charging preferences.`);
                return true;
            }
            return false;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user name', { whatsappId, name, error });
            return false;
        }
    }
    async showProfileSummary(whatsappId) {
        try {
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Profile not found. Please start with "hi".');
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
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, profileText, [
                { id: 'update_preferences', title: '🔄 Update Preferences' },
                { id: 'update_profile', title: '✏️ Update Name' },
            ], '👤 Your Profile');
        }
        catch (error) {
            logger_1.logger.error('Failed to show profile summary', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load profile. Please try again.');
        }
    }
    async updateUserProfile(whatsappId, updates) {
        try {
            const updatedUser = await userService_1.userService.updateUserProfile(whatsappId, updates);
            if (updatedUser) {
                logger_1.logger.info('Profile updated successfully', { whatsappId, updates });
                let updateMessage = `✅ *Profile Updated!*\n\nYour profile has been successfully updated.\n\nUpdated information:\n`;
                if (updates.name)
                    updateMessage += `• Name: ${updates.name}\n`;
                if (updates.phoneNumber)
                    updateMessage += `• Phone: ${updates.phoneNumber}\n`;
                updateMessage += `\nType "profile" anytime to view your complete profile.`;
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, updateMessage);
                return updatedUser;
            }
            throw new Error('Update failed: No user returned');
        }
        catch (error) {
            logger_1.logger.error('Failed to update user profile', { whatsappId, updates, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to update your profile. Please try again later.');
            return null;
        }
    }
}
exports.ProfileService = ProfileService;
exports.profileService = new ProfileService();
//# sourceMappingURL=profile.js.map