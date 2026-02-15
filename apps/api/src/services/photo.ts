import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});

export const BUCKET_NAME = process.env.BUCKET_NAME ?? '';

/** Supported image types identified via magic bytes. */
type ImageType = 'jpeg' | 'png' | 'heic';

interface PhotoValidationResult {
  valid: true;
  type: ImageType;
  mediaType: 'image/jpeg' | 'image/png' | 'image/heic';
  ext: string;
}

interface PhotoValidationError {
  valid: false;
  error: string;
}

const MAX_PHOTO_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Validate photo via magic bytes, not file extension.
 */
export function validatePhoto(buffer: Buffer): PhotoValidationResult | PhotoValidationError {
  if (buffer.length > MAX_PHOTO_SIZE) {
    return { valid: false, error: 'Image must be under 20MB' };
  }

  if (buffer.length < 12) {
    return { valid: false, error: 'File is too small to be a valid image' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, type: 'jpeg', mediaType: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { valid: true, type: 'png', mediaType: 'image/png', ext: 'png' };
  }

  // HEIC: check for ftyp box with heic/heix/mif1 brands
  // Bytes 4-7 should be "ftyp", then the brand follows
  if (buffer.length >= 12) {
    const ftyp = buffer.toString('ascii', 4, 8);
    if (ftyp === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12);
      if (['heic', 'heix', 'mif1', 'heis'].includes(brand)) {
        return { valid: true, type: 'heic', mediaType: 'image/heic', ext: 'heic' };
      }
    }
  }

  return {
    valid: false,
    error: 'Please upload a JPEG, PNG, or HEIC image',
  };
}

/**
 * Convert HEIC to JPEG for Claude Vision (which doesn't support HEIC).
 */
export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Anthropic API enforces a 5 MB limit on base64-encoded images.
 * Base64 inflates ~33%, so raw bytes must stay under ~3.75 MB.
 * Resize progressively until the image fits.
 */
const MAX_AI_IMAGE_BYTES = 1_500_000;

export async function resizeForApi(
  buffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png',
): Promise<Buffer> {
  if (buffer.length <= MAX_AI_IMAGE_BYTES) return buffer;

  const sharp = (await import('sharp')).default;
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width;

  // Try progressively smaller widths
  const targets = [2048, 1536, 1024];
  for (const targetWidth of targets) {
    if (width <= targetWidth) continue;
    const resized = await sharp(buffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      [mediaType === 'image/png' ? 'png' : 'jpeg']({ quality: 85 })
      .toBuffer();
    if (resized.length <= MAX_AI_IMAGE_BYTES) return resized;
    buffer = resized;
  }

  // Last resort: aggressive JPEG compression at current size
  return sharp(buffer).jpeg({ quality: 70 }).toBuffer();
}

/**
 * Upload photo to S3.
 */
export async function uploadPhoto(
  analysisId: string,
  buffer: Buffer,
  ext: string,
  contentType: string,
): Promise<string> {
  const key = `photos/anonymous/${analysisId}/original.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    }),
  );

  return key;
}

/**
 * Generate a pre-signed PUT URL for direct browser upload to S3.
 */
export async function getPhotoUploadUrl(
  analysisId: string,
  contentType: string,
  ext: string,
): Promise<{ uploadUrl: string; s3Key: string }> {
  const s3Key = `photos/anonymous/${analysisId}/original.${ext}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    }),
    { expiresIn: 300 }, // 5 minutes
  );

  return { uploadUrl, s3Key };
}

/**
 * Download a photo from S3 into a buffer.
 */
export async function downloadPhoto(s3Key: string): Promise<Buffer> {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    }),
  );

  const stream = result.Body;
  if (!stream) {
    throw new Error('Empty response body from S3');
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Generate a pre-signed URL for accessing a photo (15-min expiry).
 */
export async function getPhotoPresignedUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }),
    { expiresIn: 900 }, // 15 minutes
  );
}
