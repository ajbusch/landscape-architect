import { z } from 'zod';

/**
 * US ZIP code — 5 digits or ZIP+4 format.
 */
export const ZipCodeSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'Must be a valid US ZIP code (e.g., 28202 or 28202-1234)');

/**
 * Address input for zone resolution.
 * User provides either a full address or just a ZIP code.
 */
export const AddressInputSchema = z.object({
  zipCode: ZipCodeSchema,
  streetAddress: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2, 'Use 2-letter state abbreviation').toUpperCase().optional(),
});

export type AddressInput = z.infer<typeof AddressInputSchema>;

/**
 * USDA Hardiness Zone — e.g., "7b", "5a", "10a".
 */
export const USDAZoneSchema = z
  .string()
  .regex(/^(1[0-3]|[1-9])[ab]$/, 'Must be a valid USDA zone (e.g., 7b, 10a)');

/**
 * Zone lookup response.
 */
export const ZoneResponseSchema = z.object({
  zipCode: ZipCodeSchema,
  zone: USDAZoneSchema,
  zoneNumber: z.number().int().min(1).max(13),
  zoneLetter: z.enum(['a', 'b']),
  minTempF: z.number().int(),
  maxTempF: z.number().int(),
  description: z.string(),
});

export type ZoneResponse = z.infer<typeof ZoneResponseSchema>;
