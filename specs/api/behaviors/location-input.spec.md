# Feature: Location Input Redesign

## Status

Draft

## Context

Replace the US-only ZIP code input with a globally-available location search. Users select a location via Google Places Autocomplete, which resolves to lat/lng coordinates and a display name. Claude uses the location name and coordinates — plus its training knowledge — to determine climate context for plant recommendations.

Related: [ADR-005 (Location Input Redesign)](../../architecture/decisions/005-location-input-redesign.md), AI Analysis Integration v2 (Async) spec, Yard Photo Analysis spec, Plant Database spec, Frontend V1 spec, [Climate Data Model Comparison](../../architecture/research/location-climate-data-comparison.md)

---

## What Changes

| Component            | Current                                                    | New                                                           |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Frontend input       | ZIP code text field                                        | Google Places Autocomplete search                             |
| API request body     | `{ photoKey, zipCode }`                                    | `{ photoKey, latitude, longitude, locationName }`             |
| API validation       | 5-digit ZIP regex                                          | lat/lng range check + non-empty locationName                  |
| Zone resolution      | In-memory ZIP→zone lookup                                  | Removed from API Lambda                                       |
| Worker input         | `{ analysisId, photoKey, zipCode, zone, zoneDescription }` | `{ analysisId, photoKey, latitude, longitude, locationName }` |
| Claude user message  | "Zone 7b (5 to 10°F)"                                      | "Charlottesville, Virginia, USA (38.03°N, 78.48°W)"           |
| Claude system prompt | References USDA zones                                      | References location and local climate                         |
| DynamoDB record      | `zipCode`, `zone` fields                                   | `latitude`, `longitude`, `locationName` fields                |
| Plant matching       | Worker queries `ZONE#<zone>` from ZIP lookup               | Worker uses Claude's zone output to query plants              |
| Observability        | Logs `zipCode`, `zone`                                     | Logs `locationName`, `latitude`, `longitude`                  |
| Smoke test           | Passes `zipCode: "22903"`                                  | Passes `latitude`, `longitude`, `locationName`                |

---

## 1. Frontend: Google Places Autocomplete

### Input Component

Replace the ZIP code text field on `/analyze` with a location search input.

**Behavior:**

- User types a location (city, town, address, or ZIP code — Places handles all)
- Autocomplete dropdown shows matching suggestions as the user types
- User selects a suggestion
- The component extracts `{ latitude, longitude, locationName }` from the selected place
- Display the confirmed location below the input (e.g., "📍 Charlottesville, Virginia, USA")
- Allow clearing/changing the selection

**What we extract from the Places response:**

- `latitude`: `place.geometry.location.lat()`
- `longitude`: `place.geometry.location.lng()`
- `locationName`: `place.formatted_address` or `place.name` — use the shortest unambiguous form (e.g., "Charlottesville, Virginia, USA" not a full street address)

**Places API configuration:**

- Use the Places Autocomplete widget (client-side JS, no server calls)
- Restrict to `types: ['(regions)']` — returns cities, states, countries, postal codes. Excludes street addresses and businesses
- No country restriction
- API key restricted to the frontend domain in Google Cloud Console

**Fallback for Places API failure:**

- Show a plain text field for location name (e.g., "Enter your city or region")
- User types a location name manually (e.g., "Charlottesville, Virginia")
- No lat/lng input — coordinates are submitted as `null` (not `0, 0`, which is a real location in the Gulf of Guinea)
- The API accepts `null` lat/lng when `locationName` is provided (see §3 for nullable schema)
- The Worker still passes the location name to Claude, which provides climate context from the name alone
- Plant matching skips zone filtering when coordinates are `null` (falls back to type + light only)
- This is a degraded experience but usable — the name is what matters most for Claude's analysis

### Landing Page Update

"How It Works" section: change "Step 2: Enter your ZIP code" to "Step 2: Enter your location."

### Frontend Validation

- `latitude`: number, -90 to 90
- `longitude`: number, -180 to 180
- `locationName`: non-empty string, max 200 characters
- Analyze button disabled until photo + valid location are provided

### Google Places API Key

The API key is a frontend-only asset, embedded via `VITE_GOOGLE_PLACES_API_KEY`.

