"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageDeduplication = void 0;
const logger_1 = require("./logger");
class MessageDeduplicationService {
    constructor() {
        this.processedMessages = new Map();
        this.TTL = 5 * 60 * 1000;
        this.CLEANUP_INTERVAL = 60 * 1000;
        this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
    }
    isDuplicate(messageId) {
        const now = Date.now();
        const timestamp = this.processedMessages.get(messageId);
        if (timestamp) {
            if (now - timestamp < this.TTL) {
                logger_1.logger.debug('🔄 Duplicate message blocked', { messageId });
                return true;
            }
            this.processedMessages.delete(messageId);
        }
        this.processedMessages.set(messageId, now);
        return false;
    }
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [messageId, timestamp] of this.processedMessages.entries()) {
            if (now - timestamp > this.TTL) {
                this.processedMessages.delete(messageId);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger_1.logger.debug('🧹 Cleaned expired message IDs', {
                cleaned,
                remaining: this.processedMessages.size
            });
        }
    }
    getStats() {
        return {
            trackedMessages: this.processedMessages.size,
            ttlMs: this.TTL,
            cleanupIntervalMs: this.CLEANUP_INTERVAL
        };
    }
    clear(messageId) {
        if (messageId) {
            this.processedMessages.delete(messageId);
        }
        else {
            this.processedMessages.clear();
        }
    }
    destroy() {
        clearInterval(this.cleanupTimer);
        this.processedMessages.clear();
    }
}
exports.messageDeduplication = new MessageDeduplicationService();
//# sourceMappingURL=message-deduplication.js.map