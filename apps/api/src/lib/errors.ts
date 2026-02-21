import { STATUS_CODES } from 'node:http';
import type { FastifyReply } from 'fastify';

/**
 * Send a standardised error response: { statusCode, error, message }.
 */
export function sendError(reply: FastifyReply, statusCode: number, message: string): FastifyReply {
  return reply.status(statusCode).send({
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Unknown Error',
    message,
  });
}

/**
 * Send a 400 validation error with Zod issue details.
 */
export function sendValidationError(reply: FastifyReply, issues: readonly unknown[]): FastifyReply {
  return reply.status(400).send({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    details: issues,
  });
}
