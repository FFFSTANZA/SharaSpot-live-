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
export declare const ownerService: OwnerService;
//# sourceMappingURL=owner-service.d.ts.map