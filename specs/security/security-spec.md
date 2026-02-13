# Security Specification & Threat Model

## Status

Approved

## Date

2026-02-13

## Overview

This document defines the security posture for Landscape Architect. It is the authoritative reference for all security decisions. Every feature spec MUST reference this document and address the relevant threat categories.

**Principle:** Security is not a feature — it is a constraint that applies to all features.

Related: [ADR-001](../architecture/decisions/001-architecture-overview.md)

---

## 1. Threat Model

### 1.1 Assets (What We Protect)

| Asset                      | Sensitivity | Impact if Compromised                           | Status              |
| -------------------------- | ----------- | ----------------------------------------------- | ------------------- |
| User photos                | Medium      | Privacy violation, trust loss                   | Not yet stored      |
| User addresses/ZIP codes   | Medium      | PII exposure, regulatory risk                   | Schema defined      |
| User account credentials   | High        | Account takeover, data theft                    | Not yet implemented |
| Plant database             | Low         | IP loss, competitive disadvantage               | Not yet implemented |
| AI analysis results        | Low-Medium  | Contains user-specific yard data                | Schema defined      |
| AWS infrastructure         | Critical    | Service disruption, data breach, financial loss | NetworkStack only   |
| API keys (Anthropic, etc.) | Critical    | Financial abuse, service impersonation          | Not yet provisioned |
| Payment data (future)      | Critical    | Financial fraud, PCI compliance violation       | Not planned for v1  |

### 1.2 Threat Actors

| Actor                  | Motivation                      | Capability                               |
| ---------------------- | ------------------------------- | ---------------------------------------- |
| Opportunistic attacker | Financial gain, data harvesting | Automated scanning, known exploits       |
| Disgruntled user       | Abuse, disruption               | Authenticated access, social engineering |
| Competitor             | IP theft, service disruption    | Moderate technical skill                 |
| Automated bot          | Spam, resource abuse, scraping  | High volume, distributed                 |

### 1.3 Attack Surface

```
                    ┌──────────────────────────────────┐
                    │         Attack Surface            │
                    └──────────────────────────────────┘

   External                    Application                    Infrastructure
   ─────────                   ───────────                    ──────────────
   • CloudFront CDN            • API endpoints                • AWS IAM roles
   • API Gateway               • File upload (photos)         • S3 buckets
   • DNS (Route 53)            • Authentication flow          • RDS database
   • GitHub repo               • AI prompt construction       • Lambda functions
   • npm dependencies          • User input (addresses)       • Secrets Manager
                               • Session management           • VPC network
```

### 1.4 STRIDE Analysis

| Threat                                      | Category               | Mitigation                                            |
| ------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| Attacker impersonates user                  | Spoofing               | Cognito JWT validation, token rotation                |
| User modifies another user's analysis       | Tampering              | Resource-owner authorization on all endpoints         |
| User denies uploading inappropriate content | Repudiation            | Audit logging with CloudTrail, request logging        |
| Attacker accesses other users' photos       | Information Disclosure | S3 private bucket, pre-signed URLs, owner-only access |
| Attacker floods analysis endpoint           | Denial of Service      | Rate limiting, WAF, API Gateway throttling            |
| Attacker bypasses free tier limits          | Elevation of Privilege | Server-side tier enforcement, no client-side gating   |

---

## 2. Authentication & Authorization

### 2.1 Authentication

> **Implementation Status:** Not yet implemented. Required before any user-specific feature ships.

- **Provider:** AWS Cognito User Pool
- **Method:** JWT (access token + refresh token)
- **Token lifetime:** Access token: 1 hour. Refresh token: 30 days.
- **Storage:** Access token in memory only (never localStorage). Refresh token in httpOnly secure cookie.
- **MFA:** Optional for login, required for destructive operations (account deletion, data export)
- **Password policy:** Minimum 12 characters, no reuse of last 5 passwords
- **Account lockout:** 5 failed attempts → 15-minute lockout

### 2.2 Authorization Model

Resource-owner authorization: Users can only access their own resources. There is no admin panel in v1.

