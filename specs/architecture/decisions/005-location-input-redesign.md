# ADR-005: Location Input via Google Places and Coordinates

## Status

Proposed

## Date

2026-02-21

## Context

The application's location system accepts a 5-digit US ZIP code, resolves it to a USDA hardiness zone via an in-memory lookup (~42,000 entries), and passes the zone string to Claude: _"The homeowner is in USDA Hardiness Zone 7b (5 to 10°F)."_

This has two critical limitations:

1. **US-only.** The ZIP→zone lookup is a US dataset. International users cannot use the app at all.
2. **Climate data too coarse.** USDA zones encode only winter minimum temperature. Seattle and Charleston are both Zone 8b but have radically different climates — cool/wet vs hot/humid. Claude gets one number and must guess the rest from the photo alone.

We evaluated five approaches for providing location and climate context to Claude. The full analysis with real data for two test locations (Charlottesville, VA and Fredericton, NB) is documented in [research/location-climate-data-comparison.md](research/location-climate-data-comparison.md).

### Models Evaluated

| Model                            | Input          | Climate Data Source         | Works Globally | External API | Latency   | Implementation |
| -------------------------------- | -------------- | --------------------------- | -------------- | ------------ | --------- | -------------- |
| 1. Current (USDA from ZIP)       | ZIP code       | Static ZIP→zone lookup      | ❌ US only     | None         | 0ms       | Existing       |
| 2. Static Köppen (from lat/lng)  | Lat/lng        | ~50MB global raster grid    | ✅             | None         | <1ms      | Medium         |
| 3. Open-Meteo API (from lat/lng) | Lat/lng        | Weather API (historical)    | ✅             | Yes ($29/mo) | 200-500ms | Medium         |
| 4. Location name + coordinates   | Lat/lng + name | Claude's training knowledge | ✅             | None         | 0ms       | Zero           |
| 5. Hybrid (Köppen + name)        | Lat/lng + name | Static grid + training      | ✅             | None         | <1ms      | Medium         |

### Key finding

Claude's training data already contains extensive climate knowledge for populated locations worldwide. When Claude reads "Charlottesville, Virginia" it knows the USDA zone (7a/7b), Köppen classification (Cfa — humid subtropical), precipitation (~42" annually), growing season (April–October), frost dates, local soil types, and common landscaping patterns. The location name is the key that unlocks this knowledge. The photo provides complementary visual context (sun exposure, existing vegetation, soil conditions).

## Decision

### 1. Replace ZIP code input with Google Places Autocomplete

The frontend location input changes from a ZIP code text field to a Google Places Autocomplete search. This accepts cities, regions, postal codes, and addresses globally. Users select a place from autocomplete suggestions.

**Why Google Places over GeoNames or other geocoding services:**

- Better international quality, especially for non-English locations
- Handles ambiguous queries well (fuzzy matching, regional awareness)
- At current scale ($2.83 per 1,000 sessions) cost is negligible
- Can downgrade to a free alternative later if cost becomes an issue

**Privacy tradeoff:** The Places Autocomplete widget sends every keystroke to Google, which is a new third-party data flow that doesn't exist today (the current ZIP input is entirely client-side). Google receives what users type, when, and from which domain. This is standard for any app using Google Maps/Places, but should be acknowledged. If the app targets GDPR jurisdictions, revisit with a privacy notice or self-hosted geocoding alternative.

### 2. Normalize all locations to lat/lng + display name

Every location input resolves to `{ latitude, longitude, locationName }`. This is the universal API contract — the backend never sees a ZIP code, city name, or country code as separate fields. Lat/lng are nullable to support the Places fallback path (plain text location name only); the API validates that both are present or both are null.

**Coordinate precision:** The API rounds lat/lng to 2 decimal places (~1.1km precision) at the validation boundary before storing or logging. Google Places returns 6+ decimal places, which can identify a specific house. 2 decimal places is sufficient for climate determination and dramatically reduces PII exposure. Rounding happens server-side (not in the frontend) so it's enforced regardless of client.

Lat/lng enables all future climate data sources (Köppen grid, weather APIs, elevation lookups) without changing the API contract. The display name enables Claude's training knowledge.

### 3. Pass location name + coordinates to Claude (Model 4)

Instead of a USDA zone string, Claude receives: _"The homeowner's yard is in Charlottesville, Virginia, USA (38.03°N, 78.48°W)."_

