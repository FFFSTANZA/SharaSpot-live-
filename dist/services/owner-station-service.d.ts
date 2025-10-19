export interface OwnerStation {
    id: number;
    name: string;
    address: string;
    isActive: boolean;
    isOpen: boolean;
    totalSlots: number;
    availableSlots: number;
    pricePerKwh: string;
    queueLength: number;
    todayRevenue: number;
    connectorTypes: any;
    operatingHours: any;
}
export interface StationAnalytics {
    queueLength: number;
    todaySessions: number;
    todayRevenue: number;
    todayEnergy: number;
    utilizationRate: number;
    averageSessionDuration: number;
}
export declare class OwnerStationService {
    getOwnerStations(whatsappId: string): Promise<OwnerStation[]>;
    toggleStationStatus(stationId: number, ownerWhatsappId: string): Promise<boolean>;
    getStationDetails(stationId: number, ownerWhatsappId: string): Promise<any | null>;
    getStationAnalytics(stationId: number): Promise<StationAnalytics>;
    getOwnerQuickStats(whatsappId: string): Promise<{
        totalStations: number;
        activeStations: number;
        todayRevenue: number;
        activeSessions: number;
        todayEnergy: number;
    }>;
    private getQueueLength;
    private getTodayRevenue;
    private getTodaySessionsCount;
    private getTodayEnergy;
    private getStationSlots;
    private getActiveSessionsCount;
    private getAverageSessionDuration;
    private verifyStationOwnership;
}
export declare const ownerStationService: OwnerStationService;
//# sourceMappingURL=owner-station-service.d.ts.map