**Per-environment referrer restrictions (Google Cloud Console):**

| Environment | Allowed Referrers                                  |
| ----------- | -------------------------------------------------- |
| Dev         | `d2jp0cpr1bn6fp.cloudfront.net`, `localhost:5173`  |
| Staging     | `d3734vo7rulmf3.cloudfront.net`                    |
| Prod        | `d5hj1rpwk1mpl.cloudfront.net`, `landscaper.cloud` |

Set a daily quota cap in Google Cloud Console as a cost safety net.

**CDK impact:** None. The key is a frontend build-time variable injected during `vite build` via GitHub Actions secrets.

---

## 2. API Changes

### POST /api/v1/analyses (API Lambda)

**New request body:**

```json
{
  "photoKey": "photos/anonymous/abc-123/original.jpg",
  "latitude": 38.03,
  "longitude": -78.48,
  "locationName": "Charlottesville, Virginia, USA"
}
```

**What it does (must complete in <3s):**

1. Validate input (photoKey exists in S3, lat/lng in valid range, locationName non-empty)
2. **Round lat/lng to 2 decimal places** (~1.1km precision) — reduces PII exposure while preserving climate accuracy
3. Generate analysisId (UUID)
4. Write DynamoDB record with `status: "pending"` (using rounded coordinates)
5. Async invoke the Worker Lambda passing `{ analysisId, photoKey, latitude, longitude, locationName }`
6. Return immediately

**Response: 202 Accepted** (unchanged)

```json
{
  "id": "abc-123-def-456",
  "status": "pending"
}
```

**Error responses:**

- 400: Invalid input (missing photoKey, lat/lng out of range, empty locationName)

**Removed:**

- ZIP code validation
- Zone resolution (`getZoneByZip()` call)
- 404 "ZIP code not found" error

### GET /api/v1/zones/:zip

**Remove this endpoint.** No consumers besides the frontend, which no longer needs it.

### GET /api/v1/analyses/:id (API Lambda)

**Response shape when complete** — the `result` object is unchanged. The top-level analysis record gains new fields:

```json
{
  "id": "abc-123",
  "status": "complete",
  "latitude": 38.03,
  "longitude": -78.48,
  "locationName": "Charlottesville, Virginia, USA",
  "createdAt": "2026-02-16T...",
  "result": {
    /* unchanged AnalysisResponseSchema */
  }
}
```

`zipCode` and `zone` removed from the top-level record.

---

## 3. Zod Schema Changes (packages/shared)

### New: LocationInputSchema

```typescript
export const LocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  locationName: z.string().min(1).max(200),
});

export type LocationInput = z.infer<typeof LocationInputSchema>;
```

Lat/lng are nullable to support the Places fallback path, where the user provides only a location name. When Places is available, both are always populated. The API validates that both are present or both are null — mixed states (one null, one not) are rejected as 400.

### Updated: AnalysisRequestSchema

```typescript
// Before
export const AnalysisRequestSchema = z.object({
  photoKey: z.string().min(1),
  zipCode: ZipCodeSchema,
});

// After — compose with LocationInputSchema to prevent field drift
export const AnalysisRequestSchema = z
  .object({
    photoKey: z.string().min(1),
  })
  .merge(LocationInputSchema);
```

### Updated: AnalysisResponseSchema

Add `latitude`, `longitude`, `locationName`. Remove `zipCode`, `zone`.

### Deprecated: ZipCodeSchema, ZoneResponseSchema

No longer used by the analysis flow. Can be removed or retained for potential future use.

---

## 4. Worker Lambda Changes

### New input payload

```json
{
  "analysisId": "abc-123",
  "photoKey": "photos/anonymous/abc-123/original.jpg",
  "latitude": 38.03,
  "longitude": -78.48,
  "locationName": "Charlottesville, Virginia, USA"
}
```

### Claude prompt changes

**System prompt** — replace USDA-zone-centric language:

- Current: "...tailored to the user's USDA hardiness zone."
- New: "...tailored to the user's local climate and growing conditions."

In the "Important rules" section:

