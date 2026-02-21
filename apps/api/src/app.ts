import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import { healthRoute } from './routes/health.js';
import { plantsRoute } from './routes/plants.js';
import { analysesRoute } from './routes/analyses.js';
import { logger } from './lib/logger.js';

const CORS_ORIGINS: Record<string, string[]> = {
  dev: ['https://dev.landscaper.cloud', 'http://localhost:5173'],
  staging: ['https://staging.landscaper.cloud'],
  prod: ['https://landscaper.cloud', 'https://d5hj1rpwk1mpl.cloudfront.net'],
};

export interface AppOptions {
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const useLogger = options.logger ?? true;
  const app = Fastify({
    ...(useLogger ? { loggerInstance: logger as unknown as FastifyBaseLogger } : { logger: false }),
    bodyLimit: 10 * 1024 * 1024, // 10MB — matches API Gateway HTTP API hard limit
  });

  const stage = process.env.STAGE ?? 'dev';
  await app.register(cors, {
    origin: CORS_ORIGINS[stage] ?? CORS_ORIGINS.dev,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  });

  // Origin-verify hook — blocks direct API Gateway access bypassing CloudFront.
  // Registered after CORS plugin so 403 responses include CORS headers.
  // Only active when ORIGIN_VERIFY_SECRET is set (deployed Lambda, not local dev/tests).
  const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;
  if (originVerifySecret) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url === '/health') return;
      if (request.headers['x-origin-verify'] !== originVerifySecret) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    });
  }

  // Routes
  await app.register(healthRoute);
  await app.register(plantsRoute);
  await app.register(analysesRoute);

  return app;
}
