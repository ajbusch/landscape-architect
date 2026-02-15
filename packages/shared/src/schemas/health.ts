import { z } from 'zod';
import { HEALTH_STATUS } from '../constants/index.js';

const healthStatuses = Object.values(HEALTH_STATUS) as [string, ...string[]];

/**
 * Health check response schema.
 * Used by the API health endpoint and verified in contract tests.
 */
export const HealthResponseSchema = z.object({
  status: z.enum(healthStatuses),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
