# Feature: Observability

## Status

Ready for implementation (Phase 1)

## Context

The Worker Lambda is failing in dev with a generic "AI analysis failed" error. We have no visibility into what's happening — CloudWatch logs require manual tailing, there's no structured logging, and no centralized log aggregation. We need observability to diagnose the current failure and to support ongoing development.

This spec defines a phased approach using Datadog, starting with structured logging and log shipping (Phase 1), expanding to metrics, tracing, and alerting in later phases.

Related: AI Analysis Integration v2 (Async) spec, ADR-004 (DynamoDB)

---

## Architecture Overview

```
Lambda (API + Worker)
  │
  ├─ Pino JSON logs ──► CloudWatch Logs
  │                          │
  │                    Datadog Extension (Lambda Layer)
  │                          │
  │                          ▼
  │                     Datadog Logs ◄── Claude Code (via MCP)
  │
  └─ (Phase 3) Datadog Extension ──► Datadog APM
```

**Key decisions:**

- **Pino** for structured logging (already a Fastify dependency — zero new deps)
- **Datadog Lambda Extension** for log shipping (not the legacy Forwarder — Extension handles logs, metrics, and traces in one layer, avoiding a second mechanism in Phase 2)
- **Explicit CloudWatch log groups** in CDK with retention policies

---

## Phase 1: Structured Logging + Datadog (Now)

### 1.1 Structured Logger (Pino)

Fastify already initializes Pino with `logger: true` in `app.ts`. The API Lambda has structured JSON logging for HTTP requests out of the box. Rather than creating a competing custom logger, use Pino everywhere.

**Shared base logger** at `apps/api/src/lib/logger.ts`:

```typescript
import pino from 'pino';

export const logger = pino({
  base: {
    service: 'landscape-architect',
    stage: process.env.STAGE,
    lambda: process.env.AWS_LAMBDA_FUNCTION_NAME,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
```

The `formatters.level` override makes Pino output `"level": "info"` (string) instead of the default `"level": 30` (numeric). This ensures Datadog's standard status remapper works without a custom pipeline processor.

**Usage in the Worker Lambda** (standalone — no Fastify):

```typescript
import { logger } from './lib/logger';

// Create a child logger scoped to this invocation
const log = logger.child({
  analysisId,
  awsRequestId: context.awsRequestId,
  coldStart: isColdStart,
});

log.info({ step: 'download', duration: 1234, photoSizeBytes: 500000 }, 'Photo downloaded');
log.error({ step: 'claude', error: err.message, stack: err.stack }, 'Worker failed');
```

**Usage in the API Lambda** (via Fastify):

Fastify is currently initialized with `logger: true` in `app.ts`, which uses Pino defaults (`base: { pid, hostname }`). **This must be updated** to use the shared logger so API Lambda logs include the same `service`, `stage`, `lambda` fields as Worker logs:

```typescript
// apps/api/src/app.ts — change from `logger: true` to:
import { logger } from './lib/logger';

const app = fastify({ logger });
```

This gives Fastify the shared Pino instance. Route handlers continue using `request.log` (Pino child logger per request), which now inherits the base fields:

```typescript
request.log.info({ analysisId, zipCode, zone }, 'Analysis requested');
```

**Rules:**

- Every log line includes `service`, `stage`, `lambda` (from Pino base)
- Every log line includes `awsRequestId` (from `context.awsRequestId`, added via child logger)
- Every Worker log includes `analysisId` (via child logger)
- First log per invocation includes `coldStart: true/false`
- Error logs always include `error` (message), `stack` (trace), and `errorCategory`
- Duration-sensitive steps include `duration` in milliseconds
- Pino is the only logging mechanism — no raw `console.log` calls

**Cold start detection:**

```typescript
let isColdStart = true;

export async function handler(event: WorkerEvent, context: Context) {
  const log = logger.child({
    analysisId: event.analysisId,
    awsRequestId: context.awsRequestId,
  });

  log.info({ coldStart: isColdStart, step: 'start' }, 'Worker started');
  isColdStart = false;
  // ...
}
```

