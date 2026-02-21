import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ── Mock S3 ─────────────────────────────────────────────────────────────

const mockS3Send = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockS3Send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

// ── Mock Sharp ──────────────────────────────────────────────────────────

const mockJpeg = vi.hoisted(() => vi.fn());
const mockPng = vi.hoisted(() => vi.fn());
const mockResize = vi.hoisted(() => vi.fn());
const mockMetadata = vi.hoisted(() => vi.fn());
const mockToBuffer = vi.hoisted(() => vi.fn());

vi.mock('sharp', () => ({
  default: () => ({
    jpeg: mockJpeg,
    png: mockPng,
    resize: mockResize,
    metadata: mockMetadata,
    toBuffer: mockToBuffer,
  }),
}));

import {
  convertHeicToJpeg,
  resizeForApi,
  uploadPhoto,
  downloadPhoto,
  getPhotoPresignedUrl,
  getPhotoUploadUrl,
} from '../../src/services/photo.js';

describe('photo S3 and image processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default sharp chain: jpeg().toBuffer() → small buffer
    mockJpeg.mockReturnValue({ toBuffer: mockToBuffer });
    mockPng.mockReturnValue({ toBuffer: mockToBuffer });
    mockResize.mockReturnValue({
      jpeg: mockJpeg,
      png: mockPng,
      toBuffer: mockToBuffer,
    });
  });

  // ── convertHeicToJpeg ───────────────────────────────────────────────

  describe('convertHeicToJpeg', () => {
    it('converts buffer to JPEG with quality 90', async () => {
      const input = Buffer.from('fake-heic-data');
      const output = Buffer.from('fake-jpeg-data');
      mockToBuffer.mockResolvedValueOnce(output);

      const result = await convertHeicToJpeg(input);

      expect(result).toBe(output);
      expect(mockJpeg).toHaveBeenCalledWith({ quality: 90 });
    });
  });

  // ── resizeForApi ────────────────────────────────────────────────────

  describe('resizeForApi', () => {
    it('returns buffer unchanged when under size limit', async () => {
      const small = Buffer.alloc(100_000); // well under 1.5MB

      const result = await resizeForApi(small, 'image/jpeg');

      expect(result).toBe(small);
      expect(mockResize).not.toHaveBeenCalled();
    });

    it('resizes large JPEG images progressively', async () => {
      const large = Buffer.alloc(2_000_000); // over 1.5MB
      const resized = Buffer.alloc(1_000_000); // under limit
      mockMetadata.mockResolvedValueOnce({ width: 4000 });
      mockToBuffer.mockResolvedValueOnce(resized);

      const result = await resizeForApi(large, 'image/jpeg');

      expect(result).toBe(resized);
      expect(mockResize).toHaveBeenCalledWith({ width: 2048, withoutEnlargement: true });
    });

    it('resizes large PNG images using png encoder', async () => {
      const large = Buffer.alloc(2_000_000);
      const resized = Buffer.alloc(1_000_000);
      mockMetadata.mockResolvedValueOnce({ width: 4000 });
      mockToBuffer.mockResolvedValueOnce(resized);

      const result = await resizeForApi(large, 'image/png');

      expect(result).toBe(resized);
      expect(mockPng).toHaveBeenCalled();
    });

    it('tries smaller widths when first resize is still too large', async () => {
      const large = Buffer.alloc(2_000_000);
      const stillLarge = Buffer.alloc(1_600_000); // still over limit
      const small = Buffer.alloc(1_000_000); // under limit
      mockMetadata.mockResolvedValueOnce({ width: 4000 });
      // First resize (2048) still too large
      mockToBuffer.mockResolvedValueOnce(stillLarge);
      // Second resize (1536) fits
      mockToBuffer.mockResolvedValueOnce(small);

      const result = await resizeForApi(large, 'image/jpeg');

      expect(result).toBe(small);
    });

    it('falls back to aggressive JPEG compression as last resort', async () => {
      const large = Buffer.alloc(2_000_000);
      const stillLarge1 = Buffer.alloc(1_600_000);
      const stillLarge2 = Buffer.alloc(1_600_000);
      const stillLarge3 = Buffer.alloc(1_600_000);
      const compressed = Buffer.alloc(800_000);
      mockMetadata.mockResolvedValueOnce({ width: 4000 });
      // All progressive resizes still too large
      mockToBuffer.mockResolvedValueOnce(stillLarge1);
      mockToBuffer.mockResolvedValueOnce(stillLarge2);
      mockToBuffer.mockResolvedValueOnce(stillLarge3);
      // Final aggressive compression
      mockToBuffer.mockResolvedValueOnce(compressed);

      const result = await resizeForApi(large, 'image/jpeg');

      expect(result).toBe(compressed);
      expect(mockJpeg).toHaveBeenCalledWith({ quality: 70 });
    });

    it('skips target widths larger than the image', async () => {
      const large = Buffer.alloc(2_000_000);
      const resized = Buffer.alloc(1_000_000);
      // Image is only 1200px wide — skip 2048 and 1536, try 1024
      mockMetadata.mockResolvedValueOnce({ width: 1200 });
      mockToBuffer.mockResolvedValueOnce(resized);

      const result = await resizeForApi(large, 'image/jpeg');

      expect(result).toBe(resized);
      expect(mockResize).toHaveBeenCalledWith({ width: 1024, withoutEnlargement: true });
    });
  });

  // ── uploadPhoto ─────────────────────────────────────────────────────

  describe('uploadPhoto', () => {
    it('uploads buffer to S3 with correct key and headers', async () => {
      mockS3Send.mockResolvedValueOnce({});
      const buffer = Buffer.from('photo-data');

      const key = await uploadPhoto('analysis-123', buffer, 'jpg', 'image/jpeg');

      expect(key).toBe('photos/anonymous/analysis-123/original.jpg');
      expect(mockS3Send).toHaveBeenCalledOnce();
      const cmd = mockS3Send.mock.calls[0]![0];
      expect(cmd.input).toEqual(
        expect.objectContaining({
          Key: 'photos/anonymous/analysis-123/original.jpg',
          ContentType: 'image/jpeg',
          ServerSideEncryption: 'AES256',
        }),
      );
    });
  });

  // ── downloadPhoto ───────────────────────────────────────────────────

  describe('downloadPhoto', () => {
    it('downloads and concatenates S3 stream chunks', async () => {
      const chunk1 = Buffer.from('hello');
      const chunk2 = Buffer.from(' world');
      const mockStream = (async function* (): AsyncGenerator<Buffer> {
        yield chunk1;
        yield chunk2;
      })();

      mockS3Send.mockResolvedValueOnce({ Body: mockStream });

      const result = await downloadPhoto('photos/test/original.jpg');

      expect(result.toString()).toBe('hello world');
    });

    it('throws when S3 response body is empty', async () => {
      mockS3Send.mockResolvedValueOnce({ Body: undefined });

      await expect(downloadPhoto('photos/test/original.jpg')).rejects.toThrow(
        'Empty response body from S3',
      );
    });
  });

  // ── getPhotoPresignedUrl ────────────────────────────────────────────

  describe('getPhotoPresignedUrl', () => {
    it('returns a pre-signed GET URL with 15-min expiry', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/signed');

      const url = await getPhotoPresignedUrl('photos/test/original.jpg');

      expect(url).toBe('https://s3.example.com/signed');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 900 },
      );
    });
  });

  // ── getPhotoUploadUrl ───────────────────────────────────────────────

  describe('getPhotoUploadUrl', () => {
    it('returns a pre-signed PUT URL and S3 key', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/put-signed');

      const result = await getPhotoUploadUrl('analysis-456', 'image/png', 'png');

      expect(result.uploadUrl).toBe('https://s3.example.com/put-signed');
      expect(result.s3Key).toBe('photos/anonymous/analysis-456/original.png');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 300 },
      );
    });
  });
});
