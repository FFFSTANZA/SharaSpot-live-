declare const app: import("express-serve-static-core").Express;
declare class ServerManager {
    private server;
    private isShuttingDown;
    start(): Promise<void>;
    private initializeDatabaseWithTimeout;
    private startBackgroundServices;
    private setupGracefulShutdown;
}
declare const serverManager: ServerManager;
export { app, serverManager };
export declare const getServerHealth: () => Promise<{
    status: string;
    [key: string]: any;
}>;
export declare const getServerMetrics: () => {
    activeRateLimitEntries: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    environment: "development" | "production" | "test";
    version: string;
};
//# sourceMappingURL=index.d.ts.map