- Current: "Consider the user's USDA zone when recommending — only suggest plants that thrive in their zone."
- New: "Consider the user's location and local climate when recommending. Determine the appropriate hardiness zone, growing season, precipitation patterns, and other climate factors based on the location provided. Only suggest plants that thrive in these conditions."

**User message:**

- Current: `"Analyze this yard photo. The homeowner is in USDA Hardiness Zone {zone} ({zoneDescription})."`
- New: `"Analyze this yard photo. The homeowner's yard is in {locationName} ({formattedLat}, {formattedLng})."`

Format coordinates with N/S and E/W suffixes: "38.03°N, 78.48°W" not "38.03, -78.48".

### AI output schema changes

Add a required `climate` field to `AiAnalysisOutputSchema` so Claude explicitly states its climate assessment. This makes the climate reasoning transparent, debuggable, and trackable:

```typescript
// Add to AiAnalysisOutputSchema — required, not optional
climate: z.object({
  usdaZone: z.string().regex(/^(1[0-3]|[1-9])[ab]$/).optional(),  // e.g., "7b" — must match existing zone format
  description: z.string().min(1).max(500),  // e.g., "Humid subtropical with hot summers..." — always required
}),
```

The `climate` object is **required** — Claude must always attempt a climate assessment. The `usdaZone` within it is optional because some international locations don't map cleanly to USDA zones. The `description` field is always required and is the primary value for debugging prompt quality.

**Zone format validation:** The `usdaZone` field uses the same regex as the existing `USDAZoneSchema` (`/^(1[0-3]|[1-9])[ab]$/`). This ensures the value can be used directly in a `ZONE#<zone>` DynamoDB query without normalization. If Claude returns a non-conforming value (e.g., "Zone 7b", "7B", "7"), the Zod parse strips it to `undefined` and the Worker falls back to type + light matching. The system prompt must instruct Claude on the expected format (see below).

Add to the system prompt's JSON schema accordingly, and add these instructions:

```
- Always provide a climate assessment with at least a description. Include a USDA hardiness zone estimate when possible.
- Format the USDA zone as a number (1-13) followed by a lowercase letter (a or b), e.g., "7b", "10a". Do not include "Zone" or other prefixes.
```

### Plant matching changes

- Claude always provides `climate.description` (required)
- If Claude also provides `climate.usdaZone` (and it passes the regex validation), use it for the `ZONE#<zone>` DynamoDB query (same access pattern as today, different zone source)
- If `climate.usdaZone` is absent or fails validation, skip zone filtering and query by type + light only
- If coordinates are `null` (fallback path), skip zone filtering regardless of Claude's output
- Log `climateZonePresent: boolean` on the worker completion log line (see §7) to track fallback frequency

The DynamoDB access patterns (`ZONE#<zone>`, `PLANT_TYPE#<type>`) are unchanged.

---

## 5. DynamoDB Record Changes

```
PK: ANALYSIS#{analysisId}
SK: ANALYSIS#{analysisId}
status: "pending" | "analyzing" | "matching" | "complete" | "failed"
photoKey: "photos/anonymous/{analysisId}/original.jpg"
latitude: 38.03
longitude: -78.48
locationName: "Charlottesville, Virginia, USA"
result: { ... }              // populated when status = "complete"
error: "..."                 // populated when status = "failed"
createdAt: ISO string
updatedAt: ISO string
ttl: <epoch seconds>         // 7 days from creation, auto-delete
```

**Removed:** `zipCode`, `zone`
**Added:** `latitude`, `longitude`, `locationName`

No table schema or index changes needed.

---

## 6. Code Removal

- `apps/api/src/data/zip-zones.json` (~2-3MB, ~42,000 entries)
- `apps/api/src/services/zone-lookup.ts`
- Zone resolution step in POST /analyses handler
- `GET /api/v1/zones/:zip` route
- ZIP code validation in the analysis request handler

---

## 7. Observability Updates

### Logging changes

**API Lambda:**

```typescript
// Before
request.log.info({ analysisId, zipCode, zone }, 'Analysis requested');
// After
request.log.info({ analysisId, locationName, latitude, longitude }, 'Analysis requested');
```

**Worker Lambda (start step):**

