import { LocationContextManager } from './context-manager';
export declare class LocationDisplayController {
    private contextManager;
    constructor(contextManager: LocationContextManager);
    displayStationResults(whatsappId: string, searchResult: any, startIndex: number): Promise<void>;
    showStationCard(whatsappId: string, station: any, position: number, total: number): Promise<void>;
    private showNavigationOptions;
    showAllNearbyStations(whatsappId: string, stations: any[], totalCount: number): Promise<void>;
    handleNoStationsFound(whatsappId: string, address?: string): Promise<void>;
    handleGeocodingFailed(whatsappId: string, address: string, recentSearches: string[]): Promise<void>;
    showBackToTopResult(whatsappId: string): Promise<void>;
}
//# sourceMappingURL=display-controller.d.ts.map