### 1.2 Worker Lambda Instrumentation

Add step-level logging with timing to every stage of the Worker. Each step logs on completion:

| Step             | Log message                   | Extra fields                                                                                       |
| ---------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| start            | "Worker started"              | `photoKey`, `zone`, `coldStart`                                                                    |
| status_analyzing | "Status updated to analyzing" | —                                                                                                  |
| download         | "Photo downloaded"            | `duration`, `photoSizeBytes`                                                                       |
| resize           | "Photo resized"               | `duration`, `resizedSizeBytes`                                                                     |
| secrets          | "API key retrieved"           | `duration`                                                                                         |
| claude           | "Claude responded"            | `duration`, `inputTokens`, `outputTokens`                                                          |
| parse            | "AI response parsed"          | `isValid`, `isValidYardPhoto`                                                                      |
| status_matching  | "Status updated to matching"  | —                                                                                                  |
| matching         | "Plants matched"              | `duration`, `matchCount`                                                                           |
| save_result      | "Result saved"                | —                                                                                                  |
| complete         | "Worker complete"             | `duration` (total)                                                                                 |
| error            | "Worker failed"               | `error`, `stack`, `lastStep`, `duration` (total), `errorCategory`, `errorRetryable`, `userMessage` |

`analysisId` and `awsRequestId` are on every line via the child logger — not listed per-row.

The top-level try/catch **must** log the error before writing the failed status to DynamoDB.

**Migration:** The Worker currently has raw `console.error` calls at 4 locations (`worker.ts:67, 87, 195, 201`). All must be replaced with structured Pino calls using the child logger. No raw `console.log` / `console.error` calls should remain after instrumentation.

### 1.3 Error Classification

The Worker must classify errors into categories for structured alerting in Phase 4. Every error log includes:

| Field            | Type    | Description                                          |
| ---------------- | ------- | ---------------------------------------------------- |
| `errorCategory`  | string  | One of the categories below                          |
| `errorRetryable` | boolean | Whether the user should retry                        |
| `userMessage`    | string  | The message written to DynamoDB (what the user sees) |

**Error categories:**

| Category                  | Retryable | User message                                                   |
| ------------------------- | --------- | -------------------------------------------------------------- |
| `download_failed`         | Yes       | "Unable to retrieve photo. Please try again."                  |
| `resize_failed`           | No        | "Unable to process this image format. Please try JPEG or PNG." |
| `secrets_failed`          | Yes       | "AI analysis failed. Please try again."                        |
| `claude_timeout`          | Yes       | "Analysis timed out. Please try again."                        |
| `claude_rate_limit`       | Yes       | "Service is busy. Please try again in a moment."               |
| `claude_invalid_response` | Yes       | "AI analysis failed. Please try again."                        |
| `claude_api_error`        | Yes       | "AI analysis failed. Please try again."                        |
| `invalid_photo`           | No        | (from AI response — `invalidPhotoReason`)                      |
| `matching_failed`         | Yes       | "AI analysis failed. Please try again."                        |
| `save_failed`             | Yes       | "AI analysis failed. Please try again."                        |
| `unknown`                 | Yes       | "AI analysis failed. Please try again."                        |

### 1.4 API Lambda Instrumentation

Fastify's Pino integration already logs HTTP requests/responses with `req`, `res`, `responseTime`. Add application-level logging to key routes:

| Route                      | When             | Fields                                                |
| -------------------------- | ---------------- | ----------------------------------------------------- |
| `POST /api/v1/upload-url`  | On success       | `analysisId`                                          |
| `POST /api/v1/analyses`    | On request       | `analysisId`, `zipCode`, `zone`                       |
| `POST /api/v1/analyses`    | On worker invoke | `analysisId`, `workerFunctionName`, `workerRequestId` |
| `GET /api/v1/analyses/:id` | On response      | `analysisId`, `status`                                |

**Request ID correlation:** When the API Lambda invokes the Worker, log the invocation's request ID from the Lambda invoke response:

