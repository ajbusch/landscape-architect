import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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
  getPhotoPresignedUrl,
  getPhotoUploadUrl,
  downloadPhoto,
} from '../services/photo.js';
import { analyzeYardPhoto } from '../services/claude-vision.js';
import { matchPlants } from '../services/plant-matcher.js';
import { getAnthropicApiKey } from '../services/secrets.js';

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

export function analysesRoute(app: FastifyInstance): void {
  /**
   * POST /api/v1/analyses/upload-url — get a pre-signed S3 PUT URL for direct upload.
   */
  app.post<{
    Body: { contentType: string };
  }>('/api/v1/analyses/upload-url', async (request, reply) => {
    const { contentType } = request.body;
    const ext = CONTENT_TYPE_TO_EXT[contentType];

    if (!ext) {
      return await reply
        .status(400)
        .send({ error: 'Unsupported content type. Use image/jpeg, image/png, or image/heic.' });
    }

    const analysisId = randomUUID();
    const { uploadUrl, s3Key } = await getPhotoUploadUrl(analysisId, contentType, ext);

    return await reply.send({ uploadUrl, s3Key, analysisId });
  });

  /**
   * POST /api/v1/analyses — create a new yard analysis from an S3 key.
   */
  app.post<{
    Body: { s3Key: string; analysisId: string; address?: { zipCode?: string } };
  }>('/api/v1/analyses', async (request, reply) => {
    const { s3Key, analysisId, address } = request.body;

    if (!s3Key || !analysisId) {
      return await reply.status(400).send({ error: 's3Key and analysisId are required' });
    }
    if (!address?.zipCode) {
      return await reply.status(400).send({ error: 'address.zipCode is required' });
    }

    const { zipCode } = address;

    // ── 1. Resolve ZIP to zone ────────────────────────────────────────
    const zoneData = getZoneByZip(zipCode);
    if (!zoneData) {
      return await reply.status(404).send({ error: 'ZIP code not found' });
    }

    // ── 2. Validate secrets are accessible early ──────────────────────
    try {
      await getAnthropicApiKey();
    } catch (err) {
      request.log.error(err, 'Failed to retrieve Anthropic API key');
      return reply
        .status(500)
        .send({ error: 'Internal server error: unable to initialize AI service' });
    }

    // ── 3. Download photo from S3 and validate ────────────────────────
    let photoBuffer: Buffer;
    try {
      photoBuffer = await downloadPhoto(s3Key);
    } catch (err) {
      request.log.error(err, 'Failed to download photo from S3');
      return await reply.status(400).send({ error: 'Photo not found. Please re-upload.' });
    }

    const validation = validatePhoto(photoBuffer);
    if (!validation.valid) {
      return await reply.status(400).send({ error: validation.error });
    }

    // ── 4. Convert HEIC → JPEG if needed, prepare base64 ─────────────
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

    // ── 5. Call Claude Vision API ─────────────────────────────────────
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

    // ── 6. Check for invalid yard photo ───────────────────────────────
    if (!aiResult.data.isValidYardPhoto) {
      return await reply.status(422).send({
        error:
          aiResult.data.invalidPhotoReason ??
          "We couldn't identify a yard or garden in this photo.",
      });
    }

    // ── 7. Match plant types to real plants ───────────────────────────
    const recommendations = await matchPlants(aiResult.data, zoneData.zone);

    // ── 8. Assemble features with IDs ────────────────────────────────
    const features: IdentifiedFeature[] = aiResult.data.features.map((f) => ({
      ...f,
      id: randomUUID(),
    }));

    // ── 9. Generate pre-signed URL ───────────────────────────────────
    const photoUrl = await getPhotoPresignedUrl(s3Key);

    // ── 10. Assemble response ─────────────────────────────────────────
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

    // ── 11. Store in DynamoDB with TTL ────────────────────────────────
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
