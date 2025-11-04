"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locationSchema = exports.userPreferencesSchema = exports.queuePreferenceSchema = exports.chargingIntentSchema = exports.connectorTypeSchema = exports.whatsappIdSchema = void 0;
exports.validateWhatsAppId = validateWhatsAppId;
exports.validateLocation = validateLocation;
const zod_1 = require("zod");
exports.whatsappIdSchema = zod_1.z.string().min(10).max(20).regex(/^\d+$/);
exports.connectorTypeSchema = zod_1.z.enum(['CCS2', 'Type2', 'CHAdeMO', 'Any']);
exports.chargingIntentSchema = zod_1.z.enum(['Quick Top-up', 'Full Charge', 'Emergency']);
exports.queuePreferenceSchema = zod_1.z.enum(['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue']);
exports.userPreferencesSchema = zod_1.z.object({
    evModel: zod_1.z.string().max(100).optional(),
    connectorType: exports.connectorTypeSchema.optional(),
    chargingIntent: exports.chargingIntentSchema.optional(),
    queuePreference: exports.queuePreferenceSchema.optional(),
});
exports.locationSchema = zod_1.z.object({
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    name: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
});
function validateWhatsAppId(id) {
    return exports.whatsappIdSchema.safeParse(id).success;
}
function validateLocation(lat, lng) {
    return exports.locationSchema.safeParse({ latitude: lat, longitude: lng }).success;
}
//# sourceMappingURL=validation.js.map