```typescript
const invokeResult = await lambdaClient.send(invokeCommand);
request.log.info(
  {
    analysisId,
    workerFunctionName: WORKER_FUNCTION_NAME,
    workerRequestId: invokeResult.$metadata.requestId,
  },
  'Worker invoked',
);
```

This creates a correlation chain: API `awsRequestId` → Worker `awsRequestId` → `analysisId`.

Fastify's default error handler already logs 4xx/5xx errors via Pino. No additional error hook needed unless custom formatting is required.

### 1.5 CDK Prerequisites: Explicit Log Groups and STAGE Environment Variable

The ApiStack must create explicit `logs.LogGroup` constructs for both Lambdas. Currently the log groups are auto-created by AWS Lambda and aren't CloudFormation-managed, which means they can't be passed as cross-stack references and have no retention policy (logs accumulate forever).

**Changes to ApiStack:**

```typescript
// Create explicit log groups with retention — omit logGroupName so CDK
// automatically sets it to /aws/lambda/<function-name> when the logGroup
// prop is passed to NodejsFunction. Hardcoding the name would conflict
// because CDK-generated function names include a hash suffix.
const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
  retention: stage === 'prod' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
  retention: stage === 'prod' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Assign to Lambdas — CDK wires log group name automatically
const apiLambda = new NodejsFunction(this, 'ApiFunction', {
  logGroup: apiLogGroup,
  // ... other config
});

const workerLambda = new NodejsFunction(this, 'AnalysisWorker', {
  logGroup: workerLogGroup,
  // ... other config
});
```

**STAGE environment variable:** The API Lambda already has `STAGE: props.stage` in its environment. The **Worker Lambda does not** — add it:

```typescript
// Worker Lambda environment — add STAGE alongside existing vars
environment: {
  TABLE_NAME: tableName,
  BUCKET_NAME: bucketName,
  SECRET_ARN: secretArn,
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  STAGE: props.stage, // ← add this
  NODE_OPTIONS: '--enable-source-maps',
}
```

The logger reads `process.env.STAGE` for its base fields. Without this, the `stage` field will be `undefined` in all Worker logs.

**Expose as public properties** (consumed by FrontendStack for the API URL and available for future cross-stack references):

```typescript
public readonly apiLambda: lambda.Function;
public readonly workerLambda: lambda.Function;
```

**Retention policy:**

- Dev/Staging: 30 days
- Prod: 90 days

**Note:** If these log groups already exist in AWS from previous deploys (auto-created by Lambda runtime), CDK will fail on `CREATE`. Delete the existing log groups before deploying:

```bash
aws logs delete-log-group --log-group-name /aws/lambda/<actual-function-name>
```

Check actual function names with `aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `LandscapeArchitect`)].FunctionName'`.

**CDK assertion tests:** Update the existing `api-stack.test.ts` to assert that both log groups are created with the correct retention days and that both Lambdas reference their explicit log group.

### 1.6 Datadog Lambda Extension (CDK)

Ship logs from both Lambdas to Datadog using the Datadog Lambda Extension (a Lambda Layer). This replaces the legacy Datadog Forwarder approach — the Extension ships logs directly from the Lambda execution environment without CloudWatch subscription filters, and will also handle metrics and traces in later phases.

**Architecture note:** The Extension layer and environment variables are added to the Lambdas in the **ApiStack**, not in a separate ObservabilityStack. Mutating Lambda resources cross-stack (calling `addLayers()` / `addEnvironment()` on a Lambda owned by another stack) is a CDK anti-pattern that creates implicit circular dependencies and fragile deployment ordering. The ObservabilityStack owns only the Secrets Manager secret and exports its ARN for the ApiStack to consume.

#### ObservabilityStack (new): `infra/lib/stacks/observability-stack.ts`

Owns the Datadog API key secret and exports its ARN.

```typescript
interface ObservabilityStackProps extends cdk.StackProps {
  stage: string;
}
```

**Resources:**

1. **Secrets Manager secret** for the Datadog API key
   - Name: `LandscapeArchitect/${stage}/datadog-api-key`
   - Manually populated after first deploy

