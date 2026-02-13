# Software Development Plan — Evaluation & Suggested Changes

## Review Date: 2026-02-13

## Reviewer: Claude (automated evaluation against existing codebase)

---

## Overall Assessment

The plan is **well-aligned** with the existing codebase. Most of the foundation described in Phase 0 is already implemented. The spec-first methodology, test strategy, and CI/CD design all match what's already in place. However, there are several **inaccuracies, gaps, and areas where the plan diverges from what's actually built** that should be corrected before this becomes the canonical development plan.

**Verdict: Adopt with the changes below.**

---

## 1. Factual Corrections (Spec vs. Reality Mismatches)

### 1.1 API Framework: "Express or Fastify" → Fastify (decided)

**Spec says:** `apps/api/ # Backend API (Express or Fastify)`
**Reality:** Fastify 5 is already chosen, installed, and in use (`@landscape-architect/api` depends on `fastify: ^5.2.0`).

**Fix:** Remove the "Express or" hedge. The ADR (001-architecture-overview.md) already records this decision.

---

### 1.2 API Directory Structure: `handlers/` and `validators/` don't exist

**Spec proposes:**

```
api/src/
├── routes/
├── handlers/
├── services/
├── repositories/
├── middleware/
├── validators/     # Zod schemas (shared with specs)
└── types/
```

**Reality:** The API currently has:

```
api/src/
├── routes/         # health.ts (route + handler inline)
├── app.ts          # Fastify app factory
└── index.ts        # Server entry
```

**Issues:**

- The `validators/` directory is misleading. Zod schemas live in `packages/shared/src/schemas/`, not in the API. The spec's own Section 3.3 correctly states schemas are in `packages/shared`. Having a `validators/` directory in the API contradicts the "single source of truth" principle.
- `handlers/` vs `routes/`: Fastify's idiomatic pattern uses route plugins that combine route definition + handler. Splitting into separate `routes/` and `handlers/` directories adds unnecessary indirection for a Fastify app. The current pattern (handler code inside route files) is Fastify-standard.

**Suggested fix:**

```
api/src/
├── routes/         # Fastify route plugins (route + handler together)
├── services/       # Business logic
├── repositories/   # Data access
├── middleware/      # Fastify plugins (auth, etc.)
└── types/          # API-specific types (not shared ones)
```

Remove `validators/` entirely. Remove `handlers/` — keep handler logic in route files per Fastify convention.

---

### 1.3 Database Choice: "RDS PostgreSQL (or DynamoDB)" → PostgreSQL (decided)

**Spec says (Section 5.2):** `DatabaseStack: RDS PostgreSQL (or DynamoDB)`
**Spec says (Section 5.1 diagram):** `RDS/DynamoDB`
**Spec says (Section 8):** `PostgreSQL (RDS)`

**Reality:** The CI workflows already run PostgreSQL 16 as a service container for integration tests. The security spec references RDS encryption. The feature spec (yard-photo-analysis) describes relational data.

**Fix:** Remove all DynamoDB references. PostgreSQL is the decision. Write ADR-002 to record this.

---

### 1.4 ORM Choice: Drizzle is recommended but not recorded

**Spec says (Section 8):** `Drizzle ORM — Type-safe, lightweight, great migration story`
**Reality:** No ORM is installed or chosen yet. The security spec flags "ORM selection: Not started."

**Fix:** This is a recommendation, not a fait accompli. It should be flagged as a pending decision requiring an ADR (e.g., `002-orm-choice.md`). Other viable options include Kysely (query builder, lighter weight) and Prisma (more ecosystem support, heavier).

---

### 1.5 Phase 0 Checklist: Most items already done

The plan lists Phase 0 as "Week 1–2" future work, but **nearly everything in Phase 0 is already implemented:**

| Phase 0 Item                                       | Status                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| WSL environment setup                              | Done (implied by working repo)                                                |
| Initialize repo                                    | Done                                                                          |
| `.gitattributes`, `.editorconfig`, `.nvmrc`        | Done                                                                          |
| Monorepo (Turborepo + pnpm)                        | Done                                                                          |
| TypeScript strict mode                             | Done                                                                          |
| ESLint + Prettier                                  | Done                                                                          |
| CDK app with NetworkStack                          | Done                                                                          |
| GitHubOidcStack                                    | **NOT done** — OIDC config is in deploy.yml but no CDK stack exists           |
| AWS accounts (dev/staging/prod)                    | Unknown — deploy.yml references environments but no evidence of multi-account |
| GitHub repo: branch protection, environments, OIDC | Partially done (workflows exist, environments referenced)                     |
| CI workflow                                        | Done                                                                          |
| ADR-001                                            | Done                                                                          |

**Fix:** Update Phase 0 to reflect current status. Mark completed items. The remaining Phase 0 work is:

