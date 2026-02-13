import { describe, it, expect } from 'vitest';
import { PlantSchema, PlantSearchParamsSchema } from './plant.js';

const validPlant = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  commonName: 'Eastern Redbud',
  scientificName: 'Cercis canadensis',
  description: 'A stunning small tree known for its pink-purple flowers in early spring.',
  photoUrl: 'https://example.com/plants/redbud.jpg',
  light: ['partial_shade', 'full_sun'],
  waterNeeds: 'moderate' as const,
  soilTypes: ['clay', 'loamy'],
  matureHeightFtMin: 20,
  matureHeightFtMax: 30,
  matureWidthFtMin: 25,
  matureWidthFtMax: 35,
  zoneMin: '4b',
  zoneMax: '9a',
  type: 'tree' as const,
  bloomSeason: 'spring' as const,
  isNative: true,
  isInvasive: false,
  deerResistant: false,
  droughtTolerant: false,
  costRange: 'medium' as const,
  difficulty: 'beginner' as const,
  tags: ['native', 'spring-blooming', 'understory'],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('PlantSchema', () => {
  it('accepts a valid plant', () => {
    expect(PlantSchema.safeParse(validPlant).success).toBe(true);
  });

  it('requires at least one light condition', () => {
    const result = PlantSchema.safeParse({ ...validPlant, light: [] });
    expect(result.success).toBe(false);
  });

  it('requires at least one soil type', () => {
    const result = PlantSchema.safeParse({ ...validPlant, soilTypes: [] });
    expect(result.success).toBe(false);
  });

  it('rejects negative height', () => {
    const result = PlantSchema.safeParse({ ...validPlant, matureHeightFtMin: -1 });
    expect(result.success).toBe(false);
  });

  it('allows at most 20 tags', () => {
    const tooManyTags = Array.from({ length: 21 }, (_, i) => `tag-${String(i)}`);
    const result = PlantSchema.safeParse({ ...validPlant, tags: tooManyTags });
    expect(result.success).toBe(false);
  });

  it('allows optional careGuide', () => {
    const result = PlantSchema.safeParse({
      ...validPlant,
      careGuide: 'Plant in spring. Water deeply once per week.',
    });
    expect(result.success).toBe(true);
  });
});

describe('PlantSearchParamsSchema', () => {
  it('accepts empty params (all defaults)', () => {
    const result = PlantSearchParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts full search params', () => {
    const result = PlantSearchParamsSchema.safeParse({
      query: 'redbud',
      zone: '7b',
      light: 'partial_shade',
      type: 'tree',
      difficulty: 'beginner',
      deerResistant: true,
      isNative: true,
      page: 2,
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects page < 1', () => {
    const result = PlantSearchParamsSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit > 50', () => {
    const result = PlantSearchParamsSchema.safeParse({ limit: 51 });
    expect(result.success).toBe(false);
  });
});
