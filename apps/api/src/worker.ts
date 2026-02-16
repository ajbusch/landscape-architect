import { randomUUID } from 'node:crypto';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

interface WorkerEvent {
  analysisId: string;
  photoKey: string;
  zipCode: string;
  zone: string;
  zoneDescription: string;
}

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

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

export async function handler(event: WorkerEvent): Promise<void> {
  const { analysisId, photoKey, zipCode, zone, zoneDescription } = event;

  try {
    // ── 1. Update status to "analyzing" ─────────────────────────────
    await updateStatus(analysisId, 'analyzing');

    // ── 2. Download photo from S3 ───────────────────────────────────
    let photoBuffer: Buffer;
    try {
      photoBuffer = await downloadPhoto(photoKey);
    } catch (err) {
      console.error('Failed to download photo from S3', err);
      await updateStatus(analysisId, 'failed', { error: 'Unable to retrieve photo' });
      return;
    }

    // ── 3. Validate and resize with Sharp ───────────────────────────
    const validation = validatePhoto(photoBuffer);
    if (!validation.valid) {
      await updateStatus(analysisId, 'failed', { error: 'Unable to process image' });
      return;
    }

    let aiPhotoBuffer = photoBuffer;
    let aiMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg';

    if (validation.type === 'heic') {
      try {
        aiPhotoBuffer = await convertHeicToJpeg(photoBuffer);
        aiMediaType = 'image/jpeg';
      } catch (err) {
        console.error('HEIC conversion failed', err);
        await updateStatus(analysisId, 'failed', { error: 'Unable to process image' });
        return;
      }
    } else if (validation.type === 'png') {
      aiMediaType = 'image/png';
    }

    aiPhotoBuffer = await resizeForApi(aiPhotoBuffer, aiMediaType);

    // ── 4. Base64 encode ────────────────────────────────────────────
    const base64Photo = aiPhotoBuffer.toString('base64');

    // ── 5. Call Claude Vision API ───────────────────────────────────
    const aiResult = await analyzeYardPhoto(base64Photo, aiMediaType, zone, zoneDescription);

    if (!aiResult.ok) {
      const { error } = aiResult;
      switch (error.type) {
        case 'timeout':
          await updateStatus(analysisId, 'failed', {
            error: 'Analysis timed out. Please try again.',
          });
          return;
        case 'rate_limit':
          await updateStatus(analysisId, 'failed', {
            error: 'Service is busy. Please try again.',
          });
          return;
        default:
          await updateStatus(analysisId, 'failed', {
            error: 'AI analysis failed. Please try again.',
          });
          return;
      }
    }

    // ── 6. Handle invalid yard photo ────────────────────────────────
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
      return;
    }

    // ── 7. Update status to "matching" ──────────────────────────────
    await updateStatus(analysisId, 'matching');

    // ── 8. Match plant types to real plants ─────────────────────────
    const recommendations = await matchPlants(aiResult.data, zone);

    // ── 9. Assemble features with IDs ───────────────────────────────
    const features: IdentifiedFeature[] = aiResult.data.features.map((f) => ({
      ...f,
      id: randomUUID(),
    }));

    // ── 10. Generate pre-signed URL ─────────────────────────────────
    const photoUrl = await getPhotoPresignedUrl(photoKey);

    // ── 11. Assemble response ───────────────────────────────────────
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

    // ── 12. Save complete result ────────────────────────────────────
    await updateStatus(analysisId, 'complete', { result: analysisResponse });
  } catch (err) {
    console.error('Worker unhandled error', err);
    try {
      await updateStatus(analysisId, 'failed', {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      });
    } catch (updateErr) {
      console.error('Failed to update status to failed', updateErr);
    }
  }
}