- GitHubOidcStack (CDK stack for OIDC provider — or document that this was done manually)
- AWS account setup verification
- GitHub environment protection rules configuration

---

### 1.6 ADR Numbering Conflict

**Spec proposes:** `001-auth-strategy.md`, `002-database-choice.md`
**Reality:** `001-architecture-overview.md` already exists.

**Fix:** Renumber to avoid collision:

- `001-architecture-overview.md` (exists)
- `002-orm-choice.md` (pending)
- `003-auth-strategy.md` (pending)

---

### 1.7 Existing Feature Work Not Acknowledged

The plan makes no mention of the **yard-photo-analysis feature** which already has:

- A detailed spec: `specs/api/behaviors/yard-photo-analysis.spec.md` (43 functional requirements)
- Full Zod schemas: `zone.ts`, `plant.ts`, `analysis.ts` in `packages/shared`
- A comprehensive security spec: `specs/security/security-spec.md`

**Fix:** The plan should reference existing specs and schemas as the "first feature" rather than using a generic "resources" CRUD example. The yard-photo-analysis feature IS the Phase 1 feature.

---

## 2. Structural & Architectural Suggestions

### 2.1 Missing: `packages/shared` already has domain schemas

The plan's example schemas (`CreateResourceSchema`, `ResourceResponseSchema`) are generic placeholders. The real codebase has rich domain schemas:

- `HealthResponseSchema` — health check
- `ZipCodeSchema`, `AddressInputSchema`, `USDAZoneSchema`, `ZoneResponseSchema` — location/zone
- `PlantSchema`, `PlantSearchParamsSchema` — plant database
- `AnalysisResultSchema`, `AnalysisResponseSchema` — AI analysis
- `IdentifiedFeatureSchema`, `PlantRecommendationSchema` — sub-schemas

**Suggestion:** Replace generic examples with references to actual schemas, or note that concrete schemas already exist and the generic examples are illustrative.

---

### 2.2 Missing: `lint:secrets` not mentioned in Quality Gates

The codebase has `secretlint` configured with its own ignore file and CI integration, but the plan's Quality Gates section (4.4) doesn't mention secret scanning.

**Fix:** Add to Section 4.4:

- **Secret scanning**: `secretlint` — zero findings policy

---

### 2.3 Missing: `format:check` in CI

The existing `ci.yml` runs `pnpm turbo format:check` (Prettier), but the plan's CI section doesn't mention format checking as a separate step.

**Fix:** Add format checking to CI quality gates or note it's bundled with linting.

---

### 2.4 Missing: Dependabot configuration

The codebase has `.github/dependabot.yml` configured for weekly npm and GitHub Actions updates. The plan doesn't mention dependency update automation.

**Fix:** Add a brief section on dependency management strategy (Dependabot, update grouping, review process).

---

### 2.5 OpenAPI Spec: Proposed but no strategy for generation

The plan references `specs/api/openapi.yaml` and contract tests validating against it, but doesn't specify:

- Will the OpenAPI spec be hand-written or generated from Zod schemas?
- How will it stay in sync with `packages/shared` schemas?
- Which tool generates it? (e.g., `zod-to-openapi`, `fastify-swagger`)

**Suggestion:** Since Zod is the SSoT, strongly recommend auto-generating OpenAPI from Zod schemas using `@asteasolutions/zod-to-openapi` or Fastify's built-in `@fastify/swagger` with `@fastify/swagger-ui`. This prevents drift between schemas and the OpenAPI spec.

---

### 2.6 Vitest Config: Multi-project setup not reflected

The plan doesn't mention that `apps/api` already uses Vitest's multi-project feature with 3 named projects (unit, integration, contract), each with different configs (timeouts, coverage thresholds, include patterns). This is important for contributors to understand.

**Suggestion:** Note the multi-project Vitest configuration in the test strategy section.

---

### 2.7 Lambda as compute: Not yet decided

The architecture diagram shows Lambda as the API compute, but:

- No Lambda-related dependencies exist in `apps/api`
- The current API is a long-running Fastify server (`app.listen()`)
- No adapter (e.g., `@fastify/aws-lambda`) is installed

This is a significant architectural decision (Lambda vs. ECS/Fargate) that deserves an ADR.

**Suggestion:** Add ADR for compute choice. If Lambda, document the adapter strategy (`@fastify/aws-lambda` or `aws-lambda-fastify`). If ECS/Fargate, update the architecture diagram.

---

### 2.8 Missing: State management choice for web app

Section 2 lists `store/` directory for state management but Section 8 doesn't recommend a specific tool. The placeholder directory exists but is empty.

**Suggestion:** Either recommend a specific solution (React Context for simple cases, Zustand or TanStack Query for complex) or note it as a pending ADR.

---

## 3. CI/CD Discrepancies

### 3.1 Existing CI is more nuanced than the plan describes

