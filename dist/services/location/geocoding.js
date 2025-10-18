"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geocodingService = exports.GeocodingService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const database_1 = require("../../config/database");
const schema_1 = require("../../db/schema");
const logger_1 = require("../../utils/logger");
class GeocodingService {
    constructor() {
        this.indianCities = [
            { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707, population: 4646732, aliases: ['madras'] },
            { name: 'Coimbatore', state: 'Tamil Nadu', lat: 11.0168, lng: 76.9558, population: 1061447, aliases: ['kovai'] },
            { name: 'Madurai', state: 'Tamil Nadu', lat: 9.9252, lng: 78.1198, population: 1016885 },
            { name: 'Tiruchirappalli', state: 'Tamil Nadu', lat: 10.7905, lng: 78.7047, population: 847387, aliases: ['trichy', 'tiruchy'] },
            { name: 'Salem', state: 'Tamil Nadu', lat: 11.664, lng: 78.146, population: 696760 },
            { name: 'Tirunelveli', state: 'Tamil Nadu', lat: 8.7139, lng: 77.7567, population: 474838 },
            { name: 'Tiruppur', state: 'Tamil Nadu', lat: 11.1085, lng: 77.3411, population: 444543 },
            { name: 'Vellore', state: 'Tamil Nadu', lat: 12.9165, lng: 79.1325, population: 423425 },
            { name: 'Erode', state: 'Tamil Nadu', lat: 11.341, lng: 77.717, population: 498129 },
            { name: 'Thoothukkudi', state: 'Tamil Nadu', lat: 8.7642, lng: 78.1348, population: 237817, aliases: ['tuticorin'] },
            { name: 'Anna Nagar', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0878, lng: 80.2086 },
            { name: 'T Nagar', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0418, lng: 80.2341, aliases: ['t. nagar', 'thyagaraya nagar'] },
            { name: 'Velachery', state: 'Tamil Nadu', district: 'Chennai', lat: 12.9754, lng: 80.2212 },
            { name: 'Adyar', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0067, lng: 80.2206 },
            { name: 'Mylapore', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0339, lng: 80.2619 },
            { name: 'Nungambakkam', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0594, lng: 80.2428 },
            { name: 'Egmore', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0732, lng: 80.2609 },
            { name: 'Tambaram', state: 'Tamil Nadu', district: 'Chennai', lat: 12.9249, lng: 80.1000 },
            { name: 'Chrompet', state: 'Tamil Nadu', district: 'Chennai', lat: 12.9516, lng: 80.1462 },
            { name: 'Porur', state: 'Tamil Nadu', district: 'Chennai', lat: 13.0381, lng: 80.1564 },
            { name: 'OMR', state: 'Tamil Nadu', district: 'Chennai', lat: 12.8956, lng: 80.2267, aliases: ['old mahabalipuram road', 'rajiv gandhi salai'] },
            { name: 'ECR', state: 'Tamil Nadu', district: 'Chennai', lat: 12.8230, lng: 80.2467, aliases: ['east coast road'] },
            { name: 'RS Puram', state: 'Tamil Nadu', district: 'Coimbatore', lat: 11.0049, lng: 76.9618, aliases: ['race course'] },
            { name: 'Gandhipuram', state: 'Tamil Nadu', district: 'Coimbatore', lat: 11.0183, lng: 76.9725 },
            { name: 'Peelamedu', state: 'Tamil Nadu', district: 'Coimbatore', lat: 11.0301, lng: 77.0081 },
            { name: 'Saibaba Colony', state: 'Tamil Nadu', district: 'Coimbatore', lat: 11.0230, lng: 76.9370 },
            { name: 'Singanallur', state: 'Tamil Nadu', district: 'Coimbatore', lat: 11.0510, lng: 77.0410 },
            { name: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946, population: 8443675, aliases: ['bengaluru'] },
            { name: 'Mysore', state: 'Karnataka', lat: 12.2958, lng: 76.6394, population: 887446, aliases: ['mysuru'] },
            { name: 'Hubli', state: 'Karnataka', lat: 15.3647, lng: 75.1240, population: 943857, aliases: ['hubballi'] },
            { name: 'Mangalore', state: 'Karnataka', lat: 12.9141, lng: 74.8560, population: 623841, aliases: ['mangaluru'] },
            { name: 'Belgaum', state: 'Karnataka', lat: 15.8497, lng: 74.4977, population: 610350, aliases: ['belagavi'] },
            { name: 'Hyderabad', state: 'Telangana', lat: 17.3850, lng: 78.4867, population: 6809970 },
            { name: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lng: 83.2185, population: 1730320, aliases: ['vizag'] },
            { name: 'Vijayawada', state: 'Andhra Pradesh', lat: 16.5062, lng: 80.6480, population: 1048240 },
            { name: 'Guntur', state: 'Andhra Pradesh', lat: 16.3067, lng: 80.4365, population: 743354 },
            { name: 'Tirupati', state: 'Andhra Pradesh', lat: 13.6288, lng: 79.4192, population: 374260 },
            { name: 'Thiruvananthapuram', state: 'Kerala', lat: 8.5241, lng: 76.9366, population: 957730, aliases: ['trivandrum'] },
            { name: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673, population: 677381, aliases: ['cochin'] },
            { name: 'Kozhikode', state: 'Kerala', lat: 11.2588, lng: 75.7804, population: 609224, aliases: ['calicut'] },
            { name: 'Thrissur', state: 'Kerala', lat: 10.5276, lng: 76.2144, population: 315596, aliases: ['trichur'] },
            { name: 'Kollam', state: 'Kerala', lat: 8.8932, lng: 76.6141, population: 349033, aliases: ['quilon'] },
            { name: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lng: 72.8777, population: 12442373, aliases: ['bombay'] },
            { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567, population: 3124458 },
            { name: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lng: 79.0882, population: 2405421 },
            { name: 'Thane', state: 'Maharashtra', lat: 19.2183, lng: 72.9781, population: 1841488 },
            { name: 'Nashik', state: 'Maharashtra', lat: 19.9975, lng: 73.7898, population: 1486973 },
            { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714, population: 5633927 },
            { name: 'Surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311, population: 4466826 },
            { name: 'Vadodara', state: 'Gujarat', lat: 22.3072, lng: 73.1812, population: 1666703, aliases: ['baroda'] },
            { name: 'Rajkot', state: 'Gujarat', lat: 22.3039, lng: 70.8022, population: 1390933 },
            { name: 'New Delhi', state: 'Delhi', lat: 28.6139, lng: 77.2090, population: 16787941, aliases: ['delhi'] },
            { name: 'Gurgaon', state: 'Haryana', lat: 28.4595, lng: 77.0266, population: 876969, aliases: ['gurugram'] },
            { name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.3910, population: 637272 },
            { name: 'Faridabad', state: 'Haryana', lat: 28.4089, lng: 77.3178, population: 1404653 },
            { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639, population: 4496694, aliases: ['calcutta'] },
            { name: 'Howrah', state: 'West Bengal', lat: 22.5958, lng: 88.2636, population: 1072161 },
            { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873, population: 3046163 },
            { name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462, population: 2817105 },
            { name: 'Kanpur', state: 'Uttar Pradesh', lat: 26.4499, lng: 80.3319, population: 2767031 },
            { name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577, population: 1964086 },
            { name: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lng: 77.4126, population: 1798218 },
            { name: 'Patna', state: 'Bihar', lat: 25.5941, lng: 85.1376, population: 1684222 },
            { name: 'Agra', state: 'Uttar Pradesh', lat: 27.1767, lng: 78.0081, population: 1585704 }
        ];
    }
    async geocodeText(searchText, options = {}) {
        try {
            const searchTerm = this.cleanSearchTerm(searchText);
            const cached = await this.getCachedResult(searchTerm);
            if (cached) {
                await this.updateCacheUsage(searchTerm);
                return [cached];
            }
            const results = await this.searchIndianCities(searchTerm);
            if (results.length > 0) {
                await this.cacheResult(searchTerm, searchText, results[0]);
                if (options.userWhatsapp) {
                    await this.saveUserSearchHistory(options.userWhatsapp, searchText, results[0]);
                }
                return results.slice(0, options.maxResults || 3);
            }
            logger_1.logger.warn('No geocoding results found', { searchText, searchTerm });
            return [];
        }
        catch (error) {
            logger_1.logger.error('Geocoding failed', { searchText, error });
            return [];
        }
    }
    async reverseGeocode(latitude, longitude) {
        try {
            let nearestCity = null;
            let minDistance = Infinity;
            for (const city of this.indianCities) {
                const distance = this.calculateDistance(latitude, longitude, city.lat, city.lng);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestCity = city;
                }
            }
            if (nearestCity && minDistance < 50) {
                const result = {
                    latitude,
                    longitude,
                    formattedAddress: `Near ${nearestCity.name}, ${nearestCity.state}, India`,
                    locality: nearestCity.name,
                    state: nearestCity.state,
                    country: 'India',
                    confidence: minDistance < 5 ? 1.0 : 0.8,
                    geohash: this.generateGeohash(latitude, longitude),
                };
                return result;
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error('Reverse geocoding failed', { latitude, longitude, error });
            return null;
        }
    }
    cleanSearchTerm(term) {
        return term
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async searchIndianCities(cleanTerm) {
        const results = [];
        for (const city of this.indianCities) {
            const cityName = city.name.toLowerCase();
            const stateName = city.state.toLowerCase();
            const district = city.district?.toLowerCase();
            if (cityName === cleanTerm) {
                results.push(this.createGeocodeResult(city, 1.0));
                continue;
            }
            if (`${cityName} ${stateName}` === cleanTerm || `${cityName}, ${stateName}` === cleanTerm) {
                results.push(this.createGeocodeResult(city, 0.95));
                continue;
            }
            if (district && (`${cityName} ${district}` === cleanTerm || cleanTerm.includes(cityName))) {
                results.push(this.createGeocodeResult(city, 0.9));
                continue;
            }
            if (city.aliases) {
                for (const alias of city.aliases) {
                    if (alias.toLowerCase() === cleanTerm) {
                        results.push(this.createGeocodeResult(city, 0.95));
                        break;
                    }
                }
            }
        }
        if (results.length === 0) {
            for (const city of this.indianCities) {
                const cityName = city.name.toLowerCase();
                if (cleanTerm.includes(cityName) || cityName.includes(cleanTerm)) {
                    const confidence = cityName.includes(cleanTerm) ? 0.8 : 0.7;
                    results.push(this.createGeocodeResult(city, confidence));
                }
            }
        }
        if (results.length === 0) {
            for (const city of this.indianCities) {
                const cityName = city.name.toLowerCase();
                const similarity = this.calculateSimilarity(cityName, cleanTerm);
                if (similarity > 0.75) {
                    results.push(this.createGeocodeResult(city, similarity * 0.8));
                }
                if (city.aliases) {
                    for (const alias of city.aliases) {
                        const aliasSimilarity = this.calculateSimilarity(alias.toLowerCase(), cleanTerm);
                        if (aliasSimilarity > 0.75) {
                            results.push(this.createGeocodeResult(city, aliasSimilarity * 0.75));
                            break;
                        }
                    }
                }
            }
        }
        return results
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5)
            .filter(r => r.confidence > 0.6);
    }
    createGeocodeResult(city, confidence) {
        const formattedAddress = city.district
            ? `${city.name}, ${city.district}, ${city.state}, India`
            : `${city.name}, ${city.state}, India`;
        return {
            latitude: city.lat,
            longitude: city.lng,
            formattedAddress,
            locality: city.name,
            subLocality: city.district,
            state: city.state,
            country: 'India',
            confidence,
            geohash: this.generateGeohash(city.lat, city.lng),
        };
    }
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0)
            return 1.0;
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }
    levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                }
                else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                }
            }
        }
        return matrix[str2.length][str1.length];
    }
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = this.deg2rad(lat2 - lat1);
        const dLng = this.deg2rad(lng2 - lng1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    deg2rad(deg) {
        return deg * (Math.PI / 180);
    }
    generateGeohash(lat, lng, precision = 7) {
        const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
        let even = true;
        let bit = 0;
        let ch = 0;
        let geohash = '';
        let latRange = [-90.0, 90.0];
        let lngRange = [-180.0, 180.0];
        while (geohash.length < precision) {
            if (even) {
                const mid = (lngRange[0] + lngRange[1]) / 2;
                if (lng >= mid) {
                    ch |= (1 << (4 - bit));
                    lngRange[0] = mid;
                }
                else {
                    lngRange[1] = mid;
                }
            }
            else {
                const mid = (latRange[0] + latRange[1]) / 2;
                if (lat >= mid) {
                    ch |= (1 << (4 - bit));
                    latRange[0] = mid;
                }
                else {
                    latRange[1] = mid;
                }
            }
            even = !even;
            if (bit < 4) {
                bit++;
            }
            else {
                geohash += base32[ch];
                bit = 0;
                ch = 0;
            }
        }
        return geohash;
    }
    async getCachedResult(searchTerm) {
        try {
            const [cached] = await database_1.db
                .select()
                .from(schema_1.geocodeCacheV2)
                .where((0, drizzle_orm_1.eq)(schema_1.geocodeCacheV2.searchTerm, searchTerm))
                .limit(1);
            if (cached) {
                return {
                    latitude: parseFloat(cached.latitude),
                    longitude: parseFloat(cached.longitude),
                    formattedAddress: cached.formattedAddress || '',
                    locality: cached.locality || undefined,
                    subLocality: cached.subLocality || undefined,
                    state: cached.state || undefined,
                    country: cached.country || 'India',
                    postalCode: cached.postalCode || undefined,
                    confidence: parseFloat(cached.confidence || '1.0'),
                    geohash: cached.geohash,
                };
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error('Failed to get cached result', { searchTerm, error });
            return null;
        }
    }
    async cacheResult(searchTerm, originalAddress, result) {
        try {
            await database_1.db.insert(schema_1.geocodeCacheV2).values({
                searchTerm,
                originalAddress,
                latitude: result.latitude.toString(),
                longitude: result.longitude.toString(),
                geohash: result.geohash,
                formattedAddress: result.formattedAddress,
                locality: result.locality,
                subLocality: result.subLocality,
                state: result.state,
                country: result.country,
                postalCode: result.postalCode,
                confidence: result.confidence.toString(),
                hitCount: 1,
                lastUsed: new Date(),
                createdAt: new Date(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to cache geocode result', { searchTerm, error });
        }
    }
    async updateCacheUsage(searchTerm) {
        try {
            await database_1.db
                .update(schema_1.geocodeCacheV2)
                .set({
                hitCount: (0, drizzle_orm_1.sql) `${schema_1.geocodeCacheV2.hitCount} + 1`,
                lastUsed: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.geocodeCacheV2.searchTerm, searchTerm));
        }
        catch (error) {
            logger_1.logger.error('Failed to update cache usage', { searchTerm, error });
        }
    }
    async saveUserSearchHistory(userWhatsapp, searchTerm, result) {
        try {
            await database_1.db.insert(schema_1.userSearchHistory).values({
                userWhatsapp,
                searchTerm,
                latitude: result.latitude.toString(),
                longitude: result.longitude.toString(),
                resultCount: 1,
                createdAt: new Date(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to save user search history', { userWhatsapp, searchTerm, error });
        }
    }
    async getUserRecentSearches(userWhatsapp, limit = 5) {
        try {
            const recent = await database_1.db
                .select({ searchTerm: schema_1.userSearchHistory.searchTerm })
                .from(schema_1.userSearchHistory)
                .where((0, drizzle_orm_1.eq)(schema_1.userSearchHistory.userWhatsapp, userWhatsapp))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.userSearchHistory.createdAt))
                .limit(limit);
            return recent.map(r => r.searchTerm);
        }
        catch (error) {
            logger_1.logger.error('Failed to get user recent searches', { userWhatsapp, error });
            return [];
        }
    }
    addCity(cityData) {
        this.indianCities.push(cityData);
        logger_1.logger.info('City added to database', { city: cityData.name, state: cityData.state });
    }
    getCitiesInState(stateName) {
        return this.indianCities.filter(city => city.state.toLowerCase() === stateName.toLowerCase());
    }
    findCitiesNearby(latitude, longitude, radiusKm = 50) {
        return this.indianCities.filter(city => {
            const distance = this.calculateDistance(latitude, longitude, city.lat, city.lng);
            return distance <= radiusKm;
        }).sort((a, b) => {
            const distA = this.calculateDistance(latitude, longitude, a.lat, a.lng);
            const distB = this.calculateDistance(latitude, longitude, b.lat, b.lng);
            return distA - distB;
        });
    }
}
exports.GeocodingService = GeocodingService;
exports.geocodingService = new GeocodingService();
//# sourceMappingURL=geocoding.js.map