import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { Mock } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

vi.mock('../../src/services/zone-lookup.js', () => ({
  getZoneByZip: vi.fn(),
}));

vi.mock('../../src/services/secrets.js', () => ({
  getAnthropicApiKey: vi.fn(),
}));

vi.mock('../../src/services/photo.js', () => ({
  validatePhoto: vi.fn(),
  convertHeicToJpeg: vi.fn(),
  uploadPhoto: vi.fn(),
  getPhotoPresignedUrl: vi.fn(),
  BUCKET_NAME: 'test-bucket',
}));

vi.mock('../../src/services/claude-vision.js', () => ({
  analyzeYardPhoto: vi.fn(),
}));

vi.mock('../../src/services/plant-matcher.js', () => ({
  matchPlants: vi.fn(),
}));

import { docClient } from '../../src/db.js';
import { getZoneByZip } from '../../src/services/zone-lookup.js';
import { getAnthropicApiKey } from '../../src/services/secrets.js';
import {
  validatePhoto,
  convertHeicToJpeg,
  uploadPhoto,
  getPhotoPresignedUrl,
} from '../../src/services/photo.js';
import { analyzeYardPhoto } from '../../src/services/claude-vision.js';
import { matchPlants } from '../../src/services/plant-matcher.js';

const mockSend = docClient.send as unknown as Mock;
const mockGetZoneByZip = getZoneByZip as unknown as Mock;
const mockGetApiKey = getAnthropicApiKey as unknown as Mock;
const mockValidatePhoto = validatePhoto as unknown as Mock;
const mockConvertHeic = convertHeicToJpeg as unknown as Mock;
const mockUploadPhoto = uploadPhoto as unknown as Mock;
const mockGetPresignedUrl = getPhotoPresignedUrl as unknown as Mock;
const mockAnalyzeYard = analyzeYardPhoto as unknown as Mock;
const mockMatchPlants = matchPlants as unknown as Mock;

// ── Test data ──────────────────────────────────────────────────────────

const sampleZone = {
  zipCode: '28202',
  zone: '7b',
  zoneNumber: 7,
  zoneLetter: 'b',
  minTempF: 5,
  maxTempF: 10,
  description: 'USDA Hardiness Zone 7b (5°F to 10°F)',
};

const sampleAiOutput = {
  summary: 'A medium-sized suburban backyard with mature trees and a patio area.',
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
      notes: 'Large canopy providing shade',
    },
    {
      type: 'patio',
      label: 'Stone Patio',
      confidence: 'high',
    },
    {
      type: 'grass',
      label: 'Lawn Area',
      confidence: 'medium',
      sunExposure: 'partial_shade',
    },
  ],
  recommendedPlantTypes: [
    {
      category: 'quick_win',
      plantType: 'perennial',
      lightRequirement: 'partial_shade',
      reason: 'Add color to the shaded area under the oak tree.',
      searchCriteria: { type: 'perennial', light: 'partial_shade', tags: ['native'] },
    },
    {
      category: 'foundation_plant',
      plantType: 'shrub',
      lightRequirement: 'partial_shade',
      reason: 'Anchor the patio edge with evergreen structure.',
      searchCriteria: { type: 'shrub', light: 'partial_shade' },
    },
    {
      category: 'seasonal_color',
      plantType: 'bulb',
      lightRequirement: 'partial_shade',
      reason: 'Spring blooms under deciduous canopy.',
      searchCriteria: { type: 'bulb', light: 'partial_shade' },
    },
    {
      category: 'problem_solver',
      plantType: 'groundcover',
      lightRequirement: 'full_shade',
      reason: 'Replace bare patches under the tree.',
      searchCriteria: { type: 'groundcover', light: 'full_shade' },
    },
  ],
};

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

// JPEG magic bytes
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);

