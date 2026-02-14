# Feature: Frontend V1

## Status

Draft

## Context

The v1 frontend is a React SPA that lets anonymous users analyze their yard photos and browse plants. No authentication. Results are ephemeral (7-day TTL).

Related: Yard Photo Analysis spec, AI Analysis Integration spec, Plant Database spec

---

## Tech Stack

- React 18+ with TypeScript
- React Router v7
- Tailwind CSS v4
- shadcn/ui component library
- Vite (already configured)
- Vitest for unit tests
- Playwright for e2e tests

---

## Pages & Routes

| Route          | Page         | Description                                          |
| -------------- | ------------ | ---------------------------------------------------- |
| `/`            | Landing      | Hero, value prop, CTA to analyze, preview of results |
| `/analyze`     | Upload       | Photo upload dropzone, ZIP input, analyze button     |
| `/analyze/:id` | Results      | Yard summary, features, plant recommendations        |
| `/plants`      | Plant Browse | Filterable grid of all plants                        |
| `/plants/:id`  | Plant Detail | Full plant info page                                 |

---

## User Journeys

### Journey 1: Analyze My Yard

1. User lands on `/`
2. Clicks "Analyze Your Yard" CTA
3. Navigated to `/analyze`
4. Drags/drops or selects a photo (JPEG/PNG/HEIC, max 20MB)
5. Sees photo preview
6. Enters ZIP code
7. Clicks "Analyze"
8. Sees spinner while waiting (5-20s)
9. Navigated to `/analyze/:id` with results
10. Views: yard summary, sun/soil/size assessment, identified features, plant recommendations
11. Clicks a recommended plant card → navigated to `/plants/:id`
12. Returns to results via back button or nav
13. Can copy shareable link from results page

### Journey 2: Browse Plants

1. User clicks "Browse Plants" in nav
2. Navigated to `/plants`
3. Filters by zone, light, type, difficulty, native, deer resistant, drought tolerant
4. Browses plant cards in a grid
5. Clicks a plant card → navigated to `/plants/:id`
6. Views full plant info: description, photo, care requirements, zones, bloom season, tags

### Journey 3: View Shared Results

1. User receives a link to `/analyze/:id`
2. Opens link in browser
3. Sees full analysis results (if within 7-day window)
4. If expired: sees "This analysis has expired" with CTA to create a new one
5. Can click plant cards and browse plants

### Journey 4: Run Another Analysis

1. From results page or nav, clicks "Analyze Another Yard"
2. Navigated to `/analyze`
3. New analysis creates a new URL

---

## Page Specifications

### Landing Page (`/`)

**Hero Section:**

- Headline: communicates the core value prop (AI-powered yard analysis)
- Subheadline: briefly explains what the user gets
- Primary CTA button: "Analyze Your Yard" → links to `/analyze`
- Hero image or illustration of a yard analysis result

**How It Works Section:**

- Step 1: Upload a photo of your yard
- Step 2: Enter your ZIP code
- Step 3: Get personalized plant recommendations
- Keep it visual — icons or illustrations for each step

**Preview Section:**

- Example of what analysis results look like
- Shows the value before the user commits to uploading

**Footer:**

- Links to Browse Plants
- Basic info (about, privacy)

### Upload Page (`/analyze`)

**Photo Upload:**

- Drag-and-drop zone with click-to-browse fallback
- Accept: JPEG, PNG, HEIC
- Max size: 20MB
- Show file type/size validation errors inline
- Show photo preview after selection
- Allow removing/replacing the selected photo

**ZIP Code Input:**

- Text input with validation (5-digit ZIP)
- Show validation error inline if invalid
- Optional: show resolved zone after entry ("Zone 7b — Charlotte, NC area")

**Analyze Button:**

- Disabled until photo + valid ZIP are provided
- On click: POST to /api/v1/analyses
- Show spinner/loading state (5-20s expected)
- Disable all inputs during analysis
- On success: redirect to `/analyze/:id`
- On error: show error message, allow retry

**Edge Cases:**

- Non-yard photo → show 422 error from API with AI's explanation
- Timeout → show "Analysis timed out, please try again"
- Rate limited → show "Service is busy, please wait"

