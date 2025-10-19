export interface OwnerProfile {
    id: number;
    whatsappId: string;
    name: string;
    businessName?: string;
    phoneNumber: string;
    email?: string;
    businessType?: string;
    gstNumber?: string;
    isVerified: boolean;
    isActive: boolean;
    kycStatus: string;
    totalStations: number;
    totalRevenue: string;
    averageRating: string;
    createdAt: Date;
}
export interface OwnerAnalytics {
    todaySessions: number;
    todayRevenue: number;
    todayEnergy: number;
    avgSessionDuration: number;
    weekSessions: number;
    weekRevenue: number;
    weekGrowth: number;
    bestStationName: string;
    avgUtilization: number;
    peakHours: string;
    averageRating: number;
    totalReviews: number;
    repeatCustomers: number;
}
export declare class OwnerService {
    getOwnerProfile(whatsappId: string): Promise<OwnerProfile | null>;
    updateOwnerProfile(whatsappId: string, updates: Partial<OwnerProfile>): Promise<boolean>;
    getOwnerAnalytics(whatsappId: string): Promise<OwnerAnalytics | null>;
    isRegisteredOwner(whatsappId: string): Promise<boolean>;
    getOwnerByBusinessName(businessName: string): Promise<OwnerProfile | null>;
}
export interface OwnerStation {
    id: number;
    name: string;
    address: string;
    isActive: boolean;
    isOpen: boolean;
    totalSlots: number;
    availableSlots: number;
    pricePerKwh: string;
    operatingHours: any;
    createdAt: Date;
}
export interface StationAnalytics {
    queueLength: number;
    todaySessions: number;
    todayRevenue: number;
    todayEnergy: number;
    utilizationRate: number;
    activeUsers: number;
}
export declare class OwnerStationService {
    getOwnerStations(whatsappId: string): Promise<OwnerStation[]>;
    toggleStationStatus(stationId: number, ownerWhatsappId: string): Promise<boolean>;
    getStationAnalytics(stationId: number): Promise<StationAnalytics | null>;
}
export declare class OwnerAuthService {
    isAuthenticated(whatsappId: string): Promise<boolean>;
    authenticateByBusinessName(whatsappId: string, businessName: string): Promise<boolean>;
    createAuthSession(whatsappId: string): Promise<string | null>;
}
export interface OwnerButtonParseResult {
    action: string;
    category: 'auth' | 'main' | 'station' | 'profile' | 'analytics' | 'system';
    stationId?: number;
    additionalData?: any;
}
export declare function parseOwnerButtonId(buttonId: string): OwnerButtonParseResult;
export declare const ownerService: OwnerService;
export declare const ownerStationService: OwnerStationService;
export declare const ownerAuthService: OwnerAuthService;
//# sourceMappingURL=owner-service.d.ts.map