2. **CfnOutput** exporting the secret ARN for the ApiStack:

   ```typescript
   new cdk.CfnOutput(this, 'DatadogApiKeySecretArn', {
     value: ddApiKeySecret.secretArn,
     exportName: `${this.stackName}-DatadogApiKeySecretArn`,
   });
   ```

3. **Expose as public property** for direct TypeScript reference:
   ```typescript
   public readonly ddApiKeySecret: secretsmanager.ISecret;
   ```

**CDK assertion tests:** Create `observability-stack.test.ts` to assert the secret is created with the correct name pattern and that the CfnOutput export exists.

#### ApiStack changes: Extension layer + environment variables

Add the Extension layer and Datadog environment variables directly to both Lambdas in the ApiStack. Accept the secret as an optional prop — the entire Datadog Extension block is gated on the secret being present so the Extension is not added without a valid API key (an Extension without a key would log authentication errors on every invocation).

```typescript
interface ApiStackProps extends cdk.StackProps {
  stage: string;
  ddApiKeySecret?: secretsmanager.ISecret; // optional — no Datadog until secret stack deploys
}
```

```typescript
// Datadog Extension — only add if the API key secret is available.
// Without the secret, the Extension would start, fail to authenticate,
// and log errors on every invocation.
if (props.ddApiKeySecret) {
  // Pin to specific version, never use :latest
  // Layer ARN is region-specific; parameterize for multi-region support
  const region = cdk.Stack.of(this).region;
  const datadogExtension = lambda.LayerVersion.fromLayerVersionArn(
    this,
    'DatadogExtension',
    `arn:aws:lambda:${region}:464622532012:layer:Datadog-Extension:65`,
  );

  for (const fn of [apiLambda, workerLambda]) {
    fn.addLayers(datadogExtension);
    fn.addEnvironment('DD_API_KEY_SECRET_ARN', props.ddApiKeySecret.secretArn);
    fn.addEnvironment('DD_SITE', 'datadoghq.com');
    fn.addEnvironment('DD_LOG_LEVEL', 'info');
    fn.addEnvironment('DD_SERVERLESS_LOGS_ENABLED', 'true');
    fn.addEnvironment('DD_ENV', props.stage);
    fn.addEnvironment('DD_SERVICE', 'landscape-architect');
    props.ddApiKeySecret.grantRead(fn);
  }
}
```

#### Wiring in `infra/bin/app.ts`

Add alongside existing stack definitions in `app.ts` — preserve existing dependencies on Database and Storage stacks. The full dependency chain becomes: **Observability → Api → Frontend**.

```typescript
const observabilityStack = new ObservabilityStack(
  app,
  `LandscapeArchitect-Observability-${stage}`,
  {
    stage,
  },
);

const apiStack = new ApiStack(app, `LandscapeArchitect-Api-${stage}`, {
  stage,
  ddApiKeySecret: observabilityStack.ddApiKeySecret,
});
apiStack.addDependency(observabilityStack);

const frontendStack = new FrontendStack(app, `LandscapeArchitect-Frontend-${stage}`, {
  stage,
  apiUrl: apiStack.apiUrl,
  // ... other props
});
frontendStack.addDependency(apiStack);
```

**Cold start note:** The Extension adds ~50ms to cold starts. For the Worker Lambda (120s timeout) this is negligible. For the API Lambda (sub-1s typical response), it's noticeable but acceptable.

**Post-deploy step:** Populate the secret:

```bash
aws secretsmanager put-secret-value \
  --secret-id LandscapeArchitect/dev/datadog-api-key \
  --secret-string "<your-datadog-api-key>"
```

### 1.7 Datadog Log Pipeline Configuration

After logs are flowing, configure in the Datadog UI:

