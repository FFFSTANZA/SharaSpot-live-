export interface ChargingSession {
    id: string;
    userWhatsapp: string;
    stationId: number;
    stationName?: string;
    startTime?: Date;
    endTime?: Date;
    energyDelivered: number;
    currentBatteryLevel: number;
    targetBatteryLevel: number;
    pricePerKwh: number;
    totalCost: number;
    status: 'initiated' | 'active' | 'completed' | 'stopped';
    queueId?: number;
}
export interface SessionSummary {
    sessionId: string;
    duration: string;
    energyDelivered: number;
    finalBatteryLevel: number;
    totalCost: number;
    stationName: string;
    startTime: Date;
    endTime: Date;
}
declare class SessionService {
    private activeSessions;
    startSession(userWhatsapp: string, stationId: number, queueId?: number): Promise<ChargingSession | null>;
    startChargingAfterVerification(sessionId: string, startMeterReading: number): Promise<void>;
    getActiveSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null>;
    stopSession(userWhatsapp: string, stationId: number): Promise<boolean>;
    completeSessionAfterVerification(sessionId: string, endMeterReading: number, consumption: number): Promise<void>;
    private formatDuration;
    private updateUserStats;
    private mapToChargingSession;
    getSessionById(sessionId: string): Promise<ChargingSession | null>;
    getSessionHistory(userWhatsapp: string, limit?: number): Promise<ChargingSession[]>;
    getUserStats(userWhatsapp: string): Promise<any>;
    emergencyStopStation(stationId: number): Promise<boolean>;
    getStationStats(stationId: number): Promise<any>;
    getActiveSessions(): Map<string, ChargingSession>;
}
export declare const sessionService: SessionService;
export {};
//# sourceMappingURL=session.d.ts.map