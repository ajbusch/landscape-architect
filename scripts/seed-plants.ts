#!/usr/bin/env npx tsx
/**
 * Seed script for the plant database.
 * Reads from data/plants-seed.json, validates against PlantSchema,
 * and writes to DynamoDB using BatchWriteItem.
 *
 * Idempotent: uses PutItem which overwrites existing items with the same key.
 *
 * Usage: npx tsx scripts/seed-plants.ts [--table-name <name>]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  type BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { PlantSchema } from '@landscape-architect/shared';
import type { Plant } from '@landscape-architect/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseZone(zone: string): number {
  const match = zone.match(/^(\d+)([ab])$/);
  if (!match) throw new Error(`Invalid zone: ${zone}`);
  const num = parseInt(match[1]!, 10);
  const letter = match[2]!;
  return num * 2 + (letter === 'b' ? 1 : 0);
}

function getZonesInRange(min: string, max: string): string[] {
  const minVal = parseZone(min);
  const maxVal = parseZone(max);
  const zones: string[] = [];
  for (let v = minVal; v <= maxVal; v++) {
    const num = Math.floor(v / 2);
    const letter = v % 2 === 0 ? 'a' : 'b';
    zones.push(`${num}${letter}`);
  }
  return zones;
}

function buildDynamoItems(plant: Plant): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const plantData = { ...plant, entityType: 'PLANT' };

  // Primary item: get plant by ID
  items.push({
    PK: `PLANT#${plant.id}`,
    SK: `PLANT#${plant.id}`,
    GSI1PK: 'PLANT_NAME',
    GSI1SK: `${plant.commonName.toLowerCase()}#${plant.id}`,
    ...plantData,
  });

  // Plant by type
  items.push({
    PK: `PLANT_TYPE#${plant.type}`,
    SK: `PLANT#${plant.id}`,
    ...plantData,
  });

  // Plant by zone — one item per zone in range
  const zones = getZonesInRange(plant.zoneMin, plant.zoneMax);
  for (const zone of zones) {
    items.push({
      PK: `ZONE#${zone}`,
      SK: `PLANT#${plant.id}`,
      ...plantData,
    });
  }

  return items;
}

async function main(): Promise<void> {
  const tableNameArg = process.argv.indexOf('--table-name');
  const tableName =
    tableNameArg !== -1
      ? process.argv[tableNameArg + 1]
      : (process.env.TABLE_NAME ?? 'LandscapeArchitect-Database-dev');

  if (!tableName) {
    console.error('Usage: npx tsx scripts/seed-plants.ts [--table-name <name>]');
    process.exit(1);
  }

  // Read and validate seed data
  const seedPath = resolve(__dirname, '..', 'data', 'plants-seed.json');
  const rawData: unknown = JSON.parse(readFileSync(seedPath, 'utf-8'));

  if (!Array.isArray(rawData)) {
    console.error('Seed data must be an array');
    process.exit(1);
  }

  const plants: Plant[] = [];
  for (let i = 0; i < rawData.length; i++) {
    const result = PlantSchema.safeParse(rawData[i]);
    if (!result.success) {
      console.error(`Validation failed for plant at index ${i}:`, result.error.issues);
      process.exit(1);
    }
    plants.push(result.data);
  }

  console.log(`Validated ${plants.length} plants`);

  // Build all DynamoDB items
  const allItems = plants.flatMap(buildDynamoItems);
  console.log(`Writing ${allItems.length} items to table "${tableName}"`);

  // Write in batches of 25 (DynamoDB limit)
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  for (let i = 0; i < allItems.length; i += 25) {
    const batch = allItems.slice(i, i + 25);
    const params: BatchWriteCommandInput = {
      RequestItems: {
        [tableName]: batch.map((item) => ({
          PutRequest: { Item: item },
        })),
      },
    };

    await docClient.send(new BatchWriteCommand(params));
    console.log(`  Wrote batch ${Math.floor(i / 25) + 1} (${batch.length} items)`);
  }

  console.log('Seed complete');
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
