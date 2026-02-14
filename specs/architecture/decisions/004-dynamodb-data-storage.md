# ADR-004: DynamoDB for Data Storage

## Status

Accepted

## Date

2026-02-14

## Context

We need a database for the plant catalog (~500 plants, read-heavy, rarely updated) and eventually for user data (analyses, accounts). We have deferred VPC deployment (ADR-003), which rules out RDS without a publicly accessible endpoint. We want minimal cost and zero infrastructure management.

## Decision

Use **DynamoDB** as the primary data store for all application data.

### Table Design (Single-Table)

We use a single-table design with composite keys to support multiple entity types:

| Entity            | PK                  | SK              | Access Patterns                  |
| ----------------- | ------------------- | --------------- | -------------------------------- |
| Plant             | `PLANT#<id>`        | `PLANT#<id>`    | Get plant by ID                  |
| Plant by type     | `PLANT_TYPE#<type>` | `PLANT#<id>`    | List all trees, shrubs, etc.     |
| Plant by zone     | `ZONE#<zone>`       | `PLANT#<id>`    | List plants for a hardiness zone |
| Analysis          | `USER#<userId>`     | `ANALYSIS#<id>` | Get user's analyses              |
| Analysis (unauth) | `ANON#<sessionId>`  | `ANALYSIS#<id>` | Ephemeral analysis               |
| Zone lookup       | `ZIP#<zipCode>`     | `ZIP#<zipCode>` | ZIP to zone resolution           |

### GSI (Global Secondary Index)

- **GSI1**: For reverse lookups (e.g., all analyses for a plant, search by name)
  - GSI1PK / GSI1SK — defined per entity as needed

### Capacity Mode

- **On-demand (pay-per-request)** — no provisioned capacity, scales to zero
- Free tier: 25 read/write capacity units per second, perpetual
- At our scale (~500 plants, <100 users initially), cost will be effectively $0

## Consequences

### Positive

- Zero cost at low traffic (free tier is perpetual, not 12-month limited)
- No VPC required — Lambda accesses DynamoDB over AWS internal network
- No instance management — no patching, scaling, or monitoring a database server
- Single-table design keeps all related data together, fast lookups
- Scales automatically if the app takes off

### Negative

- Complex ad-hoc queries require careful index planning upfront
- No joins — denormalization required for cross-entity queries
- Single-table design has a learning curve and is harder to debug visually
- Migration to RDS later would be a significant effort (but unlikely to be needed)

### Neutral

- DynamoDB is eventually consistent by default; strongly consistent reads available at 2x cost
- Plant data reads can use eventual consistency (data rarely changes)
- User data reads (like "get my analysis") should use strongly consistent reads
