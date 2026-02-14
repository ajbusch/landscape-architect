import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';

const s3 = new S3Client({});

export const BUCKET_NAME = process.env.PHOTO_BUCKET ?? '';

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
  return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
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
