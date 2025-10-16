// src/services/whatsapp.ts - ENHANCED & EFFICIENT
import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ButtonMessage, ListMessage, LocationMessage } from '../types/whatsapp';

// ===============================================
// INTERFACES & TYPES
// ===============================================

interface WhatsAppButtonData {
  id: string;
  title: string;
}

interface WhatsAppListRow {
  id: string;
  title: string;
  description?: string;
}

interface WhatsAppListSection {
  title: string;
  rows: WhatsAppListRow[];
}

interface WhatsAppResponse {
  messages: Array<{ id: string }>;
}

// ===============================================
// WHATSAPP SERVICE CLASS
// ===============================================

class WhatsAppService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor() {
    this.baseUrl = `https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`;
    this.headers = {
      'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send text message with validation
   */
  async sendTextMessage(to: string, message: string): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        text: { body: this.truncateText(message, 4096) }, // WhatsApp text limit
      };

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Text message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ Text message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send button message with enhanced validation
   */
  async sendButtonMessage(
    to: string, 
    body: string, 
    buttons: WhatsAppButtonData[], 
    header?: string
  ): Promise<boolean> {
    try {
      // Validate and truncate button titles (20 char max)
      const validatedButtons = buttons.slice(0, 3).map(btn => ({
        type: "reply" as const,
        reply: {
          id: btn.id,
          title: this.truncateText(btn.title, 20),
        },
      }));

      const payload: ButtonMessage = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: this.truncateText(body, 1024) },
          action: { buttons: validatedButtons },
        },
      };

      // Add header if provided
      if (header?.trim()) {
        payload.interactive.header = {
          type: 'text',
          text: this.truncateText(header, 60),
        };
      }

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Button message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ Button message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send list message with comprehensive validation
   */
  async sendListMessage(
    to: string, 
    body: string, 
    buttonText: string,
    sections: WhatsAppListSection[],
    header?: string
  ): Promise<boolean> {
    try {
      // Validate sections and rows
      const validatedSections = sections.slice(0, 10).map(section => ({
        title: this.truncateText(section.title, 24),
        rows: section.rows.slice(0, 10).map(row => ({
          id: row.id,
          title: this.truncateText(row.title, 24),
          description: row.description ? this.truncateText(row.description, 72) : undefined,
        })),
      }));

      const payload: ListMessage = {
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

      // Add header if provided
      if (header?.trim()) {
        payload.interactive.header = {
          type: 'text',
          text: this.truncateText(header, 60),
        };
      }

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ List message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ List message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send location message
   */
  async sendLocationMessage(
    to: string, 
    latitude: number, 
    longitude: number, 
    name: string, 
    address: string
  ): Promise<boolean> {
    try {
      const payload: LocationMessage = {
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

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Location message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ Location message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send template message
   */
  async sendTemplateMessage(
    to: string, 
    templateName: string, 
    parameters: string[] = []
  ): Promise<boolean> {
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

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Template message sent', { 
        to, 
        templateName, 
        messageId: response.messages[0].id 
      });
      return true;

    } catch (error: any) {
      logger.error('❌ Template message failed', {
        to,
        templateName,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };

      await this.makeRequest(payload);
      logger.debug('✅ Message marked as read', { messageId });
      return true;

    } catch (error: any) {
      logger.error('❌ Mark as read failed', {
        messageId,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send image message with caption
   */
  async sendImageMessage(
    to: string, 
    imageUrl: string, 
    caption?: string
  ): Promise<boolean> {
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

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Image message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ Image message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send document message
   */
  async sendDocumentMessage(
    to: string, 
    documentUrl: string, 
    filename?: string, 
    caption?: string
  ): Promise<boolean> {
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

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Document message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ Document message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send contact message
   */
  async sendContactMessage(
    to: string, 
    contacts: Array<{
      name: { formatted_name: string; first_name?: string; last_name?: string };
      phones?: Array<{ phone: string; type?: string }>;
      emails?: Array<{ email: string; type?: string }>;
    }>
  ): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'contacts',
        contacts: contacts.slice(0, 5), // Max 5 contacts
      };

      const response = await this.makeRequest<WhatsAppResponse>(payload);
      logger.info('✅ Contact message sent', { to, messageId: response.messages[0].id });
      return true;

    } catch (error: any) {
      logger.error('❌ Contact message failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(to: string): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: '⌨️ Typing...' },
      };

      await this.makeRequest(payload);
      return true;

    } catch (error: any) {
      logger.error('❌ Typing indicator failed', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  /**
   * Truncate text to specified length with ellipsis
   */
  private truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    
    const trimmed = text.trim();
    if (trimmed.length <= maxLength) return trimmed;
    
    return trimmed.substring(0, maxLength - 3) + '...';
  }

  /**
   * Make HTTP request with error handling
   */
  private async makeRequest<T = any>(payload: any): Promise<T> {
    const response = await axios.post(this.baseUrl, payload, {
      headers: this.headers,
      timeout: 30000, // 30 second timeout
    });

    return response.data;
  }

  /**
   * Validate phone number format
   */
  private isValidPhoneNumber(phoneNumber: string): boolean {
    // Basic validation for international phone numbers
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber.replace(/\s+/g, ''));
  }

  /**
   * Format phone number for WhatsApp
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove spaces and special characters, keep only digits and +
    let formatted = phoneNumber.replace(/[^\d+]/g, '');
    
    // Add + if missing for international numbers
    if (!formatted.startsWith('+') && formatted.length > 10) {
      formatted = '+' + formatted;
    }
    
    return formatted;
  }

  /**
   * Get message type from payload
   */
  private getMessageType(payload: any): string {
    if (payload.type) return payload.type;
    if (payload.text) return 'text';
    if (payload.interactive) return 'interactive';
    return 'unknown';
  }

  // ===============================================
  // BULK OPERATIONS
  // ===============================================

  /**
   * Send bulk text messages (rate limited)
   */
  async sendBulkTextMessages(
    recipients: string[], 
    message: string,
    delayMs: number = 1000
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        const sent = await this.sendTextMessage(recipient, message);
        if (sent) success++;
        else failed++;
        
        // Rate limiting delay
        if (delayMs > 0) {
          await this.delay(delayMs);
        }
      } catch (error) {
        failed++;
        logger.error('Bulk message failed', { recipient, error });
      }
    }

    logger.info('Bulk messages completed', { success, failed, total: recipients.length });
    return { success, failed };
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===============================================
  // HEALTH & MONITORING
  // ===============================================

  /**
   * Test WhatsApp API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      // Send a test message to a dummy number (will fail but test API access)
      await axios.post(this.baseUrl, {
        messaging_product: 'whatsapp',
        to: '1234567890',
        text: { body: 'test' },
      }, {
        headers: this.headers,
        timeout: 5000,
      });
      
      return true;
    } catch (error: any) {
      // If error is about invalid phone number, API is working
      if (error.response?.status === 400) {
        return true;
      }
      
      logger.error('WhatsApp API test failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      service: 'whatsapp',
      status: 'healthy',
      baseUrl: this.baseUrl,
      hasToken: !!env.WHATSAPP_TOKEN,
      hasPhoneId: !!env.PHONE_NUMBER_ID,
    };
  }
}

// ===============================================
// SINGLETON EXPORT
// ===============================================

export const whatsappService = new WhatsAppService();