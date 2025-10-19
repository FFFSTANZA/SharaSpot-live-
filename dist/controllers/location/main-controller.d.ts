export declare class LocationMainController {
    private contextManager;
    private displayController;
    private searchController;
    constructor();
    handleGPSLocation(whatsappId: string, latitude: number, longitude: number, name?: string, address?: string): Promise<void>;
    handleAddressInput(whatsappId: string, address: string): Promise<void>;
    handleNextStation(whatsappId: string): Promise<void>;
    loadMoreStations(whatsappId: string): Promise<void>;
    showAllNearbyStations(whatsappId: string): Promise<void>;
    expandSearchRadius(whatsappId: string): Promise<void>;
    removeFilters(whatsappId: string): Promise<void>;
    showBackToTopResult(whatsappId: string): Promise<void>;
    startNewSearch(whatsappId: string): Promise<void>;
    showRecentSearches(whatsappId: string): Promise<void>;
    handleRecentSearchSelection(whatsappId: string, searchIndex: number): Promise<void>;
    handleStationSelection(whatsappId: string, stationId: number): Promise<void>;
    handleStationBooking(whatsappId: string, stationId: number): Promise<void>;
    showStationDetails(whatsappId: string, stationId: number): Promise<void>;
    showLocationHelp(whatsappId: string): Promise<void>;
    clearLocationContext(whatsappId: string): void;
    hasLocationContext(whatsappId: string): boolean;
    getLocationContext(whatsappId: string): import("./context-manager").LocationContext | null;
    getActiveContextsCount(): number;
    handleBackToList(whatsappId: string): Promise<void>;
    handleFindOtherStations(whatsappId: string): Promise<void>;
    handleNotificationSetup(whatsappId: string): Promise<void>;
    private parseButtonId;
    handleButtonWithStationId(whatsappId: string, buttonId: string): Promise<void>;
}
export declare const locationController: LocationMainController;
//# sourceMappingURL=main-controller.d.ts.map