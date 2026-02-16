import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { Mock } from 'vitest';
import { AnalysisResponseSchema } from '@landscape-architect/shared';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

vi.mock('../../src/services/zone-lookup.js', () => ({
  getZoneByZip: vi.fn(),
}));

vi.mock('../../src/services/photo.js', () => ({
  getPhotoPresignedUrl: vi.fn(),
  getPhotoUploadUrl: vi.fn(),
  BUCKET_NAME: 'test-bucket',
}));

vi.mock('@aws-sdk/client-lambda', () => {
  const mockSend = vi.fn().mockResolvedValue({});
  return {
    LambdaClient: class {
      send = mockSend;
    },
    InvokeCommand: class {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from '../../src/db.js';
import { getZoneByZip } from '../../src/services/zone-lookup.js';
import { getPhotoPresignedUrl } from '../../src/services/photo.js';

const mockSend = docClient.send as unknown as Mock;
const mockGetZoneByZip = getZoneByZip as unknown as Mock;
const mockGetPresignedUrl = getPhotoPresignedUrl as unknown as Mock;

const sampleZone = {
  zipCode: '28202',
  zone: '7b',
  zoneNumber: 7,
  zoneLetter: 'b',
  minTempF: 5,
  maxTempF: 10,
  description: 'USDA Hardiness Zone 7b (5°F to 10°F)',
};

const sampleCompleteResult = {
  id: '55efd08d-b675-4cb2-a271-ecd2b7003501',
  photoUrl: 'https://s3.example.com/presigned',
  address: { zipCode: '28202', zone: '7b' },
  result: {
    summary: 'A medium-sized suburban backyard with mature trees and a patio area.',
    yardSize: 'medium',
    overallSunExposure: 'partial_shade',
    estimatedSoilType: 'loamy',
    features: [
      {
        id: '55efd08d-b675-4cb2-a271-ecd2b7003510',
        type: 'tree',
        label: 'Mature Oak',
        species: 'Quercus alba',
        confidence: 'high',
        sunExposure: 'full_sun',
        notes: 'Large canopy providing shade',
      },
    ],
    recommendations: [
      {
        plantId: '55efd08d-b675-4cb2-a271-ecd2b7003501',
        commonName: 'Hostas',
        scientificName: 'Hosta spp.',
        reason: 'Add color under the oak.',
        category: 'quick_win',
        light: 'partial_shade',
        waterNeeds: 'moderate',
        matureSize: {
          heightFt: { min: 1, max: 3 },
          widthFt: { min: 2, max: 4 },
        },
        hardinessZones: { min: '3a', max: '9b' },
        bloomSeason: 'summer',
        costRange: 'low',
        difficulty: 'beginner',
      },
    ],
  },
  tier: 'free',
  createdAt: '2026-02-16T00:00:00.000Z',
  expiresAt: '2026-02-23T00:00:00.000Z',
};

describe('Analysis integration flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('end-to-end: POST creates pending analysis and returns 202', async () => {
    mockGetZoneByZip.mockReturnValue(sampleZone);
    mockSend.mockResolvedValue({}); // DynamoDB PutCommand

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        photoKey: 'photos/anonymous/test-id/original.jpg',
        zipCode: '28202',
      }),
    });

    expect(response.statusCode).toBe(202);

    const body = JSON.parse(response.body);
    expect(body.id).toBeDefined();
    expect(body.status).toBe('pending');

    // Verify DynamoDB was called with pending record
    expect(mockSend).toHaveBeenCalledOnce();
    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input as Record<string, unknown>;
    const item = input.Item as Record<string, unknown>;
    expect(item.status).toBe('pending');
    expect(item.photoKey).toBe('photos/anonymous/test-id/original.jpg');
    expect(item.zipCode).toBe('28202');
    expect(item.zone).toBe('7b');
  });

  it('end-to-end: POST then GET returns consistent pending data', async () => {
    mockGetZoneByZip.mockReturnValue(sampleZone);
    mockSend.mockResolvedValue({});

    // POST to create
    const postResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        photoKey: 'photos/anonymous/test-id/original.jpg',
        zipCode: '28202',
      }),
    });

    const created = JSON.parse(postResponse.body) as { id: string; status: string };

    // Simulate DynamoDB returning the pending item for GET
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `ANALYSIS#${created.id}`,
        SK: `ANALYSIS#${created.id}`,
        id: created.id,
        status: 'pending',
        photoKey: 'photos/anonymous/test-id/original.jpg',
        zipCode: '28202',
        zone: '7b',
        createdAt: '2026-02-16T00:00:00.000Z',
        updatedAt: '2026-02-16T00:00:00.000Z',
        ttl: Math.floor(Date.now() / 1000) + 86400,
      },
    });

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${created.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.body);
    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe('pending');
    expect(fetched.createdAt).toBeDefined();
  });

  it('end-to-end: GET returns complete result with valid AnalysisResponse', async () => {
    const analysisId = '55efd08d-b675-4cb2-a271-ecd2b7003501';

    // Simulate DynamoDB returning a complete item
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `ANALYSIS#${analysisId}`,
        SK: `ANALYSIS#${analysisId}`,
        id: analysisId,
        status: 'complete',
        photoKey: `photos/anonymous/${analysisId}/original.jpg`,
        result: sampleCompleteResult,
        createdAt: '2026-02-16T00:00:00.000Z',
        ttl: Math.floor(Date.now() / 1000) + 86400,
      },
    });
    mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/fresh-presigned');

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${analysisId}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.body);

    expect(fetched.status).toBe('complete');
    expect(fetched.result).toBeDefined();
    expect(fetched.result.photoUrl).toBe('https://s3.example.com/fresh-presigned');

    // Validate the nested result conforms to AnalysisResponseSchema
    const validation = AnalysisResponseSchema.safeParse(fetched.result);
    if (!validation.success) {
      console.error('Schema validation errors:', JSON.stringify(validation.error.issues));
    }
    expect(validation.success).toBe(true);
  });

  it('end-to-end: GET returns failed status with error message', async () => {
    const analysisId = '55efd08d-b675-4cb2-a271-ecd2b7003502';

    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `ANALYSIS#${analysisId}`,
        SK: `ANALYSIS#${analysisId}`,
        id: analysisId,
        status: 'failed',
        error: 'Analysis timed out. Please try again.',
        createdAt: '2026-02-16T00:00:00.000Z',
        ttl: Math.floor(Date.now() / 1000) + 86400,
      },
    });

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${analysisId}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.body);
    expect(fetched.status).toBe('failed');
    expect(fetched.error).toBe('Analysis timed out. Please try again.');
  });
});
