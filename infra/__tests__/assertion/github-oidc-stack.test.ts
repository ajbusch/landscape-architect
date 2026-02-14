import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GitHubOidcStack } from '../../lib/stacks/github-oidc-stack.js';

describe('GitHubOidcStack', () => {
  const app = new App();
  const stack = new GitHubOidcStack(app, 'TestGitHubOidc', {
    repositorySlug: 'ajbusch/landscape-architect',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('does not create an OIDC provider (imports existing)', () => {
    template.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
  });

  it('creates exactly one IAM role', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
  });

  it('scopes the trust policy to the repository', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: Match.objectLike({
                'token.actions.githubusercontent.com:sub': 'repo:ajbusch/landscape-architect:*',
              }),
            }),
          }),
        ]),
      }),
    });
  });

  it('tags resources with project', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Tags: Match.arrayWith([Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' })]),
    });
  });
});
