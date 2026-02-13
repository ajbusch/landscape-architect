# Software Development Plan

## Web Application — SPA + API (TypeScript / AWS CDK)

### Status: Draft — Pending Review

---

## 1. Executive Summary

This plan defines a specification-first, test-driven approach to building a production web application consisting of a Single-Page Application (React/TypeScript) and a backend API (Node.js/TypeScript), deployed to AWS via CDK with a fully automated Continuous Deployment pipeline.

Core philosophy: Nothing gets built until it has a specification. Nothing gets merged until it has tests. Nothing gets deployed without passing the full pipeline.

---

## 2. Project Structure

```
repo-root/
├── apps/
│   ├── web/                    # SPA (React + Vite + TypeScript)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── services/       # API client layer
│   │   │   ├── store/          # State management
│   │   │   └── types/
│   │   ├── __tests__/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── e2e/
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── api/                    # Backend API (Fastify)
│       ├── src/
│       │   ├── routes/
│       │   ├── handlers/
│       │   ├── services/       # Business logic
│       │   ├── repositories/   # Data access
│       │   ├── middleware/
│       │   ├── validators/     # Zod schemas (shared with specs)
│       │   └── types/
│       ├── __tests__/
│       │   ├── unit/
│       │   ├── integration/
│       │   └── contract/
│       └── tsconfig.json
│
├── packages/
│   └── shared/                 # Shared types, validators, constants
│       ├── src/
│       │   ├── schemas/        # Zod schemas (single source of truth)
│       │   ├── types/          # Inferred TypeScript types
│       │   └── constants/
│       └── tsconfig.json
│
├── specs/                      # Specifications (the blueprint)
│   ├── api/                    # OpenAPI + behavioral specs
│   │   ├── openapi.yaml
│   │   └── behaviors/
│   │       ├── auth.spec.md
│   │       ├── resources.spec.md
│   │       └── errors.spec.md
│   ├── frontend/               # UI/UX specs
│   │   ├── pages/
│   │   ├── components/
│   │   └── flows/
│   └── architecture/           # ADRs and system-level specs
│       ├── decisions/
│       │   ├── 001-auth-strategy.md
│       │   ├── 002-database-choice.md
│       │   └── template.md
│       └── system-context.md
│
├── infra/                      # AWS CDK (TypeScript)
│   ├── bin/
│   │   └── app.ts              # CDK app entrypoint
│   ├── lib/
│   │   ├── stacks/
│   │   │   ├── network-stack.ts
│   │   │   ├── database-stack.ts
│   │   │   ├── api-stack.ts
│   │   │   ├── frontend-stack.ts
│   │   │   ├── github-oidc-stack.ts
│   │   │   └── monitoring-stack.ts
│   │   └── constructs/         # Reusable L3 constructs
│   ├── __tests__/
│   │   ├── snapshot/
│   │   └── assertion/
│   ├── cdk.json
│   └── tsconfig.json
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # PR quality gates
│   │   └── deploy.yml          # Main → dev → staging → prod
│   ├── actions/
│   │   └── setup/action.yml    # Composite: pnpm + Node + cache
│   └── CODEOWNERS
├── turbo.json                  # Turborepo config
├── package.json                # Workspace root
├── tsconfig.base.json
├── .gitattributes              # Enforce LF line endings
├── .editorconfig               # Consistent editor settings
└── .nvmrc                      # Pin Node version (20)
```

Toolchain: Turborepo monorepo, pnpm workspaces, shared tsconfig.

---

## 3. Specification Methodology

### 3.1 Specification-First Workflow

Every feature follows this lifecycle:

```
SPEC → REVIEW → TESTS (red) → IMPLEMENT (green) → REFACTOR → DEPLOY
```

| Phase | Artifact | Owner |
|-------|----------|-------|
| 1. Spec | Markdown spec document in `specs/` | Product + Engineering |
| 2. Schema | Zod schema in `packages/shared` | Engineering |
| 3. Contract | OpenAPI spec (auto-generated or hand-written) | Engineering |
| 4. Tests | Failing tests derived from spec | Engineering |
| 5. Implementation | Code to make tests pass | Engineering |
| 6. Acceptance | E2E tests matching spec acceptance criteria | QA + Engineering |

### 3.2 Specification Template

