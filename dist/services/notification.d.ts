declare class NotificationService {
    private scheduledNotifications;
    sendQueueJoinedNotification(userWhatsapp: string, queuePosition: any): Promise<void>;
    sendReservationConfirmation(userWhatsapp: string, stationId: number, reservationMinutes: number): Promise<void>;
    sendChargingStartedNotification(userWhatsapp: string, session: any): Promise<void>;
    sendChargingCompletedNotification(userWhatsapp: string, session: any, summary?: any): Promise<void>;
    sendQueueLeftNotification(userWhatsapp: string, stationId: number, reason: string): Promise<void>;
    sendQueueProgressNotification(userWhatsapp: string, stationId: number, position: number, waitTime: number): Promise<void>;
    scheduleReservationExpiry(userWhatsapp: string, stationId: number, expiryTime: Date): Promise<void>;
    private sendReservationWarning;
    private sendReservationExpired;
    notifyStationOwner(stationId: number, eventType: string, data: any): Promise<void>;
    sendSessionStartNotification(userWhatsapp: string, session: any): Promise<void>;
    sendSessionPausedNotification(userWhatsapp: string, session: any): Promise<void>;
    sendSessionResumedNotification(userWhatsapp: string, session: any): Promise<void>;
    sendSessionProgressNotification(userWhatsapp: string, session: any, progress: any): Promise<void>;
    sendSessionCompletedNotification(userWhatsapp: string, session: any, summary: any): Promise<void>;
    sendSessionExtendedNotification(userWhatsapp: string, session: any, newTarget: number): Promise<void>;
    sendAnomalyAlert(userWhatsapp: string, session: any, status: any): Promise<void>;
    sendAvailabilityAlert(userWhatsapp: string, stationId: number, analytics: any): Promise<void>;
    sendPromotionNotification(userWhatsapp: string, stationId: number, newPosition: number): Promise<void>;
    sendSessionReminder(userWhatsapp: string, stationId: number, status: any): Promise<void>;
    getStationDetails(stationId: number, userLat?: number, userLng?: number): Promise<any>;
    private formatQueueJoinedMessage;
    private generateSessionSummary;
    private getProgressTip;
    clearUserNotifications(userWhatsapp: string): void;
    getNotificationStats(): any;
}
export declare const notificationService: NotificationService;
export {};
//# sourceMappingURL=notification.d.ts.map