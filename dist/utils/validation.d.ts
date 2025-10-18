import { z } from 'zod';
export declare const whatsappIdSchema: z.ZodString;
export declare const connectorTypeSchema: z.ZodEnum<["CCS2", "Type2", "CHAdeMO", "Any"]>;
export declare const chargingIntentSchema: z.ZodEnum<["Quick Top-up", "Full Charge", "Emergency"]>;
export declare const queuePreferenceSchema: z.ZodEnum<["Free Now", "Wait 15m", "Wait 30m", "Any Queue"]>;
export declare const userPreferencesSchema: z.ZodObject<{
    evModel: z.ZodOptional<z.ZodString>;
    connectorType: z.ZodOptional<z.ZodEnum<["CCS2", "Type2", "CHAdeMO", "Any"]>>;
    chargingIntent: z.ZodOptional<z.ZodEnum<["Quick Top-up", "Full Charge", "Emergency"]>>;
    queuePreference: z.ZodOptional<z.ZodEnum<["Free Now", "Wait 15m", "Wait 30m", "Any Queue"]>>;
}, "strip", z.ZodTypeAny, {
    evModel?: string | undefined;
    connectorType?: "CCS2" | "Type2" | "CHAdeMO" | "Any" | undefined;
    chargingIntent?: "Quick Top-up" | "Full Charge" | "Emergency" | undefined;
    queuePreference?: "Free Now" | "Wait 15m" | "Wait 30m" | "Any Queue" | undefined;
}, {
    evModel?: string | undefined;
    connectorType?: "CCS2" | "Type2" | "CHAdeMO" | "Any" | undefined;
    chargingIntent?: "Quick Top-up" | "Full Charge" | "Emergency" | undefined;
    queuePreference?: "Free Now" | "Wait 15m" | "Wait 30m" | "Any Queue" | undefined;
}>;
export declare const locationSchema: z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    name: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    latitude: number;
    longitude: number;
    name?: string | undefined;
    address?: string | undefined;
}, {
    latitude: number;
    longitude: number;
    name?: string | undefined;
    address?: string | undefined;
}>;
export declare function validateWhatsAppId(id: string): boolean;
export declare function validateLocation(lat: number, lng: number): boolean;
//# sourceMappingURL=validation.d.ts.map