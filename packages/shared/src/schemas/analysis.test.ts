import { describe, it, expect } from 'vitest';
import {
  IdentifiedFeatureSchema,
  PlantRecommendationSchema,
  AnalysisResultSchema,
  AnalysisResponseSchema,
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

  it('requires at least 1 recommendation', () => {
    const result = AnalysisResultSchema.safeParse({
      ...validResult,
      recommendations: [],
    });
    expect(result.success).toBe(false);
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
