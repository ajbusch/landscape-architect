import { z } from 'zod';

/**
 * Location input for yard analysis — replaces ZIP code input.
 * Lat/lng are nullable to support the Places API fallback path
 * (user enters location name only, no coordinates).
 */
export const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  locationName: z.string().min(1).max(200),
});

export type LocationInput = z.infer<typeof LocationInputSchema>;
