export declare class WebhookLocationController {
    handleLocationButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void>;
    handleLocationList(whatsappId: string, listId: string, listTitle: string): Promise<void>;
    private parseButtonId;
    private handleStationActions;
    private backToTopResult;
    private expandSearchRadius;
    private removeFilters;
    private startNewSearch;
    private requestGPSLocation;
    private requestAddressInput;
    private showLocationHelp;
    private backToSearch;
    private handleGetDirections;
    private handleStationSelection;
    private handleStationBooking;
    private handleQueueJoin;
    private handleQueueStatus;
    private handleQueueCancel;
    private handleChargingStart;
    private showStationDetails;
    private setupNotificationAlerts;
    private findAlternativeStations;
}
export declare const webhookLocationController: WebhookLocationController;
//# sourceMappingURL=webhook-location.d.ts.map