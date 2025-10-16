// src/services/location/station-search.ts - FIXED VERSION WITH CORRECT TYPE HANDLING
import { db } from '../../config/database';
import { chargingStations, users } from '../../db/schema';
import { logger } from '../../utils/logger';
import { eq, and, or, gte, lte, ne, desc, asc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDistance } from 'geolib';

// ===============================================
// TYPES & INTERFACES - ENHANCED WITH STRICT TYPING
// ===============================================

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

// Enhanced type safety for database records
interface RawStationData {
  id: number;
  name: string;
  address: string;
  latitude: string | number;  // Handle both string and number types
  longitude: string | number; // Handle both string and number types
  totalPorts: number | null;
  availablePorts: number | null;
  connectorTypes: unknown;     // Will properly parse this
  maxPowerKw: number | null;
  pricePerKwh: string | number | null;
  isOpen: boolean | null;
  isActive: boolean | null;
  isPaused: boolean | null;
  currentQueueLength: number | null;
  maxQueueLength: number | null;
  averageSessionMinutes: number | null;
  ownerWhatsappId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  distance?: number;
}

// User preferences type
interface UserPreferences {
  vehicleType?: string;
  connectorType?: string;
  chargingIntent?: string;
  queuePreference?: string;
  maxDistance?: number;
  maxPrice?: number;
  [key: string]: any; // Allow additional fields
}

// ===============================================
// STATION SEARCH SERVICE - IMPROVED VERSION
// ===============================================

export class StationSearchService {
  /**
   * Main search method
   */
  async searchStations(options: StationSearchOptions): Promise<StationSearchResult> {
    try {
      logger.info('Searching stations', { 
        userWhatsapp: options.userWhatsapp,
        location: { lat: options.latitude, lng: options.longitude },
        radius: options.radius || 25
      });

      // Use simple search to avoid complex SQL issues
      return await this.simpleSearch(options);

    } catch (error) {
      logger.error('Station search failed', { 
        error: error instanceof Error ? error.message : String(error), 
        options 
      });
      return this.emptyResult(options);
    }
  }

  /**
   * Create empty result for error cases
   */
  private emptyResult(options: StationSearchOptions): StationSearchResult {
    return {
      stations: [],
      totalCount: 0,
      hasMore: false,
      searchLocation: {
        latitude: options.latitude,
        longitude: options.longitude
      }
    };
  }

