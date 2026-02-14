import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

// Mock the zone-lookup service
vi.mock('../../src/services/zone-lookup.js', () => ({
  getZoneByZip: vi.fn(),
}));

import { getZoneByZip } from '../../src/services/zone-lookup.js';
import type { Mock } from 'vitest';
const mockGetZoneByZip = getZoneByZip as unknown as Mock;

// Also mock db since plants route needs it
vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

const sampleZoneResponse = {
  zipCode: '10001',
  zone: '7b',
  zoneNumber: 7,
  zoneLetter: 'b',
  minTempF: 5,
  maxTempF: 10,
  description: 'USDA Hardiness Zone 7b (5°F to 10°F)',
};

describe('Zone routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/zones/:zip', () => {
    it('returns zone data for a valid ZIP code', async () => {
      mockGetZoneByZip.mockReturnValueOnce(sampleZoneResponse);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/10001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.zipCode).toBe('10001');
      expect(body.zone).toBe('7b');
      expect(body.zoneNumber).toBe(7);
      expect(body.zoneLetter).toBe('b');
      expect(body.minTempF).toBe(5);
      expect(body.maxTempF).toBe(10);
      expect(body.description).toContain('7b');
    });

    it('calls getZoneByZip with the ZIP param', async () => {
      mockGetZoneByZip.mockReturnValueOnce(sampleZoneResponse);

      await app.inject({
        method: 'GET',
        url: '/api/v1/zones/10001',
      });

      expect(mockGetZoneByZip).toHaveBeenCalledWith('10001');
    });

    it('returns 404 when ZIP code is not found', async () => {
      mockGetZoneByZip.mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/00000',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Zone not found for ZIP code');
    });

    it('returns 400 for invalid ZIP code format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/abc',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid ZIP code');
    });

    it('returns 400 for ZIP code that is too short', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/123',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for ZIP code that is too long', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/123456',
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts ZIP+4 format', async () => {
      mockGetZoneByZip.mockReturnValueOnce({
        ...sampleZoneResponse,
        zipCode: '10001-1234',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/10001-1234',
      });

      expect(response.statusCode).toBe(200);
      expect(mockGetZoneByZip).toHaveBeenCalledWith('10001-1234');
    });
  });
});
