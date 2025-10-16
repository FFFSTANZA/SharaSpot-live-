import { logger } from '../../utils/logger';

export interface LocationContext {
  whatsappId: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  lastSearchResults?: any;
  currentOffset: number;
}

export class LocationContextManager {
  // Store location contexts (in production, use Redis)
  private locationContexts = new Map<string, LocationContext>();

  /**
   * Set location context
   */
  setLocationContext(whatsappId: string, location: { latitude: number; longitude: number; address?: string }): void {
    const existing = this.locationContexts.get(whatsappId) || { whatsappId, currentOffset: 0 };
    existing.currentLocation = location;
    this.locationContexts.set(whatsappId, existing);
    
    logger.debug('Location context set', { whatsappId, location });
  }

  /**
   * Get location context
   */
  getLocationContext(whatsappId: string): LocationContext | null {
    return this.locationContexts.get(whatsappId) || null;
  }

  /**
   * Update search results in context
   */
  updateSearchResults(whatsappId: string, searchResults: any): void {
    const context = this.getLocationContext(whatsappId);
    if (context) {
      context.lastSearchResults = searchResults;
      context.currentOffset = 0;
      this.locationContexts.set(whatsappId, context);
    }
  }

  /**
   * Update current offset
   */
  updateOffset(whatsappId: string, offset: number): void {
    const context = this.getLocationContext(whatsappId);
    if (context) {
      context.currentOffset = offset;
      this.locationContexts.set(whatsappId, context);
    }
  }

  /**
   * Merge new search results with existing
   */
  mergeSearchResults(whatsappId: string, newResults: any): void {
    const context = this.getLocationContext(whatsappId);
    if (context?.lastSearchResults) {
      context.lastSearchResults.stations.push(...newResults.stations);
      context.lastSearchResults.hasMore = newResults.hasMore;
      this.locationContexts.set(whatsappId, context);
    }
  }

  /**
   * Clear location context
   */
  clearLocationContext(whatsappId: string): void {
    this.locationContexts.delete(whatsappId);
    logger.debug('Location context cleared', { whatsappId });
  }

  /**
   * Check if user has active location context
   */
  hasLocationContext(whatsappId: string): boolean {
    const context = this.getLocationContext(whatsappId);
    return !!(context?.currentLocation);
  }

  /**
   * Get all active contexts (for monitoring)
   */
  getActiveContextsCount(): number {
    return this.locationContexts.size;
  }
}