```
Rule: For any endpoint that returns user-specific data:
  IF request.userId !== resource.ownerId THEN return 403
```

Enforcement: Authorization checks happen in **middleware**, NEVER in individual route handlers. This prevents accidental omission.

### 2.3 API Authentication Matrix

| Endpoint                   | Auth Required | Rate Limit                                           | Rate Limit Mechanism                |
| -------------------------- | ------------- | ---------------------------------------------------- | ----------------------------------- |
| `GET /health`              | No            | 100/min per IP                                       | API Gateway throttling              |
| `GET /api/v1/zones/:zip`   | No            | 30/min per IP                                        | API Gateway throttling              |
| `POST /api/v1/analyses`    | No (optional) | Unauth: 1/day per IP. Free: 1 total. Premium: 10/day | API Gateway + `@fastify/rate-limit` |
| `GET /api/v1/analyses/:id` | Yes (owner)   | 60/min per user                                      | `@fastify/rate-limit`               |
| `GET /api/v1/plants`       | No            | 60/min per IP                                        | API Gateway throttling              |
| `GET /api/v1/plants/:id`   | No            | 60/min per IP                                        | API Gateway throttling              |

---

## 3. Input Validation

### 3.1 Validation Strategy

> **Implementation Status:** Zod schemas defined in `packages/shared/src/schemas/`. Middleware enforcement not yet wired.

**All input is hostile.** Every piece of data from the client is validated before use.

```
Client → API Gateway → Lambda Handler → Zod Schema Validation → Business Logic
                                              ↓ (fail)
                                         400 Bad Request
```

Rules:

- Every request body, query parameter, and path parameter is validated against a Zod schema
- Validation happens at the handler level BEFORE any business logic
- Zod schemas are the single source of truth (defined in `packages/shared`)
- No `as any`, no `as unknown`, no type assertions that bypass validation
- File uploads are validated for: MIME type (magic bytes, not extension), file size, dimensions

### 3.2 Input Constraints

| Input          | Constraint                                    | Enforced By                       | Schema Status   |
| -------------- | --------------------------------------------- | --------------------------------- | --------------- |
| Photo file     | JPEG/PNG/HEIC, ≤20MB, magic byte validation   | API middleware + S3 upload policy | Not yet defined |
| ZIP code       | 5 digits or ZIP+4, regex validated            | `ZipCodeSchema`                   | Implemented     |
| Address fields | Max length, sanitized                         | `AddressInputSchema`              | Implemented     |
| Search queries | Max 100 chars, no SQL/NoSQL injection vectors | `PlantSearchParamsSchema`         | Implemented     |
| Pagination     | page ≥ 1, limit 1–50                          | `PlantSearchParamsSchema`         | Implemented     |
| UUIDs          | RFC 4122 format                               | Zod `.uuid()`                     | Implemented     |

### 3.3 Output Encoding

- All API responses are JSON with `Content-Type: application/json`
- HTML content is never returned by the API
- User-provided strings stored in the database are parameterized (SQL injection prevention via ORM)
- Pre-signed S3 URLs are time-limited (15 minutes)

> **Note:** ORM has not been chosen yet. Selection is required before any database work begins. The chosen ORM MUST support parameterized queries by default (e.g., Drizzle, Prisma).

---

## 4. Data Protection

### 4.1 Encryption

| Data State                | Method                                                                      | Status                   |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------ |
| In transit                | TLS 1.2+ enforced on all endpoints (CloudFront, API Gateway, RDS)           | Enforced by AWS defaults |
| At rest (S3)              | SSE-S3 (AES-256)                                                            | Not yet configured       |
| At rest (RDS)             | AWS KMS encryption enabled                                                  | Not yet configured       |
| At rest (Secrets Manager) | AWS KMS encryption (default)                                                | Not yet configured       |
| Sensitive fields in DB    | Application-level encryption for addresses (AES-256-GCM via a KMS data key) | Not yet implemented      |

### 4.2 Data Retention