### Results Page (`/analyze/:id`)

**Layout:**

- Uploaded photo displayed prominently
- Share button (copies link to clipboard)
- "Analyze Another Yard" button

**Yard Summary Section:**

- AI-generated 2-3 sentence summary
- Badges for: yard size, overall sun exposure, estimated soil type
- USDA zone badge

**Identified Features Section:**

- List of features the AI found (trees, shrubs, patios, slopes, etc.)
- Each feature shows: label, type icon, confidence badge, notes
- Species name if identified

**Plant Recommendations Section:**

- Grouped by category: Quick Wins, Foundation Plants, Seasonal Color, Problem Solvers
- Each category has a heading and explanation
- Each recommendation shows a PlantCard linking to `/plants/:id`
- PlantCard displays: photo (placeholder if none), common name, scientific name, reason for recommendation, key stats (light, water, difficulty, zone range)

**Expired State:**

- If analysis not found or expired: show "This analysis has expired"
- CTA to create a new analysis

### Plant Browse Page (`/plants`)

**Filters (sidebar or top bar):**

- Zone: dropdown or input (e.g., "7b")
- Light: checkboxes (full sun, partial shade, full shade)
- Type: checkboxes (tree, shrub, perennial, grass, groundcover, vine)
- Difficulty: checkboxes (beginner, intermediate, advanced)
- Toggles: native only, deer resistant, drought tolerant
- Reset filters button
- Filters update the URL query params for shareability

**Results Grid:**

- PlantCard grid (responsive: 1 col mobile, 2 col tablet, 3-4 col desktop)
- Show total count
- Pagination or infinite scroll
- Empty state: "No plants match your filters"

### Plant Detail Page (`/plants/:id`)

**Plant Info:**

- Common name (large heading)
- Scientific name (italic)
- Photo (placeholder if none)
- Description

**Quick Stats:**

- Light requirements
- Water needs
- Mature size (height × width range)
- Hardiness zones (range)
- Bloom season
- Cost range
- Difficulty
- Deer resistant / drought tolerant badges
- Native badge

**Tags:**

- Display as chips/badges

**Navigation:**

- Back to browse
- "Find more plants like this" (link to browse with pre-filled filters)

**404 State:**

- Plant not found: show "Plant not found" with link to browse

---

## Shared Components

### Header

- Logo/app name (links to `/`)
- Nav links: Analyze Your Yard, Browse Plants
- Mobile: hamburger menu

### Footer

- Minimal: links to about, privacy, browse plants

### PlantCard

- Reused on results page and browse page
- Photo thumbnail (placeholder if none)
- Common name, scientific name
- Key stats as small badges (light, water, difficulty)
- Zone range
- On results page: includes "reason" text from the AI recommendation
- Entire card is clickable → `/plants/:id`

### LoadingSpinner

- Used during analysis
- Centered, with optional message text

### ErrorMessage

- Reusable error display
- Icon + message + optional retry button

---

## API Integration

All API calls go through a service layer at `apps/web/src/services/api.ts`:

```typescript
// Zone lookup (for showing zone after ZIP entry)
GET /api/v1/zones/:zip → ZoneResponseSchema

// Submit analysis
POST /api/v1/analyses → AnalysisResponseSchema
  Body: multipart (photo file + JSON with zipCode)

// Get analysis results
GET /api/v1/analyses/:id → AnalysisResponseSchema

// List/search plants
GET /api/v1/plants → PlantSearchResponseSchema
  Query: zone, light, type, difficulty, deerResistant, droughtTolerant, isNative, page, limit

// Get plant detail
GET /api/v1/plants/:id → PlantSchema
```

Use the Zod schemas from `packages/shared` to validate API responses on the client side.

---

## Non-Functional Requirements

- Lighthouse performance score ≥ 80
- Mobile-first responsive design
- All interactive elements accessible (keyboard nav, ARIA labels)
- Loading states for all async operations
- Error states for all failure modes
- No layout shift on image load (use aspect ratio placeholders)

---

## Out of Scope for V1

- Authentication (login/signup)
- Saving analyses to an account
- Analysis history / dashboard
- Annotated photo overlays
- AI-generated landscape renderings
- Dark mode
- Internationalization
