# Feature: AI Analysis Integration (v2 — Async)

## Status

Ready for implementation

## Context

This spec replaces the synchronous analysis flow with an async pattern. The original design had the frontend block on a single POST request while the Lambda called Claude Vision. This consistently hit API Gateway's 30-second hard timeout because Claude Vision calls take 8-25s and combined with S3 download, image resizing, plant matching, and cold starts, the total regularly exceeded 30s.

The async pattern eliminates all timeout concerns by separating the request acceptance from the heavy processing.

Related: Yard Photo Analysis spec, Plant Database spec, ADR-004 (DynamoDB)

---

## End-to-End Flow

```
User/Frontend           API Lambda                  Worker Lambda         S3          Claude Vision    DynamoDB
 │                       │                           │                    │                │              │
 │─ PUT photo ──────────────────────────────────────────────────────────►│                │              │
 │  (pre-signed URL)     │                           │                    │                │              │
 │◄─ 200 ───────────────────────────────────────────────────────────────│                │              │
 │                       │                           │                    │                │              │
 │─ POST /analyses ─────►│                           │                    │                │              │
 │  { photoKey, zipCode} │                           │                    │                │              │
 │                       │── validate input           │                    │                │              │
 │                       │── resolve zone (in-memory) │                    │                │              │
 │                       │── create record ─────────────────────────────────────────────────────────────►│
 │                       │   status: "pending"        │                    │                │              │
 │                       │── async invoke ───────────►│                    │                │              │
 │◄─ 202 { id, status } │                           │                    │                │              │
 │                       │                           │                    │                │              │
 │                       │                           │── update status ──────────────────────────────────►│
 │                       │                           │   "analyzing"       │                │              │
 │                       │                           │── download photo ──►│                │              │
 │                       │                           │◄─ photo bytes ─────│                │              │
 │                       │                           │── resize (sharp)    │                │              │
 │                       │                           │── send to Claude ──────────────────►│              │
 │                       │                           │◄─ JSON response ───────────────────│              │
 │                       │                           │── validate (Zod)    │                │              │
 │                       │                           │── update status ──────────────────────────────────►│
 │                       │                           │   "matching"        │                │              │
 │                       │                           │── query plants ──────────────────────────────────►│
 │                       │                           │◄─ plant records ─────────────────────────────────│
 │                       │                           │── save result ────────────────────────────────────►│
 │                       │                           │   status: "complete" │                │              │
 │                       │                           │                    │                │              │
 │─ GET /analyses/:id ──►│                           │                    │                │              │
 │  (polling every 2s)   │── read from DynamoDB ───────────────────────────────────────────────────────►│
 │                       │◄─ record ────────────────────────────────────────────────────────────────────│
 │◄─ { status, result }  │                           │                    │                │              │
```

---

## 1. Photo Upload (unchanged)

The frontend uploads the photo directly to S3 via pre-signed URL before submitting the analysis. This is already implemented and working.

- Frontend calls `POST /api/v1/upload-url` to get a pre-signed PUT URL
- Frontend PUTs the photo directly to S3
- S3 path: `photos/{userId|anonymous}/{analysisId}/original.{ext}`
- The S3 key is passed to the analysis endpoint

---

## 2. API Endpoints

### POST /api/v1/analyses (API Lambda)

**Request body:**

```json
{
  "photoKey": "photos/anonymous/abc-123/original.jpg",
  "zipCode": "22903"
}
```

**What it does (must complete in <3s):**

1. Validate input (photoKey exists in S3, zipCode is valid 5-digit)
2. Resolve ZIP to USDA zone via in-memory lookup
3. Generate analysisId (UUID)
4. Write DynamoDB record with `status: "pending"`
5. Async invoke the Worker Lambda (InvocationType: 'Event') passing `{ analysisId, photoKey, zipCode, zone }`
6. Return immediately

**Response: 202 Accepted**

```json
{
  "id": "abc-123-def-456",
  "status": "pending"
}
```

**Error responses:**

- 400: Invalid input (bad ZIP format, missing photoKey)
- 404: ZIP code not found

### GET /api/v1/analyses/:id (API Lambda)

**What it does:**

1. Read DynamoDB record by analysisId
2. Return current status and result (if complete)

**Response depends on status:**

