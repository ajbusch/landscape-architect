import type { FastifyInstance } from 'fastify';
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  PlantSchema,
  PlantSearchParamsSchema,
  type Plant,
  type PlantSearchResponse,
} from '@landscape-architect/shared';
import { docClient, TABLE_NAME } from '../db.js';

function parseZone(zone: string): number {
  const match = /^(\d+)([ab])$/.exec(zone);
  if (!match) throw new Error(`Invalid zone: ${zone}`);
  const num = parseInt(match[1] ?? '', 10);
  const letter = match[2] ?? 'a';
  return num * 2 + (letter === 'b' ? 1 : 0);
}

function isZoneInRange(zone: string, min: string, max: string): boolean {
  const zoneVal = parseZone(zone);
  return zoneVal >= parseZone(min) && zoneVal <= parseZone(max);
}

function coerceBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function plantsRoute(app: FastifyInstance): void {
  app.get('/api/v1/plants', async (request, reply) => {
    const raw = request.query as Record<string, string | undefined>;
    const parseResult = PlantSearchParamsSchema.safeParse({
      query: raw.query,
      zone: raw.zone,
      light: raw.light,
      waterNeeds: raw.waterNeeds,
      type: raw.type,
      difficulty: raw.difficulty,
      deerResistant: coerceBoolean(raw.deerResistant),
      droughtTolerant: coerceBoolean(raw.droughtTolerant),
      isNative: coerceBoolean(raw.isNative),
      page: raw.page ? parseInt(raw.page, 10) : undefined,
      limit: raw.limit ? parseInt(raw.limit, 10) : undefined,
    });

    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ error: 'Invalid query parameters', details: parseResult.error.issues });
    }

    const params = parseResult.data;
    let plants: Plant[];

    if (params.type) {
      // Query by type
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `PLANT_TYPE#${params.type}` },
        }),
      );
      plants = (result.Items ?? []).map((item) => PlantSchema.parse(item));
    } else if (params.zone && !params.query) {
      // Query by zone
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `ZONE#${params.zone}` },
        }),
      );
      plants = (result.Items ?? []).map((item) => PlantSchema.parse(item));
    } else if (params.query) {
      // Search by name using GSI1
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'PLANT_NAME',
            ':sk': params.query.toLowerCase(),
          },
        }),
      );
      plants = (result.Items ?? []).map((item) => PlantSchema.parse(item));
    } else {
      // Scan all plants (primary items only)
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'PLANT_NAME' },
        }),
      );
      plants = (result.Items ?? []).map((item) => PlantSchema.parse(item));
    }

    // Apply remaining filters in memory
    if (params.zone) {
      const zone = params.zone;
      plants = plants.filter((p) => isZoneInRange(zone, p.zoneMin, p.zoneMax));
    }
    if (params.light) {
      const light = params.light;
      plants = plants.filter((p) => p.light.includes(light));
    }
    if (params.waterNeeds) {
      plants = plants.filter((p) => p.waterNeeds === params.waterNeeds);
    }
    if (params.difficulty) {
      plants = plants.filter((p) => p.difficulty === params.difficulty);
    }
    if (params.deerResistant !== undefined) {
      plants = plants.filter((p) => p.deerResistant === params.deerResistant);
    }
    if (params.droughtTolerant !== undefined) {
      plants = plants.filter((p) => p.droughtTolerant === params.droughtTolerant);
    }
    if (params.isNative !== undefined) {
      plants = plants.filter((p) => p.isNative === params.isNative);
    }

    const total = plants.length;
    const page = params.page;
    const limit = params.limit;
    const totalPages = Math.ceil(total / limit) || 0;
    const start = (page - 1) * limit;
    const paged = plants.slice(start, start + limit);

    const response: PlantSearchResponse = {
      plants: paged,
      total,
      page,
      limit,
      totalPages,
    };

    return reply.send(response);
  });

  app.get<{ Params: { id: string } }>('/api/v1/plants/:id', async (request, reply) => {
    const { id } = request.params;

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `PLANT#${id}`, SK: `PLANT#${id}` },
      }),
    );

    if (!result.Item) {
      return reply.status(404).send({ error: 'Plant not found' });
    }

    const plant = PlantSchema.parse(result.Item);
    return reply.send(plant);
  });
}
