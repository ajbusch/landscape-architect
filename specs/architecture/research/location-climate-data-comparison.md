# Climate Data Model Comparison

## Two Test Locations

|               | Charlottesville, VA, USA | Fredericton, NB, Canada |
| ------------- | ------------------------ | ----------------------- |
| **Lat/Lng**   | 38.03, -78.48            | 45.96, -66.65           |
| **Elevation** | ~190m (620 ft)           | ~21m (68 ft)            |

---

## Model 1: Current System (USDA Zone from ZIP)

### What Claude receives today:

**Charlottesville:**

> "The homeowner is in USDA Hardiness Zone 7b (Average annual extreme minimum temperature 5 to 10°F)."

**Fredericton:**

> ❌ Cannot process — no US ZIP code. International users blocked entirely.
> (If we somehow mapped it: USDA Zone 5a, -28.9°C to -26.1°C based on Canadian sources using USDA methodology)

### What this tells Claude about the climate:

- One number: the coldest it gets in winter
- Nothing about: summer heat, rainfall, humidity, growing season length, frost dates, snow load, drought patterns

### The Seattle vs Charleston problem:

Both are USDA 8b. Claude gets the same single data point for radically different climates:

- Seattle: cool summers (avg high 75°F), dry summers, wet winters, ~37" rain
- Charleston: hot humid summers (avg high 91°F), year-round rain, ~50" rain

---

## Model 2: Static Köppen Classification (from lat/lng grid lookup)

### What Claude would receive:

**Charlottesville: `Cfa` — Humid Subtropical**

- C = Temperate (coldest month avg between 0°C and 18°C)
- f = No dry season (precipitation in driest month >40mm)
- a = Hot summer (hottest month avg >22°C)

**Fredericton: `Dfb` — Humid Continental, Warm Summer**

- D = Continental (coldest month avg below 0°C)
- f = No dry season
- b = Warm summer (hottest month avg <22°C, 4+ months >10°C)

### What this tells Claude:

- General climate regime (tropical/arid/temperate/continental/polar)
- Precipitation pattern (dry season or not, when)
- Summer heat level (hot vs warm vs cool)
- It's a 3-letter code — Claude's training data has extensive knowledge of what each means for gardening

### What it doesn't tell Claude:

- Specific temperatures (how cold? how hot?)
- Precipitation amounts
- Growing season length
- Frost dates

### Implementation:

- Static global raster (~10km resolution), ~50MB dataset
- Lat/lng → grid cell → 3-letter code
- Could bundle as JSON lookup or query from S3
- No external API dependency, sub-millisecond lookup
- Covers entire planet

---

## Model 3: Open-Meteo Historical Weather API (from lat/lng)

### What Claude would receive (derived from daily data aggregated to annual summary):

**Charlottesville (38.03, -78.48):**

```json
{
  "koppen": "Cfa",
  "annualAvgHigh_C": 19.3,
  "annualAvgLow_C": 7.2,
  "coldestMonthAvgLow_C": -3.3,
  "hottestMonthAvgHigh_C": 31.2,
  "annualPrecipitation_mm": 1047,
  "annualSnowfall_cm": 26.5,
  "frostFreeDays": ~200,
  "lastFrostDate": "~April 15",
  "firstFrostDate": "~October 25",
  "growingSeasonDays": ~193,
  "summerAvgHumidity_pct": 72,
  "driestMonth": "February (68mm)",
  "wettestMonth": "September (107mm)"
}
```

**Fredericton (45.96, -66.65):**

```json
{
  "koppen": "Dfb",
  "annualAvgHigh_C": 10.7,
  "annualAvgLow_C": -0.5,
  "coldestMonthAvgLow_C": -15.5,
  "hottestMonthAvgHigh_C": 25.5,
  "annualPrecipitation_mm": 1100,
  "annualSnowfall_cm": 258,
  "frostFreeDays": ~125,
  "lastFrostDate": "~May 20",
  "firstFrostDate": "~September 25",
  "growingSeasonDays": ~128,
  "summerAvgHumidity_pct": 70,
  "driestMonth": "February (~60mm)",
  "wettestMonth": "August (~100mm)"
}
```

### What this tells Claude:

- Everything. Specific temps, precipitation amounts, frost dates, growing season, humidity.
- Claude can make very precise plant recommendations.

