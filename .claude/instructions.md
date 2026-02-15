## Workflow Rules

Before pushing any branch or opening a PR:

1. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`
2. If any fail, fix the errors (`pnpm format` auto-fixes formatting) and re-run
3. Keep iterating until all four pass clean
4. Only then commit, push, and open the PR
5. After pushing, monitor CI. If CI fails, pull the logs, fix the issue, push again, and repeat until CI is green.
6. Once CI passes, squash merge the PR: `gh pr merge --squash --delete-branch`

Never push code with known failing tests.

## Debugging Deployed Services

When fixing Lambda or API issues:

1. Check Lambda logs: `aws logs tail /aws/lambda/FUNCTION_NAME --since 10m --format short`
2. List Lambda functions: `aws lambda list-functions --query 'Functions[?contains(FunctionName, `LandscapeArchitect`)].FunctionName' --output text`
3. Test API endpoints: `curl -s https://CLOUDFRONT_URL/api/v1/zones/22903`
4. Check stack outputs: `aws cloudformation describe-stacks --stack-name STACK_NAME --query 'Stacks[0].Outputs'`
5. After deploying a fix, verify the Lambda starts and the endpoint responds before opening a PR.

## Verifying Deployments

After deploying, verify it works end-to-end:

1. Run a quick smoke test: `curl -s -o /dev/null -w '%{http_code}' https://d2jp0cpr1bn6fp.cloudfront.net/api/v1/zones/22903`
2. For API-only issues, use curl to test endpoints directly
3. For frontend issues, use Playwright against the deployed dev URL

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
