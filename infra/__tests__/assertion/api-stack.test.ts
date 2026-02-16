import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../../lib/stacks/api-stack.js';

describe('ApiStack', () => {
  const app = new App();
  const stack = new ApiStack(app, 'TestApi', {
    stage: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates two Lambda functions (API + Worker)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  describe('API Lambda', () => {
    it('configures 512MB memory and 30s timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
        Timeout: 30,
        Handler: 'index.lambdaHandler',
      });
    });

    it('has WORKER_FUNCTION_NAME and STAGE env vars', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.lambdaHandler',
        Environment: {
          Variables: Match.objectLike({
            STAGE: 'dev',
          }),
        },
      });
    });
  });

  describe('Worker Lambda', () => {
    it('configures 1024MB memory and 120s timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 1024,
        Timeout: 120,
        Handler: 'index.handler',
      });
    });

    it('has CLAUDE_MODEL env var', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Environment: {
          Variables: Match.objectLike({
            CLAUDE_MODEL: 'claude-sonnet-4-20250514',
          }),
        },
      });
    });
  });

  it('uses Node.js 20 ARM64 runtime for both', () => {
    // Both functions should use nodejs20.x and arm64
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Handler: 'index.lambdaHandler',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
      Handler: 'index.handler',
    });
  });

  it('creates an HTTP API Gateway', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
    });
  });

  it('has a catch-all route', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /{proxy+}',
    });
  });

  it('grants Lambda DynamoDB read/write access', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:BatchGetItem',
              'dynamodb:Query',
              'dynamodb:GetItem',
              'dynamodb:Scan',
              'dynamodb:BatchWriteItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
            ]),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });

  it('tags resources with project and stage', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
        Match.objectLike({ Key: 'Stage', Value: 'dev' }),
      ]),
    });
  });
});