| Data                        | Retention                             | Deletion Method                | Status              |
| --------------------------- | ------------------------------------- | ------------------------------ | ------------------- |
| Unauthenticated user photos | 24 hours                              | S3 lifecycle policy            | Not yet configured  |
| Authenticated user photos   | Until user deletes or account closure | S3 object deletion             | Not yet implemented |
| Analysis results            | Until user deletes or account closure | Database hard delete           | Not yet implemented |
| User accounts               | Until user requests deletion          | Full data purge within 30 days | Not yet implemented |
| CloudWatch logs             | 90 days                               | Log group retention policy     | Not yet configured  |
| CloudTrail audit logs       | 1 year                                | S3 lifecycle policy            | Not yet configured  |

### 4.3 PII Handling

- Addresses are stored encrypted in the database (not in plaintext)
- Addresses are NEVER included in AI prompts — only the resolved zone is sent to the AI
- Addresses are NEVER logged (redacted in application logs)
- Photos are stored in a private S3 bucket with no public access
- Pre-signed URLs for photo access expire after 15 minutes
- User email is the only PII in Cognito — no phone number required

---

## 5. AI / LLM Security

> This application sends user photos to the Anthropic API. AI-specific threats require dedicated controls.

### 5.1 Prompt Security

- **System prompt is hardcoded** — no user-controlled text is injected into the system prompt
- **User input isolation:** User-provided text (address, zone override) is passed as structured data, never concatenated into prompt strings
- **Photo-only analysis:** Photos are sent as images via the Anthropic vision API, never converted to text descriptions by the client
- **No prompt reflection:** AI responses never echo back the system prompt or internal instructions

### 5.2 Output Validation

All AI responses MUST be validated before returning to the user:

```
Anthropic API Response → JSON parse → Zod AnalysisResultSchema validation → Store/Return
                                           ↓ (fail)
                                      Retry once with explicit format prompt
                                           ↓ (fail again)
                                      500 "Analysis failed"
```

- AI output is parsed and validated against `AnalysisResultSchema` (defined in `packages/shared`)
- No raw AI text is ever returned directly to the user without schema validation
- Plant recommendations must reference plants that exist in our database (validated server-side)

### 5.3 Cost Controls

| Control                | Limit                          | Enforcement                                       |
| ---------------------- | ------------------------------ | ------------------------------------------------- |
| Max tokens per request | 4,096 output tokens            | Anthropic API `max_tokens` parameter              |
| Daily spend cap        | Configurable per stage         | CloudWatch billing alarm + Lambda circuit breaker |
| Per-user request limit | Free: 1 total. Premium: 10/day | Server-side tier enforcement                      |
| Per-IP unauth limit    | 1/day                          | API Gateway + application middleware              |
| Retry limit            | 1 retry on parse failure       | Application code (no infinite retry loops)        |

### 5.4 Anthropic API Key Protection

- API key stored in AWS Secrets Manager (never in environment variables or code)
- Key rotated every 90 days
- Lambda function has scoped IAM permission to read only its specific secret
- Key is fetched at cold start and cached in memory for the Lambda lifecycle
- Audit trail: All Secrets Manager access logged in CloudTrail

---

## 6. Infrastructure Security

### 6.1 AWS Account Strategy

> **Note:** If deploying to a single AWS account with stage-based naming (dev/staging/prod stacks), adapt this section accordingly. Multi-account via AWS Organizations is recommended for production but adds operational overhead for small teams.

| Account    | Purpose                         | Access                                       |
| ---------- | ------------------------------- | -------------------------------------------- |
| management | AWS Organizations root, billing | Break-glass only                             |
| dev        | Development environment         | Engineers via SSO                            |
| staging    | Pre-production testing          | CI/CD pipeline + limited engineer access     |
| prod       | Production                      | CI/CD pipeline only (no direct human access) |

### 6.2 IAM Principles

> **Implementation Status:** Only NetworkStack exists. IAM policies will be defined as stacks are built.

Least privilege everywhere. No IAM policy uses `*` for resources in production.

