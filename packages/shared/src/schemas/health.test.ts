import { describe, it, expect } from 'vitest';
import { HealthResponseSchema } from '../schemas/health.js';
import { HEALTH_STATUS } from '../constants/index.js';

describe('HealthResponseSchema', () => {
  it('accepts a valid healthy response', () => {
    const result = HealthResponseSchema.safeParse({
      status: HEALTH_STATUS.HEALTHY,
      timestamp: '2025-01-01T00:00:00Z',
      version: '0.0.1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts degraded status', () => {
    const result = HealthResponseSchema.safeParse({
      status: HEALTH_STATUS.DEGRADED,
      timestamp: '2025-06-15T12:30:00Z',
      version: '1.2.3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status value', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'unknown',
      timestamp: '2025-01-01T00:00:00Z',
      version: '0.0.1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamp format', () => {
    const result = HealthResponseSchema.safeParse({
      status: HEALTH_STATUS.HEALTHY,
      timestamp: 'not-a-date',
      version: '0.0.1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty version string', () => {
    const result = HealthResponseSchema.safeParse({
      status: HEALTH_STATUS.HEALTHY,
      timestamp: '2025-01-01T00:00:00Z',
      version: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = HealthResponseSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('status');
      expect(paths).toContain('timestamp');
      expect(paths).toContain('version');
    }
  });
});
