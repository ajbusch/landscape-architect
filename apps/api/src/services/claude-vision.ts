import Anthropic from '@anthropic-ai/sdk';
import type { AiAnalysisOutput } from '@landscape-architect/shared';
import { AiAnalysisOutputSchema } from '@landscape-architect/shared';
import { getAnthropicApiKey } from './secrets.js';

let clientInstance: Anthropic | null = null;

async function getClient(): Promise<Anthropic> {
  if (clientInstance) return clientInstance;
  const apiKey = await getAnthropicApiKey();
  clientInstance = new Anthropic({ apiKey });
  return clientInstance;
}

/** Reset client — used in tests. */
export function _resetClient(): void {
  clientInstance = null;
}

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514';
const CLAUDE_TIMEOUT = 25_000; // 25 seconds (leaves headroom for S3 download + API Gateway 30s limit)

const SYSTEM_PROMPT = `You are an expert landscape architect and horticulturist analyzing a homeowner's yard photo. You provide actionable, specific analysis with plant recommendations tailored to the user's local climate and growing conditions.

Respond ONLY with valid JSON matching the schema below. No markdown, no preamble, no explanation outside the JSON.

{
  "summary": "2-3 sentence description of the yard",
  "yardSize": "small | medium | large",
  "overallSunExposure": "full_sun | partial_shade | full_shade",
  "estimatedSoilType": "clay | sandy | loamy | silty | rocky | unknown",
  "climate": {
    "usdaZone": "USDA zone as number + letter, e.g., '7b', '10a'. Omit if uncertain or not applicable.",
    "description": "1-2 sentence description of the local climate, precipitation, and growing conditions"
  },
  "features": [
    {
      "type": "tree | shrub | flower | grass | patio | walkway | fence | wall | deck | water_feature | slope | flat_area | garden_bed | other",
      "label": "Human-readable name",
      "species": "If identifiable, the species name",
      "confidence": "high | medium | low",
      "sunExposure": "full_sun | partial_shade | full_shade",
      "notes": "Additional observations"
    }
  ],
  "recommendedPlantTypes": [
    {
      "category": "quick_win | foundation_plant | seasonal_color | problem_solver",
      "plantType": "tree | shrub | perennial | annual | grass | vine | groundcover | bulb",
      "lightRequirement": "full_sun | partial_shade | full_shade",
      "reason": "Why this type of plant is recommended for this yard",
      "searchCriteria": {
        "type": "The plant type to search for",
        "light": "The light condition to filter by",
        "tags": ["Optional tags to prefer, e.g., 'native', 'drought tolerant'"]
      }
    }
  ],
  "isValidYardPhoto": true,
  "invalidPhotoReason": "Only populated if isValidYardPhoto is false"
}

Important rules:
- If the photo does not show a yard or outdoor space, set isValidYardPhoto to false and provide a reason. Leave features and recommendedPlantTypes as empty arrays.
- Identify 3-8 visible features with confidence levels.
- Recommend 5-8 plant types across the categories (quick_win, foundation_plant, seasonal_color, problem_solver). Include at least one from each category.
- Consider the user's location and local climate when recommending. Determine the appropriate hardiness zone, growing season, precipitation patterns, and other climate factors based on the location provided. Only suggest plants that thrive in these conditions.
- Always provide a climate assessment with at least a description. Include a USDA hardiness zone estimate when possible.
- Format the USDA zone as a number (1-13) followed by a lowercase letter (a or b), e.g., "7b", "10a". Do not include "Zone" or other prefixes.
- Base sun exposure assessment on visible shadows, tree canopy, building orientation, and time-of-day cues.
- Be specific in your reasons — reference what you see in the photo.`;

function formatCoordinates(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return '';
  const latStr = `${String(Math.abs(lat))}°${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${String(Math.abs(lng))}°${lng >= 0 ? 'E' : 'W'}`;
  return ` (${latStr}, ${lngStr})`;
}

function buildUserMessage(
  locationName: string,
  latitude: number | null,
  longitude: number | null,
): string {
  return `Analyze this yard photo. The homeowner's yard is in ${locationName}${formatCoordinates(latitude, longitude)}.

Provide your analysis as JSON matching the schema in your instructions.`;
}

export interface ClaudeVisionError {
  type: 'timeout' | 'rate_limit' | 'invalid_response' | 'api_error';
  message: string;
}

export type ClaudeVisionResult =
  | { ok: true; data: AiAnalysisOutput }
  | { ok: false; error: ClaudeVisionError };

/**
 * Call Claude Vision API with the yard photo and parse the structured response.
 * Retries once on invalid JSON or schema validation failure.
 */
export async function analyzeYardPhoto(
  base64Photo: string,
  mediaType: 'image/jpeg' | 'image/png',
  locationName: string,
  latitude: number | null,
  longitude: number | null,
): Promise<ClaudeVisionResult> {
  const client = await getClient();
  const userText = buildUserMessage(locationName, latitude, longitude);

  const callClaude = async (): Promise<ClaudeVisionResult> => {
    try {
      const response = await client.messages.create(
        {
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Photo,
                  },
                },
                {
                  type: 'text',
                  text: userText,
                },
              ],
            },
          ],
        },
        { timeout: CLAUDE_TIMEOUT },
      );

      // Extract text from response
      const textBlock = response.content.find(
        (block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text',
      );
      if (!textBlock) {
        return {
          ok: false,
          error: { type: 'invalid_response', message: 'No text in Claude response' },
        };
      }

      // Parse JSON — strip markdown code fences if Claude wrapped the response
      let parsed: unknown;
      try {
        let jsonText = textBlock.text.trim();
        const fencedContent = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/.exec(jsonText)?.[1];
        if (fencedContent !== undefined) {
          jsonText = fencedContent.trim();
        }
        parsed = JSON.parse(jsonText);
      } catch {
        return {
          ok: false,
          error: { type: 'invalid_response', message: 'Claude returned invalid JSON' },
        };
      }

      // Validate against schema
      const result = AiAnalysisOutputSchema.safeParse(parsed);
      if (!result.success) {
        return {
          ok: false,
          error: {
            type: 'invalid_response',
            message: `Schema validation failed: ${result.error.message}`,
          },
        };
      }

      return { ok: true, data: result.data };
    } catch (err: unknown) {
      if (err instanceof Anthropic.APIError) {
        if (err.status === 429) {
          return {
            ok: false,
            error: {
              type: 'rate_limit',
              message: 'Service is busy. Please try again in a moment.',
            },
          };
        }
      }

      // Check for timeout
      if (
        err instanceof Error &&
        (err.name === 'AbortError' ||
          err.message.includes('timeout') ||
          err.message.includes('Timeout'))
      ) {
        return {
          ok: false,
          error: {
            type: 'timeout',
            message: 'Analysis timed out. Please try again.',
          },
        };
      }

      return {
        ok: false,
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : 'Unknown Claude API error',
        },
      };
    }
  };

  // First attempt
  const firstAttempt = await callClaude();
  if (firstAttempt.ok) return firstAttempt;

  // Retry once on invalid_response (JSON parse or schema failure) — not on timeout or rate limit
  if (firstAttempt.error.type === 'invalid_response') {
    const retry = await callClaude();
    return retry;
  }

  return firstAttempt;
}
