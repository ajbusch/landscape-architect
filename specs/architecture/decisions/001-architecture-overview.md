# ADR-001: Architecture Overview

## Status
Accepted

## Date
2026-02-13

## Context
We are building a web application (Landscape Architect) consisting of a user-facing SPA and a backend API. We need to decide on the overall architecture, technology stack, and deployment strategy.

## Decision
We will use a **TypeScript monorepo** with the following structure:

- **Frontend:** React 19 + Vite (SPA deployed to S3 + CloudFront)
- **Backend:** Fastify (Node.js, deployed as Lambda behind API Gateway)
- **Shared:** Zod schemas as the single source of truth for types and validation
- **Infrastructure:** AWS CDK (TypeScript) with isolated stacks
- **CI/CD:** GitHub Actions with OIDC authentication to AWS
- **Monorepo tooling:** Turborepo + pnpm workspaces

The spec-first, test-driven workflow is: **Spec → Schema → Tests (red) → Implement (green) → Deploy**.

## Consequences

### Positive
- Single language (TypeScript) across the entire stack reduces context switching
- Zod schemas shared between frontend and backend eliminate type drift
- CDK in TypeScript enables testing infrastructure with the same tools as application code
- GitHub Actions OIDC eliminates long-lived AWS credentials

### Negative
- Monorepo adds initial setup complexity
- CDK has a learning curve for those unfamiliar with AWS CloudFormation
- Spec-first workflow requires discipline to not skip directly to implementation

### Neutral
- Team must be comfortable with TypeScript across all layers
