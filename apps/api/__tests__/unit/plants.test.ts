import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

// Mock the db module
vi.mock('../../src/db.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'test-table',
}));

// Import the mocked module
import { docClient } from '../../src/db.js';
import type { Mock } from 'vitest';
const mockSend = docClient.send as unknown as Mock;

const samplePlant = {
  id: '55efd08d-b675-4cb2-a271-ecd2b7003516',
  commonName: 'Test Plant',
  scientificName: 'Testus plantus',
  description: 'A test plant',
  light: ['full_sun'],
  waterNeeds: 'moderate',
  soilTypes: ['loamy'],
  matureHeightFtMin: 5,
  matureHeightFtMax: 10,
  matureWidthFtMin: 3,
  matureWidthFtMax: 6,
  zoneMin: '5a',
  zoneMax: '8b',
  type: 'perennial',
  bloomSeason: 'summer',
  isNative: true,
  isInvasive: false,
  deerResistant: false,
  droughtTolerant: false,
  costRange: 'low',
  difficulty: 'beginner',
  tags: ['test'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Plant routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('GET /api/v1/plants', () => {
    it('returns paginated list of plants', async () => {
      mockSend.mockResolvedValueOnce({ Items: [samplePlant] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.plants).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.totalPages).toBe(1);
    });

    it('returns empty list when no plants match', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants?type=tree',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.plants).toHaveLength(0);
      expect(body.total).toBe(0);
      expect(body.totalPages).toBe(0);
    });

    it('filters by type using DynamoDB query', async () => {
      mockSend.mockResolvedValueOnce({ Items: [samplePlant] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants?type=perennial',
      });

      expect(response.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('filters by zone', async () => {
      mockSend.mockResolvedValueOnce({ Items: [samplePlant] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants?zone=6a',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.plants).toHaveLength(1);
    });

    it('filters out plants outside zone range', async () => {
      mockSend.mockResolvedValueOnce({ Items: [samplePlant] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants?zone=3a',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // samplePlant is zones 5a-8b, so 3a should filter it out
      expect(body.plants).toHaveLength(0);
    });

    it('returns 400 for invalid query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants?zone=invalid',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/plants/:id', () => {
    it('returns a plant by ID', async () => {
      mockSend.mockResolvedValueOnce({ Item: samplePlant });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants/55efd08d-b675-4cb2-a271-ecd2b7003516',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('55efd08d-b675-4cb2-a271-ecd2b7003516');
      expect(body.commonName).toBe('Test Plant');
    });

    it('returns 404 for non-existent plant', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plants/97a410a1-3c38-48d4-8e94-59e5366fb34b',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
