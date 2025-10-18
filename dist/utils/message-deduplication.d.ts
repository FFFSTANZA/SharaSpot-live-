declare class MessageDeduplicationService {
    private processedMessages;
    private readonly TTL;
    private readonly CLEANUP_INTERVAL;
    private cleanupTimer;
    constructor();
    isDuplicate(messageId: string): boolean;
    private cleanup;
    getStats(): {
        trackedMessages: number;
        ttlMs: number;
        cleanupIntervalMs: number;
    };
    clear(messageId?: string): void;
    destroy(): void;
}
export declare const messageDeduplication: MessageDeduplicationService;
export {};
//# sourceMappingURL=message-deduplication.d.ts.map