Claude uses its training knowledge to determine climate context. No structured climate data is provided in V1.

**Non-determinism guardrails:** Claude's climate reasoning is non-deterministic — it may produce slightly different zone assessments across runs. We accept this for V1 because the current system's determinism produces a worse failure mode (Seattle and Charleston both get identical Zone 8b recommendations). To validate this bet and decide when to upgrade to Model 5 (Köppen hybrid):

- **Pre-launch benchmark:** Before full rollout, re-run 10-20 existing analyses with the new prompt format. Compare Claude's zone output against the known ZIP→zone value. This validates the premise of Model 4.
- **Production monitoring:** Track `climateZonePresent` (boolean) and `climateUsdaZone` (string) on every worker completion log. If Claude omits the zone in >10% of analyses, or if spot-checks reveal zone errors beyond ±1 zone for well-known locations, implement Model 5.
- **Model 5 is pre-designed:** The API contract (lat/lng) already supports a static Köppen grid lookup. Adding it requires sourcing the dataset and a Worker-side lookup — no API or frontend changes.

### 4. Remove the ZIP→zone in-memory lookup

The `zip-zones.json` file (~2-3MB, ~42,000 entries) and `zone-lookup.ts` service are removed. The `GET /api/v1/zones/:zip` endpoint is deprecated.

### 5. Source USDA zone from Claude's output for plant matching

The Worker currently queries plants by `ZONE#<zone>` using the zone from the ZIP lookup. After this change, Claude's AI output includes a required `climate` object with an optional `usdaZone` field within it. Claude must always provide a climate description; the specific USDA zone is optional (some international locations don't map cleanly to USDA zones). The `usdaZone` field is validated against the existing zone format regex (`/^(1[0-3]|[1-9])[ab]$/`) to ensure it can be used directly in `ZONE#<zone>` queries. If `usdaZone` is present and valid, the Worker uses it for plant matching. If absent or malformed, the Worker matches by plant type and light requirements only.

This keeps the DynamoDB plant access patterns unchanged while sourcing the zone from a globally-available signal.

**International plant database limitation:** Opening location input globally while the plant database is US-centric means international users may receive recommendations that aren't locally available. The results page should indicate that plant recommendations are currently sourced from a North American database. Expanding the plant catalog internationally is a separate feature.

## Consequences

### Positive

- International users can use the app immediately — any location Google Places can find, we can analyze
- Richer climate context for Claude — location name triggers comprehensive climate knowledge vs a single temperature number
- Reduced bundle size — removing 2-3MB zip-zones.json improves API Lambda cold starts
- No external API on the critical analysis path — Places runs client-side, Claude call happens regardless
- Universal API contract — lat/lng works with any future climate enrichment without contract changes
- Reduced PII — coordinates rounded to ~1km precision; city-level names less identifying than ZIP codes

### Negative

- **Non-deterministic climate reasoning.** Claude may produce slightly different climate assessments across runs for the same location. Mitigated with production monitoring and concrete trigger criteria for Model 5 upgrade (see Decision §3)
- **Google Places cost.** ~$2.83 per 1,000 sessions. Negligible now but scales linearly. Mitigated with daily quota caps. Can switch to free GeoNames if cost becomes an issue
- **Google Places privacy.** Autocomplete sends keystrokes to Google — a new third-party data flow. Acceptable for V1; revisit if targeting GDPR jurisdictions
- **Google Places dependency for frontend.** If the Places JS library fails to load, the frontend falls back to a plain text location name input with null coordinates. Not on the critical backend path
- **Breaking API change.** Frontend and backend must deploy together. Acceptable for a pre-launch app with zero external API consumers. The deploy pipeline runs both in the same workflow
- **Plant matching less precise for edge cases.** If Claude omits a USDA zone, plant matching falls back to type + light only. Tracked via `climateZonePresent` metric
- **International plant database mismatch.** Global location input but US-centric plant catalog. International users get climate-appropriate analysis but plant recommendations may not be locally available. Results page acknowledges this limitation

### Neutral

- The DynamoDB `ZONE#<zone>` access pattern for plants is unchanged — the zone source changes but the query doesn't
- Existing analysis records (with `zipCode`/`zone` fields) auto-expire via 7-day TTL — no migration needed
- The plant database and seed data are unaffected
- The research document and this ADR together form the decision record. The implementation spec is at [specs/api/behaviors/location-input-redesign.spec.md](../api/behaviors/location-input-redesign.spec.md)
