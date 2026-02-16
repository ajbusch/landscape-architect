import { z } from 'zod';
import { USDAZoneSchema } from './zone.js';

/**
 * Confidence level for AI-identified features.
 */
export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);

/**
 * Sun exposure categories.
 */
export const SunExposureSchema = z.enum(['full_sun', 'partial_shade', 'full_shade']);

/**
 * A landscape feature identified by AI in the uploaded photo.
 */
export const IdentifiedFeatureSchema = z.object({
  id: z.uuid(),
  type: z.enum([
    'tree',
    'shrub',
    'flower',
    'grass',
    'patio',
    'walkway',
    'fence',
    'wall',
    'deck',
    'water_feature',
    'slope',
    'flat_area',
    'garden_bed',
    'other',
  ]),
  label: z.string().min(1).max(100),
  species: z.string().max(100).optional(),
  confidence: ConfidenceLevelSchema,
  sunExposure: SunExposureSchema.optional(),
  notes: z.string().max(500).optional(),
});

export type IdentifiedFeature = z.infer<typeof IdentifiedFeatureSchema>;

/**
 * Plant difficulty level.
 */
export const DifficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);

/**
 * Cost estimate range.
 */
export const CostRangeSchema = z.enum(['low', 'medium', 'high']);

/**
 * Recommendation category.
 */
export const RecommendationCategorySchema = z.enum([
  'quick_win',
  'foundation_plant',
  'seasonal_color',
  'problem_solver',
]);

/**
 * A single plant recommendation from the AI analysis.
 */
export const PlantRecommendationSchema = z.object({
  plantId: z.uuid(),
  commonName: z.string().min(1).max(100),
  scientificName: z.string().min(1).max(150),
  photoUrl: z.url().optional(),
  reason: z.string().min(1).max(500),
  category: RecommendationCategorySchema,
  light: SunExposureSchema,
  waterNeeds: z.enum(['low', 'moderate', 'high']),
  matureSize: z.object({
    heightFt: z.object({ min: z.number().positive(), max: z.number().positive() }),
    widthFt: z.object({ min: z.number().positive(), max: z.number().positive() }),
  }),
  hardinessZones: z.object({
    min: USDAZoneSchema,
    max: USDAZoneSchema,
  }),
  bloomSeason: z.enum(['spring', 'summer', 'fall', 'winter', 'evergreen', 'none']).optional(),
  costRange: CostRangeSchema,
  difficulty: DifficultySchema,
});

export type PlantRecommendation = z.infer<typeof PlantRecommendationSchema>;

/**
 * The complete AI analysis result.
 */
export const AnalysisResultSchema = z.object({
  summary: z.string().min(1).max(2000),
  yardSize: z.enum(['small', 'medium', 'large']),
  overallSunExposure: SunExposureSchema,
  estimatedSoilType: z.enum(['clay', 'sandy', 'loamy', 'silty', 'rocky', 'unknown']),
  features: z.array(IdentifiedFeatureSchema),
  recommendations: z.array(PlantRecommendationSchema).max(10),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/**
 * Full analysis response returned by the API.
 */
export const AnalysisResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().optional(),
  photoUrl: z.url(),
  address: z.object({
    zipCode: z.string(),
    zone: USDAZoneSchema,
  }),
  result: AnalysisResultSchema,
  tier: z.enum(['free', 'premium']),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

/**
 * Feature type enum — extracted for reuse in the AI output schema.
 */
export const FeatureTypeSchema = IdentifiedFeatureSchema.shape.type;

/**
 * Plant type enum — extracted for reuse.
 */
export const PlantTypeSchema = z.enum([
  'tree',
  'shrub',
  'perennial',
  'annual',
  'grass',
  'vine',
  'groundcover',
  'bulb',
]);

/**
 * Raw AI output from Claude Vision — intermediate schema before plant matching.
 * This is different from AnalysisResultSchema: the AI returns plant *types* with
 * search criteria, not specific plant records from our database.
 */
export const AiAnalysisOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  yardSize: z.enum(['small', 'medium', 'large']),
  overallSunExposure: SunExposureSchema,
  estimatedSoilType: z.enum(['clay', 'sandy', 'loamy', 'silty', 'rocky', 'unknown']),
  features: z.array(
    z.object({
      type: FeatureTypeSchema,
      label: z.string().min(1).max(100),
      species: z.string().max(100).optional(),
      confidence: ConfidenceLevelSchema,
      sunExposure: SunExposureSchema.optional(),
      notes: z.string().max(500).optional(),
    }),
  ),
  recommendedPlantTypes: z.array(
    z.object({
      category: RecommendationCategorySchema,
      plantType: PlantTypeSchema,
      lightRequirement: SunExposureSchema,
      reason: z.string().min(1).max(500),
      searchCriteria: z.object({
        type: z.string().min(1).max(50),
        light: z.string().min(1).max(50),
        tags: z.array(z.string().max(50)).max(10).optional(),
      }),
    }),
  ),
  isValidYardPhoto: z.boolean(),
  invalidPhotoReason: z.string().max(500).optional(),
});

export type AiAnalysisOutput = z.infer<typeof AiAnalysisOutputSchema>;

/**
 * Analysis status for async processing flow.
 */
export const AnalysisStatusSchema = z.enum([
  'pending',
  'analyzing',
  'matching',
  'complete',
  'failed',
]);

export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

/**
 * Response from GET /api/v1/analyses/:id — status-based polling response.
 */
export const AnalysisPollingResponseSchema = z.discriminatedUnion('status', [
  z.object({
    id: z.string(),
    status: z.literal('pending'),
    createdAt: z.string(),
  }),
  z.object({
    id: z.string(),
    status: z.literal('analyzing'),
    createdAt: z.string(),
  }),
  z.object({
    id: z.string(),
    status: z.literal('matching'),
    createdAt: z.string(),
  }),
  z.object({
    id: z.string(),
    status: z.literal('complete'),
    createdAt: z.string(),
    result: AnalysisResponseSchema,
  }),
  z.object({
    id: z.string(),
    status: z.literal('failed'),
    createdAt: z.string(),
    error: z.string(),
  }),
]);

export type AnalysisPollingResponse = z.infer<typeof AnalysisPollingResponseSchema>;