```typescript
// Before
log.info({ photoKey, zone, coldStart, step: 'start' }, 'Worker started');
// After
log.info(
  { photoKey, locationName, latitude, longitude, coldStart, step: 'start' },
  'Worker started',
);
```

**Worker Lambda (complete step) — new fields for Model 4 health monitoring:**

```typescript
log.info(
  {
    step: 'complete',
    duration,
    climateZonePresent: !!parsedResult.climate.usdaZone,
    climateUsdaZone: parsedResult.climate.usdaZone ?? null,
  },
  'Worker complete',
);
```

### Datadog facet updates

- Remove: `zipCode`, `zone`
- Add: `locationName`, `latitude`, `longitude`, `climateZonePresent`, `climateUsdaZone`
- Update saved views that filter on `zone`

### New saved views

- **"Missing climate zone"**: `service:landscape-architect @climateZonePresent:false` — tracks how often Claude omits a USDA zone estimate. Key health signal for Model 4; if this exceeds 10% of analyses, trigger Model 5 (Köppen) implementation.
- **"Climate zone distribution"**: `service:landscape-architect @step:complete` grouped by `@climateUsdaZone` — shows the range of zones Claude is returning, useful for spotting systematic errors.

---

## 8. Prompt Quality Validation

Before deploying to staging, validate that Claude's output quality doesn't regress:

1. Select 10-20 completed analyses from the current system (with known ZIP/zone)
2. Re-run each through the Worker with the new prompt format (location name + coordinates instead of zone string)
3. Compare for each:
   - Does Claude return a `climate.usdaZone`? Does it match the known zone (±1 zone is acceptable)?
   - Are the recommended plant types and search criteria comparable to the original run?
   - Is the `climate.description` sensible for the location?
4. If Claude's zone accuracy is below 90% against the test set, or if plant recommendations are qualitatively worse, reconsider Model 4 before proceeding

This is cheap to run (20 Claude API calls ≈ $0.60) and validates the entire premise of using Claude's training knowledge instead of a static lookup.

---

## 9. Smoke Test Updates

Update `apps/api/scripts/test-analysis.ts`:

```typescript
// Before
const body = { photoKey, zipCode: '22903' };

// After
const body = {
  photoKey,
  latitude: 38.03,
  longitude: -78.48,
  locationName: 'Charlottesville, Virginia, USA',
};
```

---

## 10. Migration & Backwards Compatibility

This is a **breaking change**. Frontend and backend must deploy together.

- The deploy pipeline (GitHub Actions `deploy.yml`) runs frontend and backend in the same workflow. CloudFront invalidation completes within the pipeline run. There is no window where old frontend hits new backend or vice versa.
- No backwards-compatibility API period needed — there are zero production users and no external API consumers.
- Existing DynamoDB records (with `zipCode`/`zone`) auto-expire via 7-day TTL. No migration needed.
- Frontend should handle missing `locationName` on legacy records gracefully (show "Unknown location" or hide the location section).

---

## 11. Spec Cross-References

This spec supersedes location-related sections of existing specs. Those specs should be updated to reference this one.

| Spec                                   | Sections Affected                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **AI Analysis Integration v2 (Async)** | §2 POST /analyses request body, §3 Worker input, §4 DynamoDB record, §5 Frontend polling, §6c Smoke test, §8 Claude prompt |
| **AI Analysis Integration v1**         | §2 Zone resolution, §3 Claude prompt, §7 Anthropic API config                                                              |
| **Yard Photo Analysis**                | FR-010–FR-014 (address/ZIP requirements), API contract, Technical notes (USDA zone data)                                   |
| **Frontend V1**                        | Upload page ZIP input, Landing page "How It Works", API integration service layer                                          |
| **Plant Database**                     | `ZONE#<zone>` access pattern (still used, zone sourced differently)                                                        |
| **Observability**                      | §1.2 Worker instrumentation, §1.4 API instrumentation, §1.7 Datadog facets                                                 |
| **Security**                           | §3.2 Input constraints, §4.3 PII handling                                                                                  |

---

## Acceptance Criteria

