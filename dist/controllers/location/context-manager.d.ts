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
export declare class LocationContextManager {
    private locationContexts;
    setLocationContext(whatsappId: string, location: {
        latitude: number;
        longitude: number;
        address?: string;
    }): void;
    getLocationContext(whatsappId: string): LocationContext | null;
    updateSearchResults(whatsappId: string, searchResults: any): void;
    updateOffset(whatsappId: string, offset: number): void;
    mergeSearchResults(whatsappId: string, newResults: any): void;
    clearLocationContext(whatsappId: string): void;
    hasLocationContext(whatsappId: string): boolean;
    getActiveContextsCount(): number;
}
//# sourceMappingURL=context-manager.d.ts.map