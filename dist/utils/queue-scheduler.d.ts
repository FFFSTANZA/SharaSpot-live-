interface ScheduledTask {
    id: string;
    type: 'cleanup' | 'optimization' | 'notification' | 'analytics' | 'session' | 'alert' | 'performance' | 'verification';
    scheduledTime: Date;
    retries: number;
    maxRetries: number;
    priority: 'high' | 'normal' | 'low';
}
declare class QueueScheduler {
    private isRunning;
    private startTime;
    private intervals;
    private tasks;
    private taskLatencies;
    private readonly MAX_LATENCIES;
    private readonly concurrencyLimits;
    private readonly baseIntervals;
    private readonly processes;
    start(): Promise<void>;
    stop(): Promise<void>;
    private startProcess;
    private recordLatency;
    private getAvgLatency;
    private cleanupExpiredReservations;
    private optimizeQueues;
    private optimizeStationQueue;
    private processNotifications;
    private updateAnalytics;
    private updateQueueCounts;
    private monitorSessions;
    private getSessionFromDb;
    private cleanupVerificationStates;
    private checkAvailabilityAlerts;
    private monitorPerformance;
    private countActiveQueues;
    private countActiveVerifications;
    private countExpiredVerifications;
    private getCacheSize;
    private cleanupCache;
    scheduleTask(type: ScheduledTask['type'], scheduledTime: Date, maxRetries?: number, priority?: 'high' | 'normal' | 'low'): string;
    private executeTask;
    getStatus(): {
        isRunning: boolean;
        uptime: number;
        activeProcesses: string[];
        scheduledTasks: number;
        avgLatencyMs: string;
        processes: {
            name: string;
            interval: string;
            priority: "low" | "high" | "normal";
        }[];
    };
    healthCheck(): Promise<boolean>;
}
export declare const queueScheduler: QueueScheduler;
export {};
//# sourceMappingURL=queue-scheduler.d.ts.map