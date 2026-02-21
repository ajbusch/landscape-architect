# Landscape Architect

## Project Structure

pnpm monorepo managed by Turborepo.

- `apps/web` — React SPA (Vite, Tailwind, Shadcn)
- `apps/api` — Fastify REST API (DynamoDB, S3, Anthropic Vision)
- `packages/shared` — Shared Zod schemas, types, constants
- `infra` — AWS CDK infrastructure (TypeScript)
- `specs/` — Architecture decisions, behavioral specs, and design docs (see [Specs](#specs))

## Local Development

`pnpm dev` starts both apps via Turborepo:

- Web on `localhost:3000` (Vite dev server)
- API on `localhost:3001` (tsx watch)
- Vite proxies `/api` requests to the API server automatically

No `.env` file needed for basic local dev.

## Branch Strategy

Feature branches → PR to `main` → CI → merge → auto-deploy (dev → staging with E2E → prod).

## Pre-commit Checks

Before committing, run these checks to match CI:

```sh
turbo lint --force   # --force bypasses Turborepo cache
pnpm typecheck
pnpm format:check   # fix with: pnpm format
pnpm test:unit
pnpm lint:secrets
```

All five must pass. CI also runs `pnpm test:contract`, `pnpm test:integration`, and `pnpm format:check`.

## Code Style

- Prettier enforces formatting (see `.prettierrc`). Run `pnpm format` to auto-fix.
- ESLint flat config at root. Run `pnpm lint` (all) or `pnpm --filter <pkg> lint`.
- Strict TypeScript — `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`.

### ESLint Rules That Affect How You Write Code

- **`consistent-type-imports`: error** — always use `import type { Foo }` for type-only imports.
- **`no-explicit-any`: error** — no `any` (relaxed in test files).
- **`explicit-function-return-type`: warn** — add return types to functions (off for Shadcn `components/ui/`).
- **`no-floating-promises`: error** — always `await` or handle promises.
- **`eslint-plugin-security`** — enabled globally; flags unsafe patterns.

## Testing

- Unit tests: `pnpm test:unit` (Vitest across all packages)
- Contract tests: `pnpm test:contract` (validates API responses against shared Zod schemas)
- Integration tests: `pnpm test:integration` (requires PostgreSQL)
- E2E tests: `pnpm test:e2e` (Playwright, requires running app)
- CDK assertion tests live in `infra/__tests__/assertion/`

### Test File Conventions

| Package | Location                                          | Pattern                 |
| ------- | ------------------------------------------------- | ----------------------- |
| API     | `apps/api/__tests__/{unit,contract,integration}/` | Separated by test type  |
| Web     | `apps/web/src/pages/*.test.tsx`                   | Co-located with pages   |
| Shared  | `packages/shared/src/schemas/*.test.ts`           | Co-located with schemas |
| Infra   | `infra/__tests__/assertion/`                      | One file per stack      |

### Coverage Thresholds

- API: 85% statements/functions/lines, 90% branches
- Web: 70% across the board
- Shared: 95% across the board

## Shared Package (`packages/shared`)

The shared package is the contract between API and web:

- **Zod v4** schemas are the source of truth — types are inferred, not manually written.
- **No build step** — consumers import TypeScript source directly.
- Multiple entry points: `@landscape-architect/shared/schemas`, `/types`, `/constants`.
- When changing a schema, update both API and web consumers, and run `pnpm test:contract`.

## Infrastructure (CDK)

Stacks in `infra/lib/stacks/`. Each stack follows the pattern:

- Interface extending `StackProps` with a `stage` prop
- Tags: `Project=LandscapeArchitect`, `Stage={stage}`
- Cross-stack values shared via `CfnOutput` with `exportName`

Deploy: `cd infra && npx cdk deploy --all -c stage=dev`
Synth: `cd infra && npx cdk synth`

## Key Conventions

- Package names: `@landscape-architect/{web,api,shared,infra}`
- Filter commands: `pnpm --filter @landscape-architect/api <cmd>`
- Node.js >= 20, pnpm 9.x
- Web path alias: `@/` maps to `apps/web/src/`
- API routes registered as Fastify plugins, all under `/api/v1/`
- API client (`apps/web/src/services/api.ts`) validates all responses with shared Zod schemas

## Specs

Detailed architecture and design docs live in `specs/`. Consult these when building features or making design decisions:

- `specs/architecture/decisions/` — ADRs (architecture overview, security, DynamoDB, VPC)
- `specs/api/behaviors/` — API behavioral specifications (analysis pipeline, plant database)
- `specs/frontend/` — Frontend spec
- `specs/security/` — Security spec
- `specs/observability.spec.md` — Observability spec

## Task Tracking

GitHub Issues is the task tracker. Use `gh` CLI to interact with issues.

- `gh issue list --state open` — see current work
- `gh issue close <number> --comment "reason"` — close when completing work
- `gh issue create --title "..." --label "label1,label2" --body "..."` — create when discovering new work

Labels: `api`, `frontend`, `infra`, `security`, `observability`, `testing`, `enhancement`, `decision`, `plant-database`, `github_actions`

When starting a task, check if there's already an issue for it. When finishing, close the issue with a comment explaining what was done.
