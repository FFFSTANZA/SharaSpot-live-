// src/utils/message-deduplication.ts
import { logger } from './logger';

/**
 * High-performance message deduplication service
 * Prevents duplicate webhook processing with automatic cleanup
 */
class MessageDeduplicationService {
  private processedMessages = new Map<string, number>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL = 60 * 1000; // 1 minute
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  /**
   * Check if message was already processed
   * Returns true if duplicate, false if new
   */
  isDuplicate(messageId: string): boolean {
    const now = Date.now();
    const timestamp = this.processedMessages.get(messageId);
    
    if (timestamp) {
      // Check if still within TTL
      if (now - timestamp < this.TTL) {
        logger.debug('🔄 Duplicate message blocked', { messageId });
        return true;
      }
      // Expired, remove and allow
      this.processedMessages.delete(messageId);
    }

    // Mark as processed
    this.processedMessages.set(messageId, now);
    return false;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.TTL) {
        this.processedMessages.delete(messageId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('🧹 Cleaned expired message IDs', { 
        cleaned, 
        remaining: this.processedMessages.size 
      });
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      trackedMessages: this.processedMessages.size,
      ttlMs: this.TTL,
      cleanupIntervalMs: this.CLEANUP_INTERVAL
    };
  }

  /**
   * Manually clear a message ID (for testing)
   */
  clear(messageId?: string): void {
    if (messageId) {
      this.processedMessages.delete(messageId);
    } else {
      this.processedMessages.clear();
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.processedMessages.clear();
  }
}

export const messageDeduplication = new MessageDeduplicationService();