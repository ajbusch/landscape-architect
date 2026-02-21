import { z } from 'zod';

/**
 * Standard API error response schema (matches Fastify convention).
 */
export const ErrorResponseSchema = z.object({
  statusCode: z.number().int().min(400).max(599),
  error: z.string().min(1),
  message: z.string().min(1),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Validation error response — extends the base with a details array for field-level issues.
 */
export const ValidationErrorResponseSchema = ErrorResponseSchema.extend({
  details: z.array(z.record(z.string(), z.unknown())),
});

export type ValidationErrorResponse = z.infer<typeof ValidationErrorResponseSchema>;
