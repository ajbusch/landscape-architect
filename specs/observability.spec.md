# Feature: Observability

## Status

Phase 1 deployed. Phase 3 ready for implementation.

## Context

This spec defines a phased approach using Datadog, starting with structured logging and log shipping (Phase 1), expanding to metrics, tracing, and alerting in later phases.

Related: AI Analysis Integration v2 (Async) spec, ADR-004 (DynamoDB)

---

## Architecture Overview

```
Lambda (API + Worker) — ARM64 architecture
  │
  ├─ Pino JSON logs ──► CloudWatch Logs
  │                          │
  │                    Datadog Extension (Lambda Layer, ARM variant)
  │                          │
  │                          ▼
  │                     Datadog Logs (us5.datadoghq.com) ◄── Claude Code (via MCP)
  │
  ├─ Datadog Node.js Library Layer (datadog-lambda-js + dd-trace, multi-arch)
  │     │
  │     ├─ Auto-instruments AWS SDK, HTTP, Pino
  │     └─ Handler redirect (DD_LAMBDA_HANDLER)
  │                          │
  │                    Datadog Extension (same layer as above)
  │                          │
  │                          ▼
  │                     Datadog APM (us5.datadoghq.com)
  │
  └─ Cross-Lambda correlation via analysisId facet
```

**Key decisions:**

- **Pino** for structured logging (already a Fastify dependency — zero new deps)
- **Datadog Lambda Extension** (ARM variant) for log/metric/trace shipping (not the legacy Forwarder)
- **Datadog Node.js Library Layer** (multi-arch) for tracing (provides pre-built `datadog-lambda-js` + `dd-trace` — NOT installed as npm deps due to esbuild incompatibility)
- **Handler redirect** for trace instrumentation (no application code changes)
- **Explicit CloudWatch log groups** in CDK with retention policies
- **Both Lambdas are ARM64** — the Extension layer ARN must use the `-ARM` suffix (Go binary). The Node.js library layer is published as multi-arch (single ARN for x86 and ARM64)

---

## Phase 1: Structured Logging + Datadog (Deployed)

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

