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

  it('creates a Lambda function', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  it('configures 512MB memory and 30s timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Timeout: 30,
    });
  });

  it('uses Node.js 20 ARM64 runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Architectures: ['arm64'],
    });
  });

  it('sets required environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          STAGE: 'dev',
          CLAUDE_MODEL: 'claude-sonnet-4-20250514',
        }),
      },
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
