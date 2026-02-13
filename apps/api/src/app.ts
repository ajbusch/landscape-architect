import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';

export interface AppOptions {
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  await app.register(cors);

  // Routes
  await app.register(healthRoute);

  return app;
}
