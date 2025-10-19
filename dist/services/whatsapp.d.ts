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
declare class WhatsAppService {
    private readonly baseUrl;
    private readonly headers;
    constructor();
    sendTextMessage(to: string, message: string): Promise<boolean>;
    sendButtonMessage(to: string, body: string, buttons: WhatsAppButtonData[], header?: string): Promise<boolean>;
    sendListMessage(to: string, body: string, buttonText: string, sections: WhatsAppListSection[], header?: string): Promise<boolean>;
    sendLocationMessage(to: string, latitude: number, longitude: number, name: string, address: string): Promise<boolean>;
    sendTemplateMessage(to: string, templateName: string, parameters?: string[]): Promise<boolean>;
    markAsRead(messageId: string): Promise<boolean>;
    sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<boolean>;
    sendDocumentMessage(to: string, documentUrl: string, filename?: string, caption?: string): Promise<boolean>;
    sendContactMessage(to: string, contacts: Array<{
        name: {
            formatted_name: string;
            first_name?: string;
            last_name?: string;
        };
        phones?: Array<{
            phone: string;
            type?: string;
        }>;
        emails?: Array<{
            email: string;
            type?: string;
        }>;
    }>): Promise<boolean>;
    sendTypingIndicator(to: string): Promise<boolean>;
    private truncateText;
    private makeRequest;
    private isValidPhoneNumber;
    private formatPhoneNumber;
    private getMessageType;
    sendBulkTextMessages(recipients: string[], message: string, delayMs?: number): Promise<{
        success: number;
        failed: number;
    }>;
    private delay;
    testConnection(): Promise<boolean>;
    getHealthStatus(): {
        service: string;
        status: string;
        baseUrl: string;
        hasToken: boolean;
        hasPhoneId: boolean;
    };
}
export declare const whatsappService: WhatsAppService;
export {};
//# sourceMappingURL=whatsapp.d.ts.map