Every feature spec in `specs/` follows this structure:

```markdown
# Feature: [Name]

## Status: [Draft | In Review | Approved | Implemented]

## Context
Why this feature exists. Link to ADR if architectural decisions are involved.

## Requirements
### Functional
- FR-001: The system SHALL [do X] WHEN [condition Y]
- FR-002: The system SHALL NOT [do Z] UNLESS [condition W]

### Non-Functional
- NFR-001: Response time < 200ms at p95
- NFR-002: Availability >= 99.9%

## API Contract
- Endpoint: `POST /api/v1/resources`
- Request schema: `CreateResourceSchema` (ref: packages/shared/schemas)
- Response schema: `ResourceResponseSchema`
- Error cases: 400 (validation), 401 (auth), 409 (conflict), 500

## Acceptance Criteria
Given [precondition]
When [action]
Then [expected result]

## Edge Cases & Error Scenarios
- What happens when [boundary condition]?
- What happens when [dependency fails]?

## Security Considerations
- Authentication required: Yes/No
- Authorization model: [RBAC/ABAC/resource-owner]
- Input validation: [reference Zod schema]

## Open Questions
- [ ] TBD items
```

### 3.3 Zod as Single Source of Truth

Zod schemas in `packages/shared` serve triple duty:

1. **Runtime validation** — used by API handlers and form validation
2. **Type generation** — `z.infer<typeof Schema>` produces TypeScript types
3. **Spec documentation** — schemas ARE the contract, not a derivative of it

```typescript
// packages/shared/src/schemas/resource.ts
import { z } from 'zod';

export const CreateResourceSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['A', 'B', 'C']),
  metadata: z.record(z.string()).optional(),
});

export const ResourceResponseSchema = CreateResourceSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Types are derived, never hand-written
export type CreateResource = z.infer<typeof CreateResourceSchema>;
export type ResourceResponse = z.infer<typeof ResourceResponseSchema>;
```

---

## 4. Test Strategy

### 4.1 Test Pyramid

```
         ╱  E2E Tests  ╲           ~10% — Critical user flows
        ╱────────────────╲
       ╱ Contract Tests   ╲        ~15% — API contract compliance
      ╱────────────────────╲
     ╱  Integration Tests   ╲      ~25% — Service + DB interactions
    ╱────────────────────────╲
   ╱     Unit Tests           ╲    ~50% — Pure logic, validators, utils
  ╱────────────────────────────╲
```

### 4.2 Test Types — Detailed Breakdown

#### Unit Tests (Vitest)

Scope: Pure functions, validators, transformers, hooks, utility modules. No I/O.

#### Integration Tests (Vitest + Testcontainers)

Scope: Service layer + real database, handler + middleware chains. Uses Testcontainers for PostgreSQL.

#### Contract Tests (Vitest + OpenAPI validation)

Scope: Ensure API responses match the OpenAPI spec exactly.

#### E2E Tests (Playwright)

Scope: Full user flows through the browser against a real deployed (or local) stack.

#### CDK Infrastructure Tests

Scope: Verify synthesized CloudFormation templates are correct.

### 4.3 Test Coverage Requirements

| Layer | Minimum Coverage | Enforced By |
|-------|-----------------|-------------|
| `packages/shared` | 95% statements | CI gate |
| `apps/api/services` | 90% branches | CI gate |
| `apps/api/handlers` | 85% statements | CI gate |
| `apps/web/hooks` | 85% statements | CI gate |
| `apps/web/components` | 70% statements | CI warning |
| `infra/` | 100% of stacks have assertion tests | CI gate |

### 4.4 Quality Gates (all enforced in CI)

- **Linting**: ESLint (strict config) + Prettier — zero warnings policy
- **Type checking**: `tsc --noEmit` across all packages — zero errors
- **Unit + Integration tests**: must pass, coverage must meet thresholds
- **Contract tests**: must pass — any drift = pipeline failure
- **E2E tests**: must pass on staging before production deploy
- **Security**: npm audit (no critical/high), dependency scanning
- **Bundle size**: Vite bundle analysis, fail if main chunk > threshold

---

## 5. AWS Infrastructure (CDK)

### 5.1 Architecture Overview

