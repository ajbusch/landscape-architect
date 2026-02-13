import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@landscape-architect/shared';

const APP_VERSION = process.env['APP_VERSION'] ?? '0.0.1';

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
    };
  });
}
