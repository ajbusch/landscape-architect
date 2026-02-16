import { describe, it, expect } from 'vitest';
import {
  IdentifiedFeatureSchema,
  PlantRecommendationSchema,
  AnalysisResultSchema,
  AnalysisResponseSchema,
  AiAnalysisOutputSchema,
} from './analysis.js';

const validFeature = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  type: 'tree' as const,
  label: 'Large Oak Tree',
  species: 'Quercus alba',
  confidence: 'high' as const,
  sunExposure: 'partial_shade' as const,
};

const validRecommendation = {
  plantId: '550e8400-e29b-41d4-a716-446655440001',
  commonName: 'Eastern Redbud',
  scientificName: 'Cercis canadensis',
  reason:
    'A beautiful understory tree that thrives in the partial shade beneath your existing oak.',
  category: 'foundation_plant' as const,
  light: 'partial_shade' as const,
  waterNeeds: 'moderate' as const,
  matureSize: {
    heightFt: { min: 20, max: 30 },
    widthFt: { min: 25, max: 35 },
  },
  hardinessZones: { min: '4b', max: '9a' },
  bloomSeason: 'spring' as const,
  costRange: 'medium' as const,
  difficulty: 'beginner' as const,
};

describe('IdentifiedFeatureSchema', () => {
  it('accepts a valid feature', () => {
    expect(IdentifiedFeatureSchema.safeParse(validFeature).success).toBe(true);
  });

  it('allows optional fields to be omitted', () => {
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'grass',
      label: 'Lawn area',
      confidence: 'medium',
    };
    expect(IdentifiedFeatureSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects invalid feature type', () => {
    const result = IdentifiedFeatureSchema.safeParse({
      ...validFeature,
      type: 'swimming_pool',
    });
    expect(result.success).toBe(false);
  });
});

