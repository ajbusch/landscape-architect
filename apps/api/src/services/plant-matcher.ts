import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  PlantSchema,
  type Plant,
  type PlantRecommendation,
  type AiAnalysisOutput,
} from '@landscape-architect/shared';
import { docClient, TABLE_NAME } from '../db.js';

const MAX_RECOMMENDATIONS = 10;

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

/**
 * Query DynamoDB for plants matching type + light, optionally filtered by zone.
 */
async function findPlantsByTypeAndLight(
  type: string,
  light: string,
  zone: string | null,
): Promise<Plant[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `PLANT_TYPE#${type}` },
    }),
  );

  const plants = (result.Items ?? [])
    .map((item) => {
      const parsed = PlantSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((p): p is Plant => p !== null);

  // Filter by light, and by zone if available
  return plants.filter(
    (p) =>
      p.light.includes(light as Plant['light'][number]) &&
      (zone === null || isZoneInRange(zone, p.zoneMin, p.zoneMax)),
  );
}

/**
 * Get popular/fallback plants for a zone (top plants regardless of type/light).
 */
async function getPopularPlantsForZone(zone: string): Promise<Plant[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `ZONE#${zone}` },
    }),
  );

  return (result.Items ?? [])
    .map((item) => {
      const parsed = PlantSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((p): p is Plant => p !== null);
}

function plantToRecommendation(
  plant: Plant,
  reason: string,
  category: PlantRecommendation['category'],
  light: PlantRecommendation['light'],
): PlantRecommendation {
  return {
    plantId: plant.id,
    commonName: plant.commonName,
    scientificName: plant.scientificName,
    photoUrl: plant.photoUrl,
    reason,
    category,
    light,
    waterNeeds: plant.waterNeeds,
    matureSize: {
      heightFt: { min: plant.matureHeightFtMin, max: plant.matureHeightFtMax },
      widthFt: { min: plant.matureWidthFtMin, max: plant.matureWidthFtMax },
    },
    hardinessZones: { min: plant.zoneMin, max: plant.zoneMax },
    bloomSeason: plant.bloomSeason,
    costRange: plant.costRange,
    difficulty: plant.difficulty,
  };
}

/**
 * Match AI-recommended plant types to real plants from the database.
 * Returns PlantRecommendation[] with up to 2 matches per recommendation.
 * Falls back to popular zone plants if no matches found.
 */
export async function matchPlants(
  aiOutput: AiAnalysisOutput,
  zone: string | null,
): Promise<PlantRecommendation[]> {
  const recommendations: PlantRecommendation[] = [];
  const usedPlantIds = new Set<string>();

  for (const rec of aiOutput.recommendedPlantTypes) {
    const candidates = await findPlantsByTypeAndLight(
      rec.searchCriteria.type,
      rec.searchCriteria.light,
      zone,
    );

    // Prefer plants with matching tags
    const withTagScore = candidates.map((plant) => {
      const tagScore = rec.searchCriteria.tags
        ? rec.searchCriteria.tags.filter((tag) =>
            plant.tags.some((pt) => pt.toLowerCase().includes(tag.toLowerCase())),
          ).length
        : 0;
      return { plant, tagScore };
    });

    // Sort by tag match score (descending), then filter out already-used plants
    withTagScore.sort((a, b) => b.tagScore - a.tagScore);
    const available = withTagScore.filter((c) => !usedPlantIds.has(c.plant.id));

    // Pick top 2
    const picks = available.slice(0, 2);
    for (const pick of picks) {
      usedPlantIds.add(pick.plant.id);
      recommendations.push(
        plantToRecommendation(pick.plant, rec.reason, rec.category, rec.lightRequirement),
      );
    }
  }

  // If no recommendations at all and zone is available, fall back to popular plants for the zone
  if (recommendations.length === 0 && zone !== null) {
    const fallback = await getPopularPlantsForZone(zone);
    const topFallback = fallback.slice(0, 5);
    for (const plant of topFallback) {
      if (!usedPlantIds.has(plant.id)) {
        usedPlantIds.add(plant.id);
        recommendations.push(
          plantToRecommendation(
            plant,
            `Popular plant for your hardiness zone`,
            'quick_win',
            plant.light[0] ?? 'full_sun',
          ),
        );
      }
    }
  }

  // Cap at 10 to match AnalysisResultSchema.recommendations.max(10)
  return recommendations.slice(0, MAX_RECOMMENDATIONS);
}
