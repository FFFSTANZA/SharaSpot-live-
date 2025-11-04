"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
class WhatsAppService {
    constructor() {
        this.baseUrl = `https://graph.facebook.com/v18.0/${env_1.env.PHONE_NUMBER_ID}/messages`;
        this.headers = {
            'Authorization': `Bearer ${env_1.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
        };
    }
    async sendTextMessage(to, message) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                text: { body: this.truncateText(message, 4096) },
            };
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Text message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Text message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendButtonMessage(to, body, buttons, header) {
        try {
            const validatedButtons = buttons.slice(0, 3).map(btn => ({
                type: "reply",
                reply: {
                    id: btn.id,
                    title: this.truncateText(btn.title, 20),
                },
            }));
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: this.truncateText(body, 1024) },
                    action: { buttons: validatedButtons },
                },
            };
            if (header?.trim()) {
                payload.interactive.header = {
                    type: 'text',
                    text: this.truncateText(header, 60),
                };
            }
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Button message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Button message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendListMessage(to, body, buttonText, sections, header) {
        try {
            const validatedSections = sections.slice(0, 10).map(section => ({
                title: this.truncateText(section.title, 24),
                rows: section.rows.slice(0, 10).map(row => ({
                    id: row.id,
                    title: this.truncateText(row.title, 24),
                    description: row.description ? this.truncateText(row.description, 72) : undefined,
                })),
            }));
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'list',
                    body: { text: this.truncateText(body, 1024) },
                    action: {
                        button: this.truncateText(buttonText, 20),
                        sections: validatedSections,
                    },
                },
            };
            if (header?.trim()) {
                payload.interactive.header = {
                    type: 'text',
                    text: this.truncateText(header, 60),
                };
            }
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ List message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ List message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendLocationMessage(to, latitude, longitude, name, address) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'location',
                location: {
                    latitude,
                    longitude,
                    name: this.truncateText(name, 1000),
                    address: this.truncateText(address, 1000),
                },
            };
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Location message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Location message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendTemplateMessage(to, templateName, parameters = []) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: 'en' },
                    components: parameters.length > 0 ? [
                        {
                            type: 'body',
                            parameters: parameters.map(param => ({
                                type: 'text',
                                text: this.truncateText(param, 1000),
                            })),
                        },
                    ] : [],
                },
            };
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Template message sent', {
                to,
                templateName,
                messageId: response.messages[0].id
            });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Template message failed', {
                to,
                templateName,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async markAsRead(messageId) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
            };
            await this.makeRequest(payload);
            logger_1.logger.debug('✅ Message marked as read', { messageId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Mark as read failed', {
                messageId,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendImageMessage(to, imageUrl, caption) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'image',
                image: {
                    link: imageUrl,
                    caption: caption ? this.truncateText(caption, 1024) : undefined,
                },
            };
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Image message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Image message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendDocumentMessage(to, documentUrl, filename, caption) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'document',
                document: {
                    link: documentUrl,
                    filename: filename ? this.truncateText(filename, 255) : undefined,
                    caption: caption ? this.truncateText(caption, 1024) : undefined,
                },
            };
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Document message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Document message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendContactMessage(to, contacts) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'contacts',
                contacts: contacts.slice(0, 5),
            };
            const response = await this.makeRequest(payload);
            logger_1.logger.info('✅ Contact message sent', { to, messageId: response.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Contact message failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendTypingIndicator(to) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: '⌨️ Typing...' },
            };
            await this.makeRequest(payload);
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Typing indicator failed', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    truncateText(text, maxLength) {
        if (!text)
            return '';
        const trimmed = text.trim();
        if (trimmed.length <= maxLength)
            return trimmed;
        return trimmed.substring(0, maxLength - 3) + '...';
    }
    async makeRequest(payload) {
        const response = await axios_1.default.post(this.baseUrl, payload, {
            headers: this.headers,
            timeout: 30000,
        });
        return response.data;
    }
    isValidPhoneNumber(phoneNumber) {
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        return phoneRegex.test(phoneNumber.replace(/\s+/g, ''));
    }
    formatPhoneNumber(phoneNumber) {
        let formatted = phoneNumber.replace(/[^\d+]/g, '');
        if (!formatted.startsWith('+') && formatted.length > 10) {
            formatted = '+' + formatted;
        }
        return formatted;
    }
    getMessageType(payload) {
        if (payload.type)
            return payload.type;
        if (payload.text)
            return 'text';
        if (payload.interactive)
            return 'interactive';
        return 'unknown';
    }
    async sendBulkTextMessages(recipients, message, delayMs = 1000) {
        let success = 0;
        let failed = 0;
        for (const recipient of recipients) {
            try {
                const sent = await this.sendTextMessage(recipient, message);
                if (sent)
                    success++;
                else
                    failed++;
                if (delayMs > 0) {
                    await this.delay(delayMs);
                }
            }
            catch (error) {
                failed++;
                logger_1.logger.error('Bulk message failed', { recipient, error });
            }
        }
        logger_1.logger.info('Bulk messages completed', { success, failed, total: recipients.length });
        return { success, failed };
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async testConnection() {
        try {
            await axios_1.default.post(this.baseUrl, {
                messaging_product: 'whatsapp',
                to: '1234567890',
                text: { body: 'test' },
            }, {
                headers: this.headers,
                timeout: 5000,
            });
            return true;
        }
        catch (error) {
            if (error.response?.status === 400) {
                return true;
            }
            logger_1.logger.error('WhatsApp API test failed', { error: error.message });
            return false;
        }
    }
    getHealthStatus() {
        return {
            service: 'whatsapp',
            status: 'healthy',
            baseUrl: this.baseUrl,
            hasToken: !!env_1.env.WHATSAPP_TOKEN,
            hasPhoneId: !!env_1.env.PHONE_NUMBER_ID,
        };
    }
}
exports.whatsappService = new WhatsAppService();
//# sourceMappingURL=whatsapp.js.map