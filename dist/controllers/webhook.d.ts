import { Request, Response } from 'express';
export declare class WebhookController {
    private readonly waitingUsers;
    private readonly MAX_WAITING_USERS;
    private readonly MAX_PROCESSING_MESSAGES;
    private processingMessages;
    verifyWebhook(req: Request, res: Response): Promise<void>;
    handleWebhook(req: Request, res: Response): Promise<void>;
    private extractMessages;
    private processMessage;
    private routeMessage;
    private handleVerificationPhoto;
    private handleManualVerificationEntry;
    private downloadWhatsAppImage;
    private handleVerificationButtons;
    private handleTextMessage;
    private handleButtonMessage;
    private handleListMessage;
    private handleLocationMessage;
    private routeButtonAction;
    private isSessionButton;
    private routeListAction;
    private handleStationButton;
    private handleLocationButton;
    private handleLocationList;
    private handleCoreButton;
    private handleCommand;
    private handleWaitingInput;
    private looksLikeAddress;
    private handleGetDirections;
    private handleNearbyRequest;
    private handleGreeting;
    private startBooking;
    private showHelp;
    private showLocationHelp;
    private requestGPSLocation;
    private requestAddressInput;
    private requestProfileUpdate;
    private processNameInput;
    private processAddressInput;
    private isVerificationButton;
    private isQueueButton;
    private isLocationButton;
    private isLocationList;
    private sendErrorMessage;
    getStats(): {
        waitingUsers: number;
        processingMessages: number;
        deduplication: {
            trackedMessages: number;
            ttlMs: number;
            cleanupIntervalMs: number;
        };
    };
    cleanup(): void;
    getHealthStatus(): {
        status: "healthy";
        waitingUsers: number;
        processingMessages: number;
        uptime: number;
    };
}
export declare const webhookController: WebhookController;
//# sourceMappingURL=webhook.d.ts.map