**ARM64 note:** Both Lambdas use `Architecture.ARM_64`. The Datadog Extension layer ARN must use the `-ARM` suffix (it contains a Go binary). The Node.js library layer is published as multi-arch and does not require a suffix. Using an x86 Extension layer on ARM Lambdas will fail at invocation time.

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
  // Both Lambdas are ARM64 — must use -ARM suffix variant
  const region = cdk.Stack.of(this).region;
  const datadogExtension = lambda.LayerVersion.fromLayerVersionArn(
    this,
    'DatadogExtension',
    `arn:aws:lambda:${region}:464622532012:layer:Datadog-Extension-ARM:65`,
  );

  for (const fn of [apiLambda, workerLambda]) {
    fn.addLayers(datadogExtension);
    fn.addEnvironment('DD_API_KEY_SECRET_ARN', props.ddApiKeySecret.secretArn);
    fn.addEnvironment('DD_SITE', 'us5.datadoghq.com');
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

After logs are flowing, configure in the Datadog UI (at us5.datadoghq.com):

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
        "DATADOG_SITE": "us5.datadoghq.com"
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

## Phase 2: Metrics & Dashboards (After Phase 3)

**Goal:** Understand performance characteristics and usage patterns.

**Why after Phase 3:** Tracing provides more immediate debugging value than log-based metrics. Metrics are derived from Phase 1 logs (no code changes), so they can be added at any time.

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

## Phase 3: Distributed Tracing (Now)

**Goal:** Trace a single analysis request across API Lambda → S3 → Worker Lambda → Claude API → DynamoDB.

### Critical: esbuild Compatibility

`dd-trace` is **not compatible with esbuild bundling** due to conditional imports and native modules. The CDK `NodejsFunction` construct uses esbuild by default.

**Solution:** Use the **Datadog Node.js Lambda Layer** (multi-arch, includes pre-built `datadog-lambda-js` + `dd-trace`) and mark them as esbuild externals. Do NOT install `datadog-lambda-js` or `dd-trace` as npm dependencies.

### 3.1 CDK Changes (ApiStack)

All tracing changes are in the ApiStack, inside the existing `if (props.ddApiKeySecret)` block. No application code changes required.

#### Add the Datadog Node.js Library Layer

Add a second Lambda Layer alongside the existing Extension layer. The Node.js layer contains pre-built `datadog-lambda-js` and `dd-trace`.

```typescript
// Existing Extension layer — keep at currently deployed version (ARM:65)
// The Extension contains a Go binary, so it requires the -ARM suffix for ARM64.
// Upgrading the Extension version is a separate concern; do not bundle
// with the tracing change. Validate new versions independently.
const datadogExtension = lambda.LayerVersion.fromLayerVersionArn(
  this,
  'DatadogExtension',
  `arn:aws:lambda:${region}:464622532012:layer:Datadog-Extension-ARM:65`,
);

// NEW: Datadog Node.js library layer
// This layer is published as multi-arch (single ARN for x86 and ARM64).
// Unlike the Extension layer (Go binary), it does NOT require an -ARM suffix.
// Match to your Lambda's Node.js runtime:
//   Node 18 → Datadog-Node18-x:133
//   Node 20 → Datadog-Node20-x:133
//   Node 22 → Datadog-Node22-x:133
const datadogNodeLib = lambda.LayerVersion.fromLayerVersionArn(
  this,
  'DatadogNodeLib',
  `arn:aws:lambda:${region}:464622532012:layer:Datadog-Node20-x:133`,
);
```

Add both layers to both Lambdas:

```typescript
for (const fn of [apiLambda, workerLambda]) {
  fn.addLayers(datadogExtension, datadogNodeLib);
  // ... existing DD_* env vars ...
}
```

#### Add esbuild Externals

For BOTH `NodejsFunction` constructs, mark `datadog-lambda-js` and `dd-trace` as external so esbuild skips them. They're provided by the Layer at runtime.

```typescript
// API Lambda — add datadog externals alongside existing ones
const apiLambda = new NodejsFunction(this, 'ApiFunction', {
  bundling: {
    externalModules: ['@aws-sdk/*', 'sharp', 'datadog-lambda-js', 'dd-trace'],
  },
  // ... other config
});

// Worker Lambda — same externals
const workerLambda = new NodejsFunction(this, 'AnalysisWorker', {
  bundling: {
    externalModules: ['@aws-sdk/*', 'sharp', 'datadog-lambda-js', 'dd-trace'],
  },
  // ... other config
});
```

#### Handler Redirect

The Datadog Node.js layer uses handler redirection to wrap handlers without code changes. For each Lambda:

1. Set `DD_LAMBDA_HANDLER` to the original handler value
2. Override the Lambda handler to the Datadog wrapper path

**Important:** The API Lambda exports `lambdaHandler` (see `apps/api/src/lambda.ts`), not `handler`. The Worker exports `handler`. Getting these wrong will cause every invocation to 500.

```typescript
if (props.ddApiKeySecret) {
  // After construction, set up handler redirect for Datadog tracing
  for (const { fn, originalHandler } of [
    { fn: apiLambda, originalHandler: 'index.lambdaHandler' }, // apps/api/src/lambda.ts exports lambdaHandler
    { fn: workerLambda, originalHandler: 'index.handler' }, // apps/api/src/worker.ts exports handler
  ]) {
    fn.addEnvironment('DD_LAMBDA_HANDLER', originalHandler);

    // Override handler at L1 (CfnFunction) level — this is a CDK escape hatch.
    // The official alternative is datadog-cdk-constructs-v2 which handles this
    // automatically, but it's heavier. This approach is fine for 2 functions.
    const cfnFn = fn.node.defaultChild as lambda.CfnFunction;
    cfnFn.handler = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler';
  }
}
```

**How it works:** The Datadog wrapper at `/opt/nodejs/node_modules/datadog-lambda-js/handler.handler` reads `DD_LAMBDA_HANDLER`, imports your original handler, wraps it with tracing instrumentation, and calls it. Your handler code is unchanged.

#### Add Tracing Environment Variables

Add to both Lambdas alongside the existing `DD_*` env vars:

```typescript
fn.addEnvironment('DD_TRACE_ENABLED', 'true');
fn.addEnvironment('DD_MERGE_XRAY_TRACES', 'false');
fn.addEnvironment('DD_COLD_START_TRACING', 'true');
fn.addEnvironment('DD_CAPTURE_LAMBDA_PAYLOAD', 'false');
fn.addEnvironment('DD_VERSION', props.version ?? 'unset');
```

Do NOT set `DD_FLUSH_TO_LOG` — with the Extension layer, traces ship directly.

For initial dev deployment, also add `DD_TRACE_DEBUG=true` to verify spans are flowing. **Warning:** This generates ~10x normal log volume. Pair with `DD_LOG_LEVEL=debug` on the Extension to see Extension-side debug logs as well. Remove both before promoting to staging.

#### Accept version prop

Add a `version` prop to ApiStackProps so `DD_VERSION` can be set from the deployment:

```typescript
interface ApiStackProps extends cdk.StackProps {
  stage: string;
  version?: string; // git SHA or package.json version, used for DD_VERSION
  ddApiKeySecret?: secretsmanager.ISecret;
}
```

Wire it in `app.ts`:

```typescript
const apiStack = new ApiStack(app, `LandscapeArchitect-Api-${stage}`, {
  stage,
  version: process.env.VERSION ?? 'local',
  ddApiKeySecret: observabilityStack.ddApiKeySecret,
});
```

In CI, set `VERSION` from the git SHA or tag: `VERSION=$(git rev-parse --short HEAD)`.

### 3.2 Complete DD\_\* Environment Variables

After Phase 3, both Lambdas have these Datadog environment variables:

```
# From Phase 1 (existing)
DD_API_KEY_SECRET_ARN=<secret-arn>
DD_SITE=us5.datadoghq.com
DD_LOG_LEVEL=info
DD_SERVERLESS_LOGS_ENABLED=true
DD_ENV=<stage>
DD_SERVICE=landscape-architect

# Phase 3 (new)
DD_TRACE_ENABLED=true
DD_MERGE_XRAY_TRACES=false
DD_COLD_START_TRACING=true
DD_CAPTURE_LAMBDA_PAYLOAD=false
DD_LAMBDA_HANDLER=<original-handler>
DD_VERSION=<git-sha-or-version>
```

`DD_SERVICE`, `DD_ENV`, and `DD_VERSION` together form Datadog's **unified service tagging**. Without `DD_VERSION`, the APM Deployments tab will be empty and you can't correlate traces to specific deploys.

### 3.3 Auto-Instrumentation Coverage

The handler redirect means **zero changes** to API or Worker Lambda source code. The Datadog layer wraps the handler transparently and auto-instruments:

- **AWS SDK v3 calls** — DynamoDB, S3, Lambda invoke, Secrets Manager all appear as spans automatically
- **Node.js `http`/`https` module calls** — any HTTP client using these modules gets traced
- **Cold starts** — tracked as spans when `DD_COLD_START_TRACING=true`

**Known gap: Anthropic SDK and `fetch()`** — The `@anthropic-ai/sdk` uses the native `fetch()` API internally (via undici on Node 20), not the `http`/`https` modules. `dd-trace`'s auto-instrumentation patches `http`/`https` but may not patch native `fetch()` depending on the dd-trace version in the layer. This means the Claude API call may not appear as a span automatically.

After deploying, verify whether a Claude API span appears in traces. If missing:

- Try setting `DD_TRACE_FETCH_ENABLED=true` (if supported by the layer version)
- If still missing, accept this gap — the Claude call duration is already captured by Pino logging (`step:claude`, `duration`) from Phase 1, which is correlated to the trace via `dd.trace_id`

This is a known limitation, not a blocker. Custom spans for fetch-based clients can be added later if needed by importing `dd-trace` from the layer in application code.

### 3.4 Trace-Log Correlation

`dd-trace` automatically injects `dd.trace_id`, `dd.span_id`, and `dd.service` into Pino log output. This means clicking a trace in Datadog APM shows the related logs, and clicking a log shows the related trace.

No Pino configuration changes needed — `dd-trace` patches Pino automatically when it detects it. Existing Pino fields are preserved; the `dd.*` fields are additive.

### 3.5 Cross-Lambda Trace Linking

The API Lambda invokes the Worker via `InvocationType: 'Event'` (async). This creates two separate traces — a **linked trace** pattern, not parent-child. The API trace ends before the Worker starts.

Correlation strategy:

- Both traces share the same `analysisId` (logged by both Lambdas and indexed as a Datadog facet from Phase 1)
- Datadog's "Related Traces" feature links them via `@analysisId:<value>`
- No manual trace context injection into the Lambda invoke payload needed

### 3.6 What You'll See in Datadog

After deployment, navigate to **APM → Traces** (at us5.datadoghq.com):

- **API Lambda traces** showing: API Gateway → Lambda handler → DynamoDB (zone lookup) → S3 (pre-signed URL) → Lambda invoke (Worker)
- **Worker Lambda traces** showing: S3 (photo download) → Secrets Manager → DynamoDB (multiple writes). Claude API call may or may not appear as a span (see section 3.3).
- **Service Map** showing the relationship between API and Worker services
- **Flame graphs** for each invocation showing time spent in each operation
- **Auto-correlated logs** — click any trace to see the Pino logs for that invocation
- **Deployments tab** — shows performance by `DD_VERSION`, letting you compare before/after a deploy

### 3.7 CDK Test Updates

**Update** the existing Datadog tests in `api-stack.test.ts`. The existing tests identify Lambdas by matching on `Handler: 'index.lambdaHandler'` and `Handler: 'index.handler'`. After the handler redirect, both Lambdas will have `Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'`, so you can no longer distinguish them by handler name. Switch to identifying Lambdas by `DD_LAMBDA_HANDLER` env var value or `MemorySize` (API = 512, Worker = 1024).

Updated and new assertions:

- API Lambda has exactly 2 Lambda Layers (Extension + Node.js library) when `ddApiKeySecret` is provided
- Worker Lambda has exactly 3 Lambda Layers (Sharp + Extension + Node.js library) when `ddApiKeySecret` is provided
- Both Lambdas have `DD_TRACE_ENABLED=true`
- Both Lambdas have `DD_LAMBDA_HANDLER` set (API = `index.lambdaHandler`, Worker = `index.handler`)
- Both Lambdas have handler set to `/opt/nodejs/node_modules/datadog-lambda-js/handler.handler`
- Both Lambdas have `datadog-lambda-js` and `dd-trace` in `externalModules`
- Both Lambdas have `DD_VERSION` set

### 3.8 Verification

After deploying to dev:

0. Before deploying, run `cdk synth` and verify the CloudFormation output shows `Handler: /opt/nodejs/node_modules/datadog-lambda-js/handler.handler` for both functions, not the original handler values. This confirms the CfnFunction override took effect.
1. Trigger an analysis (upload photo, poll for results)
2. Go to **Datadog → APM → Traces** (at us5.datadoghq.com)
3. Filter by `service:landscape-architect` and `env:dev`
4. Verify traces appear with spans for DynamoDB, S3, Secrets Manager
5. Check whether a Claude API (HTTPS) span appears — if not, see section 3.3
6. Click a Worker trace → verify the **Logs** tab shows correlated Pino logs
7. Search by `@analysisId:<value>` to see both API and Worker traces for the same analysis
8. Check **APM → Services → landscape-architect → Deployments** — verify `DD_VERSION` appears

### 3.9 Rollback

If tracing causes cold start regressions or breaks invocations:

1. Remove the `datadogNodeLib` layer from both Lambdas
2. Delete the `DD_LAMBDA_HANDLER`, `DD_TRACE_ENABLED`, `DD_COLD_START_TRACING`, `DD_MERGE_XRAY_TRACES`, `DD_CAPTURE_LAMBDA_PAYLOAD`, and `DD_VERSION` environment variables
3. Revert the `CfnFunction` handler override (restore original handlers)
4. Deploy

The esbuild externals for `datadog-lambda-js` and `dd-trace` are harmless to leave in place — they're no-ops without the layer present. The Extension layer (for logs) stays untouched.

---

## Phase 4: Alerting & SLOs (After Phase 3)

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

| Phase                               | What                                                                                                                            | When          | Effort   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| **1: Structured Logging + Datadog** | Pino logger, Extension layer, explicit log groups, error classification, cold start tracking, request ID correlation, MCP       | Deployed      | 1-2 days |
| **3: Distributed Tracing**          | Datadog Node.js Library Layer, handler redirect, esbuild externals, auto-instrumented traces, trace-log correlation, DD_VERSION | Now           | Half day |
| **2: Metrics & Dashboards**         | Log-based metrics, enhanced Lambda metrics, dashboard                                                                           | After Phase 3 | Half day |
| **4: Alerting & SLOs**              | Monitors with errorCategory/errorRetryable filtering, SLOs                                                                      | After Phase 3 | Half day |

---

## Risks & Mitigations

| Risk                                           | Impact                                                                                                 | Mitigation                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dd-trace cold start overhead                   | Additional 200-500ms on cold starts from dd-trace initialization (separate from the Extension's ~50ms) | Worker has 120s timeout so 200-500ms is negligible (~0.4%); API Lambda has 30s timeout and sub-1s typical response, so cold start impact is proportionally larger but acceptable for debugging value. Monitor `DD_COLD_START_TRACING` spans to quantify actual impact. |
| esbuild external misconfiguration              | Lambda fails to start with module not found                                                            | CDK tests verify externals are set; test in dev before staging/prod                                                                                                                                                                                                    |
| Handler redirect breaks existing handler       | Lambda invocations fail                                                                                | API exports `lambdaHandler`, Worker exports `handler` — must match exactly; CDK tests verify; test in dev                                                                                                                                                              |
| Wrong handler export name in DD_LAMBDA_HANDLER | Every invocation returns 500                                                                           | Spec documents exact export names with source file references                                                                                                                                                                                                          |
| x86 Extension layer on ARM Lambda              | Lambda fails at invocation time                                                                        | Extension layer uses `-ARM` suffix; Node.js library layer is multi-arch (no suffix needed); CDK tests could verify architecture match                                                                                                                                  |
| DD_SITE mismatch (wrong Datadog region)        | Traces/logs sent to wrong site, silently lost                                                          | Hardcoded to `us5.datadoghq.com` matching deployed infra                                                                                                                                                                                                               |
| dd-trace patches Pino log format               | Log pipeline breaks                                                                                    | dd-trace adds fields (`dd.trace_id`, `dd.span_id`) but doesn't change existing ones; existing Pino fields preserved                                                                                                                                                    |
| Anthropic SDK uses fetch(), not http           | Claude API call missing from traces                                                                    | Pino logs capture timing; try `DD_TRACE_FETCH_ENABLED=true`; accept gap if needed                                                                                                                                                                                      |
| Layer version incompatibility                  | Traces not shipped                                                                                     | Pin both layers to specific versions; keep Extension at deployed v65 for now                                                                                                                                                                                           |
| CfnFunction escape hatch breaks in future CDK  | Handler override silently ignored                                                                      | Alternative: `datadog-cdk-constructs-v2` handles this officially; monitor CDK release notes                                                                                                                                                                            |

---

## Cost Estimate

At current scale (<100 analyses/day):

- Datadog Extension: no additional Lambda cost (runs in existing execution environment)
- Extension cold start overhead: ~50ms per cold start
- Log ingestion: <1GB/month → free tier or ~$1/month
- Custom metrics (Phase 2): 5-10 metrics → free tier
- Serverless APM (Phase 3): Per-invocation billing, no APM Host charges for Lambda. Pricing is usage-based and changes — see [Datadog Serverless Billing](https://docs.datadoghq.com/account_management/billing/serverless/) for current rates. At 2 functions × 3 environments × ~100 invocations/day, expect <$10/month.

At scale this grows, but for early development the cost is negligible.
