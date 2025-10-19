export interface GeocodeResult {
    latitude: number;
    longitude: number;
    formattedAddress: string;
    locality?: string;
    subLocality?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    confidence: number;
    geohash: string;
}
export interface GeocodeOptions {
    userWhatsapp?: string;
    maxResults?: number;
    minConfidence?: number;
}
interface CityData {
    name: string;
    state: string;
    district?: string;
    lat: number;
    lng: number;
    population?: number;
    aliases?: string[];
}
export declare class GeocodingService {
    private indianCities;
    geocodeText(searchText: string, options?: GeocodeOptions): Promise<GeocodeResult[]>;
    reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null>;
    private cleanSearchTerm;
    private searchIndianCities;
    private createGeocodeResult;
    private calculateSimilarity;
    private levenshteinDistance;
    private calculateDistance;
    private deg2rad;
    private generateGeohash;
    private getCachedResult;
    private cacheResult;
    private updateCacheUsage;
    saveUserSearchHistory(userWhatsapp: string, searchTerm: string, result: GeocodeResult): Promise<void>;
    getUserRecentSearches(userWhatsapp: string, limit?: number): Promise<string[]>;
    addCity(cityData: CityData): void;
    getCitiesInState(stateName: string): CityData[];
    findCitiesNearby(latitude: number, longitude: number, radiusKm?: number): CityData[];
}
export declare const geocodingService: GeocodingService;
export {};
//# sourceMappingURL=geocoding.d.ts.map