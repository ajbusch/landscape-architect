import { createRequire } from 'node:module';
import type { ZoneResponse } from '@landscape-architect/shared';

const require = createRequire(import.meta.url);

interface ZipZoneEntry {
  zone: string;
  temperature_range: string;
}

type ZipZoneMap = Record<string, ZipZoneEntry>;

let zipZoneData: ZipZoneMap | null = null;

function loadData(): ZipZoneMap {
  zipZoneData ??= require('../data/zip-zones.json') as ZipZoneMap;
  return zipZoneData;
}

/** USDA zone temperature ranges (minimum average annual extreme temperature in °F). */
const ZONE_TEMP_RANGES: Record<string, { minTempF: number; maxTempF: number }> = {
  '1a': { minTempF: -60, maxTempF: -55 },
  '1b': { minTempF: -55, maxTempF: -50 },
  '2a': { minTempF: -50, maxTempF: -45 },
  '2b': { minTempF: -45, maxTempF: -40 },
  '3a': { minTempF: -40, maxTempF: -35 },
  '3b': { minTempF: -35, maxTempF: -30 },
  '4a': { minTempF: -30, maxTempF: -25 },
  '4b': { minTempF: -25, maxTempF: -20 },
  '5a': { minTempF: -20, maxTempF: -15 },
  '5b': { minTempF: -15, maxTempF: -10 },
  '6a': { minTempF: -10, maxTempF: -5 },
  '6b': { minTempF: -5, maxTempF: 0 },
  '7a': { minTempF: 0, maxTempF: 5 },
  '7b': { minTempF: 5, maxTempF: 10 },
  '8a': { minTempF: 10, maxTempF: 15 },
  '8b': { minTempF: 15, maxTempF: 20 },
  '9a': { minTempF: 20, maxTempF: 25 },
  '9b': { minTempF: 25, maxTempF: 30 },
  '10a': { minTempF: 30, maxTempF: 35 },
  '10b': { minTempF: 35, maxTempF: 40 },
  '11a': { minTempF: 40, maxTempF: 45 },
  '11b': { minTempF: 45, maxTempF: 50 },
  '12a': { minTempF: 50, maxTempF: 55 },
  '12b': { minTempF: 55, maxTempF: 60 },
  '13a': { minTempF: 60, maxTempF: 65 },
  '13b': { minTempF: 65, maxTempF: 70 },
};

export function getZoneByZip(zip: string): ZoneResponse | null {
  const data = loadData();
  const entry = data[zip];
  if (!entry) return null;

  const zone = entry.zone;
  const match = /^(\d+)([ab])$/.exec(zone);
  if (!match) return null;

  const numStr = match[1];
  const letterStr = match[2];
  if (!numStr || !letterStr) return null;

  const zoneNumber = parseInt(numStr, 10);
  const zoneLetter = letterStr as 'a' | 'b';
  const temps = ZONE_TEMP_RANGES[zone];
  if (!temps) return null;

  return {
    zipCode: zip,
    zone,
    zoneNumber,
    zoneLetter,
    minTempF: temps.minTempF,
    maxTempF: temps.maxTempF,
    description: `USDA Hardiness Zone ${zone} (${String(temps.minTempF)}°F to ${String(temps.maxTempF)}°F)`,
  };
}
