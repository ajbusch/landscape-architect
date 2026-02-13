import { z } from 'zod';
import { USDAZoneSchema } from './zone.js';
import { SunExposureSchema, DifficultySchema, CostRangeSchema } from './analysis.js';

/**
 * A plant in the database — the source of truth for all recommendations.
 */
export const PlantSchema = z.object({
  id: z.uuid(),
  commonName: z.string().min(1).max(100),
  scientificName: z.string().min(1).max(150),
  description: z.string().max(2000),
  photoUrl: z.url().optional(),

  // Growing conditions
  light: z.array(SunExposureSchema).min(1),
  waterNeeds: z.enum(['low', 'moderate', 'high']),
  soilTypes: z.array(z.enum(['clay', 'sandy', 'loamy', 'silty', 'rocky'])).min(1),

  // Size
  matureHeightFtMin: z.number().positive(),
  matureHeightFtMax: z.number().positive(),
  matureWidthFtMin: z.number().positive(),
  matureWidthFtMax: z.number().positive(),

  // Hardiness
  zoneMin: USDAZoneSchema,
  zoneMax: USDAZoneSchema,

  // Categorization
  type: z.enum(['tree', 'shrub', 'perennial', 'annual', 'grass', 'vine', 'groundcover', 'bulb']),
  bloomSeason: z.enum(['spring', 'summer', 'fall', 'winter', 'evergreen', 'none']).optional(),
  isNative: z.boolean(),
  isInvasive: z.boolean(),
  deerResistant: z.boolean(),
  droughtTolerant: z.boolean(),

  // User-facing
  costRange: CostRangeSchema,
  difficulty: DifficultySchema,
  careGuide: z.string().max(5000).optional(),

  // Metadata
  tags: z.array(z.string().max(50)).max(20),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Plant = z.infer<typeof PlantSchema>;

/**
 * Query parameters for searching/filtering plants.
 */
export const PlantSearchParamsSchema = z.object({
  query: z.string().max(100).optional(),
  zone: USDAZoneSchema.optional(),
  light: SunExposureSchema.optional(),
  waterNeeds: z.enum(['low', 'moderate', 'high']).optional(),
  type: PlantSchema.shape.type.optional(),
  difficulty: DifficultySchema.optional(),
  deerResistant: z.boolean().optional(),
  droughtTolerant: z.boolean().optional(),
  isNative: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(50).default(20),
});

export type PlantSearchParams = z.infer<typeof PlantSearchParamsSchema>;

/**
 * Paginated plant search response.
 */
export const PlantSearchResponseSchema = z.object({
  plants: z.array(PlantSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export type PlantSearchResponse = z.infer<typeof PlantSearchResponseSchema>;
