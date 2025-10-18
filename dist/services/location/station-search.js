"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stationSearchService = exports.StationSearchService = void 0;
const database_1 = require("../../config/database");
const schema_1 = require("../../db/schema");
const logger_1 = require("../../utils/logger");
const drizzle_orm_1 = require("drizzle-orm");
const geolib_1 = require("geolib");
class StationSearchService {
    async searchStations(options) {
        try {
            logger_1.logger.info('Searching stations', {
                userWhatsapp: options.userWhatsapp,
                location: { lat: options.latitude, lng: options.longitude },
                radius: options.radius || 25
            });
            return await this.simpleSearch(options);
        }
        catch (error) {
            logger_1.logger.error('Station search failed', {
                error: error instanceof Error ? error.message : String(error),
                options
            });
            return this.emptyResult(options);
        }
    }
    emptyResult(options) {
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
    async simpleSearch(options) {
        const { latitude, longitude, radius = 25, maxResults = 10, offset = 0, availableOnly = false } = options;
        try {
            const userPrefs = await this.getUserPreferences(options.userWhatsapp);
            const rawStations = await database_1.db
                .select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingStations.isActive, true), (0, drizzle_orm_1.ne)(schema_1.chargingStations.isPaused, true)));
            const stationsWithDistance = rawStations.map(station => {
                const stationLat = typeof station.latitude === 'string'
                    ? parseFloat(station.latitude)
                    : Number(station.latitude);
                const stationLng = typeof station.longitude === 'string'
                    ? parseFloat(station.longitude)
                    : Number(station.longitude);
                let distance = 0;
                if (!isNaN(stationLat) && !isNaN(stationLng) &&
                    !isNaN(latitude) && !isNaN(longitude)) {
                    try {
                        distance = (0, geolib_1.getDistance)({ latitude, longitude }, { latitude: stationLat, longitude: stationLng }) / 1000;
                    }
                    catch (e) {
                        logger_1.logger.warn('Distance calculation failed', {
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
                };
            });
            const withinRadius = this.filterByDistance(stationsWithDistance, radius);
            const filtered = this.applyFilters(withinRadius, options, userPrefs);
            const sorted = this.sortStations(filtered, options.sortBy || 'distance');
            const paginatedStations = sorted.slice(offset, offset + maxResults);
            const stations = this.processStationResults(paginatedStations, userPrefs);
            return {
                stations,
                totalCount: filtered.length,
                hasMore: offset + maxResults < filtered.length,
                searchLocation: {
                    latitude,
                    longitude
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Station search processing failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    filterByDistance(stations, radius) {
        return stations.filter(station => !isNaN(station.distance) && station.distance <= radius);
    }
    applyFilters(stations, options, userPrefs) {
        let filtered = [...stations];
        if (options.availableOnly === true) {
            filtered = filtered.filter(station => {
                const availablePorts = station.availablePorts ?? 0;
                const isOpen = station.isOpen === true;
                return isOpen && availablePorts > 0;
            });
        }
        if (options.maxPrice && !isNaN(options.maxPrice)) {
            filtered = filtered.filter(station => {
                let price = 0;
                if (typeof station.pricePerKwh === 'number') {
                    price = station.pricePerKwh;
                }
                else if (typeof station.pricePerKwh === 'string') {
                    price = parseFloat(station.pricePerKwh) || 0;
                }
                return price <= (options.maxPrice ?? Infinity);
            });
        }
        if (options.connectorTypes && options.connectorTypes.length > 0) {
            filtered = filtered.filter(station => {
                const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
                return options.connectorTypes.some(type => stationConnectors.includes(type));
            });
        }
        if (userPrefs.connectorType && userPrefs.connectorType !== 'Any') {
            filtered = filtered.filter(station => {
                const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
                return stationConnectors.includes(userPrefs.connectorType);
            });
        }
        return filtered;
    }
    sortStations(stations, sortBy) {
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
    processStationResults(stations, userPrefs) {
        return stations.map(station => {
            const availablePorts = station.availablePorts ?? 0;
            const totalPorts = station.totalPorts ?? 1;
            const queueLength = station.currentQueueLength ?? 0;
            const maxQueue = station.maxQueueLength ?? 5;
            const avgSession = station.averageSessionMinutes ?? 45;
            const estimatedWait = availablePorts > 0 ? 0 : Math.ceil((queueLength * avgSession) / totalPorts);
            const isOpen = station.isOpen === true;
            const isAvailable = isOpen && availablePorts > 0 && queueLength < maxQueue;
            let pricePerKwh = 0;
            if (typeof station.pricePerKwh === 'number') {
                pricePerKwh = station.pricePerKwh;
            }
            else if (typeof station.pricePerKwh === 'string') {
                pricePerKwh = parseFloat(station.pricePerKwh) || 0;
            }
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
    parseConnectorTypes(connectorTypes) {
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
                }
                catch {
                    return connectorTypes.split(',').map(item => item.trim());
                }
            }
            return ['Standard'];
        }
        catch (error) {
            logger_1.logger.warn('Error parsing connector types', {
                connectorTypes,
                error: error instanceof Error ? error.message : String(error)
            });
            return ['Standard'];
        }
    }
    calculateMatchScore(station, userPrefs, distance, isAvailable) {
        let score = 50;
        if (isAvailable) {
            score += 20;
        }
        const maxDistance = userPrefs.maxDistance ?? 25;
        if (distance <= maxDistance) {
            score += Math.round(20 * (1 - distance / maxDistance));
        }
        if (userPrefs.connectorType && userPrefs.connectorType !== 'Any') {
            const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
            if (stationConnectors.includes(userPrefs.connectorType)) {
                score += 15;
            }
        }
        const maxPrice = userPrefs.maxPrice ?? 30;
        let price = 0;
        if (typeof station.pricePerKwh === 'number') {
            price = station.pricePerKwh;
        }
        else if (typeof station.pricePerKwh === 'string') {
            price = parseFloat(station.pricePerKwh) || 0;
        }
        if (price <= maxPrice) {
            score += Math.round(15 * (1 - price / maxPrice));
        }
        return Math.max(0, Math.min(100, score));
    }
    async getUserPreferences(userWhatsapp) {
        try {
            const user = await database_1.db
                .select()
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, userWhatsapp))
                .limit(1);
            if (user.length === 0) {
                return {};
            }
            const userPrefs = {
                connectorType: user[0].connectorType || undefined,
                chargingIntent: user[0].chargingIntent || undefined,
                queuePreference: user[0].queuePreference || undefined,
                vehicleType: this.inferVehicleTypeFromModel(user[0].evModel || '')
            };
            return userPrefs;
        }
        catch (error) {
            logger_1.logger.warn('Failed to get user preferences', {
                userWhatsapp,
                error: error instanceof Error ? error.message : String(error)
            });
            return {};
        }
    }
    async getAllNearbyStations(options) {
        try {
            logger_1.logger.info('Getting all nearby stations', {
                userWhatsapp: options.userWhatsapp,
                location: { lat: options.latitude, lng: options.longitude },
                radius: options.radius || 25
            });
            const expandedOptions = {
                ...options,
                maxResults: options.maxResults || 20,
                offset: options.offset || 0,
                availableOnly: false,
                sortBy: options.sortBy || 'distance'
            };
            const result = await this.searchStations(expandedOptions);
            logger_1.logger.info('All nearby stations retrieved', {
                userWhatsapp: options.userWhatsapp,
                stationsFound: result.stations.length,
                totalCount: result.totalCount
            });
            return result;
        }
        catch (error) {
            logger_1.logger.error('Failed to get all nearby stations', {
                userWhatsapp: options.userWhatsapp,
                coordinates: { latitude: options.latitude, longitude: options.longitude },
                error: error instanceof Error ? error.message : String(error)
            });
            return this.emptyResult(options);
        }
    }
    inferVehicleTypeFromModel(evModel) {
        const model = evModel.toLowerCase();
        const carModels = [
            'tesla', 'model 3', 'model s', 'model x', 'model y',
            'tata nexon', 'tigor', 'punch',
            'mg zs', 'audi e-tron', 'bmw', 'hyundai kona', 'kia ev6'
        ];
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
        return 'Any';
    }
    async getNearbyStations(userWhatsapp, latitude, longitude, limit = 5) {
        try {
            const options = {
                userWhatsapp,
                latitude,
                longitude,
                radius: 10,
                maxResults: limit,
                sortBy: 'distance'
            };
            const result = await this.searchStations(options);
            return result.stations;
        }
        catch (error) {
            logger_1.logger.error('Failed to get nearby stations', {
                userWhatsapp,
                coordinates: { latitude, longitude },
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
}
exports.StationSearchService = StationSearchService;
exports.stationSearchService = new StationSearchService();
//# sourceMappingURL=station-search.js.map