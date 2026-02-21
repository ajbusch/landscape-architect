import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Context } from 'aws-lambda';

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

vi.mock('../../src/services/photo.js', () => ({
  validatePhoto: vi.fn(),
  convertHeicToJpeg: vi.fn(),
  resizeForApi: vi.fn(),
  downloadPhoto: vi.fn(),
  getPhotoPresignedUrl: vi.fn(),
}));

vi.mock('../../src/services/claude-vision.js', () => ({
  analyzeYardPhoto: vi.fn(),
}));

vi.mock('../../src/services/plant-matcher.js', () => ({
  matchPlants: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => {
  const child = vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  });
  return { logger: { child, info: vi.fn(), error: vi.fn() } };
});

import { docClient } from '../../src/db.js';
import {
  validatePhoto,
  convertHeicToJpeg,
  resizeForApi,
  downloadPhoto,
  getPhotoPresignedUrl,
} from '../../src/services/photo.js';
import { analyzeYardPhoto } from '../../src/services/claude-vision.js';
import { matchPlants } from '../../src/services/plant-matcher.js';
import { handler } from '../../src/worker.js';

const mockDbSend = docClient.send as unknown as Mock;
const mockValidatePhoto = validatePhoto as unknown as Mock;
const mockConvertHeic = convertHeicToJpeg as unknown as Mock;
const mockResizeForApi = resizeForApi as unknown as Mock;
const mockDownloadPhoto = downloadPhoto as unknown as Mock;
const mockGetPresignedUrl = getPhotoPresignedUrl as unknown as Mock;
const mockAnalyzeYardPhoto = analyzeYardPhoto as unknown as Mock;
const mockMatchPlants = matchPlants as unknown as Mock;

// ── Fixtures ──────────────────────────────────────────────────────────

const baseEvent = {
  analysisId: 'test-analysis-id',
  photoKey: 'photos/anonymous/test-analysis-id/original.jpg',
  zipCode: '28202',
  zone: '7b',
  zoneDescription: 'USDA Hardiness Zone 7b (5°F to 10°F)',
};

const fakeContext: Context = {
  awsRequestId: 'test-request-id',
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'worker',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:worker',
  logGroupName: '/aws/lambda/worker',
  logStreamName: '2026/02/21/[$LATEST]abc123',
  memoryLimitInMB: '512',
  getRemainingTimeInMillis: () => 30000,
  done: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
};

const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
const resizedBuffer = Buffer.from('resized-photo');

const validAiResult = {
  ok: true as const,
  data: {
    summary: 'A medium backyard with shade.',
    yardSize: 'medium' as const,
    overallSunExposure: 'partial_shade' as const,
    estimatedSoilType: 'loamy' as const,
    isValidYardPhoto: true,
    features: [{ type: 'tree' as const, label: 'Oak', confidence: 'high' as const }],
    recommendedPlantTypes: [
      {
        category: 'quick_win' as const,
        plantType: 'perennial',
        lightRequirement: 'partial_shade',
        reason: 'Shade plants.',
        searchCriteria: { type: 'perennial', light: 'partial_shade' },
      },
    ],
  },
};

