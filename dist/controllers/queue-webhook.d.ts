export declare class QueueWebhookController {
    handleQueueButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void>;
    handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void>;
    private routeAction;
    private handleQueueCategory;
    private handleSessionCategory;
    private handleStationCategory;
    private handleSpecificActions;
    private handleQueueStatus;
    private handleJoinQueue;
    private handleQueueCancel;
    private handleConfirmCancel;
    private handleSessionStatus;
    private handleNotificationActions;
    private handleStationRating;
    private formatQueueStatus;
    private formatSessionStatus;
    private sendQueueManagementButtons;
    private sendSessionControls;
    private sendFindStationButtons;
    private getQueueStatusEmoji;
    private getStatusDescription;
    private generateProgressBar;
    private getQueueTip;
    private getQueueData;
    private getSessionData;
    private handleUnknownAction;
    private handleError;
    getHealthStatus(): {
        status: 'healthy' | 'degraded';
        lastActivity: string;
    };
}
export declare const queueWebhookController: QueueWebhookController;
//# sourceMappingURL=queue-webhook.d.ts.map