- **Log Pipeline** for `service:landscape-architect` (Datadog auto-detects Pino JSON)
- **Status Remapper** on the `level` attribute (maps Pino's string levels — `info`, `warn`, `error` — to Datadog's standard `status` field). This works automatically because the logger uses the `formatters.level` override (see section 1.1) to output string levels.
- **Facets** on: `analysisId`, `step`, `duration`, `stage`, `lambda`, `errorCategory`, `errorRetryable`, `coldStart`, `awsRequestId`
- **Saved View**: "Worker errors" — `service:landscape-architect @lambda:*Worker* status:error`
- **Saved View**: "Cold starts" — `service:landscape-architect @coldStart:true`
- **Saved View**: "Non-retryable errors" — `service:landscape-architect @errorRetryable:false`
- **Log-based Alert**: Worker error rate > 5 errors in 5 minutes → notify via email or Slack

### 1.8 Claude Code Datadog MCP

Enable the open-source Datadog MCP server so Claude Code can query logs directly during development.

**Config:** Add to `.claude/settings.json` (not committed — in `.gitignore`):

```json
{
  "mcpServers": {
    "datadog": {
      "command": "npx",
      "args": ["-y", "@winor30/mcp-server-datadog"],
      "env": {
        "DATADOG_API_KEY": "${DD_API_KEY}",
        "DATADOG_APP_KEY": "${DD_APP_KEY}",
        "DATADOG_SITE": "datadoghq.com"
      }
    }
  }
}
```

**Prerequisites:**

- Create Datadog API Key + Application Key in Datadog → Organization Settings
- Store as `DD_API_KEY` and `DD_APP_KEY` environment variables in shell profile
- Add `.claude/settings.json` to `.gitignore`

**Available tools:** `get_logs`, `list_metrics`, `get_metrics`, `get_monitors`, `list_hosts`, `list_incidents`, `list_dashboards`, `get_trace`, `list_spans`

**SDLC loop:**

1. Claude Code deploys a change
2. Runs `pnpm test:smoke`
3. If failure → queries Datadog logs for the analysisId → sees exact error + stack trace + errorCategory → fixes → redeploys
4. No manual CloudWatch tailing, no context switching

**Future migration:** When Datadog allowlists the org for the official remote MCP server, switch to:

```bash
claude mcp add datadog -- ~/.local/bin/datadog_mcp_cli \
  --endpoint-path /api/unstable/mcp-server/mcp?toolsets=core
```

---

## Phase 2: Metrics & Dashboards (Week 2-3)

**Goal:** Understand performance characteristics and usage patterns.

### Custom Metrics

The Datadog Lambda Extension is already deployed from Phase 1. Enable enhanced metrics by adding to the Extension environment variables in the ApiStack:

```typescript
fn.addEnvironment('DD_ENHANCED_METRICS', 'true');
```

Derive custom metrics from Phase 1 structured logs using Datadog's **log-based metrics** feature (no code changes needed):

| Metric                       | Source log field           | Why                    |
| ---------------------------- | -------------------------- | ---------------------- |
| `analysis.submitted.count`   | `step:start`               | Usage volume           |
| `analysis.completed.count`   | `step:complete`            | Success rate           |
| `analysis.failed.count`      | `step:error`               | Failure rate           |
| `analysis.duration.total`    | `step:complete → duration` | End-to-end worker time |
| `analysis.duration.claude`   | `step:claude → duration`   | Claude API latency     |
| `analysis.duration.resize`   | `step:resize → duration`   | Sharp processing time  |
| `analysis.duration.matching` | `step:matching → duration` | Plant matching time    |
| `analysis.cold_start.count`  | `coldStart:true`           | Cold start frequency   |
| `analysis.error.by_category` | `errorCategory`            | Error breakdown        |

### Dashboard

Create a "Landscape Architect" dashboard with:

- Analyses per hour (submitted, completed, failed)
- Success rate (%)
- Claude API latency (p50, p95, p99)
- Worker total duration (p50, p95, p99)
- Error breakdown by `errorCategory`
- Cold start frequency and impact on duration
- Photo size distribution

---

## Phase 3: Distributed Tracing (Week 4-6)

**Goal:** Trace a single analysis request across API Lambda → S3 → Worker Lambda → Claude API → DynamoDB.

### Approach: Datadog Extension + datadog-lambda-js

