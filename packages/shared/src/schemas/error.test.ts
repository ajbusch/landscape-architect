import { describe, it, expect } from 'vitest';
import { ErrorResponseSchema, ValidationErrorResponseSchema } from '../schemas/error.js';

describe('ErrorResponseSchema', () => {
  it('accepts a valid error response', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Unsupported content type',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a 500 error response', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
    expect(result.success).toBe(true);
  });

  it('rejects statusCode below 400', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 200,
      error: 'OK',
      message: 'Not an error',
    });
    expect(result.success).toBe(false);
  });

  it('rejects statusCode above 599', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 600,
      error: 'Unknown',
      message: 'Out of range',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = ErrorResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty error string', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 400,
      error: '',
      message: 'Something failed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty message string', () => {
    const result = ErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'Bad Request',
      message: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('ValidationErrorResponseSchema', () => {
  it('accepts a valid validation error with details', () => {
    const result = ValidationErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: [{ path: ['photoKey'], message: 'Required' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty details array', () => {
    const result = ValidationErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects when details is missing', () => {
    const result = ValidationErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when details is not an array', () => {
    const result = ValidationErrorResponseSchema.safeParse({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: 'not an array',
    });
    expect(result.success).toBe(false);
  });
});
