# ADR-002: Security Architecture

## Status

Accepted

## Date

2026-02-14

## Context

Landscape Architect handles user photos, addresses (PII), and payment data (future). We need a security posture that protects user data, prevents abuse, and meets the expectations of a consumer application — without slowing development to a crawl.

## Decision

We adopt a defense-in-depth strategy with security controls at every layer:

1. GitHub layer: Branch protection, CODEOWNERS, secret scanning + push protection, Dependabot
2. Code layer: ESLint security plugin, strict TypeScript, banned patterns, Zod validation on all inputs
3. CI layer: npm audit, secretlint, trivy, license compliance — all as required checks
4. Infrastructure layer: Least-privilege IAM, encrypted S3/RDS, WAF, private VPC subnets
5. Runtime layer: JWT auth via Cognito, resource-owner authorization in middleware, rate limiting, PII redaction in logs
6. Operational layer: CloudWatch alarms, CloudTrail audit logs, incident response playbook

The full threat model and controls are documented in specs/architecture/security.spec.md.

## Consequences

### Positive

- Security is enforced automatically (CI gates, ESLint rules) — not dependent on human vigilance
- Threat model exists as a living document that guides all feature development
- Defense-in-depth means a failure at one layer doesn't compromise the system

### Negative

- CI pipeline is slightly slower due to additional security scans (~30-60 seconds)
- Some false positives from eslint-plugin-security require triage

### Neutral

- Security spec must be maintained as the application evolves
