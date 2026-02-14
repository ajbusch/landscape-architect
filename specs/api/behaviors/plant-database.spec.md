# Feature: Plant Database

## Status

Draft

## Context

The plant database is the foundation for AI-powered recommendations in the Yard Photo Analysis feature. It stores curated landscape plant data that the AI references when making recommendations. This is a read-heavy, rarely-updated dataset.

**DynamoDB is the source of truth** for all plant data. The seed file (`data/initial-seed.json`) is a one-time bootstrap used to populate an empty table. Once seeded, plant data is managed directly in DynamoDB. Admin management tools will be added later.

Related: ADR-004 (DynamoDB), Yard Photo Analysis spec

---

## Requirements

### Functional

**Data Model**

- FR-001: Each plant record SHALL conform to the `PlantSchema` defined in `packages/shared/src/schemas/plant.ts`
- FR-002: The initial seed dataset SHALL contain 50 popular US landscape plants spanning:
  - At least 5 plant types (trees, shrubs, perennials, grasses, groundcovers)
  - USDA zones 3 through 10 (covering the majority of the continental US)
  - All three light conditions (full sun, partial shade, full shade)
  - All three difficulty levels (beginner, intermediate, advanced)
  - All bloom seasons represented
  - A mix of native and non-native (non-invasive) species
- FR-003: Each plant SHALL include accurate horticultural data:
  - Correct hardiness zone ranges
  - Realistic mature sizes
  - Accurate light and water requirements
  - Appropriate difficulty classification
- FR-004: No invasive species SHALL be included in the seed dataset (`isInvasive: false` for all)

**DynamoDB Table Design**

- FR-010: Use a single DynamoDB table with on-demand capacity (pay-per-request)
- FR-011: Primary key: `PK` (partition key) + `SK` (sort key)
- FR-012: Each plant is stored with multiple items for different access patterns:

  | Access Pattern      | PK                  | SK           |
  | ------------------- | ------------------- | ------------ |
  | Get plant by ID     | `PLANT#<id>`        | `PLANT#<id>` |
  | List plants by type | `PLANT_TYPE#<type>` | `PLANT#<id>` |
  | List plants by zone | `ZONE#<zone>`       | `PLANT#<id>` |

- FR-013: GSI1 for search by name:

  | Access Pattern        | GSI1PK       | GSI1SK              |
  | --------------------- | ------------ | ------------------- |
  | Search by common name | `PLANT_NAME` | `<commonName>#<id>` |

**API Endpoints**

- FR-020: `GET /api/v1/plants` — List/search plants with optional filters (zone, light, type, difficulty, native, deer resistant, drought tolerant)
- FR-021: `GET /api/v1/plants/:id` — Get a single plant by ID
- FR-022: Both endpoints are public (no auth required)
- FR-023: Responses conform to `PlantSearchResponseSchema` and `PlantSchema`

**Seed Script**

- FR-030: A seed script SHALL exist at `scripts/seed-plants.ts`
- FR-031: The seed script reads from `data/initial-seed.json` and writes to DynamoDB
- FR-032: The seed script skips any plant that already exists in the table (DynamoDB is the source of truth; the seed file does not overwrite existing data)
- FR-033: The seed script validates all records against `PlantSchema` before writing

### Non-Functional

- NFR-001: Plant list endpoint response time < 200ms at p95
- NFR-002: Plant detail endpoint response time < 50ms at p95
- NFR-003: Table uses on-demand capacity (no provisioned throughput)
- NFR-004: Table has point-in-time recovery enabled
- NFR-005: Table is encrypted with AWS-managed key

---

## API Contract

### GET /api/v1/plants

- **Auth:** None
- **Query params:** Validated by `PlantSearchParamsSchema`
  - `query` — text search on common/scientific name
  - `zone` — USDA zone filter (e.g., "7b")
  - `light` — sun exposure filter
  - `type` — plant type filter
  - `difficulty` — difficulty filter
  - `deerResistant` — boolean
  - `droughtTolerant` — boolean
  - `isNative` — boolean
  - `page` — page number (default 1)
  - `limit` — results per page (default 20, max 50)