### Implementation cost:

- Free for non-commercial use, no API key needed
- Historical API requires Professional plan for production ($29/mo)
- Or: pre-compute and cache results (fetch once per unique ~10km grid cell, store in DynamoDB)
- Adds ~200-500ms to Worker Lambda if called live
- External dependency on critical path

---

## Model 4: Just Give Claude the Location Name

### What Claude would receive:

**Charlottesville:**

> "The homeowner's yard is in Charlottesville, Virginia, USA (38.03°N, 78.48°W)."

**Fredericton:**

> "The homeowner's yard is in Fredericton, New Brunswick, Canada (45.96°N, 66.65°W)."

### What Claude knows from training:

Claude already knows:

- Charlottesville is USDA Zone 7a/7b, humid subtropical, hot summers, cold winters, ~42" rain, growing season April-October
- Fredericton is Zone 5a, humid continental, short growing season May-September, heavy snow, ~43" rain
- Appropriate plants for both regions
- Local soil types, common landscaping patterns, regional nursery availability

### What it doesn't know:

- Anything that changed since training cutoff
- Hyperlocal microclimate details
- It might occasionally confuse nearby places or get details slightly wrong
- Not deterministic — may give slightly different climate context on different runs

### Implementation:

- Zero. Pass display name + lat/lng from Google Places. Done.
- No dataset, no API, no latency, no dependency
- Works globally, immediately

---

## Model 5: Hybrid — Static Köppen + Location Name (Recommended)

### What Claude would receive:

**Charlottesville:**

> "The homeowner's yard is in Charlottesville, Virginia, USA (38.03°N, 78.48°W).
> Climate zone: Cfa (Humid Subtropical — hot summers, mild winters, no dry season).
> Provide plant recommendations appropriate for this climate."

**Fredericton:**

> "The homeowner's yard is in Fredericton, New Brunswick, Canada (45.96°N, 66.65°W).
> Climate zone: Dfb (Humid Continental — warm summers, cold winters, no dry season).
> Provide plant recommendations appropriate for this climate."

### What this gives Claude:

- Structured, deterministic climate classification (from static lookup)
- Rich contextual knowledge from training (from location name)
- Lat/lng for precision (elevation inference, coastal proximity, etc.)
- The Köppen code anchors Claude's response — prevents it from confusing climates

### Implementation:

- Static Köppen grid lookup (~50MB dataset, bundled or S3)
- Sub-millisecond lookup, no external API dependency
- Pass location name + lat/lng + Köppen code to Claude
- Can enrich with Open-Meteo later if the static data proves too coarse

---

## Side-by-Side: What Claude Gets in Each Model

| Data Point       | USDA Zone  | Köppen Only            | Open-Meteo            | Name Only      | Hybrid (Köppen + Name)  |
| ---------------- | ---------- | ---------------------- | --------------------- | -------------- | ----------------------- |
| Winter hardiness | ✅ precise | ✅ general             | ✅ precise            | ⚠️ from memory | ✅ general + memory     |
| Summer heat      | ❌         | ✅ general             | ✅ precise            | ⚠️ from memory | ✅ general + memory     |
| Precipitation    | ❌         | ✅ pattern only        | ✅ precise amounts    | ⚠️ from memory | ✅ pattern + memory     |
| Growing season   | ❌         | ❌                     | ✅ precise dates      | ⚠️ from memory | ⚠️ from memory          |
| Frost dates      | ❌         | ❌                     | ✅ precise dates      | ⚠️ from memory | ⚠️ from memory          |
| Humidity         | ❌         | ❌                     | ✅ precise            | ⚠️ from memory | ⚠️ from memory          |
| Works globally   | ❌ US only | ✅                     | ✅                    | ✅             | ✅                      |
| External API dep | ❌ none    | ❌ none                | ✅ yes                | ❌ none        | ❌ none                 |
| Deterministic    | ✅         | ✅                     | ✅                    | ❌             | ✅ (code) + ❌ (memory) |
| Implementation   | existing   | medium (~50MB dataset) | medium (API or cache) | zero           | medium (~50MB dataset)  |
| Latency added    | 0ms        | <1ms                   | 200-500ms             | 0ms            | <1ms                    |
