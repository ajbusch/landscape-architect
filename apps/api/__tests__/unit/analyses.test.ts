import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { Mock } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

vi.mock('../../src/services/photo.js', () => ({
  getPhotoPresignedUrl: vi.fn(),
  getPhotoUploadUrl: vi.fn(),
  BUCKET_NAME: 'test-bucket',
}));

vi.mock('@aws-sdk/client-lambda', () => {
  const mockSend = vi.fn().mockResolvedValue({
    $metadata: { requestId: 'mock-request-id' },
  });
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
import { getPhotoPresignedUrl, getPhotoUploadUrl } from '../../src/services/photo.js';

const mockSend = docClient.send as unknown as Mock;
const mockGetPresignedUrl = getPhotoPresignedUrl as unknown as Mock;
const mockGetUploadUrl = getPhotoUploadUrl as unknown as Mock;

// ── Test data ──────────────────────────────────────────────────────────

const sampleRecommendations = [
  {
    plantId: '55efd08d-b675-4cb2-a271-ecd2b7003501',
    commonName: 'Hostas',
    scientificName: 'Hosta spp.',
    reason: 'Add color to the shaded area under the oak tree.',
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
  {
    plantId: '55efd08d-b675-4cb2-a271-ecd2b7003502',
    commonName: 'Boxwood',
    scientificName: 'Buxus sempervirens',
    reason: 'Anchor the patio edge with evergreen structure.',
    category: 'foundation_plant',
    light: 'partial_shade',
    waterNeeds: 'moderate',
    matureSize: {
      heightFt: { min: 3, max: 8 },
      widthFt: { min: 3, max: 6 },
    },
    hardinessZones: { min: '5a', max: '8b' },
    bloomSeason: 'evergreen',
    costRange: 'medium',
    difficulty: 'beginner',
  },
];

const analysisBody = {
  photoKey: 'photos/anonymous/test-id/original.jpg',
  latitude: 35.23,
  longitude: -80.84,
  locationName: 'Charlotte, North Carolina, USA',
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('Analysis routes', () => {
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

  // ── POST /api/v1/analyses/upload-url ─────────────────────────────

  describe('POST /api/v1/analyses/upload-url', () => {
    it('returns presigned URL for valid content type', async () => {
      mockGetUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/presigned-put',
        s3Key: 'photos/anonymous/abc/original.jpg',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses/upload-url',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: 'image/jpeg' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.uploadUrl).toBe('https://s3.example.com/presigned-put');
      expect(body.s3Key).toBeDefined();
      expect(body.analysisId).toBeDefined();
    });

    it('returns 400 for unsupported content type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses/upload-url',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: 'application/pdf' }),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Unsupported content type');
    });
  });

  // ── POST /api/v1/analyses (async) ─────────────────────────────────

  describe('POST /api/v1/analyses', () => {
    it('returns 202 with analysis id and pending status', async () => {
      mockSend.mockResolvedValue({}); // DynamoDB PutCommand

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(analysisBody),
      });

      expect(response.statusCode).toBe(202);
      const result = JSON.parse(response.body);
      expect(result.id).toBeDefined();
      expect(result.status).toBe('pending');
    });

    it('writes pending record to DynamoDB with rounded coordinates', async () => {
      mockSend.mockResolvedValue({});

      await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoKey: 'photos/anonymous/test-id/original.jpg',
          latitude: 35.2271234,
          longitude: -80.8431456,
          locationName: 'Charlotte, North Carolina, USA',
        }),
      });

      expect(mockSend).toHaveBeenCalledOnce();
      const callArg = mockSend.mock.calls[0]![0];
      const input = callArg.input as Record<string, unknown>;
      expect(input.TableName).toBe('test-table');

      const item = input.Item as Record<string, unknown>;
      expect(item.status).toBe('pending');
      expect(item.photoKey).toBe('photos/anonymous/test-id/original.jpg');
      expect(item.latitude).toBe(35.23);
      expect(item.longitude).toBe(-80.84);
      expect(item.locationName).toBe('Charlotte, North Carolina, USA');
      expect(item.ttl).toBeTypeOf('number');
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
    });

    it('returns 400 when photoKey is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          latitude: 35.23,
          longitude: -80.84,
          locationName: 'Charlotte, NC',
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when locationName is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoKey: 'photos/test.jpg',
          latitude: 35.23,
          longitude: -80.84,
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when latitude and longitude have mixed nullability', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoKey: 'photos/test.jpg',
          latitude: 35.23,
          longitude: null,
          locationName: 'Charlotte, NC',
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts null coordinates for fallback path', async () => {
      mockSend.mockResolvedValue({});

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoKey: 'photos/test.jpg',
          latitude: null,
          longitude: null,
          locationName: 'Charlotte, North Carolina',
        }),
      });

      expect(response.statusCode).toBe(202);
    });

    it('returns 400 when latitude is out of range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoKey: 'photos/test.jpg',
          latitude: 91,
          longitude: -80.84,
          locationName: 'Charlotte, NC',
        }),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/analyses/:id ─────────────────────────────────────

  describe('GET /api/v1/analyses/:id', () => {
    it('returns pending status for in-progress analysis', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'ANALYSIS#test-id',
          SK: 'ANALYSIS#test-id',
          id: 'test-id',
          status: 'pending',
          createdAt: '2026-02-16T00:00:00.000Z',
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/test-id',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('test-id');
      expect(body.status).toBe('pending');
      expect(body.createdAt).toBeDefined();
      expect(body.result).toBeUndefined();
    });

    it('returns analyzing status', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'ANALYSIS#test-id',
          SK: 'ANALYSIS#test-id',
          id: 'test-id',
          status: 'analyzing',
          createdAt: '2026-02-16T00:00:00.000Z',
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/test-id',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).status).toBe('analyzing');
    });

    it('returns complete status with result', async () => {
      const completeResult = {
        id: '55efd08d-b675-4cb2-a271-ecd2b7003599',
        photoUrl: 'https://s3.example.com/old-url',
        latitude: 35.23,
        longitude: -80.84,
        locationName: 'Charlotte, North Carolina, USA',
        result: {
          summary: 'A nice yard.',
          yardSize: 'medium',
          overallSunExposure: 'partial_shade',
          estimatedSoilType: 'loamy',
          features: [
            {
              id: '55efd08d-b675-4cb2-a271-ecd2b7003510',
              type: 'tree',
              label: 'Oak',
              confidence: 'high',
            },
          ],
          recommendations: sampleRecommendations,
        },
        tier: 'free',
        createdAt: '2026-02-01T00:00:00.000Z',
        expiresAt: '2026-02-08T00:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'ANALYSIS#55efd08d-b675-4cb2-a271-ecd2b7003599',
          SK: 'ANALYSIS#55efd08d-b675-4cb2-a271-ecd2b7003599',
          id: '55efd08d-b675-4cb2-a271-ecd2b7003599',
          status: 'complete',
          photoKey: 'photos/anonymous/55efd08d-b675-4cb2-a271-ecd2b7003599/original.jpg',
          result: completeResult,
          createdAt: '2026-02-01T00:00:00.000Z',
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      });
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/fresh-presigned');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/55efd08d-b675-4cb2-a271-ecd2b7003599',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('complete');
      expect(body.result).toBeDefined();
      expect(body.result.photoUrl).toBe('https://s3.example.com/fresh-presigned');
      expect(body.result.result.summary).toBe('A nice yard.');
    });

    it('returns failed status with error message', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'ANALYSIS#test-id',
          SK: 'ANALYSIS#test-id',
          id: 'test-id',
          status: 'failed',
          error: 'Analysis timed out. Please try again.',
          createdAt: '2026-02-16T00:00:00.000Z',
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/test-id',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('failed');
      expect(body.error).toBe('Analysis timed out. Please try again.');
    });

    it('returns 404 when analysis not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toBe('Analysis not found');
    });

    it('returns 404 when analysis is expired', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'ANALYSIS#test-id',
          SK: 'ANALYSIS#test-id',
          id: 'test-id',
          status: 'complete',
          createdAt: '2026-02-01T00:00:00.000Z',
          ttl: Math.floor(Date.now() / 1000) - 3600,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/test-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