```
                          ┌────────────────────┐
                          │   Route 53 (DNS)    │
                          └─────────┬──────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 │                                      │
        ┌────────▼────────┐                   ┌─────────▼────────┐
        │  CloudFront CDN  │                   │  CloudFront CDN   │
        │  (SPA hosting)   │                   │  (API caching)    │
        └────────┬─────────┘                   └─────────┬─────────┘
                 │                                       │
        ┌────────▼─────────┐                   ┌─────────▼─────────┐
        │  S3 Bucket        │                   │  API Gateway v2   │
        │  (static assets)  │                   │  (HTTP API)       │
        └───────────────────┘                   └─────────┬─────────┘
                                                          │
                                                 ┌────────▼────────┐
                                                 │  Lambda (API)    │
                                                 │  Node.js 20.x   │
                                                 └────────┬────────┘
                                                          │
                                           ┌──────────────┼──────────────┐
                                           │              │              │
                                    ┌──────▼──┐    ┌──────▼──┐   ┌──────▼──┐
                                    │ RDS/     │    │ Cognito  │   │ Secrets │
                                    │ Postgres │    │ (Auth)   │   │ Manager │
                                    └─────────┘    └──────────┘   └─────────┘
```

### 5.2 CDK Stack Breakdown

| Stack | Resources | Dependencies |
|-------|-----------|-------------|
| `NetworkStack` | VPC, subnets, security groups, NAT Gateway | None |
| `DatabaseStack` | RDS PostgreSQL, secrets | NetworkStack |
| `AuthStack` | Cognito User Pool, app clients, custom domain | None |
| `ApiStack` | Lambda, API Gateway v2, CloudFront distribution | NetworkStack, DatabaseStack, AuthStack |
| `FrontendStack` | S3 bucket, CloudFront distribution, OAC | None |
| `MonitoringStack` | CloudWatch dashboards, alarms, SNS topics | ApiStack, DatabaseStack |
| `GitHubOidcStack` | OIDC provider, IAM deploy roles (per env) | None (bootstrapped first) |

### 5.3 Environment Strategy

Each environment is a separate AWS account (AWS Organizations) with identical infrastructure, parameterized by stage.

---

## 6. CI/CD Pipeline (GitHub Actions)

### 6.1 Pipeline Architecture

**PR Validation (ci.yml):**
- Lint, Typecheck, Unit Tests, Integration Tests, CDK Diff, Contract Tests, Bundle Size Check, Security Audit

**Deploy (deploy.yml):**
- Build & Test → Deploy Dev (+ smoke test) → Deploy Staging (+ E2E + smoke test) → Deploy Production (manual approval + canary + smoke)

### 6.2 OIDC Authentication

GitHub Actions authenticates to AWS via OIDC federation — no long-lived AWS credentials stored anywhere.

### 6.3 Pipeline Rules

- `main` branch is protected — requires PR with passing CI, 1+ approvals
- Build once, deploy everywhere — artifacts built once and reused across all stages
- No skipping stages — dev → staging → prod, always sequential
- Any test failure = full stop — no manual overrides
- Production requires manual approval via GitHub Environments after staging E2E passes
- Concurrency control — only one deploy pipeline runs at a time (never cancel in-flight)
- OIDC only — no long-lived AWS credentials anywhere
- Rollback — revert the commit on main; pipeline redeploys the previous state

---

## 7. Development Workflow

### 7.1 Branch Strategy

Trunk-based development — short-lived feature branches, frequent merges.

### 7.2 PR Checklist (enforced by CI + CODEOWNERS)

- [ ] Spec exists in `specs/` for any new behavior
- [ ] Zod schemas added/updated in `packages/shared`
- [ ] Unit tests cover new logic (coverage thresholds met)
- [ ] Integration tests cover new API behavior
- [ ] Contract tests updated if API surface changed
- [ ] E2E test added for any new user-facing flow
- [ ] CDK snapshot updated if infra changed
- [ ] No `any` types — strict TypeScript
- [ ] ADR written if architectural decision made

### 7.3 Local Development (Windows + WSL)

Project root: `/home/tonybanana/projects/landscape-architect`

All development happens inside WSL (Ubuntu). Files live on the Linux filesystem for performance.

---