```gherkin
Scenario: User searches for a US city
  Given I am on the /analyze page
  When I type "Charlotte" in the location search
  Then I see autocomplete suggestions including "Charlotte, North Carolina, USA"
  When I select "Charlotte, North Carolina, USA"
  Then I see the confirmed location displayed below the input
  And the Analyze button becomes enabled (if photo is also selected)

Scenario: User searches for an international city
  Given I am on the /analyze page
  When I type "Fredericton" in the location search
  Then I see autocomplete suggestions including "Fredericton, New Brunswick, Canada"
  When I select it
  Then I see the confirmed location displayed
  And the Analyze button becomes enabled (if photo is also selected)

Scenario: Successful analysis with location
  Given I have uploaded a photo
  And I have selected "Charlottesville, Virginia, USA" as my location
  When I click "Analyze"
  Then the API receives latitude, longitude, and locationName
  And the Worker passes location data to Claude
  And Claude returns plant recommendations appropriate for Charlottesville's climate

Scenario: Analysis results show location and climate
  Given an analysis has completed for "Charlottesville, Virginia, USA"
  When I view the results page
  Then I see "Charlottesville, Virginia, USA" displayed
  And I see the climate description (e.g., "Humid subtropical with hot summers...")
  And if Claude provided a USDA zone, I see it displayed (e.g., "USDA Zone 7b")

Scenario: Legacy bookmarked result still loads
  Given an analysis record exists from before this change (has zipCode, no locationName)
  When I visit /analyze/:id
  Then I see the analysis results without crashing

Scenario: Places API fails gracefully
  Given the Google Places API fails to load
  When I visit /analyze
  Then I see a plain text location name input
  And I can type "Charlottesville, Virginia" manually
  And I can still submit an analysis
```

---

## Edge Cases

- **Broad region selected** (e.g., "Texas"): Claude analyzes based on centroid coordinates. Results less precise, but photo provides primary context. Acceptable.
- **Ocean or uninhabited location**: Claude should detect non-yard photo and return `isValidYardPhoto: false`.
- **Very obscure location**: Claude's knowledge may be limited. Photo becomes primary signal.
- **Coordinates at ±90/±180**: Valid per schema, unlikely from Places. No special handling.

---

## Security Considerations

- **Coordinate precision and PII:** Raw Google Places coordinates (6+ decimal places) can identify a specific house. The API rounds to 2 decimal places (~1.1km) at the validation boundary before storing or logging. This is sufficient for climate determination and covers ~30,000 people per grid cell — comparable to a ZIP code but without the direct postal lookup.
- **Google Places privacy:** The Autocomplete widget sends keystrokes to Google as the user types. This is a new third-party data flow that doesn't exist with the current ZIP input. Google receives the user's location query, timing, and referrer domain. This is standard for Google Maps/Places integrations. If the app expands to GDPR jurisdictions, revisit with a privacy notice or self-hosted geocoding alternative.
- **Google Places API key:** Frontend-only, restricted by HTTP referrer and daily quota. Visible in browser but useless on other domains.
- **Location data in logs:** `locationName` logged for debugging. Rounded coordinates logged. Less precise than ZIP codes.
- **Location data sent to Claude:** Location name + rounded coordinates sent to Anthropic API. Less identifying than ZIP codes.

---

## International Plant Database Limitation

This spec enables global location input, but the plant database is currently seeded with North American species organized by USDA zones. International users will receive a climate-appropriate analysis from Claude, but plant recommendations may not be locally available or appropriate.

**Mitigation for V1:** The results page should display a notice for non-US locations: "Plant recommendations are currently sourced from a North American database and may not be locally available." Expanding the plant catalog internationally is a separate feature.

---

## Open Questions

None — all resolved.

## Resolved

- **`types` restriction:** Use `(regions)`. Returns cities/states/countries/postal codes, excludes addresses and businesses. Correct for our use case.
- **Lat/lng rounding:** Round to 2 decimal places at the API boundary. Firm decision — see §2 and Security Considerations.
- **Places Autocomplete fallback:** Plain text location name field with nullable coordinates, not manual lat/lng input. See §1.
- **Show inferred USDA zone on results page:** Yes. Display `climate.usdaZone` (when present) and `climate.description` on the results page. The zone gives US users a familiar reference point and helps debug zone accuracy. The description gives all users climate context for their recommendations. See updated acceptance criteria.
