# Feature: Yard Photo Analysis

## Status

Draft

## Context

This is the primary onboarding experience for Landscape Architect. A homeowner uploads a photo of their yard, provides their address (to determine USDA hardiness zone), and receives AI-powered analysis including identification of existing features, soil/sun assessments, and personalized plant recommendations.

This feature is the "wow moment" that converts visitors to users. It must feel fast, insightful, and immediately useful.

Related: ADR-001 (Architecture Overview)

---

## Requirements

### Functional

**Photo Upload**

- FR-001: The system SHALL accept photo uploads in JPEG, PNG, and HEIC formats up to 20MB
- FR-002: The system SHALL display a preview of the uploaded photo before analysis begins
- FR-003: The system SHALL reject files that are not valid images and display a clear error message
- FR-004: The system SHALL support uploading from camera roll (mobile) and file picker (desktop)

**Address & Zone Resolution**

- FR-010: The system SHALL accept a US street address or ZIP code from the user
- FR-011: The system SHALL resolve the address to a USDA Plant Hardiness Zone (1a–13b)
- FR-012: The system SHALL display the resolved zone to the user with a brief explanation (e.g., "Zone 7b — Average minimum temperature: 5°F to 10°F")
- FR-013: The system SHALL allow the user to manually override the resolved zone
- FR-014: The system SHALL reject non-US addresses with a message indicating US-only support

**AI Analysis**

- FR-020: The system SHALL analyze the uploaded photo and identify visible landscape features including:
  - Existing plants (trees, shrubs, flowers, grass) with estimated species when possible
  - Hardscape elements (patios, walkways, fences, walls, decks)
  - Terrain characteristics (slope, drainage patterns, flat areas)
  - Sun exposure assessment (full sun, partial shade, full shade) based on visual cues
  - Approximate yard dimensions (small/medium/large) based on visual estimation
- FR-021: The system SHALL generate a structured analysis report containing:
  - A summary paragraph describing the yard
  - A list of identified features with confidence levels (high/medium/low)
  - Sun/shade assessment per visible area
  - Soil type estimation based on visual cues and geographic data
- FR-022: The system SHALL generate 5–10 personalized plant recommendations based on:
  - The user's USDA hardiness zone
  - Identified sun/shade conditions
  - Estimated soil type
  - Existing plants (to ensure visual compatibility)
  - Seasonal interest (recommending plants that bloom in different seasons)
- FR-023: Each plant recommendation SHALL include:
  - Common name and scientific name
  - Photo (from plant database)
  - Why it was recommended (specific to this yard)
  - Light requirements, water needs, mature size
  - Hardiness zone range
  - Estimated cost range (low/medium/high)
  - Difficulty level (beginner/intermediate/advanced)
- FR-024: The system SHALL categorize recommendations into:
  - "Quick Wins" — easy, high-impact additions
  - "Foundation Plants" — structural plants for long-term design
  - "Seasonal Color" — plants for specific seasonal interest
  - "Problem Solvers" — plants that address identified issues (erosion, privacy, shade)

**Results Display**

- FR-030: The system SHALL display analysis results on a dedicated results page
- FR-031: The system SHALL overlay identified features on the original photo as labeled regions
- FR-032: The system SHALL allow the user to save their analysis to their account (requires sign-up)
- FR-033: The system SHALL allow the user to start a new analysis

**Freemium Gating**

- FR-040: Free users SHALL receive 1 analysis per account with up to 5 plant recommendations
- FR-041: Premium users SHALL receive unlimited analyses with up to 10 recommendations per analysis, plus detailed care guides for each recommended plant
- FR-042: The system SHALL display a clear upgrade prompt when free limits are reached
- FR-043: The system SHALL allow unauthenticated users to perform 1 analysis (results are ephemeral unless they sign up)

### Non-Functional

- NFR-001: Photo upload SHALL complete in < 3 seconds on a 10Mbps connection
- NFR-002: AI analysis SHALL return results in < 30 seconds
- NFR-003: AI analysis SHALL show a progress indicator with status updates (e.g., "Analyzing photo...", "Identifying plants...", "Generating recommendations...")
- NFR-004: The analysis results page SHALL achieve a Lighthouse performance score ≥ 80
- NFR-005: Photo storage SHALL use S3 with server-side encryption (AES-256)
- NFR-006: The system SHALL not retain photos of unauthenticated users beyond 24 hours

---

## API Contract

### POST /api/v1/analyses

Creates a new yard analysis. The photo is uploaded as multipart/form-data.

- **Auth:** Optional (unauthenticated users get ephemeral results)
- **Request:** `multipart/form-data`
  - `photo`: Image file (JPEG, PNG, HEIC; max 20MB)
  - `address`: JSON string matching `AddressInputSchema`
- **Response:** `201 Created` → `AnalysisResponseSchema`
- **Errors:**
  - `400` — Invalid image format, file too large, or invalid address
  - `413` — Payload too large (exceeds 20MB)
  - `422` — Non-US address provided
  - `429` — Rate limit exceeded (unauthenticated: 1/day by IP; free tier: 1 total)
  - `500` — AI analysis failed

### GET /api/v1/analyses/:id

Retrieves a previously created analysis.

- **Auth:** Required (owner only)
- **Response:** `200 OK` → `AnalysisResponseSchema`
- **Errors:**
  - `401` — Not authenticated
  - `403` — Not the owner of this analysis
  - `404` — Analysis not found

### GET /api/v1/zones/:zipCode

Resolves a ZIP code to a USDA hardiness zone.

- **Auth:** None
- **Response:** `200 OK` → `ZoneResponseSchema`
- **Errors:**
  - `400` — Invalid ZIP code format
  - `404` — ZIP code not found in USDA database