```json
// Pending/processing
{
  "id": "abc-123",
  "status": "pending",
  "createdAt": "2026-02-16T..."
}

// Analyzing
{
  "id": "abc-123",
  "status": "analyzing",
  "createdAt": "2026-02-16T..."
}

// Matching plants
{
  "id": "abc-123",
  "status": "matching",
  "createdAt": "2026-02-16T..."
}

// Complete — includes full result
{
  "id": "abc-123",
  "status": "complete",
  "createdAt": "2026-02-16T...",
  "result": { /* full AnalysisResponseSchema */ }
}

// Failed
{
  "id": "abc-123",
  "status": "failed",
  "createdAt": "2026-02-16T...",
  "error": "Analysis timed out. Please try again."
}
```

**Error responses:**

- 404: Analysis not found (or expired)

---

## 3. Worker Lambda

This is a NEW Lambda function, separate from the API Lambda. It runs asynchronously with a 120-second timeout.

**Input (from async invoke):**

```json
{
  "analysisId": "abc-123",
  "photoKey": "photos/anonymous/abc-123/original.jpg",
  "zipCode": "22903",
  "zone": "7b",
  "zoneDescription": "5 to 10°F"
}
```

**Processing steps:**

1. Update DynamoDB status → `"analyzing"`
2. Download photo from S3
3. Resize with Sharp: max 1600px longest edge, JPEG, 85% quality (handles HEIC conversion too)
4. Base64 encode the resized image
5. Read Anthropic API key from Secrets Manager (cached for Lambda lifecycle)
6. Call Claude Vision API with the system prompt and user message (unchanged from current spec)
7. Parse JSON response, validate with Zod (`AiAnalysisOutputSchema`)
8. If invalid JSON or schema failure: retry once. If retry fails: set status to `"failed"`
9. If `isValidYardPhoto` is false: set status to `"complete"` with the invalid photo result
10. Update DynamoDB status → `"matching"`
11. For each `recommendedPlantType`, query DynamoDB for matching plants
12. Assemble final result conforming to `AnalysisResponseSchema`
13. Write complete result to DynamoDB, set status → `"complete"`

**On any unhandled error:**

- Catch at top level
- Update DynamoDB status → `"failed"` with error message
- Log the full error to CloudWatch

---

## 4. DynamoDB Record

```
PK: ANALYSIS#{analysisId}
SK: ANALYSIS#{analysisId}
status: "pending" | "analyzing" | "matching" | "complete" | "failed"
photoKey: "photos/anonymous/{analysisId}/original.jpg"
zipCode: "22903"
zone: "7b"
result: { ... }              // populated when status = "complete"
error: "..."                 // populated when status = "failed"
createdAt: ISO string
updatedAt: ISO string
ttl: <epoch seconds>         // 7 days from creation, auto-delete
```

**Key decision:** The result object is stored directly in the DynamoDB item. At ~2-5KB per analysis result, this is well within DynamoDB's 400KB item limit. No need for a separate S3 storage path for results.

---

## 5. Frontend Polling Flow

```typescript
// After POST /analyses returns 202
const { id } = await submitAnalysis(photoKey, zipCode);

// Poll every 2 seconds
const poll = setInterval(async () => {
  const analysis = await getAnalysis(id);

  switch (analysis.status) {
    case 'pending':
      setMessage('Starting analysis...');
      break;
    case 'analyzing':
      setMessage('Analyzing your yard...');
      break;
    case 'matching':
      setMessage('Finding perfect plants for your zone...');
      break;
    case 'complete':
      clearInterval(poll);
      navigateToResults(id);
      break;
    case 'failed':
      clearInterval(poll);
      showError(analysis.error);
      break;
  }
}, 2000);

// Safety timeout: stop polling after 120 seconds
setTimeout(() => {
  clearInterval(poll);
  showError('Analysis is taking longer than expected. Please try again.');
}, 120000);
```

**UX requirements:**

- Show progress indicator with stage-specific messages
- Disable the form while polling
- Allow canceling (stops polling, navigates back)
- On "failed", show retry button that re-submits

---

## 6. CDK Infrastructure Changes

### New: Worker Lambda

