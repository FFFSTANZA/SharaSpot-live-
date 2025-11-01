

/**
 * WhatsApp message types as defined by the WhatsApp Business Platform API.
 * Includes 'system' to handle group events, admin changes, etc.
 */
export type WhatsAppMessageType =
  | 'text'
  | 'button'
  | 'interactive'
  | 'location'
  | 'system'; // ← Critical fix: WhatsApp *does* send this

/**
 * Represents a single message from WhatsApp webhook
 */
export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: WhatsAppMessageType; // ← Now includes 'system'
  
  
  text?: {
    body: string;
  };

  
  button?: {
    text: string;
    payload: string;
  };

  
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
    };
  };

  
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  
  system?: {
    body?: string;
    
  };
}

/**
 * Full webhook payload structure from WhatsApp
 */
export interface WhatsAppWebhook {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: WhatsAppMessage[];
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }>;
      };
    }>;
  }>;
}



export interface ButtonMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    header?: {
      type: 'text';
      text: string;
    };
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: {
      buttons: Array<{
        type: 'reply';
        reply: {
          id: string;
          title: string;
        };
      }>;
    };
  };
}

export interface ListMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'list';
    header?: {
      type: 'text';
      text: string;
    };
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: {
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };
  };
}

export interface LocationMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'location';
  location: {
    latitude: number;
    longitude: number;
    name: string;
    address: string;
  };
}