import type { FastifyInstance } from 'fastify';
import { HEALTH_STATUS, type HealthResponse } from '@landscape-architect/shared';

const APP_VERSION = process.env.APP_VERSION ?? '0.0.1';

export function healthRoute(app: FastifyInstance): void {
  app.get('/health', (): HealthResponse => {
    return {
      status: HEALTH_STATUS.HEALTHY,
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
    };
  });
}
