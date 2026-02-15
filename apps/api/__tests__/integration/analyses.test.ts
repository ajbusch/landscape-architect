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

vi.mock('../../src/services/secrets.js', () => ({
  getAnthropicApiKey: vi.fn(),
}));

vi.mock('../../src/services/photo.js', () => ({
  validatePhoto: vi.fn(),
  convertHeicToJpeg: vi.fn(),
  resizeForApi: vi.fn((buf: Buffer) => Promise.resolve(buf)),
  getPhotoPresignedUrl: vi.fn(),
  getPhotoUploadUrl: vi.fn(),
  downloadPhoto: vi.fn(),
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
import { validatePhoto, getPhotoPresignedUrl, downloadPhoto } from '../../src/services/photo.js';
import { analyzeYardPhoto } from '../../src/services/claude-vision.js';
import { matchPlants } from '../../src/services/plant-matcher.js';

const mockSend = docClient.send as unknown as Mock;
const mockGetZoneByZip = getZoneByZip as unknown as Mock;
const mockGetApiKey = getAnthropicApiKey as unknown as Mock;
const mockValidatePhoto = validatePhoto as unknown as Mock;
const mockGetPresignedUrl = getPhotoPresignedUrl as unknown as Mock;
const mockDownloadPhoto = downloadPhoto as unknown as Mock;
const mockAnalyzeYard = analyzeYardPhoto as unknown as Mock;
const mockMatchPlants = matchPlants as unknown as Mock;

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

const sampleRecommendations = [
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
];

// JPEG magic bytes
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);

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

  it('end-to-end: POST creates analysis, response conforms to AnalysisResponseSchema', async () => {
    // Setup all mocks for happy path
    mockValidatePhoto.mockReturnValue({
      valid: true,
      type: 'jpeg',
      mediaType: 'image/jpeg',
      ext: 'jpg',
    });
    mockGetZoneByZip.mockReturnValue(sampleZone);
    mockGetApiKey.mockResolvedValue('test-key');
    mockDownloadPhoto.mockResolvedValue(jpegBuffer);
    mockAnalyzeYard.mockResolvedValue({ ok: true, data: sampleAiOutput });
    mockMatchPlants.mockResolvedValue(sampleRecommendations);
    mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/presigned');
    mockSend.mockResolvedValue({}); // DynamoDB PutCommand

    const analysisId = '55efd08d-b675-4cb2-a271-ecd2b7003501';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        s3Key: `photos/anonymous/${analysisId}/original.jpg`,
        analysisId,
        address: { zipCode: '28202' },
      }),
    });

    expect(response.statusCode).toBe(201);

    // Validate against the schema
    const parsed = JSON.parse(response.body);
    const validation = AnalysisResponseSchema.safeParse(parsed);
    if (!validation.success) {
      console.error('Schema validation errors:', JSON.stringify(validation.error.issues));
    }
    expect(validation.success).toBe(true);
  });

  it('end-to-end: POST then GET returns consistent data', async () => {
    // Setup POST mocks
    mockValidatePhoto.mockReturnValue({
      valid: true,
      type: 'jpeg',
      mediaType: 'image/jpeg',
      ext: 'jpg',
    });
    mockGetZoneByZip.mockReturnValue(sampleZone);
    mockGetApiKey.mockResolvedValue('test-key');
    mockDownloadPhoto.mockResolvedValue(jpegBuffer);
    mockAnalyzeYard.mockResolvedValue({ ok: true, data: sampleAiOutput });
    mockMatchPlants.mockResolvedValue(sampleRecommendations);
    mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/presigned');
    mockSend.mockResolvedValue({});

    const analysisId = '55efd08d-b675-4cb2-a271-ecd2b7003502';
    const postResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        s3Key: `photos/anonymous/${analysisId}/original.jpg`,
        analysisId,
        address: { zipCode: '28202' },
      }),
    });

    const created = JSON.parse(postResponse.body);

    // Now GET the same analysis — simulate DynamoDB returning the stored item
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `ANALYSIS#${created.id as string}`,
        SK: `ANALYSIS#${created.id as string}`,
        ...created,
        s3Key: `photos/anonymous/${analysisId}/original.jpg`,
        ttl: Math.floor(Date.now() / 1000) + 86400,
      },
    });
    mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/fresh-presigned');

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${created.id as string}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.body);

    // Core data should match
    expect(fetched.id).toBe(created.id);
    expect(fetched.address).toEqual(created.address);
    expect(fetched.result.summary).toBe(created.result.summary);
    expect(fetched.result.features).toHaveLength(created.result.features.length);
    expect(fetched.result.recommendations).toHaveLength(created.result.recommendations.length);

    // Photo URL should be refreshed
    expect(fetched.photoUrl).toBe('https://s3.example.com/fresh-presigned');

    // GET response should also conform to schema
    const validation = AnalysisResponseSchema.safeParse(fetched);
    expect(validation.success).toBe(true);
  });
});
