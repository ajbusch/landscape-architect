import {
  ZoneResponseSchema,
  AnalysisResponseSchema,
  PlantSearchResponseSchema,
  PlantSchema,
} from '@landscape-architect/shared';
import type {
  ZoneResponse,
  AnalysisResponse,
  PlantSearchResponse,
  Plant,
} from '@landscape-architect/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function extractErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return (body.error as string | undefined) ?? res.statusText;
}

export async function lookupZone(zip: string): Promise<ZoneResponse> {
  const res = await fetch(`${BASE_URL}/zones/${encodeURIComponent(zip)}`);
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  const data: unknown = await res.json();
  return ZoneResponseSchema.parse(data);
}

export async function submitAnalysis(photo: File, zipCode: string): Promise<AnalysisResponse> {
  // Step 1: Get a presigned S3 upload URL
  const contentType = photo.type || 'image/jpeg';
  const uploadRes = await fetch(`${BASE_URL}/analyses/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType }),
  });

  if (!uploadRes.ok) {
    const message = await extractErrorMessage(uploadRes);
    throw new ApiError(uploadRes.status, message || 'Failed to get upload URL.');
  }

  const { uploadUrl, s3Key, analysisId } = (await uploadRes.json()) as {
    uploadUrl: string;
    s3Key: string;
    analysisId: string;
  };

  // Step 2: Upload photo directly to S3
  const s3Res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-server-side-encryption': 'AES256',
    },
    body: photo,
  });

  if (!s3Res.ok) {
    throw new ApiError(s3Res.status, 'Failed to upload photo. Please try again.');
  }

  // Step 3: Submit analysis with the S3 key
  const res = await fetch(`${BASE_URL}/analyses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s3Key, analysisId, address: { zipCode } }),
  });

  if (!res.ok) {
    const message = await extractErrorMessage(res);
    switch (res.status) {
      case 422:
        throw new ApiError(422, 'This photo does not appear to be a yard or landscape.');
      case 429:
        throw new ApiError(429, 'Too many requests. Please wait a moment and try again.');
      case 504:
        throw new ApiError(504, 'The analysis is taking too long. Please try again.');
      default:
        throw new ApiError(res.status, message || 'Something went wrong. Please try again.');
    }
  }
  const data: unknown = await res.json();
  return AnalysisResponseSchema.parse(data);
}

export async function fetchAnalysis(id: string): Promise<AnalysisResponse> {
  const res = await fetch(`${BASE_URL}/analyses/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  const data: unknown = await res.json();
  return AnalysisResponseSchema.parse(data);
}

export async function searchPlants(params: Record<string, string>): Promise<PlantSearchResponse> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}/plants${query ? `?${query}` : ''}`);
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  const data: unknown = await res.json();
  return PlantSearchResponseSchema.parse(data);
}

export async function fetchPlant(id: string): Promise<Plant> {
  const res = await fetch(`${BASE_URL}/plants/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  const data: unknown = await res.json();
  return PlantSchema.parse(data);
}
