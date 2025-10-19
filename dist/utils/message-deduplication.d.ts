declare class MessageDeduplicationService {
    private processedMessages;
    private readonly TTL;
    private readonly CLEANUP_INTERVAL;
    private readonly MAX_CACHE_SIZE;
    private cleanupTimer;
    private lastCleanupLog;
    constructor();
    isDuplicate(messageKey: string): boolean;
    private cleanup;
    private trimCache;
    getStats(): {
        trackedMessages: number;
        ttlMinutes: number;
        cleanupIntervalMinutes: number;
        maxCacheSize: number;
    };
    clear(messageId?: string): void;
    destroy(): void;
}
export declare const messageDeduplication: MessageDeduplicationService;
export {};
//# sourceMappingURL=message-deduplication.d.ts.map