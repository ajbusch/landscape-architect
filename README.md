# Landscape Architect

A web application built with TypeScript, React, Fastify, AWS CDK, and GitHub Actions.

## Prerequisites (WSL / Ubuntu)

```bash
# Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install    # reads .nvmrc

# pnpm
corepack enable
corepack prepare pnpm@9 --activate

# Docker (for integration tests)
# Ensure Docker Desktop WSL 2 backend is enabled, or install Docker Engine in WSL

# AWS CDK CLI (optional — only needed for infrastructure work)
pnpm add -g aws-cdk
```

## Getting Started

```bash
# Install all dependencies
pnpm install

# Run all quality checks
pnpm lint
pnpm typecheck
pnpm test

# Start local development (API on :3001, Web on :3000)
pnpm dev

# Run specific test suites
pnpm test:unit          # Unit tests only
pnpm test:integration   # Integration tests (requires Docker)
pnpm test:contract      # API contract tests
pnpm test:e2e           # Playwright E2E tests
```

## Infrastructure

The `infra/` directory contains AWS CDK stacks:

- **NetworkStack** — VPC with public, private, and isolated subnets
- **CloudTrailStack** — Account-wide audit logging
- **GitHubOidcStack** — GitHub Actions OIDC deploy role for CI/CD

## Project Structure

```
apps/
  api/          → Fastify backend API
  web/          → React SPA (Vite)
packages/
  shared/       → Zod schemas, types, constants (shared between api & web)
infra/          → AWS CDK infrastructure
specs/          → Feature specifications & ADRs
```

## Development Workflow

1. Write a **spec** in `specs/`
2. Define **Zod schemas** in `packages/shared`
3. Write **failing tests**
4. **Implement** until tests pass
5. Open a **PR** → CI runs all quality gates
6. Merge → auto-deploys through dev → staging → production

See [ADR-001](specs/architecture/decisions/001-architecture-overview.md) for full architecture details.
