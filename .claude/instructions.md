## Workflow Rules

Before pushing any branch or opening a PR:

1. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`
2. If any fail, fix the errors (`pnpm format` auto-fixes formatting) and re-run
3. Keep iterating until all four pass clean
4. Only then commit, push, and open the PR
5. After pushing, monitor CI. If CI fails, pull the logs, fix the issue, push again, and repeat until CI is green.
6. Once CI passes, squash merge the PR: `gh pr merge --squash --delete-branch`

Never push code with known failing tests.

## Code Standards

- All inputs validated with Zod schemas from packages/shared — never trust raw input
- Use existing schemas and types — don't redefine what's already in packages/shared
- No `as any`, no type assertions bypassing validation
- Secrets come from Secrets Manager — never environment variables or hardcoded values
- PII (addresses, emails) must be redacted in logs

## Branch Naming

- Feature: `feat/short-description`
- Fix: `fix/short-description`
- Infra: `infra/short-description`

## Before Starting Work

- Read relevant specs in the specs/ directory before implementing
- Check existing code for patterns to follow — stay consistent with what's already there
