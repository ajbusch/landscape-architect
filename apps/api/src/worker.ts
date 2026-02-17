import { randomUUID } from 'node:crypto';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import type { IdentifiedFeature, AnalysisResponse } from '@landscape-architect/shared';
import { docClient, TABLE_NAME } from './db.js';
import {
  validatePhoto,
  convertHeicToJpeg,
  resizeForApi,
  downloadPhoto,
  getPhotoPresignedUrl,
} from './services/photo.js';
import { analyzeYardPhoto } from './services/claude-vision.js';
import { matchPlants } from './services/plant-matcher.js';
import { logger } from './lib/logger.js';

interface WorkerEvent {
  analysisId: string;
  photoKey: string;
  zipCode: string;
  zone: string;
  zoneDescription: string;
}

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

let isColdStart = true;

async function updateStatus(
  analysisId: string,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  let updateExpr = 'SET #status = :status, #updatedAt = :now';
  const exprNames: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
  const exprValues: Record<string, unknown> = { ':status': status, ':now': now };

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      const nameRef = `#${key}`;
      updateExpr += `, ${nameRef} = :${key}`;
      exprNames[nameRef] = key;
      exprValues[`:${key}`] = value;
    }
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ANALYSIS#${analysisId}`, SK: `ANALYSIS#${analysisId}` },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
    }),
  );
}