**Do not use raw `dd-trace`.** It has ~30MB of native modules, known ESM compatibility issues with esbuild-bundled CJS, and adds 500ms-2s to cold starts. Instead, use the `datadog-lambda-js` wrapper library which works with the Extension layer already deployed from Phase 1.

```bash
pnpm add datadog-lambda-js
```

```typescript
// Worker Lambda entry point
import { datadog } from 'datadog-lambda-js';

const workerHandler = async (event: WorkerEvent, context: Context) => {
  // ... existing handler logic
};

export const handler = datadog(workerHandler);
```

The Extension handles trace collection and shipping — no raw `dd-trace` import needed.

### Cross-Lambda trace linking

The API Lambda invokes the Worker with `InvocationType: 'Event'` (async/fire-and-forget). This is a **linked trace** pattern, not a parent-child span — the API Lambda completes and its trace ends before the Worker starts.

Correlation strategy:

- Both traces share the same `analysisId` (logged and indexed as a Datadog facet)
- Datadog's "Related Traces" feature links them via `analysisId`
- No manual trace context injection into the Lambda invoke payload needed

### Alternative: AWS X-Ray (zero-dependency)

If Datadog APM costs are a concern, X-Ray provides cross-service tracing with zero new dependencies:

```typescript
const workerLambda = new NodejsFunction(this, 'AnalysisWorker', {
  tracing: lambda.Tracing.ACTIVE,
  // ...
});
```

X-Ray is built into the AWS SDK already in use and traces DynamoDB, S3, and Lambda invokes automatically. Evaluate X-Ray vs Datadog APM based on whether the data needs to be in Datadog specifically or just needs trace visibility.

---

## Phase 4: Alerting & SLOs (Week 6+)

**Goal:** Get notified before users notice problems.

### Alerts

| Alert                   | Condition                                    | Priority   |
| ----------------------- | -------------------------------------------- | ---------- |
| Worker error spike      | >5 failures in 5 min                         | P1 (Slack) |
| Non-retryable errors    | Any `errorRetryable:false`                   | P2 (Slack) |
| Claude API latency      | p95 > 25s for 10 min                         | P2 (Slack) |
| Worker timeout          | Any invocation > 100s                        | P2 (Slack) |
| Analysis success rate   | < 90% over 15 min                            | P1         |
| Secrets Manager failure | `errorCategory:secrets_failed`               | P1         |
| S3 download failures    | `errorCategory:download_failed` > 3 in 5 min | P2         |
| Cold start spike        | > 20% of invocations cold in 15 min          | P3 (Slack) |

**Error classification enables differentiated alerting:** P1 for non-retryable errors (user is stuck), P2 for retryable errors (user can recover).

### SLOs

| SLO                            | Target | Window  |
| ------------------------------ | ------ | ------- |
| Analysis success rate          | 95%    | 30 days |
| Analysis completion time (p95) | < 45s  | 30 days |
| API availability (non-5xx)     | 99.5%  | 30 days |

---

## Phase Summary

| Phase                               | What                                                                                                                      | When     | Effort   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| **1: Structured Logging + Datadog** | Pino logger, Extension layer, explicit log groups, error classification, cold start tracking, request ID correlation, MCP | Now      | 1-2 days |
| **2: Metrics & Dashboards**         | Log-based metrics, enhanced Lambda metrics, dashboard                                                                     | Week 2-3 | Half day |
| **3: Tracing**                      | datadog-lambda-js + Extension, linked traces via analysisId, evaluate X-Ray                                               | Week 4-6 | 1 day    |
| **4: Alerting & SLOs**              | Monitors with errorCategory/errorRetryable filtering, SLOs                                                                | Week 6+  | Half day |

---

## Cost Estimate

At current scale (<100 analyses/day):

- Datadog Extension: no additional Lambda cost (runs in existing execution environment)
- Extension cold start overhead: ~50ms per cold start
- Log ingestion: <1GB/month → free tier or ~$1/month
- Custom metrics (Phase 2): 5-10 metrics → free tier
- APM (Phase 3): Datadog APM pricing applies if not on free tier; X-Ray alternative is free-tier eligible

At scale this grows, but for early development the cost is negligible.
