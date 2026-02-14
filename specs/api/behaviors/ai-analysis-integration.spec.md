# Feature: AI Analysis Integration

## Status

Draft

## Context

This spec covers the integration between our API and the Anthropic Claude Vision API for yard photo analysis. It defines the prompt design, response parsing strategy, error handling, and the end-to-end flow from photo upload to structured results.

Related: Yard Photo Analysis spec, Plant Database spec, ADR-004 (DynamoDB)

---

## End-to-End Flow

```
User                    API                         S3              Claude Vision        DynamoDB
 │                       │                          │                    │                  │
 │─ POST /analyses ─────▶│                          │                    │                  │
 │  (photo + zipCode)    │                          │                    │                  │
 │                       │── upload photo ──────────▶│                    │                  │
 │                       │◀── pre-signed URL ───────│                    │                  │
 │                       │                          │                    │                  │
 │                       │── lookup zone (in-memory) │                    │                  │
 │                       │                          │                    │                  │
 │                       │── send photo + prompt ──────────────────────▶│                  │
 │                       │◀── structured analysis ─────────────────────│                  │
 │                       │                          │                    │                  │
 │                       │── validate with Zod      │                    │                  │
 │                       │                          │                    │                  │
 │                       │── match plant IDs ──────────────────────────────────────────────▶│
 │                       │◀── full plant records ──────────────────────────────────────────│
 │                       │                          │                    │                  │
 │                       │── store analysis ───────────────────────────────────────────────▶│
 │                       │                          │                    │                  │
 │◀── analysis result ──│                          │                    │                  │
```

---

## 1. Photo Upload

**Pre-processing before AI call:**

- Validate MIME type via magic bytes (not file extension)
- Accepted: JPEG, PNG, HEIC
- Max size: 20MB
- Store in S3 under: `photos/{userId|anonymous}/{analysisId}/original.{ext}`
- Generate a pre-signed URL for the stored photo (15-min expiry for the response)
- If HEIC, convert to JPEG before sending to Claude (Claude Vision accepts JPEG/PNG/GIF/WebP)

---

## 2. Zone Resolution

**Before AI call, resolve the ZIP to a USDA zone:**

- Call `getZoneByZip(zipCode)` — a static in-memory lookup, no database call
- If not found: return 404 with "ZIP code not found"
- Pass the zone info to the AI prompt for context

**USDA Zone data:**

