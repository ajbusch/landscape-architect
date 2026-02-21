export { HealthResponseSchema, type HealthResponse } from './health.js';

export {
  ZipCodeSchema,
  AddressInputSchema,
  USDAZoneSchema,
  ZoneResponseSchema,
  type AddressInput,
  type ZoneResponse,
} from './zone.js';

export { LocationInputSchema, type LocationInput } from './location.js';

export {
  ConfidenceLevelSchema,
  SunExposureSchema,
  IdentifiedFeatureSchema,
  DifficultySchema,
  CostRangeSchema,
  RecommendationCategorySchema,
  PlantRecommendationSchema,
  AnalysisRequestSchema,
  AnalysisResultSchema,
  AnalysisResponseSchema,
  FeatureTypeSchema,
  PlantTypeSchema,
  AiAnalysisOutputSchema,
  type IdentifiedFeature,
  type PlantRecommendation,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalysisResponse,
  type AiAnalysisOutput,
  AnalysisStatusSchema,
  type AnalysisStatus,
  AnalysisPollingResponseSchema,
  type AnalysisPollingResponse,
} from './analysis.js';

export {
  PlantSchema,
  PlantSearchParamsSchema,
  PlantSearchResponseSchema,
  type Plant,
  type PlantSearchParams,
  type PlantSearchResponse,
} from './plant.js';

export {
  ErrorResponseSchema,
  ValidationErrorResponseSchema,
  type ErrorResponse,
  type ValidationErrorResponse,
} from './error.js';
