# ADR-003: Deferred VPC / Network Security

## Status

Accepted

## Date

2026-02-14

## Context

The security spec (specs/architecture/security.spec.md) calls for a VPC with private subnets, NAT Gateways, and WAF. However, the application currently has no user data, no database, and no production traffic. A NAT Gateway alone costs ~$32/month and provides no value until Lambda functions need to connect to resources inside a VPC (such as an RDS database).

We need to balance security posture against cost and complexity for a pre-launch, solo-developer project.

## Decision

**Defer VPC, NAT Gateway, and WAF until user data exists.** Deploy Lambda functions without a VPC for now.

### What we defer (costs money, no current value):

- VPC with public/private/isolated subnets
- NAT Gateway ($32/month)
- WAF rules ($5/month + per-request)
- RDS in isolated subnets (no database yet)

### What we keep (free, always valuable):

- S3 buckets: block all public access, SSE encryption, enforce SSL
- IAM: least-privilege roles, no wildcard permissions
- Secrets Manager: for all API keys and credentials (never env vars)
- CloudTrail: audit logging
- GitHub: secret scanning, push protection, Dependabot
- CI: security gates (audit, secretlint, trivy, license check)

### Trigger to upgrade:

Deploy the VPC and network security layer BEFORE any of the following ship to production:

- [ ] User authentication (Cognito)
- [ ] User photo uploads (S3 with user-owned objects)
- [ ] User address/PII storage (database)
- [ ] Payment processing

This is a hard gate — the upgrade is a prerequisite for user-facing features, not a follow-up task.

## Consequences

### Positive

- Saves ~$37/month during pre-launch development
- Simpler infrastructure to debug and iterate on
- Faster CDK deployments (fewer resources)
- No idle resources burning money

### Negative

- Lambda functions run on AWS's public managed network, not in a private subnet
- If we forget the trigger conditions, user data could ship without network isolation
- Retrofitting Lambda into a VPC requires a deploy that may cause brief cold-start latency increases

### Mitigations

- This ADR documents the explicit trigger conditions
- The yard-photo-analysis feature spec already references the security spec, which will flag the VPC requirement during implementation
- Free security controls (encryption, IAM, secrets, audit logging) remain fully enforced
