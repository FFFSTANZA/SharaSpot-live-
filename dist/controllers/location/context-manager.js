"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocationContextManager = void 0;
const logger_1 = require("../../utils/logger");
class LocationContextManager {
    constructor() {
        this.locationContexts = new Map();
    }
    setLocationContext(whatsappId, location) {
        const existing = this.locationContexts.get(whatsappId) || { whatsappId, currentOffset: 0 };
        existing.currentLocation = location;
        this.locationContexts.set(whatsappId, existing);
        logger_1.logger.debug('Location context set', { whatsappId, location });
    }
    getLocationContext(whatsappId) {
        return this.locationContexts.get(whatsappId) || null;
    }
    updateSearchResults(whatsappId, searchResults) {
        const context = this.getLocationContext(whatsappId);
        if (context) {
            context.lastSearchResults = searchResults;
            context.currentOffset = 0;
            this.locationContexts.set(whatsappId, context);
        }
    }
    updateOffset(whatsappId, offset) {
        const context = this.getLocationContext(whatsappId);
        if (context) {
            context.currentOffset = offset;
            this.locationContexts.set(whatsappId, context);
        }
    }
    mergeSearchResults(whatsappId, newResults) {
        const context = this.getLocationContext(whatsappId);
        if (context?.lastSearchResults) {
            context.lastSearchResults.stations.push(...newResults.stations);
            context.lastSearchResults.hasMore = newResults.hasMore;
            this.locationContexts.set(whatsappId, context);
        }
    }
    clearLocationContext(whatsappId) {
        this.locationContexts.delete(whatsappId);
        logger_1.logger.debug('Location context cleared', { whatsappId });
    }
    hasLocationContext(whatsappId) {
        const context = this.getLocationContext(whatsappId);
        return !!(context?.currentLocation);
    }
    getActiveContextsCount() {
        return this.locationContexts.size;
    }
}
exports.LocationContextManager = LocationContextManager;
//# sourceMappingURL=context-manager.js.map