- The ZIP-to-zone mapping (~42,000 entries) is bundled as a static JSON file at `apps/api/src/data/zip-zones.json`
- Source: USDA Plant Hardiness Zone Map data via the [frostline](https://github.com/waldoj/frostline) project (PRISM Climate Group at Oregon State University)
- This data is static (hardiness zones do not change) — no database storage needed
- The JSON file loads into memory on Lambda cold start (~2-3MB) and lookups are sub-millisecond
- The lookup function lives at `apps/api/src/services/zone-lookup.ts`
- This data is API-only — it is NOT in `packages/shared` because the frontend doesn't need 42,000 ZIP codes bundled in the browser
- Each entry shape: `{ zipCode: "28202", zone: "7b", zoneNumber: 7, zoneLetter: "b", minTempF: 5, maxTempF: 10, description: "Average annual extreme minimum temperature 5 to 10 °F" }`
- The entry shape matches `ZoneResponseSchema` from `packages/shared/src/schemas/zone.ts`

---

## 3. Claude Vision Prompt Design

### System Prompt

```
You are an expert landscape architect and horticulturist analyzing a homeowner's yard photo. You provide actionable, specific analysis with plant recommendations tailored to the user's USDA hardiness zone.

Respond ONLY with valid JSON matching the schema below. No markdown, no preamble, no explanation outside the JSON.

{
  "summary": "2-3 sentence description of the yard",
  "yardSize": "small | medium | large",
  "overallSunExposure": "full_sun | partial_shade | full_shade",
  "estimatedSoilType": "clay | sandy | loamy | silty | rocky | unknown",
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
- Consider the user's USDA zone when recommending — only suggest plants that thrive in their zone.
- Base sun exposure assessment on visible shadows, tree canopy, building orientation, and time-of-day cues.
- Be specific in your reasons — reference what you see in the photo.
```

### User Message

```
Analyze this yard photo. The homeowner is in USDA Hardiness Zone {zone} ({zoneDescription}).

Provide your analysis as JSON matching the schema in your instructions.
```

The photo is sent as a base64-encoded image in the message content.

### Why `recommendedPlantTypes` Instead of Specific Plants

The AI does NOT pick specific plants from our database. Instead it recommends plant _types_ with search criteria. The API then queries DynamoDB using those criteria to find actual plants. This means:

- The AI can't hallucinate plants that don't exist in our database
- Recommendations always link to real, browsable plant records
- We control the plant data quality, not the AI
- Adding new plants to the database automatically improves recommendations without changing the prompt

---

## 4. Response Parsing & Plant Matching

### Step 1: Parse AI Response

```typescript
const raw = JSON.parse(claudeResponse);
```

### Step 2: Validate Against Schema

```typescript
const parsed = AiAnalysisOutputSchema.safeParse(raw);
if (!parsed.success) {
  // Retry once with a more explicit prompt
  // If retry fails, return 500
}
```

### Step 3: Check for Invalid Photo

```typescript
if (!parsed.data.isValidYardPhoto) {
  return { statusCode: 422, body: { error: parsed.data.invalidPhotoReason } };
}
```

### Step 4: Match Plant Types to Real Plants

For each item in `recommendedPlantTypes`, query DynamoDB:

```typescript
for (const rec of parsed.data.recommendedPlantTypes) {
  // Query: plants matching type + light + zone
  // Filter by tags if provided
  // Pick the best match (or top 2)
  // Attach full plant record to the recommendation
}
```

### Step 5: Assemble Final Response

Combine the AI analysis with matched plant records into the `AnalysisResponseSchema` and return.

---

## 5. Error Handling

| Error                                                 | Handling                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude API timeout (>30s)                             | Return 504 with "Analysis timed out. Please try again."                                                                                            |
| Claude API rate limit                                 | Return 429 with "Service is busy. Please try again in a moment."                                                                                   |
| Claude returns invalid JSON                           | Retry once with explicit prompt. If second attempt fails, return 500.                                                                              |
| Claude returns valid JSON but fails schema validation | Retry once. If fails again, return 500 with partial results if possible.                                                                           |
| No plants match the AI's criteria                     | Return the analysis without recommendations for that category. Never return zero total recommendations — fall back to popular plants for the zone. |
| Photo is not a yard                                   | Return 422 with the AI's explanation.                                                                                                              |
| HEIC conversion fails                                 | Return 400 with "Unable to process this image format. Please try JPEG or PNG."                                                                     |
| S3 upload fails                                       | Return 500. Do not call the AI.                                                                                                                    |
| Secrets Manager fails                                 | Return 500. Log the error (without the secret value).                                                                                              |

### Retry Strategy

- Max 1 retry on AI parsing failures
- No retry on timeouts (user is already waiting)
- No retry on rate limits (would make it worse)
- Exponential backoff on Secrets Manager / DynamoDB transient errors

---

## 6. Cost & Performance

### Claude API Costs

- Start with Claude Sonnet 4 for development and testing
- Evaluate Sonnet vs Opus quality on real yard photos before production launch
- Model is configured as an environment variable, not hardcoded — easy to switch

### Performance Budget

- S3 upload: < 3s
- Zone lookup: < 50ms
- Claude Vision call: 5-15s (this is the bottleneck)
- Plant matching: < 200ms
- Total: < 20s target, < 30s hard limit

### Progress Updates

- **V1:** Simple spinner on the frontend. The POST request blocks until analysis completes.
- **Future improvement:** Add polling or SSE for real-time progress updates ("Uploading photo...", "Analyzing yard...", "Matching plants..."). Track this as a UX enhancement after launch.

---

## 7. Anthropic API Configuration

```typescript
const client = new Anthropic({
  apiKey: secretFromSecretsManager,
});

const response = await client.messages.create({
  model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514',
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
            media_type: 'image/jpeg',
            data: base64Photo,
          },
        },
        {
          type: 'text',
          text: `Analyze this yard photo. The homeowner is in USDA Hardiness Zone ${zone} (${zoneDescription}).

Provide your analysis as JSON matching the schema in your instructions.`,
        },
      ],
    },
  ],
});
```

---

## 8. New Zod Schema Needed

The AI response schema is different from the final API response schema. We need an intermediate schema for what Claude returns:

```typescript
const AiAnalysisOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  yardSize: z.enum(['small', 'medium', 'large']),
  overallSunExposure: SunExposureSchema,
  estimatedSoilType: z.enum(['clay', 'sandy', 'loamy', 'silty', 'rocky', 'unknown']),
  features: z.array(
    z.object({
      type: IdentifiedFeatureSchema.shape.type,
      label: z.string().min(1).max(100),
      species: z.string().max(100).optional(),
      confidence: ConfidenceLevelSchema,
      sunExposure: SunExposureSchema.optional(),
      notes: z.string().max(500).optional(),
    }),
  ),
  recommendedPlantTypes: z.array(
    z.object({
      category: RecommendationCategorySchema,
      plantType: PlantSchema.shape.type,
      lightRequirement: SunExposureSchema,
      reason: z.string().min(1).max(500),
      searchCriteria: z.object({
        type: z.string().min(1).max(50),
        light: z.string().min(1).max(50),
        tags: z.array(z.string().max(50)).max(10).optional(),
      }),
    }),
  ),
  isValidYardPhoto: z.boolean(),
  invalidPhotoReason: z.string().max(500).optional(),
});
```

---

## Security Considerations

- Photo is sent to Claude as base64 — never as a URL (prevents SSRF)
- User address/ZIP is NOT sent to Claude — only the resolved zone
- Anthropic API key read from Secrets Manager at runtime, cached for Lambda lifecycle (not per-request)
- AI response is validated via Zod before any downstream use — never trusted as-is
- Rate limiting prevents abuse of the expensive AI endpoint
