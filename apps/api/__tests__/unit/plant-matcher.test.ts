import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { AiAnalysisOutput } from '@landscape-architect/shared';

vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

import { docClient } from '../../src/db.js';
import { matchPlants } from '../../src/services/plant-matcher.js';

const mockSend = docClient.send as unknown as Mock;

const makePlant = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  commonName: 'Test Plant',
  scientificName: 'Testus plantus',
  description: 'A test plant',
  light: ['partial_shade'],
  waterNeeds: 'moderate',
  soilTypes: ['loamy'],
  matureHeightFtMin: 2,
  matureHeightFtMax: 4,
  matureWidthFtMin: 1,
  matureWidthFtMax: 3,
  zoneMin: '5a',
  zoneMax: '9b',
  type: 'perennial',
  bloomSeason: 'summer',
  isNative: true,
  isInvasive: false,
  deerResistant: false,
  droughtTolerant: false,
  costRange: 'low',
  difficulty: 'beginner',
  tags: ['native', 'shade tolerant'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const plant1 = makePlant({
  id: '55efd08d-b675-4cb2-a271-ecd2b7003501',
  commonName: 'Hostas',
  scientificName: 'Hosta spp.',
});

const plant2 = makePlant({
  id: '55efd08d-b675-4cb2-a271-ecd2b7003502',
  commonName: 'Coral Bells',
  scientificName: 'Heuchera spp.',
  tags: ['native', 'colorful'],
});

const plant3 = makePlant({
  id: '55efd08d-b675-4cb2-a271-ecd2b7003503',
  commonName: 'Fern',
  scientificName: 'Athyrium filix-femina',
  type: 'perennial',
  tags: ['native', 'shade tolerant'],
});

const aiOutput: AiAnalysisOutput = {
  summary: 'A shady backyard.',
  yardSize: 'medium',
  overallSunExposure: 'partial_shade',
  estimatedSoilType: 'loamy',
  climate: {
    usdaZone: '7b',
    description: 'Humid subtropical with hot summers and mild winters.',
  },
  isValidYardPhoto: true,
  features: [],
  recommendedPlantTypes: [
    {
      category: 'quick_win',
      plantType: 'perennial',
      lightRequirement: 'partial_shade',
      reason: 'Add shade plants.',
      searchCriteria: { type: 'perennial', light: 'partial_shade', tags: ['native'] },
    },
    {
      category: 'foundation_plant',
      plantType: 'shrub',
      lightRequirement: 'partial_shade',
      reason: 'Structural shrubs.',
      searchCriteria: { type: 'shrub', light: 'partial_shade' },
    },
  ],
};

describe('matchPlants', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns matched plants for each recommendation', async () => {
    // First call: perennials by type
    mockSend.mockResolvedValueOnce({ Items: [plant1, plant2, plant3] });
    // Second call: shrubs by type
    const shrub = makePlant({
      id: '55efd08d-b675-4cb2-a271-ecd2b7003504',
      commonName: 'Boxwood',
      scientificName: 'Buxus spp.',
      type: 'shrub',
    });
    mockSend.mockResolvedValueOnce({ Items: [shrub] });

    const result = await matchPlants(aiOutput, '7b');

    expect(result.length).toBeGreaterThanOrEqual(2);
    const perennials = result.filter((r) => r.category === 'quick_win');
    expect(perennials.length).toBeGreaterThanOrEqual(1);
  });

  it('picks top 2 per recommendation', async () => {
    mockSend.mockResolvedValueOnce({ Items: [plant1, plant2, plant3] });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await matchPlants(aiOutput, '7b');

    const quickWins = result.filter((r) => r.category === 'quick_win');
    expect(quickWins.length).toBeLessThanOrEqual(2);
  });

  it('does not duplicate plants across recommendations', async () => {
    // Both queries return the same plants
    mockSend.mockResolvedValue({ Items: [plant1, plant2] });

    const result = await matchPlants(aiOutput, '7b');

    const ids = result.map((r) => r.plantId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('falls back to popular zone plants when no matches found', async () => {
    // Both type queries return nothing
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Fallback zone query returns plants
    mockSend.mockResolvedValueOnce({ Items: [plant1, plant2] });

    const result = await matchPlants(aiOutput, '7b');

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.category).toBe('quick_win');
    expect(result[0]!.reason).toContain('Popular plant');
  });

  it('filters plants by zone compatibility', async () => {
    const outOfZonePlant = makePlant({
      id: '55efd08d-b675-4cb2-a271-ecd2b7003505',
      commonName: 'Tropical Plant',
      zoneMin: '10a',
      zoneMax: '13b',
    });
    // First query: returns out-of-zone and in-zone plant
    mockSend.mockResolvedValueOnce({ Items: [outOfZonePlant, plant1] });
    // Second query: empty
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await matchPlants(aiOutput, '7b');

    // The tropical plant should be filtered out (zone 10a-13b doesn't include 7b)
    const tropicalRecs = result.filter((r) => r.commonName === 'Tropical Plant');
    expect(tropicalRecs).toHaveLength(0);
    // But plant1 should be included
    const plant1Recs = result.filter((r) => r.commonName === 'Hostas');
    expect(plant1Recs.length).toBeGreaterThanOrEqual(1);
  });

  it('maps plant fields to recommendation format correctly', async () => {
    mockSend.mockResolvedValueOnce({ Items: [plant1] });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await matchPlants(aiOutput, '7b');

    expect(result[0]).toEqual(
      expect.objectContaining({
        plantId: plant1.id,
        commonName: 'Hostas',
        scientificName: 'Hosta spp.',
        waterNeeds: 'moderate',
        matureSize: {
          heightFt: { min: 2, max: 4 },
          widthFt: { min: 1, max: 3 },
        },
        hardinessZones: { min: '5a', max: '9b' },
        costRange: 'low',
        difficulty: 'beginner',
      }),
    );
  });
});