---

## Acceptance Criteria

### Photo Upload

```gherkin
Scenario: User uploads a valid yard photo
  Given I am on the analysis page
  When I upload a JPEG photo of my yard (5MB)
  Then I see a preview of my photo
  And the "Analyze" button becomes enabled

Scenario: User uploads an invalid file
  Given I am on the analysis page
  When I upload a PDF file
  Then I see an error: "Please upload a JPEG, PNG, or HEIC image"
  And the "Analyze" button remains disabled

Scenario: User uploads a file that's too large
  Given I am on the analysis page
  When I upload a 25MB photo
  Then I see an error: "Image must be under 20MB"
```

### Address & Zone

```gherkin
Scenario: User enters a valid ZIP code
  Given I have uploaded a photo
  When I enter ZIP code "28202"
  Then I see "Zone 7b — Avg min temp: 5°F to 10°F"
  And the zone is pre-selected for my analysis

Scenario: User enters a non-US address
  Given I have uploaded a photo
  When I enter "London, UK" as my address
  Then I see: "Landscape Architect currently supports US addresses only"
```

### AI Analysis

```gherkin
Scenario: Successful analysis of a backyard photo
  Given I have uploaded a photo of my backyard
  And I have entered ZIP code "28202" (Zone 7b)
  When I click "Analyze My Yard"
  Then I see a progress indicator with status updates
  And within 30 seconds I see my analysis results
  And the results include a summary paragraph
  And the results include identified features overlaid on my photo
  And the results include 5-10 plant recommendations
  And each recommendation shows why it suits my yard

Scenario: Analysis for a shady yard recommends shade-tolerant plants
  Given I upload a photo showing a heavily shaded yard
  And my zone is 7b
  When the analysis completes
  Then all recommended plants include "partial shade" or "full shade" in their light requirements
```

### Freemium Gating

```gherkin
Scenario: Unauthenticated user completes their first analysis
  Given I am not signed in
  When my analysis completes
  Then I see my results with up to 5 plant recommendations
  And I see a prompt: "Sign up to save your results and unlock more recommendations"

Scenario: Free user tries a second analysis
  Given I am signed in as a free user
  And I have already completed 1 analysis
  When I try to start a new analysis
  Then I see: "Upgrade to Premium for unlimited yard analyses"
  And I see a link to the upgrade page
```

---

## Edge Cases & Error Scenarios

- **Non-yard photo:** User uploads a photo of their cat. AI should detect this and respond: "We couldn't identify a yard or garden in this photo. Try uploading a photo of your outdoor space."
- **Indoor plant photo:** User uploads an indoor photo. Similar handling — suggest they upload an outdoor yard photo.
- **Multiple yards in one photo:** AI analyzes the primary/largest visible area.
- **Winter photo:** Yard covered in snow. AI should note limited visibility and recommend based on zone/address data rather than visual plant identification.
- **Aerial/satellite photo:** Should work — may actually provide better dimension estimates.
- **AI service outage:** Return a 503 with: "Our analysis service is temporarily unavailable. Please try again in a few minutes." Queue for retry if user is authenticated.
- **Concurrent uploads:** A user uploads while a previous analysis is still processing. Queue the second, don't cancel the first.

---

## Security Considerations

- **Authentication:** Optional for first analysis, required to save/retrieve results
- **Authorization:** Users can only access their own analyses (resource-owner model)
- **Input validation:** All inputs validated via Zod schemas (see `packages/shared/schemas`)
- **Photo storage:** S3 with SSE-S3 encryption, private bucket, pre-signed URLs for access
- **Photo retention:** Unauthenticated uploads auto-deleted after 24 hours via S3 lifecycle policy
- **Rate limiting:** By IP for unauthenticated users, by user ID for authenticated users
- **AI prompt injection:** Photos are sent as images only, never as text. User-provided text (address) is validated and sanitized before inclusion in any AI prompt.
- **PII:** Address data is stored encrypted. Not shared with AI beyond zone resolution.

---

## Technical Notes

### AI Integration

- Use Claude's vision capabilities (Anthropic API) for photo analysis
- System prompt defines the analysis structure and plant recommendation format
- Response is parsed and validated against `AnalysisResultSchema` before storage
- Fallback: If structured parsing fails, retry once with a more explicit prompt

### USDA Zone Data

- Static dataset: ZIP code → zone mapping (~42,000 entries)
- Source: USDA Plant Hardiness Zone Map (2023 revision)
- Stored as a lookup table in the database, cached aggressively (zones don't change often)
- Consider bundling as a static JSON file for the zone lookup endpoint

### Plant Database

- Seed with ~500 common landscape plants for US zones 3–10
- Each plant tagged with: zones, light, water, soil, size, bloom season, cost, difficulty
- This is a prerequisite for this feature — the recommendations reference plants from this database
- Detailed spec to follow in a separate feature spec

---

## Dependencies

- Plant database must exist (at least a seed dataset) before recommendations work
- USDA zone lookup data must be loaded
- S3 bucket for photo storage (part of CDK infra)
- Anthropic API key provisioned and stored in Secrets Manager

---

## Open Questions

- [ ] Should we support multiple photos per analysis (front yard + back yard)?
- [ ] Should we offer a "virtual staging" view that shows recommended plants composited onto the photo? (likely premium feature, future phase)
- [ ] What is the premium pricing? ($X/month or $X/year)
- [ ] Should we integrate with local nursery inventory for "buy this plant near you" links?
- [ ] Do we need to handle landscape orientation vs portrait differently in the analysis?
