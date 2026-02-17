#!/usr/bin/env tsx
/**
 * Smoke test: exercises the full async analysis flow against a live environment.
 *
 * Usage:
 *   pnpm test:smoke                                          # against dev (default)
 *   BASE_URL=https://staging.landscaper.cloud pnpm test:smoke # against staging
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = (process.env['BASE_URL'] ?? 'https://dev.landscaper.cloud').replace(/\/$/, '');
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 120_000;
const FIXTURE_PATH = resolve(__dirname, 'fixtures/test-yard.jpg');

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  log(`Smoke test starting against ${BASE_URL}`);

  // ── 1. Read test fixture ──────────────────────────────────────────
  const imageBuffer = readFileSync(FIXTURE_PATH);
  log(`Loaded test fixture (${imageBuffer.byteLength} bytes)`);

  // ── 2. Get presigned upload URL ───────────────────────────────────
  const { uploadUrl, s3Key } = await fetchJson<{
    uploadUrl: string;
    s3Key: string;
    analysisId: string;
  }>(`${BASE_URL}/api/v1/analyses/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'image/jpeg' }),
  });
  log(`Got presigned URL for key: ${s3Key}`);

  // ── 3. Upload image to S3 ────────────────────────────────────────
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', 'x-amz-server-side-encryption': 'AES256' },
    body: imageBuffer,
  });
  if (!putRes.ok) {
    throw new Error(`S3 PUT failed: ${putRes.status} ${await putRes.text()}`);
  }
  log('Uploaded image to S3');

  // ── 4. Submit analysis ────────────────────────────────────────────
  const { id, status: initialStatus } = await fetchJson<{ id: string; status: string }>(
    `${BASE_URL}/api/v1/analyses`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoKey: s3Key, zipCode: '22903' }),
    },
  );
  log(`Analysis created: id=${id}, status=${initialStatus}`);

  // ── 5. Poll for completion ────────────────────────────────────────
  const startTime = Date.now();
  let lastStatus = initialStatus;

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const analysis = await fetchJson<{
      id: string;
      status: string;
      error?: string;
      result?: { result: { summary: string; recommendations: unknown[] } };
    }>(`${BASE_URL}/api/v1/analyses/${id}`);

    if (analysis.status !== lastStatus) {
      log(`Status: ${lastStatus} → ${analysis.status}`);
      lastStatus = analysis.status;
    }

    if (analysis.status === 'complete') {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log(`Analysis complete in ${elapsed}s`);
      if (analysis.result?.result) {
        log(`Summary: ${analysis.result.result.summary.slice(0, 120)}...`);
        log(
          `Recommendations: ${Array.isArray(analysis.result.result.recommendations) ? analysis.result.result.recommendations.length : 0}`,
        );
      }
      process.exit(0);
    }

    if (analysis.status === 'failed') {
      log(`Analysis FAILED: ${analysis.error ?? 'unknown error'}`);
      process.exit(1);
    }
  }

  log(`TIMEOUT: analysis still "${lastStatus}" after ${TIMEOUT_MS / 1000}s`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
