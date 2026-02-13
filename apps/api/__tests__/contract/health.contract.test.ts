import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { HealthResponseSchema } from '@landscape-architect/shared';
import type { FastifyInstance } from 'fastify';

describe('Contract: Health endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health response conforms to HealthResponseSchema', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    const result = HealthResponseSchema.safeParse(body);

    if (!result.success) {
      // Print detailed errors if schema validation fails
      console.error('Schema validation errors:', JSON.stringify(result.error.issues, null, 2));
    }

    expect(result.success).toBe(true);
  });
});
