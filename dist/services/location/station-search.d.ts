export interface StationSearchOptions {
    userWhatsapp: string;
    latitude: number;
    longitude: number;
    radius?: number;
    maxResults?: number;
    offset?: number;
    connectorTypes?: string[];
    maxPrice?: number;
    availableOnly?: boolean;
    sortBy?: 'availability' | 'distance' | 'price';
}
export interface StationResult {
    id: number;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    distance: number;
    totalPorts: number;
    availablePorts: number;
    connectorTypes: string[];
    maxPowerKw: number;
    pricePerKwh: number;
    isOpen: boolean;
    currentQueueLength: number;
    maxQueueLength: number;
    estimatedWaitMinutes: number;
    isAvailable: boolean;
    matchScore: number;
}
export interface StationSearchResult {
    stations: StationResult[];
    totalCount: number;
    hasMore: boolean;
    searchLocation: {
        latitude: number;
        longitude: number;
        address?: string;
    };
}
export declare class StationSearchService {
    searchStations(options: StationSearchOptions): Promise<StationSearchResult>;
    private emptyResult;
    private simpleSearch;
    private filterByDistance;
    private applyFilters;
    private sortStations;
    private processStationResults;
    private parseConnectorTypes;
    private calculateMatchScore;
    private getUserPreferences;
    getAllNearbyStations(options: StationSearchOptions): Promise<StationSearchResult>;
    private inferVehicleTypeFromModel;
    getNearbyStations(userWhatsapp: string, latitude: number, longitude: number, limit?: number): Promise<StationResult[]>;
}
export declare const stationSearchService: StationSearchService;
//# sourceMappingURL=station-search.d.ts.map