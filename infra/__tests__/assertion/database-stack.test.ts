import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../../lib/stacks/database-stack.js';

describe('DatabaseStack', () => {
  const app = new App();
  const stack = new DatabaseStack(app, 'TestDatabase', {
    stage: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('uses on-demand billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('has PK/SK key schema', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: 'PK', KeyType: 'HASH' }),
        Match.objectLike({ AttributeName: 'SK', KeyType: 'RANGE' }),
      ]),
    });
  });

  it('has GSI1', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'GSI1',
          KeySchema: Match.arrayWith([
            Match.objectLike({ AttributeName: 'GSI1PK', KeyType: 'HASH' }),
            Match.objectLike({ AttributeName: 'GSI1SK', KeyType: 'RANGE' }),
          ]),
        }),
      ]),
    });
  });

  it('enables point-in-time recovery', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('uses AWS-managed encryption', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('tags resources with project and stage', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
        Match.objectLike({ Key: 'Stage', Value: 'dev' }),
      ]),
    });
  });
});