- **Response:** `200 OK` → `PlantSearchResponseSchema`

### GET /api/v1/plants/:id

- **Auth:** None
- **Response:** `200 OK` → `PlantSchema`
- **Errors:** `404` — Plant not found

---

## Seed Data Requirements

The 50 plants should include a realistic mix. Target distribution:

**By type:**

- Trees: 10 (e.g., Eastern Redbud, Japanese Maple, Crape Myrtle, Red Maple, Dogwood)
- Shrubs: 12 (e.g., Knockout Rose, Hydrangea, Boxwood, Azalea, Lilac)
- Perennials: 15 (e.g., Hosta, Black-Eyed Susan, Coneflower, Daylily, Lavender)
- Ornamental grasses: 5 (e.g., Fountain Grass, Miscanthus, Blue Fescue)
- Groundcovers: 5 (e.g., Creeping Phlox, Pachysandra, Vinca)
- Vines: 3 (e.g., Clematis, Trumpet Vine, Virginia Creeper)

**By zone coverage:**

- Cold-hardy (zones 3-5): at least 15 plants
- Mid-range (zones 5-8): at least 40 plants
- Heat-tolerant (zones 8-10): at least 15 plants
- (Many plants span multiple zone ranges)

**By difficulty:**

- Beginner: at least 25 plants
- Intermediate: at least 15 plants
- Advanced: at most 10 plants

**Data accuracy:**

- Common names and scientific names must be correct
- Zone ranges must reflect actual hardiness (verify against known sources)
- Mature sizes must be realistic ranges, not single values
- Light requirements must reflect actual growing conditions
- Native status must reflect whether the plant is native to North America

---

## Acceptance Criteria

```gherkin
Scenario: List all plants
  Given the plant database is seeded
  When I call GET /api/v1/plants
  Then I receive a paginated list of plants
  And total count is 50

Scenario: Filter plants by zone
  Given the plant database is seeded
  When I call GET /api/v1/plants?zone=7b
  Then all returned plants have zone ranges that include 7b

Scenario: Filter plants by multiple criteria
  Given the plant database is seeded
  When I call GET /api/v1/plants?zone=7b&light=partial_shade&type=perennial
  Then all returned plants are perennials suitable for partial shade in zone 7b

Scenario: Get plant by ID
  Given the plant database is seeded
  When I call GET /api/v1/plants/:id with a valid plant ID
  Then I receive the full plant record conforming to PlantSchema

Scenario: Plant not found
  When I call GET /api/v1/plants/nonexistent-id
  Then I receive a 404 response

Scenario: Seed script skips existing plants
  Given I run the seed script once
  When I run the seed script again
  Then the total plant count is still 50
  And no existing plant data is overwritten
```

---

## Edge Cases

- Zone filtering should handle range matching — a plant with zones 4b-8a should appear in a query for zone 7b
- Text search should be case-insensitive
- Empty filter results should return `{ plants: [], total: 0, page: 1, limit: 20, totalPages: 0 }`

---

## Security Considerations

- Public endpoints, no auth required
- All query parameters validated via `PlantSearchParamsSchema`
- DynamoDB table encrypted with AWS-managed key
- No user data in this table
- Rate limiting: 60 requests/min per IP

---

## Data Management

- **Source of truth:** DynamoDB table
- **Initial bootstrap:** `data/initial-seed.json` (50 plants, run once via `scripts/seed-plants.ts`)
- **Ongoing management:** Admin tools (future), direct DynamoDB edits
- **Seed behavior:** The seed script checks each plant by ID before writing. Existing plants are skipped, preserving any manual edits made directly in DynamoDB.

## Implementation Plan

1. Create CDK `DatabaseStack` with DynamoDB table
2. Generate `data/initial-seed.json` with 50 plants
3. Create `scripts/seed-plants.ts` to load data (skip existing)
4. Implement API routes (`GET /plants`, `GET /plants/:id`)
5. Write unit tests (handler logic), contract tests (response schema validation)
6. Deploy and seed

---

## Open Questions

- [ ] Should we include plant photos in the seed data, or add them later?
- [ ] Do we need a plant detail page on the frontend for v1, or only show plants in analysis results?
