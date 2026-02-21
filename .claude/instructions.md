## Before Starting Work

- Read relevant specs in the `specs/` directory before implementing
- Check existing code for patterns to follow — stay consistent with what's already there
- Pull latest main before creating a feature branch

## Workflow Rules

Before pushing any branch or opening a PR:

1. Run `pnpm format:check`, `pnpm lint --force`, `pnpm typecheck`, `pnpm test:unit`, and `pnpm lint:secrets`
2. If any fail, fix the errors (`pnpm format` auto-fixes formatting) and re-run
3. Keep iterating until all five pass clean
4. Commit your changes
5. Push the branch and open a PR
6. After pushing, monitor CI with `gh run watch`. If CI fails, pull the logs, fix the issue, push again, and repeat until CI is green.
7. Once CI passes, squash merge the PR: `gh pr merge --squash --delete-branch`
8. Close the corresponding GitHub issue: `gh issue close <number> --comment "Completed in PR #<pr-number>"`

Never push code with known failing tests.
Use `--force` on lint to bypass Turborepo cache and catch all errors.

## Branch Naming

- Feature: `feat/short-description`
- Fix: `fix/short-description`
- Infra: `infra/short-description`

## Commit Messages

Use conventional commits: `type(scope): description`

- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `infra`
- Scopes: `api`, `web`, `shared`, `infra`

## PR Descriptions

- Include a summary of changes and a test plan listing what was verified locally
- Do not include a CI checkbox — branch protection enforces CI passing before merge

## Code Standards

- All inputs validated with Zod schemas from `packages/shared` — never trust raw input
- Use existing schemas and types from `packages/shared` — don't redefine what already exists
- No `as any`, no type assertions bypassing validation
- Secrets come from Secrets Manager via the AWS SDK — never environment variables or hardcoded values
- PII (addresses, emails) must be redacted in logs
- No `eval`, no `dangerouslySetInnerHTML`, no `innerHTML`

## Testing

- Unit tests colocated with source files or in `__tests__` directories
- Mock external services (Claude API, DynamoDB, S3) in tests
- Test both success and error paths
- Validate API responses against Zod schemas in tests

## Deploying

Before running `cdk synth` or `cdk deploy`, build the Sharp Lambda Layer:

```sh
bash infra/layers/sharp/build.sh
```

This populates `infra/layers/sharp/nodejs/` with the ARM64 sharp binaries needed by the Worker Lambda. The layer only needs rebuilding when the sharp version changes.

## Datadog MCP

If DD_API_KEY and DD_APP_KEY are set in .env, the Datadog MCP server is available.
Query logs: get_logs with query `service:landscape-architect @analysisId:<id>`
Setup: populate DD_API_KEY and DD_APP_KEY in .env, then restart Claude Code.

## Debugging Deployed Services

When fixing Lambda or API issues:

1. Check Lambda logs: `aws logs tail /aws/lambda/FUNCTION_NAME --since 10m --format short`
2. List Lambda functions: `aws lambda list-functions --query 'Functions[?contains(FunctionName, `LandscapeArchitect`)].FunctionName' --output text`
3. Test API endpoints directly with curl
4. Check stack outputs: `aws cloudformation describe-stacks --stack-name STACK_NAME --query 'Stacks[0].Outputs'`
5. After deploying a fix, verify the Lambda starts and the endpoint responds before opening a PR

## Task Tracking

Before starting work, check for a relevant GitHub issue:

```sh
gh issue list --state open
```

When work is done, close the issue with context:

```sh
gh issue close <number> --comment "Completed in PR #<pr>. Changes: <brief summary>"
```

When you discover work that isn't tracked, create an issue:

```sh
gh issue create --title "Short descriptive title" --label "relevant,labels" --body "Description"
```

Don't create issues for trivial fixes included in a larger task.