const matchedPlants = [
  {
    plantId: 'plant-1',
    commonName: 'Hostas',
    scientificName: 'Hosta spp.',
    reason: 'Shade plants.',
    category: 'quick_win',
    light: 'partial_shade',
    waterNeeds: 'moderate',
    matureSize: { heightFt: { min: 1, max: 3 }, widthFt: { min: 2, max: 4 } },
    hardinessZones: { min: '3a', max: '9b' },
    bloomSeason: 'summer',
    costRange: 'low',
    difficulty: 'beginner',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────

/** Configure mocks for the happy path (JPEG). */
function setupHappyPath(): void {
  mockDbSend.mockResolvedValue({});
  mockDownloadPhoto.mockResolvedValue(jpegBuffer);
  mockValidatePhoto.mockReturnValue({
    valid: true,
    type: 'jpeg',
    mediaType: 'image/jpeg',
    ext: 'jpg',
  });
  mockResizeForApi.mockResolvedValue(resizedBuffer);
  mockAnalyzeYardPhoto.mockResolvedValue(validAiResult);
  mockMatchPlants.mockResolvedValue(matchedPlants);
  mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/signed');
}

/** Return the status string from the Nth DynamoDB update call (0-indexed). */
function getStatusUpdate(callIndex: number): string {
  const call = mockDbSend.mock.calls[callIndex];
  if (!call) throw new Error(`No DynamoDB call at index ${callIndex}`);
  const values = (call[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } })
    .input.ExpressionAttributeValues;
  return values[':status'] as string;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────

  describe('happy path (JPEG)', () => {
    it('completes the full analysis pipeline', async () => {
      setupHappyPath();

      await handler(baseEvent, fakeContext);

      // Should have called each step in order
      expect(mockDownloadPhoto).toHaveBeenCalledWith(baseEvent.photoKey);
      expect(mockValidatePhoto).toHaveBeenCalledWith(jpegBuffer);
      expect(mockResizeForApi).toHaveBeenCalledWith(jpegBuffer, 'image/jpeg');
      expect(mockAnalyzeYardPhoto).toHaveBeenCalledWith(
        resizedBuffer.toString('base64'),
        'image/jpeg',
        '7b',
        baseEvent.zoneDescription,
      );
      expect(mockMatchPlants).toHaveBeenCalledWith(validAiResult.data, '7b');
      expect(mockGetPresignedUrl).toHaveBeenCalledWith(baseEvent.photoKey);
    });

    it('updates status to analyzing, then matching, then complete', async () => {
      setupHappyPath();

      await handler(baseEvent, fakeContext);

      // At minimum: analyzing → matching → complete
      expect(getStatusUpdate(0)).toBe('analyzing');
      expect(getStatusUpdate(1)).toBe('matching');
      expect(getStatusUpdate(2)).toBe('complete');
    });

    it('saves the assembled analysis response on completion', async () => {
      setupHappyPath();

      await handler(baseEvent, fakeContext);

      // Last DynamoDB call should contain the result
      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      const result = values[':result'] as Record<string, unknown>;
      expect(result.id).toBe('test-analysis-id');
      expect(result.photoUrl).toBe('https://s3.example.com/signed');
      expect(result.address).toEqual({ zipCode: '28202', zone: '7b' });
      expect(result.tier).toBe('free');
    });
  });

  // ── HEIC conversion ───────────────────────────────────────────────

  describe('HEIC photo', () => {
    it('converts HEIC to JPEG before sending to Claude', async () => {
      setupHappyPath();
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'heic',
        mediaType: 'image/heic',
        ext: 'heic',
      });
      const convertedBuffer = Buffer.from('converted-jpeg');
      mockConvertHeic.mockResolvedValue(convertedBuffer);
      mockResizeForApi.mockResolvedValue(convertedBuffer);

      await handler(baseEvent, fakeContext);

      expect(mockConvertHeic).toHaveBeenCalledWith(jpegBuffer);
      expect(mockResizeForApi).toHaveBeenCalledWith(convertedBuffer, 'image/jpeg');
      expect(mockAnalyzeYardPhoto).toHaveBeenCalledWith(
        convertedBuffer.toString('base64'),
        'image/jpeg',
        expect.any(String),
        expect.any(String),
      );
    });

    it('fails gracefully when HEIC conversion throws', async () => {
      setupHappyPath();
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'heic',
        mediaType: 'image/heic',
        ext: 'heic',
      });
      mockConvertHeic.mockRejectedValue(new Error('Sharp HEIC decode failed'));

      await handler(baseEvent, fakeContext);

      // Should update status to failed
      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
      expect(values[':error']).toContain('image format');
      // Should NOT call Claude
      expect(mockAnalyzeYardPhoto).not.toHaveBeenCalled();
    });
  });

  // ── PNG pass-through ──────────────────────────────────────────────

  describe('PNG photo', () => {
    it('passes PNG media type through without conversion', async () => {
      setupHappyPath();
      mockValidatePhoto.mockReturnValue({
        valid: true,
        type: 'png',
        mediaType: 'image/png',
        ext: 'png',
      });

      await handler(baseEvent, fakeContext);

      expect(mockConvertHeic).not.toHaveBeenCalled();
      expect(mockResizeForApi).toHaveBeenCalledWith(jpegBuffer, 'image/png');
      expect(mockAnalyzeYardPhoto).toHaveBeenCalledWith(
        expect.any(String),
        'image/png',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ── Download failure ──────────────────────────────────────────────

  describe('photo download failure', () => {
    it('updates status to failed when S3 download throws', async () => {
      setupHappyPath();
      mockDownloadPhoto.mockRejectedValue(new Error('S3 NoSuchKey'));

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
      expect(values[':error']).toContain('retrieve photo');
    });

    it('does not call validation or Claude after download failure', async () => {
      setupHappyPath();
      mockDownloadPhoto.mockRejectedValue(new Error('Network error'));

      await handler(baseEvent, fakeContext);

      expect(mockValidatePhoto).not.toHaveBeenCalled();
      expect(mockAnalyzeYardPhoto).not.toHaveBeenCalled();
    });
  });

  // ── Validation failure ────────────────────────────────────────────

  describe('photo validation failure', () => {
    it('updates status to failed for invalid photo format', async () => {
      setupHappyPath();
      mockValidatePhoto.mockReturnValue({
        valid: false,
        error: 'Please upload a JPEG, PNG, or HEIC image',
      });

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
      expect(values[':error']).toContain('image format');
      expect(mockAnalyzeYardPhoto).not.toHaveBeenCalled();
    });
  });

  // ── Claude Vision failures ────────────────────────────────────────

  describe('Claude Vision API failure', () => {
    it('updates status to failed on timeout', async () => {
      setupHappyPath();
      mockAnalyzeYardPhoto.mockResolvedValue({
        ok: false,
        error: { type: 'timeout', message: 'Request timed out' },
      });

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
      expect(values[':error']).toContain('timed out');
    });

    it('updates status to failed on rate limit', async () => {
      setupHappyPath();
      mockAnalyzeYardPhoto.mockResolvedValue({
        ok: false,
        error: { type: 'rate_limit', message: 'Too many requests' },
      });

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
      expect(values[':error']).toContain('busy');
    });

    it('updates status to failed on invalid_response', async () => {
      setupHappyPath();
      mockAnalyzeYardPhoto.mockResolvedValue({
        ok: false,
        error: { type: 'invalid_response', message: 'Bad JSON from Claude' },
      });

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
      expect(values[':error']).toContain('failed');
    });

    it('updates status to failed on generic api_error', async () => {
      setupHappyPath();
      mockAnalyzeYardPhoto.mockResolvedValue({
        ok: false,
        error: { type: 'api_error', message: 'Internal server error' },
      });

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
    });

    it('does not call plant matching on Claude failure', async () => {
      setupHappyPath();
      mockAnalyzeYardPhoto.mockResolvedValue({
        ok: false,
        error: { type: 'timeout', message: 'Timed out' },
      });

      await handler(baseEvent, fakeContext);

      expect(mockMatchPlants).not.toHaveBeenCalled();
    });
  });

  // ── Invalid yard photo ────────────────────────────────────────────

  describe('invalid yard photo', () => {
    it('saves a complete result with empty features and recommendations', async () => {
      setupHappyPath();
      mockAnalyzeYardPhoto.mockResolvedValue({
        ok: true,
        data: {
          ...validAiResult.data,
          isValidYardPhoto: false,
          invalidPhotoReason: 'This appears to be a photo of a cat.',
          features: [],
          recommendedPlantTypes: [],
        },
      });

      await handler(baseEvent, fakeContext);

      // Should NOT call matchPlants
      expect(mockMatchPlants).not.toHaveBeenCalled();

      // Should still save a complete result
      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('complete');
      const result = values[':result'] as {
        result: { summary: string; features: unknown[]; recommendations: unknown[] };
      };
      expect(result.result.summary).toContain('cat');
      expect(result.result.features).toEqual([]);
      expect(result.result.recommendations).toEqual([]);
    });
  });

  // ── Unexpected error (catch-all) ──────────────────────────────────

  describe('unexpected errors', () => {
    it('catches unexpected throws and updates status to failed', async () => {
      setupHappyPath();
      mockMatchPlants.mockRejectedValue(new Error('Unexpected DynamoDB error'));

      await handler(baseEvent, fakeContext);

      const lastCall = mockDbSend.mock.calls[mockDbSend.mock.calls.length - 1]!;
      const values = (
        lastCall[0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }
      ).input.ExpressionAttributeValues;
      expect(values[':status']).toBe('failed');
    });

    it('handles failure in the status update itself', async () => {
      setupHappyPath();
      mockMatchPlants.mockRejectedValue(new Error('boom'));
      // Make the "update to failed" call also fail
      mockDbSend
        .mockResolvedValueOnce({}) // analyzing
        .mockResolvedValueOnce({}) // matching
        .mockRejectedValueOnce(new Error('DynamoDB unreachable'));

      // Should not throw — the outer catch swallows it
      await expect(handler(baseEvent, fakeContext)).resolves.toBeUndefined();
    });
  });
});
