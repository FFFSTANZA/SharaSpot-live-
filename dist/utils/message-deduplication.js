"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageDeduplication = void 0;
const logger_1 = require("./logger");
class MessageDeduplicationService {
    constructor() {
        this.processedMessages = new Map();
        this.TTL = 5 * 60 * 1000;
        this.CLEANUP_INTERVAL = 2 * 60 * 1000;
        this.MAX_CACHE_SIZE = 5000;
        this.lastCleanupLog = 0;
        this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
    }
    isDuplicate(messageKey) {
        if (!messageKey)
            return false;
        const now = Date.now();
        const lastSeen = this.processedMessages.get(messageKey);
        if (lastSeen && now - lastSeen < this.TTL) {
            return true;
        }
        if (this.processedMessages.size >= this.MAX_CACHE_SIZE) {
            this.trimCache();
        }
        this.processedMessages.set(messageKey, now);
        return false;
    }
    cleanup() {
        const now = Date.now();
        let removed = 0;
        for (const [id, ts] of this.processedMessages) {
            if (now - ts > this.TTL) {
                this.processedMessages.delete(id);
                removed++;
            }
        }
        if (removed > 0 && now - this.lastCleanupLog > 5 * 60 * 1000) {
            this.lastCleanupLog = now;
            logger_1.logger.info(`🧹 Message cache cleanup complete`, {
                removed,
                remaining: this.processedMessages.size,
            });
        }
    }
    trimCache() {
        const removeCount = Math.floor(this.MAX_CACHE_SIZE * 0.2);
        const keys = Array.from(this.processedMessages.keys()).slice(0, removeCount);
        keys.forEach((key) => this.processedMessages.delete(key));
        logger_1.logger.warn('⚠️ Deduplication cache trimmed', {
            removed: removeCount,
            remaining: this.processedMessages.size,
        });
    }
    getStats() {
        return {
            trackedMessages: this.processedMessages.size,
            ttlMinutes: this.TTL / 60000,
            cleanupIntervalMinutes: this.CLEANUP_INTERVAL / 60000,
            maxCacheSize: this.MAX_CACHE_SIZE,
        };
    }
    clear(messageId) {
        if (messageId)
            this.processedMessages.delete(messageId);
        else
            this.processedMessages.clear();
    }
    destroy() {
        clearInterval(this.cleanupTimer);
        this.processedMessages.clear();
    }
}
exports.messageDeduplication = new MessageDeduplicationService();
//# sourceMappingURL=message-deduplication.js.map