```typescript
// CORRECT — scoped to specific resources
{
  effect: iam.Effect.ALLOW,
  actions: ['s3:PutObject', 's3:GetObject'],
  resources: [photoBucket.arnForObjects('uploads/*')],
}

// WRONG — never do this
{
  effect: iam.Effect.ALLOW,
  actions: ['s3:*'],
  resources: ['*'],
}
```

Rules for CDK stacks:

- Every Lambda function gets a custom role with only the permissions it needs
- No inline `iam.PolicyStatement` with `actions: ['*']` — CI lint rule enforces this
- Cross-stack references use interface props, not shared roles
- Service-linked roles only (no user-based IAM keys)

### 6.3 Network Security

> **Implementation Status:** VPC with public/private/isolated subnets implemented in `infra/lib/stacks/network-stack.ts`.

- **VPC:** Private subnets for Lambda and RDS, isolated subnets for databases
- **Security Groups:** Explicit ingress/egress rules, no `0.0.0.0/0` ingress except through CloudFront/API Gateway
- **NAT Gateway:** Outbound internet access only for Lambda (to call Anthropic API)
- **WAF:** Attached to CloudFront and API Gateway with rules for:
  - Rate limiting (2000 requests/5 minutes per IP)
  - SQL injection detection
  - XSS detection
  - Known bad IP reputation lists (AWS managed rules)
  - Geo-restriction (US-only for v1)
  - Request size limits (20MB for upload endpoint, 1MB for all others)

### 6.4 S3 Bucket Security

> **Implementation Status:** Not yet configured. Required before photo upload feature ships.

```typescript
// Every S3 bucket in the project MUST have these properties
{
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  versioned: true,
  removalPolicy: RemovalPolicy.RETAIN, // Never auto-delete buckets
}
```

### 6.5 Secrets Management

- All secrets stored in AWS Secrets Manager (never in environment variables, SSM parameters, or code)
- Anthropic API key: Secrets Manager, rotated every 90 days
- Database credentials: Secrets Manager with RDS integration (auto-rotation)
- GitHub OIDC: No secrets stored — federated identity only
- Zero secrets in the codebase — enforced by `secretlint` in CI

### 6.6 CORS Policy

> **Implementation Status:** `@fastify/cors` is installed. Origin allowlist not yet configured.

```typescript
// Production CORS configuration
{
  origin: ['https://landscapearchitect.com'], // Exact origin, no wildcards
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24 hours
}

// Development CORS (dev stage only)
{
  origin: ['http://localhost:5173'], // Vite dev server
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}
```

---

## 7. Dependency Security

### 7.1 Automated Scanning

| Tool                   | What It Checks                                   | When          | Status                  |
| ---------------------- | ------------------------------------------------ | ------------- | ----------------------- |
| `npm audit`            | Known CVEs in dependencies                       | Every CI run  | Implemented             |
| GitHub Dependabot      | Outdated dependencies with known vulnerabilities | Daily scan    | Implemented             |
| GitHub Secret Scanning | Accidentally committed secrets                   | On every push | Implemented             |
| `secretlint`           | Secrets/API keys in code                         | Every CI run  | Implemented             |
| `trivy`                | Container/dependency vulnerabilities             | Every CI run  | **Not yet added to CI** |
| License check          | Non-permissive licenses (GPL, AGPL)              | Every CI run  | **Not yet added to CI** |

### 7.2 Dependency Policy

- No high or critical CVEs — CI pipeline fails on `npm audit --audit-level=high`
- Pin major versions — Use `^` for minor/patch, never `*` or `latest`
- Lockfile integrity — `pnpm install --frozen-lockfile` in CI (prevents supply chain attacks)
- Minimal dependencies — Prefer standard library over npm packages for simple tasks
- Review new dependencies — Any new dependency added to `package.json` requires reviewer approval in PR

### 7.3 Dependabot Configuration

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'weekly'
      day: 'monday'
    open-pull-requests-limit: 10
    groups:
      dev-dependencies:
        dependency-type: 'development'
      production-dependencies:
        dependency-type: 'production'
    reviewers:
      - 'ajbusch'

  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule:
      interval: 'weekly'