The actual `ci.yml` has:

- Separate `quality`, `test-unit`, `test-integration`, `security`, and `build` jobs
- The `security` job runs both `npm audit` AND `secretlint`
- The `build` job depends on `quality`, `test-unit`, and `security` (not test-integration)
- Format checking (`pnpm turbo format:check`) runs in the quality job

The plan's CI section describes a slightly different structure. The plan should match reality or explicitly propose changes.

**Fix:** Update Section 6.3 to match the actual CI structure, or document proposed changes with rationale.

---

### 3.2 CDK Diff is not a separate workflow

**Spec proposes:** A separate `cdk-diff.yml` workflow file
**Reality:** CDK diff could be a job within `ci.yml` rather than a separate workflow. The existing `ci.yml` doesn't include CDK diff yet.

**Suggestion:** Add CDK diff as a job in `ci.yml` rather than a separate workflow — simpler to maintain, and the PR comment logic is the same.

---

### 3.3 Bundle size check thresholds

**Spec says:** Fail if gzipped JS > 250KB
**Current state:** No bundle size check exists yet.

**Suggestion:** This is a good addition. Consider using `bundlesize` or `size-limit` packages instead of raw shell commands — they provide better reporting and per-file thresholds.

---

### 3.4 Multi-account strategy: Verify feasibility

The plan assumes 3 separate AWS accounts (dev/staging/prod) via AWS Organizations. The current `infra/bin/app.ts` uses `CDK_DEFAULT_ACCOUNT` (single account, stage-parameterized).

**Question for team:** Is multi-account already set up? If not, this is significant infrastructure work. Single-account with stage prefixes is viable for early development and simpler to bootstrap.

---

## 4. Missing from the Plan

### 4.1 Security Spec Integration

A comprehensive security spec already exists at `specs/security/security-spec.md`. The dev plan should reference it and align implementation phases with the security roadmap. For example:

- Phase 1 should include: Cognito auth, authorization middleware, CORS allowlist
- Phase 3 should include: WAF rules, Secrets Manager, CDK security assertion tests, pino PII redaction

---

### 4.2 AI/LLM Integration Strategy

The yard-photo-analysis feature depends on the Anthropic API for AI-powered analysis. The plan should address:

- API key management (Secrets Manager)
- Cost controls and rate limiting
- Output validation (AnalysisResultSchema already exists)
- Prompt management strategy
- Testing strategy for AI-dependent features (mocking vs. contract testing)

---

### 4.3 Database Migration Strategy

The plan mentions "forward-only migrations" (Principle 7) but doesn't specify:

- Migration tool (Drizzle Kit if using Drizzle ORM, or standalone like `node-pg-migrate`)
- Migration file location
- How migrations run in CI and deployment
- Seed data strategy for development/testing

---

### 4.4 Error Handling Strategy

No consistent error handling approach is specified:

- Fastify error handler setup
- Standardized error response format (should be a Zod schema in shared)
- Error codes taxonomy
- Client-side error handling patterns

---

### 4.5 Logging Strategy

The plan mentions pino in Phase 3, but the security spec requires PII redaction from day one. This should be moved to Phase 1 — logging configuration should be in place before building features that handle user data.

---

### 4.6 API Versioning Strategy

The existing `API_PREFIX = '/api/v1'` implies versioning, but the plan doesn't address:

- When/how to introduce v2
- Deprecation policy
- Whether versioning is in URL path, header, or both

---

## 5. Summary of Recommended Changes

### Must Fix (Factual errors)

1. Remove "Express or" — Fastify is decided
2. Remove `validators/` directory from API — schemas live in `packages/shared`
3. Remove `handlers/` directory — use Fastify route plugin pattern
4. Remove DynamoDB references — PostgreSQL is decided
5. Fix ADR numbering (001 already exists)
6. Update Phase 0 to reflect completed work

### Should Fix (Gaps and alignment)

7. Reference existing yard-photo-analysis spec and schemas as the real Phase 1 feature
8. Add secret scanning to quality gates
9. Add format checking to CI description
10. Add Dependabot/dependency management section
11. Specify OpenAPI generation strategy (auto-generate from Zod)
12. Reference security spec and align phases with security roadmap
13. Move logging/pino setup from Phase 3 to Phase 1

### Should Add (Missing sections)

14. ADR for compute choice (Lambda vs. ECS/Fargate)
15. ADR for ORM choice (document as pending decision, not fait accompli)
16. AI/LLM integration strategy section
17. Database migration strategy section
18. Error handling strategy section
19. API versioning strategy section
20. State management recommendation for web app

### Nice to Have

21. Multi-project Vitest configuration documentation
22. Bundle size tooling recommendation (size-limit over shell scripts)
23. CDK diff as ci.yml job rather than separate workflow
24. Clarify multi-account vs. single-account strategy