  /**
   * Simple search implementation with improved type safety
   */
  private async simpleSearch(options: StationSearchOptions): Promise<StationSearchResult> {
    const { 
      latitude, 
      longitude, 
      radius = 25, 
      maxResults = 10, 
      offset = 0,
      availableOnly = false 
    } = options;

    try {
      // Get user preferences
      const userPrefs = await this.getUserPreferences(options.userWhatsapp);

      // Get all active stations
      const rawStations = await db
        .select()
        .from(chargingStations)
        .where(
          and(
            eq(chargingStations.isActive, true),
            ne(chargingStations.isPaused, true)
          )
        );

      // Step 1: Convert raw data to our format with proper type handling
      const stationsWithDistance = rawStations.map(station => {
        // Ensure latitude and longitude are numbers
        const stationLat = typeof station.latitude === 'string' 
          ? parseFloat(station.latitude) 
          : Number(station.latitude);
          
        const stationLng = typeof station.longitude === 'string' 
          ? parseFloat(station.longitude) 
          : Number(station.longitude);
        
        // Calculate distance with null checking
        let distance = 0;
        if (!isNaN(stationLat) && !isNaN(stationLng) && 
            !isNaN(latitude) && !isNaN(longitude)) {
          try {
            distance = getDistance(
              { latitude, longitude },
              { latitude: stationLat, longitude: stationLng }
            ) / 1000; // Convert to kilometers
          } catch (e) {
            logger.warn('Distance calculation failed', { 
              error: e instanceof Error ? e.message : String(e),
              coords: { userLat: latitude, userLng: longitude, stationLat, stationLng }
            });
          }
        }

        return {
          ...station,
          latitude: stationLat,
          longitude: stationLng,
          distance
        } as RawStationData & { distance: number };
      });

      // Step 2: Filter by distance
      const withinRadius = this.filterByDistance(stationsWithDistance, radius);
      
      // Step 3: Apply additional filters
      const filtered = this.applyFilters(withinRadius, options, userPrefs);
      
      // Step 4: Sort by criteria
      const sorted = this.sortStations(
        filtered, 
        options.sortBy || 'distance'
      );
      
      // Step 5: Apply pagination
      const paginatedStations = sorted.slice(offset, offset + maxResults);
      
      // Step 6: Process to final format
      const stations = this.processStationResults(paginatedStations, userPrefs);

      // Return result with proper metadata
      return {
        stations,
        totalCount: filtered.length,
        hasMore: offset + maxResults < filtered.length,
        searchLocation: {
          latitude,
          longitude
        }
      };

    } catch (error) {
      logger.error('Station search processing failed', { 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error; // Re-throw to be handled by the main search method
    }
  }

  /**
   * Filter stations by distance
   */
  private filterByDistance(
    stations: (RawStationData & { distance: number })[], 
    radius: number
  ): (RawStationData & { distance: number })[] {
    return stations.filter(station => 
      !isNaN(station.distance) && station.distance <= radius
    );
  }

  /**
   * Apply all filters
   */
  private applyFilters(
    stations: (RawStationData & { distance: number })[], 
    options: StationSearchOptions,
    userPrefs: UserPreferences
  ): (RawStationData & { distance: number })[] {
    let filtered = [...stations];
    
    // Filter by availability if requested
    if (options.availableOnly === true) {
      filtered = filtered.filter(station => {
        const availablePorts = station.availablePorts ?? 0;
        const isOpen = station.isOpen === true;
        return isOpen && availablePorts > 0;
      });
    }
    
    // Filter by price if specified
    if (options.maxPrice && !isNaN(options.maxPrice)) {
      filtered = filtered.filter(station => {
        let price = 0;
        
        // Handle different price formats
        if (typeof station.pricePerKwh === 'number') {
          price = station.pricePerKwh;
        } else if (typeof station.pricePerKwh === 'string') {
          price = parseFloat(station.pricePerKwh) || 0;
        }
        
        return price <= (options.maxPrice ?? Infinity);
      });
    }
    
    // Filter by connector types if specified
    if (options.connectorTypes && options.connectorTypes.length > 0) {
      filtered = filtered.filter(station => {
        const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
        return options.connectorTypes!.some(type => 
          stationConnectors.includes(type)
        );
      });
    }
    
    // Apply user preference filters if relevant
    if (userPrefs.connectorType && userPrefs.connectorType !== 'Any') {
      filtered = filtered.filter(station => {
        const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
        return stationConnectors.includes(userPrefs.connectorType!);
      });
    }
    
    return filtered;
  }

  /**
   * Sort stations by criteria with improved null handling
   */
  private sortStations(
    stations: (RawStationData & { distance: number })[], 
    sortBy: string
  ): (RawStationData & { distance: number })[] {
    return [...stations].sort((a, b) => {
      switch (sortBy) {
        case 'availability':
          const aAvailable = a.availablePorts ?? 0;
          const bAvailable = b.availablePorts ?? 0;
          if (aAvailable !== bAvailable) {
            return bAvailable - aAvailable;
          }
          return a.distance - b.distance;

        case 'price':
          // Convert price strings to numbers safely
          const aPrice = typeof a.pricePerKwh === 'string' 
            ? parseFloat(a.pricePerKwh) || 0 
            : Number(a.pricePerKwh) || 0;
            
          const bPrice = typeof b.pricePerKwh === 'string' 
            ? parseFloat(b.pricePerKwh) || 0 
            : Number(b.pricePerKwh) || 0;
            
          if (aPrice !== bPrice) {
            return aPrice - bPrice;
          }
          return a.distance - b.distance;

        case 'distance':
        default:
          return a.distance - b.distance;
      }
    });
  }

  /**
   * Process raw station data into StationResult with full type safety
   */
  private processStationResults(
    stations: (RawStationData & { distance: number })[], 
    userPrefs: UserPreferences
  ): StationResult[] {
    return stations.map(station => {
      // Safe access with defaults for all properties
      const availablePorts = station.availablePorts ?? 0;
      const totalPorts = station.totalPorts ?? 1;
      const queueLength = station.currentQueueLength ?? 0;
      const maxQueue = station.maxQueueLength ?? 5;
      const avgSession = station.averageSessionMinutes ?? 45;

      // Calculate wait time
      const estimatedWait = availablePorts > 0 ? 0 : Math.ceil((queueLength * avgSession) / totalPorts);
      
      // Calculate availability with null safety
      const isOpen = station.isOpen === true;
      const isAvailable = isOpen && availablePorts > 0 && queueLength < maxQueue;
      
      // Safe parsing for pricing
      let pricePerKwh = 0;
      if (typeof station.pricePerKwh === 'number') {
        pricePerKwh = station.pricePerKwh;
      } else if (typeof station.pricePerKwh === 'string') {
        pricePerKwh = parseFloat(station.pricePerKwh) || 0;
      }
      
      // Calculate match score
      const matchScore = this.calculateMatchScore(station, userPrefs, station.distance, isAvailable);

      return {
        id: station.id,
        name: station.name || 'Unnamed Station',
        address: station.address || 'No address provided',
        latitude: typeof station.latitude === 'string' ? parseFloat(station.latitude) : Number(station.latitude),
        longitude: typeof station.longitude === 'string' ? parseFloat(station.longitude) : Number(station.longitude),
        distance: Math.round(station.distance * 10) / 10,
        totalPorts,
        availablePorts,
        connectorTypes: this.parseConnectorTypes(station.connectorTypes),
        maxPowerKw: station.maxPowerKw ?? 50,
        pricePerKwh,
        isOpen,
        currentQueueLength: queueLength,
        maxQueueLength: maxQueue,
        estimatedWaitMinutes: estimatedWait,
        isAvailable,
        matchScore,
      };
    });
  }

  /**
   * Parse connector types safely
   */
  private parseConnectorTypes(connectorTypes: unknown): string[] {
    try {
      if (Array.isArray(connectorTypes)) {
        return connectorTypes.filter(item => typeof item === 'string');
      }
      
      if (typeof connectorTypes === 'string') {
        try {
          const parsed = JSON.parse(connectorTypes);
          return Array.isArray(parsed) 
            ? parsed.filter(item => typeof item === 'string')
            : [];
        } catch {
          // If JSON parsing fails, check if it's a comma-separated string
          return connectorTypes.split(',').map(item => item.trim());
        }
      }
      
      return ['Standard']; // Default fallback
    } catch (error) {
      logger.warn('Error parsing connector types', { 
        connectorTypes, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return ['Standard']; // Default fallback
    }
  }

  /**
   * Calculate station match score based on user preferences
   */
  private calculateMatchScore(
    station: RawStationData, 
    userPrefs: UserPreferences, 
    distance: number, 
    isAvailable: boolean
  ): number {
    let score = 50; // Base score
    
    // Availability bonus
    if (isAvailable) {
      score += 20;
    }
    
    // Distance factor (closer is better)
    const maxDistance = userPrefs.maxDistance ?? 25;
    if (distance <= maxDistance) {
      score += Math.round(20 * (1 - distance / maxDistance));
    }
    
    // Connector type match
    if (userPrefs.connectorType && userPrefs.connectorType !== 'Any') {
      const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
      if (stationConnectors.includes(userPrefs.connectorType)) {
        score += 15;
      }
    }
    
    // Price factor
    const maxPrice = userPrefs.maxPrice ?? 30;
    let price = 0;
    
    if (typeof station.pricePerKwh === 'number') {
      price = station.pricePerKwh;
    } else if (typeof station.pricePerKwh === 'string') {
      price = parseFloat(station.pricePerKwh) || 0;
    }
    
    if (price <= maxPrice) {
      score += Math.round(15 * (1 - price / maxPrice));
    }
    
    // Clamp score to 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get user preferences with type safety
   * FIXED: Use actual user schema properties instead of preferences
   */
  private async getUserPreferences(userWhatsapp: string): Promise<UserPreferences> {
    try {
      // Get user from database
      const user = await db
        .select()
        .from(users)
        .where(eq(users.whatsappId, userWhatsapp))
        .limit(1);
      
      if (user.length === 0) {
        return {}; // Return empty preferences if user not found
      }

      // Use the actual schema properties instead of preferences
      const userPrefs: UserPreferences = {
        connectorType: user[0].connectorType || undefined,
        chargingIntent: user[0].chargingIntent || undefined,
        queuePreference: user[0].queuePreference || undefined,
        // Infer vehicle type from EV model
        vehicleType: this.inferVehicleTypeFromModel(user[0].evModel || '')
      };
      
      return userPrefs;
      
    } catch (error) {
      logger.warn('Failed to get user preferences', { 
        userWhatsapp, 
        error: error instanceof Error ? error.message : String(error)
      });
      return {}; // Return empty preferences on error
    }
  }


   /**
   * Get all nearby stations for list display
   * Used when user wants to see all available stations
   */
  async getAllNearbyStations(options: StationSearchOptions): Promise<StationSearchResult> {
    try {
      logger.info('Getting all nearby stations', { 
        userWhatsapp: options.userWhatsapp,
        location: { lat: options.latitude, lng: options.longitude },
        radius: options.radius || 25
      });

      // Use a larger limit for "show all" functionality
      const expandedOptions: StationSearchOptions = {
        ...options,
        maxResults: options.maxResults || 20, // Show more stations in list view
        offset: options.offset || 0,
        availableOnly: false, // Show all stations, not just available ones
        sortBy: options.sortBy || 'distance' // Default to distance sorting
      };

      // Use the existing searchStations method with expanded parameters
      const result = await this.searchStations(expandedOptions);
      
      logger.info('All nearby stations retrieved', {
        userWhatsapp: options.userWhatsapp,
        stationsFound: result.stations.length,
        totalCount: result.totalCount
      });

      return result;

    } catch (error) {
      logger.error('Failed to get all nearby stations', { 
        userWhatsapp: options.userWhatsapp,
        coordinates: { latitude: options.latitude, longitude: options.longitude },
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return empty result on error
      return this.emptyResult(options);
    }
  }


  /**
   * Infer vehicle type from model name
   */
  private inferVehicleTypeFromModel(evModel: string): string {
    const model = evModel.toLowerCase();
    
    // Electric car models
    const carModels = [
      'tesla', 'model 3', 'model s', 'model x', 'model y',
      'tata nexon', 'tigor', 'punch', 
      'mg zs', 'audi e-tron', 'bmw', 'hyundai kona', 'kia ev6'
    ];
    
    // Electric bike/scooter models
    const bikeModels = [
      'ather', '450x', 'ola s1', 'tvs iqube', 'bajaj chetak', 
      'revolt', 'hero electric'
    ];
    
    if (carModels.some(car => model.includes(car))) {
      return 'Car';
    }
    
    if (bikeModels.some(bike => model.includes(bike))) {
      return 'Bike/Scooter';
    }
    
    // Default
    return 'Any';
  }

  /**
   * Get nearby stations directly without search options
   * Used for quick nearby searches
   */
  async getNearbyStations(
    userWhatsapp: string, 
    latitude: number, 
    longitude: number, 
    limit: number = 5
  ): Promise<StationResult[]> {
    try {
      const options: StationSearchOptions = {
        userWhatsapp,
        latitude,
        longitude,
        radius: 10, // Default to 10 km
        maxResults: limit,
        sortBy: 'distance'
      };
      
      const result = await this.searchStations(options);
      return result.stations;
      
    } catch (error) {
      logger.error('Failed to get nearby stations', { 
        userWhatsapp, 
        coordinates: { latitude, longitude },
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}

// Export singleton instance
export const stationSearchService = new StationSearchService();