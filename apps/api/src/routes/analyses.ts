import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  AnalysisResponseSchema,
  type AnalysisResponse,
  type IdentifiedFeature,
} from '@landscape-architect/shared';
import { docClient, TABLE_NAME } from '../db.js';
import { getZoneByZip } from '../services/zone-lookup.js';
import {
  validatePhoto,
  convertHeicToJpeg,
  uploadPhoto,
  getPhotoPresignedUrl,
} from '../services/photo.js';
import { analyzeYardPhoto } from '../services/claude-vision.js';
import { matchPlants } from '../services/plant-matcher.js';
import { getAnthropicApiKey } from '../services/secrets.js';

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

export async function analysesRoute(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB
      files: 1,
    },
  });

  /**
   * POST /api/v1/analyses — create a new yard analysis.
   */
  app.post('/api/v1/analyses', async (request, reply) => {
    // ── 1. Parse multipart form data ──────────────────────────────────
    let photoBuffer: Buffer;
    let zipCode: string;

    try {
      const parts = request.parts();
      let fileBuffer: Buffer | null = null;
      let addressJson: string | null = null;

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'photo') {
          fileBuffer = await part.toBuffer();
        } else if (part.type === 'field' && part.fieldname === 'address') {
          addressJson = part.value as string;
        }
      }

      if (!fileBuffer) {
        return await reply.status(400).send({ error: 'Photo is required' });
      }
      if (!addressJson) {
        return await reply.status(400).send({ error: 'Address is required' });
      }

      photoBuffer = fileBuffer;

      // Parse address JSON
      let addressData: unknown;
      try {
        addressData = JSON.parse(addressJson);
      } catch {
        return await reply.status(400).send({ error: 'Invalid address JSON' });
      }

      if (
        !addressData ||
        typeof addressData !== 'object' ||
        !('zipCode' in addressData) ||
        typeof (addressData as Record<string, unknown>).zipCode !== 'string'
      ) {
        return await reply.status(400).send({ error: 'zipCode is required in address' });
      }

      zipCode = (addressData as { zipCode: string }).zipCode;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('request file too large')) {
        return await reply.status(413).send({ error: 'Image must be under 20MB' });
      }
      throw err;
    }

    // ── 2. Validate photo via magic bytes ─────────────────────────────
    const validation = validatePhoto(photoBuffer);
    if (!validation.valid) {
      return await reply.status(400).send({ error: validation.error });
    }

    // ── 3. Resolve ZIP to zone ────────────────────────────────────────
    const zoneData = getZoneByZip(zipCode);
    if (!zoneData) {
      return await reply.status(404).send({ error: 'ZIP code not found' });
    }

    // ── 4. Validate secrets are accessible early ──────────────────────
    try {
      await getAnthropicApiKey();
    } catch (err) {
      request.log.error(err, 'Failed to retrieve Anthropic API key');
      return reply
        .status(500)
        .send({ error: 'Internal server error: unable to initialize AI service' });
    }

    // ── 5. Generate analysis ID and upload photo to S3 ────────────────
    const analysisId = randomUUID();
    let s3Key: string;

    try {
      s3Key = await uploadPhoto(analysisId, photoBuffer, validation.ext, validation.mediaType);
    } catch (err) {
      request.log.error(err, 'S3 upload failed');
      return await reply.status(500).send({ error: 'Failed to upload photo' });
    }

    // ── 6. Convert HEIC → JPEG if needed, prepare base64 ─────────────
    let aiPhotoBuffer = photoBuffer;
    let aiMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg';

    if (validation.type === 'heic') {
      try {
        aiPhotoBuffer = await convertHeicToJpeg(photoBuffer);
        aiMediaType = 'image/jpeg';
      } catch (err) {
        request.log.error(err, 'HEIC conversion failed');
        return reply
          .status(400)
          .send({ error: 'Unable to process this image format. Please try JPEG or PNG.' });
      }
    } else if (validation.type === 'png') {
      aiMediaType = 'image/png';
    }

    const base64Photo = aiPhotoBuffer.toString('base64');

    // ── 7. Call Claude Vision API ─────────────────────────────────────
    const aiResult = await analyzeYardPhoto(
      base64Photo,
      aiMediaType,
      zoneData.zone,
      zoneData.description,
    );

    if (!aiResult.ok) {
      const { error } = aiResult;
      switch (error.type) {
        case 'timeout':
          return await reply.status(504).send({ error: error.message });
        case 'rate_limit':
          return await reply.status(429).send({ error: error.message });
        default:
          return await reply.status(500).send({ error: 'AI analysis failed. Please try again.' });
      }
    }

    // ── 8. Check for invalid yard photo ───────────────────────────────
    if (!aiResult.data.isValidYardPhoto) {
      return await reply.status(422).send({
        error:
          aiResult.data.invalidPhotoReason ??
          "We couldn't identify a yard or garden in this photo.",
      });
    }

    // ── 9. Match plant types to real plants ───────────────────────────
    const recommendations = await matchPlants(aiResult.data, zoneData.zone);

    // ── 10. Assemble features with IDs ────────────────────────────────
    const features: IdentifiedFeature[] = aiResult.data.features.map((f) => ({
      ...f,
      id: randomUUID(),
    }));

    // ── 11. Generate pre-signed URL ───────────────────────────────────
    const photoUrl = await getPhotoPresignedUrl(s3Key);

    // ── 12. Assemble response ─────────────────────────────────────────
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SEVEN_DAYS_S * 1000);

    const analysisResponse: AnalysisResponse = {
      id: analysisId,
      photoUrl,
      address: {
        zipCode,
        zone: zoneData.zone,
      },
      result: {
        summary: aiResult.data.summary,
        yardSize: aiResult.data.yardSize,
        overallSunExposure: aiResult.data.overallSunExposure,
        estimatedSoilType: aiResult.data.estimatedSoilType,
        features,
        recommendations,
      },
      tier: 'free',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    // ── 13. Store in DynamoDB with TTL ────────────────────────────────
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `ANALYSIS#${analysisId}`,
          SK: `ANALYSIS#${analysisId}`,
          ...analysisResponse,
          s3Key,
          ttl,
        },
      }),
    );

    return await reply.status(201).send(analysisResponse);
  });

  /**
   * GET /api/v1/analyses/:id — fetch a stored analysis.
   */
  app.get<{ Params: { id: string } }>('/api/v1/analyses/:id', async (request, reply) => {
    const { id } = request.params;

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `ANALYSIS#${id}`, SK: `ANALYSIS#${id}` },
      }),
    );

    if (!result.Item) {
      return await reply.status(404).send({ error: 'Analysis not found' });
    }

    // Check if expired
    const item = result.Item;
    if (item.ttl && typeof item.ttl === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (item.ttl < now) {
        return await reply.status(404).send({ error: 'Analysis not found' });
      }
    }

    // Generate fresh pre-signed URL for the photo
    const s3Key = item.s3Key as string | undefined;
    let photoUrl = item.photoUrl as string;

    if (s3Key) {
      try {
        photoUrl = await getPhotoPresignedUrl(s3Key);
      } catch {
        // If pre-signing fails, fall back to stored URL (may be expired)
      }
    }

    // Build response — strip DynamoDB internal fields
    const response: AnalysisResponse = {
      id: item.id as string,
      userId: item.userId as string | undefined,
      photoUrl,
      address: item.address as AnalysisResponse['address'],
      result: item.result as AnalysisResponse['result'],
      tier: item.tier as AnalysisResponse['tier'],
      createdAt: item.createdAt as string,
      expiresAt: item.expiresAt as string | undefined,
    };

    // Validate response shape
    const validated = AnalysisResponseSchema.safeParse(response);
    if (!validated.success) {
      request.log.error(
        { issues: validated.error.issues },
        'Stored analysis failed schema validation',
      );
      return await reply.status(500).send({ error: 'Internal server error' });
    }

    return await reply.send(validated.data);
  });
}
