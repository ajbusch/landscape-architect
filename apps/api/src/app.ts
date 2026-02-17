import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import { plantsRoute } from './routes/plants.js';
import { zonesRoute } from './routes/zones.js';
import { analysesRoute } from './routes/analyses.js';
import { logger } from './lib/logger.js';

export interface AppOptions {
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const useLogger = options.logger ?? true;
  const app = Fastify({
    ...(useLogger
      ? { loggerInstance: logger as unknown as FastifyBaseLogger }
      : { logger: false }),
    bodyLimit: 10 * 1024 * 1024, // 10MB — matches API Gateway HTTP API hard limit
  });

  await app.register(cors);

  // Routes
  await app.register(healthRoute);
  await app.register(plantsRoute);
  await app.register(zonesRoute);
  await app.register(analysesRoute);

  return app;
}
