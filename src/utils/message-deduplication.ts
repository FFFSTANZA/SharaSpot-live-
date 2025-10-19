import { logger } from './logger';


class MessageDeduplicationService {
  private processedMessages = new Map<string, number>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL = 2 * 60 * 1000; // 2 minutes
  private readonly MAX_CACHE_SIZE = 5000; // Prevent memory bloat
  private cleanupTimer: NodeJS.Timeout;
  private lastCleanupLog = 0; // prevent spammy logs

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  /**
   * Checks if a message was already processed
   * Returns true if duplicate, false if new
   */
// In your MessageDeduplicationService class
/**
 * Checks if a message was already processed
 * Returns true if duplicate, false if new
 */
isDuplicate(messageKey: string): boolean {
    if (!messageKey) return false; // fail-safe for missing keys
    
    const now = Date.now();
    const lastSeen = this.processedMessages.get(messageKey);
    
    // Fast return for active duplicates
    if (lastSeen && now - lastSeen < this.TTL) {
        return true;
    }
    
    // If cache too large, trim oldest entries
    if (this.processedMessages.size >= this.MAX_CACHE_SIZE) {
        this.trimCache();
    }
    
    this.processedMessages.set(messageKey, now);
    return false;
}

  /**
   * Removes expired message IDs periodically
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [id, ts] of this.processedMessages) {
      if (now - ts > this.TTL) {
        this.processedMessages.delete(id);
        removed++;
      }
    }

    // Log only once every 5 minutes max to avoid spam
    if (removed > 0 && now - this.lastCleanupLog > 5 * 60 * 1000) {
      this.lastCleanupLog = now;
      logger.info(`🧹 Message cache cleanup complete`, {
        removed,
        remaining: this.processedMessages.size,
      });
    }
  }

  /**
   * Trims cache size when max limit reached (removes oldest 20%)
   */
  private trimCache(): void {
    const removeCount = Math.floor(this.MAX_CACHE_SIZE * 0.2);
    const keys = Array.from(this.processedMessages.keys()).slice(0, removeCount);
    keys.forEach((key) => this.processedMessages.delete(key));
    logger.warn('⚠️ Deduplication cache trimmed', {
      removed: removeCount,
      remaining: this.processedMessages.size,
    });
  }

  /**
   * Get statistics for monitoring
   */
  getStats() {
    return {
      trackedMessages: this.processedMessages.size,
      ttlMinutes: this.TTL / 60000,
      cleanupIntervalMinutes: this.CLEANUP_INTERVAL / 60000,
      maxCacheSize: this.MAX_CACHE_SIZE,
    };
  }

  /**
   * Manual clear (for tests or resets)
   */
  clear(messageId?: string): void {
    if (messageId) this.processedMessages.delete(messageId);
    else this.processedMessages.clear();
  }

  /**
   * Clean up when shutting down the service
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.processedMessages.clear();
  }
}

export const messageDeduplication = new MessageDeduplicationService();