describe('PlantRecommendationSchema', () => {
  it('accepts a valid recommendation', () => {
    expect(PlantRecommendationSchema.safeParse(validRecommendation).success).toBe(true);
  });

  it('rejects recommendation with empty reason', () => {
    const result = PlantRecommendationSchema.safeParse({
      ...validRecommendation,
      reason: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative height values', () => {
    const result = PlantRecommendationSchema.safeParse({
      ...validRecommendation,
      matureSize: {
        heightFt: { min: -5, max: 30 },
        widthFt: { min: 25, max: 35 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('AnalysisResultSchema', () => {
  const validResult = {
    summary: 'A medium-sized backyard with a mature oak providing partial shade.',
    yardSize: 'medium' as const,
    overallSunExposure: 'partial_shade' as const,
    estimatedSoilType: 'clay' as const,
    features: [validFeature],
    recommendations: [validRecommendation],
  };

  it('accepts a valid analysis result', () => {
    expect(AnalysisResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('allows empty recommendations (e.g. invalid yard photo)', () => {
    const result = AnalysisResultSchema.safeParse({
      ...validResult,
      recommendations: [],
    });
    expect(result.success).toBe(true);
  });

  it('allows at most 10 recommendations', () => {
    const result = AnalysisResultSchema.safeParse({
      ...validResult,
      recommendations: Array.from({ length: 11 }, () => validRecommendation),
    });
    expect(result.success).toBe(false);
  });
});

describe('AnalysisResponseSchema', () => {
  it('accepts a valid full response', () => {
    const result = AnalysisResponseSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440099',
      photoUrl: 'https://s3.example.com/photos/abc.jpg',
      address: { zipCode: '28202', zone: '7b' },
      result: {
        summary: 'A medium backyard with shade.',
        yardSize: 'medium',
        overallSunExposure: 'partial_shade',
        estimatedSoilType: 'clay',
        features: [validFeature],
        recommendations: [validRecommendation],
      },
      tier: 'free',
      createdAt: '2025-06-15T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('allows optional userId for unauthenticated analysis', () => {
    const result = AnalysisResponseSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440099',
      photoUrl: 'https://s3.example.com/photos/abc.jpg',
      address: { zipCode: '28202', zone: '7b' },
      result: {
        summary: 'A yard.',
        yardSize: 'small',
        overallSunExposure: 'full_sun',
        estimatedSoilType: 'sandy',
        features: [],
        recommendations: [validRecommendation],
      },
      tier: 'free',
      createdAt: '2025-06-15T12:00:00Z',
      expiresAt: '2025-06-16T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('AiAnalysisOutputSchema', () => {
  const validAiOutput = {
    summary: 'A medium-sized suburban backyard with mature trees.',
    yardSize: 'medium',
    overallSunExposure: 'partial_shade',
    estimatedSoilType: 'loamy',
    isValidYardPhoto: true,
    features: [
      {
        type: 'tree',
        label: 'Mature Oak',
        species: 'Quercus alba',
        confidence: 'high',
        sunExposure: 'full_sun',
        notes: 'Large canopy',
      },
    ],
    recommendedPlantTypes: [
      {
        category: 'quick_win',
        plantType: 'perennial',
        lightRequirement: 'partial_shade',
        reason: 'Add color under the oak.',
        searchCriteria: { type: 'perennial', light: 'partial_shade', tags: ['native'] },
      },
    ],
  };

  it('accepts a valid AI output', () => {
    expect(AiAnalysisOutputSchema.safeParse(validAiOutput).success).toBe(true);
  });

  it('accepts output with isValidYardPhoto false and empty arrays', () => {
    const invalidPhoto = {
      ...validAiOutput,
      isValidYardPhoto: false,
      invalidPhotoReason: 'This is a photo of a cat.',
      features: [],
      recommendedPlantTypes: [],
    };
    expect(AiAnalysisOutputSchema.safeParse(invalidPhoto).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const missingField = { ...validAiOutput } as Record<string, unknown>;
    delete missingField.summary;
    expect(AiAnalysisOutputSchema.safeParse(missingField).success).toBe(false);
  });

  it('rejects invalid yardSize enum', () => {
    const result = AiAnalysisOutputSchema.safeParse({
      ...validAiOutput,
      yardSize: 'huge',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid plantType in recommendations', () => {
    const result = AiAnalysisOutputSchema.safeParse({
      ...validAiOutput,
      recommendedPlantTypes: [
        {
          ...validAiOutput.recommendedPlantTypes[0],
          plantType: 'cactus',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category in recommendations', () => {
    const result = AiAnalysisOutputSchema.safeParse({
      ...validAiOutput,
      recommendedPlantTypes: [
        {
          ...validAiOutput.recommendedPlantTypes[0],
          category: 'bonus_pick',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid feature types', () => {
    const featureTypes = [
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
    ];
    for (const type of featureTypes) {
      const data = {
        ...validAiOutput,
        features: [{ type, label: 'Test', confidence: 'medium' }],
      };
      expect(AiAnalysisOutputSchema.safeParse(data).success).toBe(true);
    }
  });

  it('accepts all valid plant types in recommendations', () => {
    const plantTypes = [
      'tree',
      'shrub',
      'perennial',
      'annual',
      'grass',
      'vine',
      'groundcover',
      'bulb',
    ];
    for (const plantType of plantTypes) {
      const data = {
        ...validAiOutput,
        recommendedPlantTypes: [
          {
            ...validAiOutput.recommendedPlantTypes[0],
            plantType,
          },
        ],
      };
      expect(AiAnalysisOutputSchema.safeParse(data).success).toBe(true);
    }
  });

  it('allows optional tags in searchCriteria', () => {
    const data = {
      ...validAiOutput,
      recommendedPlantTypes: [
        {
          ...validAiOutput.recommendedPlantTypes[0],
          searchCriteria: { type: 'perennial', light: 'partial_shade' },
        },
      ],
    };
    expect(AiAnalysisOutputSchema.safeParse(data).success).toBe(true);
  });
});
