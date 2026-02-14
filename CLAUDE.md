# Landscape Architect

## Project Structure

pnpm monorepo managed by Turborepo.

- `apps/web` — React SPA (Vite, Tailwind, Shadcn)
- `apps/api` — Fastify REST API (DynamoDB, S3, Anthropic Vision)
- `packages/shared` — Shared Zod schemas, types, constants
- `infra` — AWS CDK infrastructure (TypeScript)

## Pre-commit Checks

Before committing, run these checks to match CI:

```sh
pnpm lint
pnpm typecheck
pnpm format:check   # fix with: pnpm format
pnpm test:unit
```

All four must pass. CI also runs `pnpm test:contract`, `pnpm test:integration`, and `pnpm format:check`.

## Code Style

- Prettier enforces formatting (see `.prettierrc`). Run `pnpm format` to auto-fix.
- ESLint per-package. Run `pnpm lint` (all) or `pnpm --filter <pkg> lint`.
- Strict TypeScript — `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`.

## Testing

- Unit tests: `pnpm test:unit` (Vitest across all packages)
- Contract tests: `pnpm test:contract`
- Integration tests: `pnpm test:integration` (requires PostgreSQL)
- E2E tests: `pnpm test:e2e` (Playwright, requires running app)
- CDK assertion tests live in `infra/__tests__/assertion/`

## Infrastructure (CDK)

Stacks in `infra/lib/stacks/`. Each stack follows the pattern:
- Interface extending `StackProps` with a `stage` prop
- Tags: `Project=LandscapeArchitect`, `Stage={stage}`
- Cross-stack values shared via `CfnOutput` with `exportName`

Deploy: `cd infra && npx cdk deploy --all -c stage=dev`
Synth:  `cd infra && npx cdk synth`

## Key Conventions

- Package names: `@landscape-architect/{web,api,shared,infra}`
- Filter commands: `pnpm --filter @landscape-architect/api <cmd>`
- Node.js >= 20, pnpm 9.x
