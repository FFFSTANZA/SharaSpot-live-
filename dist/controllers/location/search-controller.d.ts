import { LocationContextManager } from './context-manager';
import { LocationDisplayController } from './display-controller';
export declare class LocationSearchController {
    private contextManager;
    private displayController;
    constructor(contextManager: LocationContextManager, displayController: LocationDisplayController);
    searchAndShowStations(whatsappId: string, latitude: number, longitude: number, address?: string): Promise<void>;
    handleNextStation(whatsappId: string): Promise<void>;
    loadMoreStations(whatsappId: string): Promise<void>;
    showAllNearbyStations(whatsappId: string): Promise<void>;
    expandSearchRadius(whatsappId: string): Promise<void>;
    removeFilters(whatsappId: string): Promise<void>;
}
//# sourceMappingURL=search-controller.d.ts.map