```

---

## 8. Code-Level Security Controls

### 8.1 ESLint Security Rules

> **Implementation Status:** Implemented in `eslint.config.mjs`.

```javascript
// In eslint.config.mjs
import security from 'eslint-plugin-security';

// Add to config array:
{
  plugins: { security },
  rules: {
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-eval-with-expression': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-possible-timing-attacks': 'warn',
  },
}
```

### 8.2 TypeScript Strict Mode

> **Implementation Status:** Implemented in `tsconfig.base.json`.

- `strict: true` — enables all strict checks
- `noUncheckedIndexedAccess: true` — forces null checks on array/object access
- `noUnusedLocals: true` — prevents dead code that could hide security issues
- `no-explicit-any` ESLint rule — prevents type-safety escape hatches

### 8.3 Banned Patterns

The following patterns MUST NOT appear in the codebase (enforced by ESLint custom rules or code review):

| Pattern                                  | Risk               | Alternative                                |
| ---------------------------------------- | ------------------ | ------------------------------------------ |
| `eval()`, `new Function()`               | Code injection     | Never needed                               |
| `dangerouslySetInnerHTML`                | XSS                | Use React's built-in escaping              |
| `innerHTML`                              | XSS                | Use `textContent` or React                 |
| `as any`                                 | Type safety bypass | Use proper types or `unknown` + validation |
| `JSON.parse(untrustedInput)` without Zod | Schema bypass      | Always validate with Zod after parsing     |
| `process.env.SECRET_*` in code           | Secret leakage     | Read from Secrets Manager at runtime       |
| `console.log(userAddress)`               | PII in logs        | Use structured logger with redaction       |
| `SELECT ... WHERE id = '${id}'`          | SQL injection      | Use parameterized queries via ORM          |
| `*` in IAM actions or resources          | Over-permissioned  | Scope to specific actions and ARNs         |

### 8.4 Secure Logging

> **Implementation Status:** Not yet configured. Fastify's default logger is active. Pino redaction must be configured before any PII-handling endpoint ships.

```typescript
// Use pino with redaction
import pino from 'pino';

const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'address',
      'address.*',
      'streetAddress',
      'email',
      'password',
      'token',
      'apiKey',
    ],
    censor: '[REDACTED]',
  },
});
```

---

## 9. CI Pipeline Security Gates

### 9.1 Required Checks (PR cannot merge without all passing)

> **Implementation Status:** `pnpm audit` and `pnpm lint:secrets` are in CI. Trivy and license-checker are not yet added.

```yaml
# Security-specific steps in ci.yml

# --- Currently implemented ---
- name: Security audit
  run: pnpm audit --audit-level=high

- name: Scan for secrets
  run: npx secretlint "**/*"

- name: Check for banned patterns
  run: pnpm lint # ESLint security plugin catches these

# --- TODO: Add to CI before production launch ---
- name: License compliance
  run: npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0"

- name: Vulnerability scan
  uses: aquasecurity/trivy-action@master
  with:
    scan-type: 'fs'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'
```

### 9.2 CDK Security Assertions

> **Implementation Status:** No CDK security tests exist yet. Required before any new CDK stack ships.

Every CDK stack MUST have security-specific tests:

```typescript
// Example: Enforce no public S3 buckets across ALL stacks
it('has no public S3 buckets', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

// Example: Enforce encryption on all buckets
it('encrypts all S3 buckets', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: Match.objectLike({
      ServerSideEncryptionConfiguration: Match.anyValue(),
    }),
  });
});

