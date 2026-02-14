import type { ZoneResponse, AnalysisResponse } from '@landscape-architect/shared';

export async function lookupZone(zip: string): Promise<ZoneResponse> {
  const res = await fetch(`/api/v1/zones/${encodeURIComponent(zip)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, (body.error as string | undefined) ?? res.statusText);
  }
  return res.json() as Promise<ZoneResponse>;
}

export async function submitAnalysis(photo: File, zipCode: string): Promise<AnalysisResponse> {
  const formData = new FormData();
  formData.append('photo', photo);
  formData.append('zipCode', zipCode);

  const res = await fetch('/api/v1/analyses', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, (body.error as string | undefined) ?? res.statusText);
  }
  return res.json() as Promise<AnalysisResponse>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