```typescript
const workerLambda = new lambda.Function(this, 'AnalysisWorker', {
  functionName: `LandscapeArchitect-${stage}-AnalysisWorker`,
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('../apps/api/dist/worker'), // separate entry point
  timeout: Duration.seconds(120),
  memorySize: 1024, // sharp needs more memory for image processing
  environment: {
    TABLE_NAME: table.tableName,
    PHOTO_BUCKET: photoBucket.bucketName,
    ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
    CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  },
});

// Permissions
photoBucket.grantRead(workerLambda);
table.grantReadWriteData(workerLambda);
anthropicSecret.grantRead(workerLambda);

// API Lambda needs permission to invoke the worker
workerLambda.grantInvoke(apiLambda);
```

### API Lambda changes

- Add WORKER_FUNCTION_NAME environment variable
- Add permission to invoke the worker
- Remove Anthropic secret access (no longer needed on API Lambda)
- Remove sharp dependency from API Lambda (no longer needed)

---

## 7. Error Handling

| Error                           | Where      | Handling                                                                              |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Invalid input                   | API Lambda | Return 400 immediately                                                                |
| ZIP not found                   | API Lambda | Return 404 immediately                                                                |
| Worker invoke fails             | API Lambda | Return 500 immediately                                                                |
| S3 download fails               | Worker     | Set status "failed", message: "Unable to retrieve photo"                              |
| Sharp resize fails              | Worker     | Set status "failed", message: "Unable to process image"                               |
| Claude API timeout              | Worker     | Set status "failed", message: "Analysis timed out. Please try again."                 |
| Claude API rate limit           | Worker     | Set status "failed", message: "Service is busy. Please try again."                    |
| Claude invalid JSON             | Worker     | Retry once. If fails: status "failed"                                                 |
| Claude schema validation fails  | Worker     | Retry once. If fails: status "failed"                                                 |
| No plants match criteria        | Worker     | Return analysis without recs for that category. Fall back to popular plants for zone. |
| Photo is not a yard             | Worker     | Set status "complete" with isValidYardPhoto: false                                    |
| Secrets Manager fails           | Worker     | Set status "failed", log error                                                        |
| Worker crashes/times out        | Worker     | DynamoDB record stays as last status. Frontend safety timeout catches it.             |
| Polling finds stale "analyzing" | Frontend   | Safety timeout after 120s shows retry                                                 |

### Retry Strategy (Worker)

- Max 1 retry on Claude JSON parsing failures
- No retry on Claude timeouts or rate limits
- No retry on S3/Sharp failures (deterministic)
- Exponential backoff on DynamoDB transient errors

---

## 8. Claude Vision Prompt Design

**Unchanged from v1.** The system prompt, user message, and response schema are the same. The only difference is where the code runs (Worker Lambda instead of API Lambda).

See sections 3, 7, and 8 of the original spec for prompt design, API configuration, and Zod schemas.

---

## 9. Cost & Performance

### Performance Budget

- POST /analyses response: <1s (just validation + DynamoDB write + async invoke)
- Worker total: 15-45s (no longer matters — user sees progress)
- GET /analyses/:id: <100ms (DynamoDB read)
- Polling overhead: ~10-20 GET requests at 2s intervals = minimal

### Cost Impact

- Same Claude API costs as before (~$0.01-0.03 per analysis)
- Slightly more DynamoDB writes (status updates during processing): negligible
- Extra Lambda invocations (polling GETs): negligible at low volume
- Worker Lambda at 1024MB for up to 120s: ~$0.002 per analysis

---

## 10. Migration Path

This is a breaking change to the API contract. The frontend and backend must be deployed together.

**What changes:**

1. POST /analyses returns 202 with `{ id, status }` instead of 200 with full result
2. Frontend switches from "wait for POST response" to "poll GET endpoint"
3. New Worker Lambda added to CDK
4. API Lambda slimmed down (no more Claude/Sharp dependencies)

**What stays the same:**

- S3 photo upload flow (pre-signed URL)
- Claude prompt and response schema
- Plant matching logic
- DynamoDB table structure (adds new fields, doesn't change existing)
- GET /analyses/:id response shape when complete

---

## Security Considerations

- Photo is sent to Claude as base64 — never as a URL (prevents SSRF)
- User address/ZIP is NOT sent to Claude — only the resolved zone
- Anthropic API key only accessible to Worker Lambda (not API Lambda)
- AI response is validated via Zod before any downstream use
- Rate limiting on POST /analyses prevents abuse
- DynamoDB TTL auto-deletes analysis records after 7 days
- Worker Lambda has no public endpoint — only invokable by API Lambda
