export declare class QueueScheduler {
    static cleanupExpiredReservations(): Promise<void>;
    static processQueueNotifications(): Promise<void>;
    static checkColumnExists(tableName: string, columnName: string): Promise<boolean>;
    static processQueueItemNotification(queue: any): Promise<void>;
    static sendPositionNotification(queue: any): Promise<void>;
    static runScheduler(): Promise<void>;
}
//# sourceMappingURL=queueScheduler.d.ts.map