function buildMultipartBody(
  photo: Buffer = jpegBuffer,
  address: string = JSON.stringify({ zipCode: '28202' }),
) {
  const boundary = '----FormBoundary123';
  const parts: Buffer[] = [];

  // Photo part
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="yard.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
  );
  parts.push(photo);
  parts.push(Buffer.from('\r\n'));

  // Address part
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="address"\r\n\r\n`),
  );
  parts.push(Buffer.from(address));
  parts.push(Buffer.from('\r\n'));

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function setupHappyPath() {
  mockValidatePhoto.mockReturnValue({
    valid: true,
    type: 'jpeg',
    mediaType: 'image/jpeg',
    ext: 'jpg',
  });
  mockGetZoneByZip.mockReturnValue(sampleZone);
  mockGetApiKey.mockResolvedValue('test-api-key');
  mockUploadPhoto.mockResolvedValue('photos/anonymous/test-id/original.jpg');
  mockAnalyzeYard.mockResolvedValue({ ok: true, data: sampleAiOutput });
  mockMatchPlants.mockResolvedValue(sampleRecommendations);
  mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/presigned-photo');
  mockSend.mockResolvedValue({}); // DynamoDB PutCommand
}

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

  // ── POST /api/v1/analyses ────────────────────────────────────────

  describe('POST /api/v1/analyses', () => {
    it('returns 201 with analysis on successful flow', async () => {
      setupHappyPath();
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.body);
      expect(result.id).toBeDefined();
      expect(result.photoUrl).toBe('https://s3.example.com/presigned-photo');
      expect(result.address.zipCode).toBe('28202');
      expect(result.address.zone).toBe('7b');
      expect(result.result.summary).toBe(sampleAiOutput.summary);
      expect(result.result.features).toHaveLength(3);
      expect(result.result.recommendations).toHaveLength(2);
      expect(result.tier).toBe('free');
      expect(result.createdAt).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it('calls Claude Vision with correct parameters', async () => {
      setupHappyPath();
      const { body, contentType } = buildMultipartBody();

      await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(mockAnalyzeYard).toHaveBeenCalledWith(
        expect.any(String), // base64 photo
        'image/jpeg',
        '7b',
        'USDA Hardiness Zone 7b (5°F to 10°F)',
      );
    });

    it('stores analysis in DynamoDB with TTL', async () => {
      setupHappyPath();
      const { body, contentType } = buildMultipartBody();

      await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(mockSend).toHaveBeenCalledOnce();
      const callArg = mockSend.mock.calls[0]![0];
      const input = callArg.input as Record<string, unknown>;
      expect(input.TableName).toBe('test-table');

      const item = input.Item as Record<string, unknown>;
      expect(item.PK).toMatch(/^ANALYSIS#/);
      expect(item.SK).toMatch(/^ANALYSIS#/);
      expect(item.ttl).toBeTypeOf('number');
      expect(item.s3Key).toBe('photos/anonymous/test-id/original.jpg');
    });

    it('assigns UUIDs to features from AI output', async () => {
      setupHappyPath();
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      const result = JSON.parse(response.body);
      for (const feature of result.result.features) {
        expect(feature.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });

    // ── Validation errors ──────────────────────────────────────────

    it('returns 400 when photo is missing', async () => {
      const boundary = '----FormBoundary123';
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="address"\r\n\r\n{"zipCode":"28202"}\r\n--${boundary}--\r\n`,
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Photo is required');
    });

    it('returns 400 when address is missing', async () => {
      const boundary = '----FormBoundary123';
      const parts = [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="yard.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        jpegBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat(parts),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Address is required');
    });

    it('returns 400 when photo validation fails', async () => {
      mockValidatePhoto.mockReturnValue({
        valid: false,
        error: 'Please upload a JPEG, PNG, or HEIC image',
      });
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Please upload a JPEG, PNG, or HEIC image');
    });

    it('returns 404 when ZIP code not found', async () => {
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'jpeg',
        mediaType: 'image/jpeg',
        ext: 'jpg',
      });
      mockGetZoneByZip.mockReturnValue(null);
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toBe('ZIP code not found');
    });

    // ── Service errors ─────────────────────────────────────────────

    it('returns 500 when Secrets Manager fails', async () => {
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'jpeg',
        mediaType: 'image/jpeg',
        ext: 'jpg',
      });
      mockGetZoneByZip.mockReturnValue(sampleZone);
      mockGetApiKey.mockRejectedValue(new Error('Secrets Manager error'));
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('unable to initialize AI service');
    });

    it('returns 500 when S3 upload fails', async () => {
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'jpeg',
        mediaType: 'image/jpeg',
        ext: 'jpg',
      });
      mockGetZoneByZip.mockReturnValue(sampleZone);
      mockGetApiKey.mockResolvedValue('test-key');
      mockUploadPhoto.mockRejectedValue(new Error('S3 upload failed'));
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toBe('Failed to upload photo');
    });

    it('returns 504 when Claude API times out', async () => {
      setupHappyPath();
      mockAnalyzeYard.mockResolvedValue({
        ok: false,
        error: { type: 'timeout', message: 'Analysis timed out. Please try again.' },
      });
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(504);
      expect(JSON.parse(response.body).error).toBe('Analysis timed out. Please try again.');
    });

    it('returns 429 when Claude API rate limited', async () => {
      setupHappyPath();
      mockAnalyzeYard.mockResolvedValue({
        ok: false,
        error: {
          type: 'rate_limit',
          message: 'Service is busy. Please try again in a moment.',
        },
      });
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(429);
    });

    it('returns 500 when AI analysis fails', async () => {
      setupHappyPath();
      mockAnalyzeYard.mockResolvedValue({
        ok: false,
        error: { type: 'api_error', message: 'API error' },
      });
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 422 when AI says photo is not a yard', async () => {
      setupHappyPath();
      const notYardOutput = {
        ...sampleAiOutput,
        isValidYardPhoto: false,
        invalidPhotoReason: 'This appears to be a photo of an indoor space.',
        features: [],
        recommendedPlantTypes: [],
      };
      mockAnalyzeYard.mockResolvedValue({ ok: true, data: notYardOutput });
      const { body, contentType } = buildMultipartBody();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error).toBe(
        'This appears to be a photo of an indoor space.',
      );
    });

    // ── HEIC conversion ────────────────────────────────────────────

    it('converts HEIC to JPEG before sending to Claude', async () => {
      setupHappyPath();
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'heic',
        mediaType: 'image/heic',
        ext: 'heic',
      });
      const convertedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, ...Array(50).fill(0)]);
      mockConvertHeic.mockResolvedValue(convertedJpeg);

      const { body, contentType } = buildMultipartBody();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(201);
      expect(mockConvertHeic).toHaveBeenCalledOnce();
      expect(mockAnalyzeYard).toHaveBeenCalledWith(
        convertedJpeg.toString('base64'),
        'image/jpeg',
        '7b',
        expect.any(String),
      );
    });

    it('returns 400 when HEIC conversion fails', async () => {
      setupHappyPath();
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'heic',
        mediaType: 'image/heic',
        ext: 'heic',
      });
      mockConvertHeic.mockRejectedValue(new Error('sharp conversion error'));

      const { body, contentType } = buildMultipartBody();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        headers: { 'content-type': contentType },
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Unable to process this image format');
    });
  });

  // ── GET /api/v1/analyses/:id ─────────────────────────────────────

  describe('GET /api/v1/analyses/:id', () => {
    const storedItem = {
      PK: 'ANALYSIS#55efd08d-b675-4cb2-a271-ecd2b7003599',
      SK: 'ANALYSIS#55efd08d-b675-4cb2-a271-ecd2b7003599',
      id: '55efd08d-b675-4cb2-a271-ecd2b7003599',
      photoUrl: 'https://s3.example.com/old-url',
      s3Key: 'photos/anonymous/55efd08d-b675-4cb2-a271-ecd2b7003599/original.jpg',
      address: { zipCode: '28202', zone: '7b' },
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
      ttl: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
    };

    it('returns a stored analysis', async () => {
      mockSend.mockResolvedValueOnce({ Item: storedItem });
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/fresh-presigned');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/55efd08d-b675-4cb2-a271-ecd2b7003599',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('55efd08d-b675-4cb2-a271-ecd2b7003599');
      expect(body.photoUrl).toBe('https://s3.example.com/fresh-presigned');
      expect(body.result.summary).toBe('A nice yard.');
    });

    it('generates a fresh pre-signed URL', async () => {
      mockSend.mockResolvedValueOnce({ Item: storedItem });
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/new-url');

      await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/55efd08d-b675-4cb2-a271-ecd2b7003599',
      });

      expect(mockGetPresignedUrl).toHaveBeenCalledWith(
        'photos/anonymous/55efd08d-b675-4cb2-a271-ecd2b7003599/original.jpg',
      );
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
      const expiredItem = {
        ...storedItem,
        ttl: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };
      mockSend.mockResolvedValueOnce({ Item: expiredItem });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses/55efd08d-b675-4cb2-a271-ecd2b7003599',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