## 8. Recommended Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Monorepo | Turborepo + pnpm | Fast builds, native TS workspace support |
| SPA Framework | React 19 + Vite | Mature ecosystem, fast HMR |
| API Framework | Fastify | TypeScript-first, excellent perf, built-in validation hooks |
| Validation | Zod | Runtime + type inference, shared FE/BE |
| Database | PostgreSQL (RDS) | Relational, mature, great with TypeScript ORMs |
| ORM | Drizzle ORM | Type-safe, lightweight, great migration story |
| Auth | AWS Cognito + JWT | Managed, integrates with API Gateway |
| Unit/Integration Tests | Vitest | Fast, native ESM + TypeScript, Vite-compatible |
| E2E Tests | Playwright | Cross-browser, excellent DX, CI-friendly |
| Contract Tests | openapi-response-validator | Validates responses against OpenAPI spec |
| IaC | AWS CDK (TypeScript) | Same language, L3 constructs |
| CI/CD | GitHub Actions | OIDC to AWS, matrix builds, environment approvals |
| Linting | ESLint flat config + Prettier | Industry standard |
| API Spec | OpenAPI 3.1 | Codegen, documentation, contract testing |

---

## 9. Implementation Phases

### Phase 0 — Foundation (Week 1–2)

- [ ] WSL environment setup (Node 20, pnpm 9, Docker, AWS CLI)
- [ ] Initialize repo
- [ ] Add `.gitattributes`, `.editorconfig`, `.nvmrc`
- [ ] Initialize monorepo (Turborepo + pnpm workspaces)
- [ ] Configure TypeScript (strict, shared base config)
- [ ] Set up ESLint + Prettier
- [ ] Create CDK app with NetworkStack + GitHubOidcStack
- [ ] Set up AWS accounts (dev/staging/prod) via Organizations
- [ ] Configure GitHub repo: branch protection, environments, OIDC
- [ ] CI workflow deploys empty stacks successfully
- [ ] Write ADR-001: Architecture Overview

### Phase 1 — Auth & First Endpoint (Week 3–4)

- [ ] Write spec: `specs/api/behaviors/auth.spec.md`
- [ ] Write spec: `specs/api/behaviors/resources.spec.md`
- [ ] Define Zod schemas in `packages/shared`
- [ ] Write OpenAPI spec for first endpoint
- [ ] Implement AuthStack (Cognito)
- [ ] Implement DatabaseStack (RDS)
- [ ] Build API: auth middleware + first CRUD endpoint
- [ ] Unit tests: validators, auth logic
- [ ] Integration tests: full request cycle with Testcontainers
- [ ] Contract tests: response validates against OpenAPI

### Phase 2 — Frontend + E2E (Week 5–6)

- [ ] Write specs: `specs/frontend/pages/` and `specs/frontend/flows/`
- [ ] Implement FrontendStack (S3 + CloudFront)
- [ ] Build SPA: auth flow, first CRUD page
- [ ] Component tests with Vitest + Testing Library
- [ ] E2E tests with Playwright for critical flows
- [ ] Pipeline now runs full test suite

### Phase 3 — Monitoring & Hardening (Week 7–8)

- [ ] Implement MonitoringStack (CloudWatch, alarms)
- [ ] Add structured logging (pino)
- [ ] Add distributed tracing (X-Ray)
- [ ] Load testing with k6 (validate NFRs from specs)
- [ ] Security review: IAM least privilege, WAF rules
- [ ] First production deployment

### Phase 4+ — Iterate

- [ ] Each feature follows the spec → test → implement cycle
- [ ] Continuous improvement of pipeline speed
- [ ] Add feature flags (LaunchDarkly or AWS AppConfig)
- [ ] Add preview environments for PRs (optional CDK stage)

---

## 10. Key Principles

1. **If it's not in a spec, it doesn't exist.** Specs are the single source of truth for behavior.
2. **If it's not tested, it's broken.** Tests are the executable version of specs.
3. **Schemas are shared, not duplicated.** Zod schemas flow from `packages/shared` to both frontend and backend.
4. **Infrastructure is code, tested like code.** CDK stacks have assertion tests and snapshots.
5. **The pipeline is the gatekeeper.** No human can override a failing pipeline.
6. **Environments are identical.** Same CDK stacks, different parameters.
7. **Forward-only migrations.** Database changes must be backward-compatible.
8. **Observability is not optional.** Logging, metrics, tracing from day one.
