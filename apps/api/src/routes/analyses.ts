import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { AnalysisResponse } from '@landscape-architect/shared';
import { AnalysisResponseSchema } from '@landscape-architect/shared';
import { docClient, TABLE_NAME } from '../db.js';
import { getZoneByZip } from '../services/zone-lookup.js';
import { getPhotoUploadUrl, getPhotoPresignedUrl } from '../services/photo.js';

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

const lambdaClient = new LambdaClient({});
const WORKER_FUNCTION_NAME = process.env.WORKER_FUNCTION_NAME ?? '';

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

    request.log.info({ analysisId }, 'Upload URL generated');
    return await reply.send({ uploadUrl, s3Key, analysisId });
  });

  /**
   * POST /api/v1/analyses — submit a new yard analysis (async).
   * Accepts JSON { photoKey, zipCode }, creates a pending record,
   * async-invokes the Worker Lambda, and returns 202 immediately.
   */
  app.post<{
    Body: { photoKey: string; zipCode: string };
  }>('/api/v1/analyses', async (request, reply) => {
    const { photoKey, zipCode } = request.body;

    if (!photoKey) {
      return await reply.status(400).send({ error: 'photoKey is required' });
    }
    if (!zipCode) {
      return await reply.status(400).send({ error: 'zipCode is required' });
    }

    // ── 1. Resolve ZIP to zone ────────────────────────────────────────
    const zoneData = getZoneByZip(zipCode);
    if (!zoneData) {
      return await reply.status(404).send({ error: 'ZIP code not found' });
    }

    // ── 2. Generate analysisId ────────────────────────────────────────
    const analysisId = randomUUID();
    request.log.info({ analysisId, zipCode, zone: zoneData.zone }, 'Analysis requested');

    // ── 3. Write pending DynamoDB record ──────────────────────────────
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + SEVEN_DAYS_S;

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `ANALYSIS#${analysisId}`,
          SK: `ANALYSIS#${analysisId}`,
          id: analysisId,
          status: 'pending',
          photoKey,
          zipCode,
          zone: zoneData.zone,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          ttl,
        },
      }),
    );

    // ── 4. Async invoke Worker Lambda ─────────────────────────────────
    try {
      const invokeResult = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: WORKER_FUNCTION_NAME,
          InvocationType: 'Event',
          Payload: Buffer.from(
            JSON.stringify({
              analysisId,
              photoKey,
              zipCode,
              zone: zoneData.zone,
              zoneDescription: zoneData.description,
            }),
          ),
        }),
      );
      request.log.info(
        {
          analysisId,
          workerFunctionName: WORKER_FUNCTION_NAME,
          workerRequestId: invokeResult.$metadata.requestId,
        },
        'Worker invoked',
      );
    } catch (err) {
      request.log.error(err, 'Failed to invoke worker Lambda');
      return await reply.status(500).send({ error: 'Failed to start analysis' });
    }

    // ── 5. Return 202 Accepted ────────────────────────────────────────
    return await reply.status(202).send({ id: analysisId, status: 'pending' });
  });

  /**
   * GET /api/v1/analyses/:id — poll analysis status and result.
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

    const item = result.Item;

    // Check if expired
    if (item.ttl && typeof item.ttl === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (item.ttl < now) {
        return await reply.status(404).send({ error: 'Analysis not found' });
      }
    }

    const status = item.status ? String(item.status) : 'complete';
    const createdAt = String(item.createdAt);

    request.log.info({ analysisId: id, status }, 'Analysis retrieved');

    // ── In-progress statuses ──────────────────────────────────────────
    if (status === 'pending' || status === 'analyzing' || status === 'matching') {
      return await reply.send({ id, status, createdAt });
    }

    // ── Failed ────────────────────────────────────────────────────────
    if (status === 'failed') {
      return await reply.send({
        id,
        status,
        createdAt,
        error: item.error ? String(item.error) : 'Analysis failed',
      });
    }

    // ── Complete — return full result ─────────────────────────────────
    const storedResult = item.result as AnalysisResponse | undefined;
    if (storedResult) {
      // Refresh pre-signed URL for the photo
      const s3Key = item.photoKey as string | undefined;
      if (s3Key && storedResult.photoUrl) {
        try {
          storedResult.photoUrl = await getPhotoPresignedUrl(s3Key);
        } catch {
          // Fall back to stored URL
        }
      }

      // Truncate recommendations to match schema max (handles records stored before the cap)
      if (storedResult.result.recommendations.length > 10) {
        storedResult.result.recommendations = storedResult.result.recommendations.slice(0, 10);
      }

      const validated = AnalysisResponseSchema.safeParse(storedResult);
      if (validated.success) {
        return await reply.send({ id, status, createdAt, result: validated.data });
      }

      request.log.error('Stored analysis failed schema validation');
    }

    return await reply.status(500).send({ error: 'Internal server error' });
  });
}
