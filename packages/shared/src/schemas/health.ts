import { z } from 'zod';

/**
 * Health check response schema.
 * Used by the API health endpoint and verified in contract tests.
 */
export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string().datetime(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