// Example: No wildcard IAM policies
it('has no wildcard IAM actions', () => {
  const policies = template.findResources('AWS::IAM::Policy');
  for (const [id, policy] of Object.entries(policies)) {
    const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
    for (const stmt of statements) {
      expect(stmt.Action).not.toContain('*');
      expect(stmt.Resource).not.toContain('*');
    }
  }
});
```

---

## 10. Incident Response

### 10.1 Monitoring & Alerting

> **Implementation Status:** Not yet configured. Required before production launch.

| Signal                         | Tool                     | Alert Threshold                  |
| ------------------------------ | ------------------------ | -------------------------------- |
| 5xx error rate                 | CloudWatch Alarm         | > 1% of requests over 5 minutes  |
| 4xx error spike                | CloudWatch Alarm         | > 10% of requests over 5 minutes |
| WAF blocked requests           | CloudWatch + SNS         | > 100 blocks in 5 minutes        |
| Failed authentication attempts | Cognito + CloudWatch     | > 50 per user in 1 hour          |
| Lambda errors                  | CloudWatch Alarm         | Any invocation error             |
| Unusual S3 access pattern      | CloudTrail + GuardDuty   | Anomaly detection                |
| Dependency vulnerability       | Dependabot               | Any high/critical CVE            |
| AI API spend anomaly           | CloudWatch billing alarm | > 2x daily average               |

### 10.2 Response Playbook (Abbreviated)

1. **Detect** — Alarm fires or report received
2. **Assess** — Determine scope and severity
3. **Contain** — If active breach: rotate secrets, block IPs via WAF, disable compromised accounts
4. **Eradicate** — Fix the vulnerability, deploy patch
5. **Recover** — Restore service, verify fix
6. **Review** — Post-incident review, update this threat model

---

## 11. Security Review Checklist

Every PR that touches any of the following MUST include a security review:

- [ ] Authentication or authorization logic
- [ ] File upload handling
- [ ] AI prompt construction
- [ ] New API endpoints
- [ ] IAM policies or CDK security constructs
- [ ] New npm dependencies
- [ ] Database schema changes
- [ ] Environment variables or secrets
- [ ] S3 bucket policies or access patterns
- [ ] Input validation schemas
- [ ] CORS configuration

Reviewer verifies:

- [ ] All inputs validated via Zod schemas
- [ ] Authorization checked in middleware (not handler)
- [ ] No PII in logs
- [ ] No secrets in code
- [ ] No wildcard IAM permissions
- [ ] No `as any` type assertions
- [ ] New dependencies justified and license-checked
- [ ] AI prompts contain no user-controlled system instructions
- [ ] AI responses validated through Zod before returning to client

---

## Implementation Roadmap

Controls are required **before** the feature that needs them ships. This table tracks what must be done and when.

| Control                                            | Required Before               | Status      |
| -------------------------------------------------- | ----------------------------- | ----------- |
| Zod input schemas                                  | Any API endpoint              | Implemented |
| ESLint security plugin                             | Any code merged               | Implemented |
| Secretlint in CI                                   | Any code merged               | Implemented |
| npm audit in CI                                    | Any code merged               | Implemented |
| `pnpm install --frozen-lockfile`                   | Any CI run                    | Implemented |
| GitHub OIDC (no long-lived credentials)            | Any deployment                | Implemented |
| VPC with private/isolated subnets                  | Database or Lambda deployment | Implemented |
| Pino logger with PII redaction                     | Any endpoint handling PII     | Not started |
| S3 bucket security config                          | Photo upload feature          | Not started |
| Cognito authentication                             | User accounts feature         | Not started |
| Authorization middleware                           | Any user-specific endpoint    | Not started |
| CORS origin allowlist                              | Frontend ↔ API integration    | Not started |
| Application-level address encryption               | Address storage feature       | Not started |
| CDK security assertion tests                       | Any new CDK stack             | Not started |
| AI output validation via Zod                       | Yard analysis feature         | Not started |
| AI cost controls (max tokens, spend cap)           | Yard analysis feature         | Not started |
| Trivy in CI                                        | Production launch             | Not started |
| License checker in CI                              | Production launch             | Not started |
| WAF rules                                          | Production launch             | Not started |
| CloudWatch alarms & monitoring                     | Production launch             | Not started |
| Secrets Manager integration                        | Any secret needed at runtime  | Not started |
| ORM selection (must support parameterized queries) | Database feature              | Not started |

---

## References

- [OWASP Top 10 (2021)](https://owasp.org/www-project-top-ten/)
- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [CWE/SANS Top 25 Most Dangerous Software Weaknesses](https://cwe.mitre.org/top25/archive/2023/2023_top25_list.html)
- [Anthropic API Security Best Practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering)
