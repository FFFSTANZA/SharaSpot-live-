export interface StationAnalytics {
    stationId: number;
    currentQueueLength: number;
    averageWaitTime: number;
    estimatedWaitTime: number;
    isPeakHour: boolean;
    peakHours: string[];
    utilization: number;
    efficiency: number;
    userSatisfaction: number;
    trends: TrendData;
    liveData: LiveStationData;
}
export interface TrendData {
    hourly: HourlyTrend[];
    daily: DailyTrend[];
    weekly: WeeklyTrend[];
}
export interface HourlyTrend {
    time: string;
    utilization: number;
    queueLength: number;
    avgWaitTime: number;
}
export interface DailyTrend {
    date: string;
    sessions: number;
    revenue: number;
    avgWaitTime: number;
}
export interface WeeklyTrend {
    week: string;
    totalSessions: number;
    totalRevenue: number;
    avgSatisfaction: number;
}
export interface OptimalTime {
    time: string;
    waitTime: number;
    description: string;
    recommendation: string;
    confidence: number;
}
export interface LiveStationData {
    activeSessions: number;
    queueLength: number;
    availableSlots: number;
    powerOutput: number;
    currentWaitTime: number;
    utilization: number;
    energyToday: number;
    predictions: string[];
}
export interface RealtimeEstimate {
    estimatedWait: number;
    confidence: number;
    expectedTime: string;
    recentChanges: string[];
    tip: string;
}
declare class AnalyticsService {
    private cache;
    private alertSubscriptions;
    getStationAnalytics(stationId: number): Promise<StationAnalytics>;
    getOptimalTimes(stationId: number, userWhatsapp: string): Promise<OptimalTime[]>;
    getRealtimeEstimate(stationId: number, userWhatsapp: string): Promise<RealtimeEstimate>;
    private getActiveSessionsCount;
    private getAvailableSlotsCount;
    private getHourlyTrends;
    private getDailyTrends;
    private getWeeklyTrends;
    private getTimeOfDayFactor;
    private getDayOfWeekFactor;
    private getSeasonalFactor;
    submitRating(userWhatsapp: string, stationId: number, rating: number): Promise<boolean>;
    clearCache(): void;
    getCacheStats(): any;
}
export declare const analyticsService: AnalyticsService;
export {};
//# sourceMappingURL=analytics.d.ts.map