export async function handler(event: WorkerEvent, context: Context): Promise<void> {
  const { analysisId, photoKey, zipCode, zone, zoneDescription } = event;
  const t0Total = Date.now();
  let lastStep = 'start';

  const log = logger.child({ analysisId, awsRequestId: context.awsRequestId });

  log.info({ coldStart: isColdStart, step: 'start', photoKey, zone }, 'Worker started');
  isColdStart = false;

  try {
    // ── 1. Update status to "analyzing" ─────────────────────────────
    await updateStatus(analysisId, 'analyzing');
    lastStep = 'status_analyzing';
    log.info({ step: 'status_analyzing' }, 'Status updated to analyzing');

    // ── 2. Download photo from S3 ───────────────────────────────────
    let photoBuffer: Buffer;
    try {
      const t0 = Date.now();
      photoBuffer = await downloadPhoto(photoKey);
      const duration = Date.now() - t0;
      lastStep = 'download';
      log.info(
        { step: 'download', duration, photoSizeBytes: photoBuffer.length },
        'Photo downloaded',
      );
    } catch (err) {
      lastStep = 'download';
      log.error(
        {
          step: 'download',
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          errorCategory: 'download_failed',
          errorRetryable: true,
          userMessage: 'Unable to retrieve photo. Please try again.',
          lastStep,
          duration: Date.now() - t0Total,
        },
        'Worker failed',
      );
      await updateStatus(analysisId, 'failed', {
        error: 'Unable to retrieve photo. Please try again.',
      });
      return;
    }

    // ── 3. Validate and resize with Sharp ───────────────────────────
    const validation = validatePhoto(photoBuffer);
    if (!validation.valid) {
      log.error(
        {
          step: 'resize',
          errorCategory: 'resize_failed',
          errorRetryable: false,
          userMessage: 'Unable to process this image format. Please try JPEG or PNG.',
          lastStep,
          duration: Date.now() - t0Total,
        },
        'Worker failed',
      );
      await updateStatus(analysisId, 'failed', {
        error: 'Unable to process this image format. Please try JPEG or PNG.',
      });
      return;
    }

    let aiPhotoBuffer = photoBuffer;
    let aiMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg';

    if (validation.type === 'heic') {
      try {
        const t0 = Date.now();
        aiPhotoBuffer = await convertHeicToJpeg(photoBuffer);
        aiMediaType = 'image/jpeg';
        const duration = Date.now() - t0;
        log.info(
          { step: 'resize', duration, resizedSizeBytes: aiPhotoBuffer.length },
          'Photo resized',
        );
      } catch (err) {
        lastStep = 'resize';
        log.error(
          {
            step: 'resize',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            errorCategory: 'resize_failed',
            errorRetryable: false,
            userMessage: 'Unable to process this image format. Please try JPEG or PNG.',
            lastStep,
            duration: Date.now() - t0Total,
          },
          'Worker failed',
        );
        await updateStatus(analysisId, 'failed', {
          error: 'Unable to process this image format. Please try JPEG or PNG.',
        });
        return;
      }
    } else if (validation.type === 'png') {
      aiMediaType = 'image/png';
    }

    {
      const t0 = Date.now();
      aiPhotoBuffer = await resizeForApi(aiPhotoBuffer, aiMediaType);
      const duration = Date.now() - t0;
      lastStep = 'resize';
      log.info(
        { step: 'resize', duration, resizedSizeBytes: aiPhotoBuffer.length },
        'Photo resized',
      );
    }

    // ── 4. Base64 encode ────────────────────────────────────────────
    const base64Photo = aiPhotoBuffer.toString('base64');

    // ── 5. Call Claude Vision API ───────────────────────────────────
    const t0Claude = Date.now();
    const aiResult = await analyzeYardPhoto(base64Photo, aiMediaType, zone, zoneDescription);
    const claudeDuration = Date.now() - t0Claude;
    lastStep = 'claude';

    if (!aiResult.ok) {
      const { error } = aiResult;
      const categoryMap: Record<string, string> = {
        timeout: 'claude_timeout',
        rate_limit: 'claude_rate_limit',
        invalid_response: 'claude_invalid_response',
        api_error: 'claude_api_error',
      };
      const errorCategory = categoryMap[error.type] ?? 'claude_api_error';

      const userMessageMap: Record<string, string> = {
        claude_timeout: 'Analysis timed out. Please try again.',
        claude_rate_limit: 'Service is busy. Please try again in a moment.',
        claude_invalid_response: 'AI analysis failed. Please try again.',
        claude_api_error: 'AI analysis failed. Please try again.',
      };
      const userMessage = userMessageMap[errorCategory] ?? 'AI analysis failed. Please try again.';

      log.error(
        {
          step: 'claude',
          error: error.message,
          errorCategory,
          errorRetryable: true,
          userMessage,
          lastStep,
          duration: Date.now() - t0Total,
          claudeDuration,
        },
        'Worker failed',
      );
      await updateStatus(analysisId, 'failed', { error: userMessage });
      return;
    }

    log.info({ step: 'claude', duration: claudeDuration }, 'Claude responded');

    // ── 6. Parse / validate result ──────────────────────────────────
    lastStep = 'parse';
    log.info(
      {
        step: 'parse',
        isValid: true,
        isValidYardPhoto: aiResult.data.isValidYardPhoto,
      },
      'AI response parsed',
    );

    // ── 7. Handle invalid yard photo ────────────────────────────────
    if (!aiResult.data.isValidYardPhoto) {
      const photoUrl = await getPhotoPresignedUrl(photoKey);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SEVEN_DAYS_S * 1000);

      const analysisResponse: AnalysisResponse = {
        id: analysisId,
        photoUrl,
        address: { zipCode, zone },
        result: {
          summary:
            aiResult.data.invalidPhotoReason ??
            "We couldn't identify a yard or garden in this photo.",
          yardSize: aiResult.data.yardSize,
          overallSunExposure: aiResult.data.overallSunExposure,
          estimatedSoilType: aiResult.data.estimatedSoilType,
          features: [],
          recommendations: [],
        },
        tier: 'free',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      await updateStatus(analysisId, 'complete', {
        result: analysisResponse,
        isValidYardPhoto: false,
      });

      log.info(
        { step: 'complete', duration: Date.now() - t0Total, isValidYardPhoto: false },
        'Worker complete',
      );
      return;
    }

    // ── 8. Update status to "matching" ──────────────────────────────
    await updateStatus(analysisId, 'matching');
    lastStep = 'status_matching';
    log.info({ step: 'status_matching' }, 'Status updated to matching');

    // ── 9. Match plant types to real plants ──────────────────────────
    const t0Match = Date.now();
    const recommendations = await matchPlants(aiResult.data, zone);
    const matchDuration = Date.now() - t0Match;
    lastStep = 'matching';
    log.info(
      { step: 'matching', duration: matchDuration, matchCount: recommendations.length },
      'Plants matched',
    );

    // ── 10. Assemble features with IDs ──────────────────────────────
    const features: IdentifiedFeature[] = aiResult.data.features.map((f) => ({
      ...f,
      id: randomUUID(),
      species: f.species ?? undefined,
      sunExposure: f.sunExposure ?? undefined,
      notes: f.notes ?? undefined,
    }));

    // ── 11. Generate pre-signed URL ─────────────────────────────────
    const photoUrl = await getPhotoPresignedUrl(photoKey);

    // ── 12. Assemble response ───────────────────────────────────────
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SEVEN_DAYS_S * 1000);

    const analysisResponse: AnalysisResponse = {
      id: analysisId,
      photoUrl,
      address: { zipCode, zone },
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

    // ── 13. Save complete result ────────────────────────────────────
    await updateStatus(analysisId, 'complete', { result: analysisResponse });
    lastStep = 'save_result';
    log.info({ step: 'save_result' }, 'Result saved');

    log.info({ step: 'complete', duration: Date.now() - t0Total }, 'Worker complete');
  } catch (err) {
    log.error(
      {
        step: 'error',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        lastStep,
        duration: Date.now() - t0Total,
        errorCategory: 'unknown',
        errorRetryable: true,
        userMessage: 'AI analysis failed. Please try again.',
      },
      'Worker failed',
    );
    try {
      await updateStatus(analysisId, 'failed', {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      });
    } catch (updateErr) {
      log.error(
        {
          step: 'error',
          error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          stack: updateErr instanceof Error ? updateErr.stack : undefined,
          errorCategory: 'save_failed',
          errorRetryable: true,
          userMessage: 'AI analysis failed. Please try again.',
        },
        'Failed to update status to failed',
      );
    }
  }
}
