# Feature: [Name]

## Status
[Draft | In Review | Approved | Implemented]

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
- Endpoint: `METHOD /api/v1/resource`
- Request schema: `SchemaName` (ref: packages/shared/schemas)
- Response schema: `ResponseSchemaName`
- Error cases: 400 (validation), 401 (auth), 409 (conflict), 500

## Acceptance Criteria

```gherkin
Given [precondition]
When [action]
Then [expected result]
```

## Edge Cases & Error Scenarios
- What happens when [boundary condition]?
- What happens when [dependency fails]?

## Security Considerations
- Authentication required: Yes/No
- Authorization model: [RBAC/ABAC/resource-owner]
- Input validation: [reference Zod schema]

## Open Questions
- [ ] TBD items
