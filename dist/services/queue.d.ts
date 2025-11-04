export interface QueuePosition {
    id: number;
    userWhatsapp: string;
    stationId: number;
    position: number;
    estimatedWaitMinutes: number;
    status: 'waiting' | 'reserved' | 'charging' | 'completed' | 'cancelled';
    isReserved: boolean;
    reservationExpiry?: Date;
    createdAt: Date;
    stationName?: string;
    stationAddress?: string;
}
export interface QueueStats {
    totalInQueue: number;
    averageWaitTime: number;
    peakHours: string[];
    userPosition?: number;
    estimatedTime?: number;
}
declare class QueueService {
    joinQueue(userWhatsapp: string, stationId: number): Promise<QueuePosition | null>;
    leaveQueue(userWhatsapp: string, stationId: number, reason?: 'user_cancelled' | 'expired' | 'completed'): Promise<boolean>;
    forceJoinQueue(userWhatsapp: string, stationId: number): Promise<QueuePosition | null>;
    getUserQueueStatus(userWhatsapp: string): Promise<QueuePosition[]>;
    reserveSlot(userWhatsapp: string, stationId: number, reservationMinutes?: number): Promise<boolean>;
    startCharging(userWhatsapp: string, stationId: number): Promise<boolean>;
    completeCharging(userWhatsapp: string, stationId: number): Promise<boolean>;
    private checkColumnExists;
    private getQueueLength;
    private calculateWaitTime;
    private reorderQueue;
    private updateStationQueueCount;
    private promoteNextInQueue;
    private notifyQueueProgress;
    getQueueStats(stationId: number): Promise<QueueStats>;
    private sendNotifications;
    private sendProgressNotification;
}
export declare const queueService: QueueService;
export {};
//# sourceMappingURL=queue.d.ts.map