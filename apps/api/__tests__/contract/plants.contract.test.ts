import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  PlantSchema,
  PlantSearchResponseSchema,
  ErrorResponseSchema,
} from '@landscape-architect/shared';
import type { FastifyInstance } from 'fastify';

// Mock the db module
vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

import { docClient } from '../../src/db.js';
import type { Mock } from 'vitest';
const mockSend = docClient.send as unknown as Mock;

const samplePlant = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  commonName: 'Contract Test Plant',
  scientificName: 'Contractus testus',
  description: 'A plant for contract testing',
  light: ['partial_shade'],
  waterNeeds: 'low',
  soilTypes: ['sandy', 'loamy'],
  matureHeightFtMin: 2,
  matureHeightFtMax: 4,
  matureWidthFtMin: 1,
  matureWidthFtMax: 3,
  zoneMin: '4a',
  zoneMax: '9a',
  type: 'shrub',
  bloomSeason: 'spring',
  isNative: false,
  isInvasive: false,
  deerResistant: true,
  droughtTolerant: false,
  costRange: 'medium',
  difficulty: 'intermediate',
  tags: ['contract-test'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Contract: Plant endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/plants response conforms to PlantSearchResponseSchema', async () => {
    mockSend.mockResolvedValueOnce({ Items: [samplePlant] });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plants',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    const result = PlantSearchResponseSchema.safeParse(body);

    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.issues, null, 2));
    }

    expect(result.success).toBe(true);
  });

  it('GET /api/v1/plants/:id response conforms to PlantSchema', async () => {
    mockSend.mockResolvedValueOnce({ Item: samplePlant });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plants/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    const result = PlantSchema.safeParse(body);

    if (!result.success) {
      console.error('Schema validation errors:', JSON.stringify(result.error.issues, null, 2));
    }

    expect(result.success).toBe(true);
  });

  it('GET /api/v1/plants/:id returns 404 conforming to ErrorResponseSchema', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plants/nonexistent-id',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    const result = ErrorResponseSchema.safeParse(body);
    expect(result.success).toBe(true);
    expect(body.message).toBe('Plant not found');
  });
});
