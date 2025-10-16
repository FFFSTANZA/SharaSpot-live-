import { z } from 'zod';

export const whatsappIdSchema = z.string().min(10).max(20).regex(/^\d+$/);

export const connectorTypeSchema = z.enum(['CCS2', 'Type2', 'CHAdeMO', 'Any']);

export const chargingIntentSchema = z.enum(['Quick Top-up', 'Full Charge', 'Emergency']);

export const queuePreferenceSchema = z.enum(['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue']);

export const userPreferencesSchema = z.object({
  evModel: z.string().max(100).optional(),
  connectorType: connectorTypeSchema.optional(),
  chargingIntent: chargingIntentSchema.optional(),
  queuePreference: queuePreferenceSchema.optional(),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
});

export function validateWhatsAppId(id: string): boolean {
  return whatsappIdSchema.safeParse(id).success;
}

export function validateLocation(lat: number, lng: number): boolean {
  return locationSchema.safeParse({ latitude: lat, longitude: lng }).success;
}