import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ObservabilityStack } from '../../lib/stacks/observability-stack.js';

describe('ObservabilityStack', () => {
  const app = new App();
  const stack = new ObservabilityStack(app, 'TestObservability', {
    stage: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates a Secrets Manager secret with correct name pattern', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'LandscapeArchitect/dev/datadog-api-key',
    });
  });

  it('exports the secret ARN via CfnOutput', () => {
    template.hasOutput('DatadogApiKeySecretArn', {
      Export: {
        Name: 'TestObservability-DatadogApiKeySecretArn',
      },
    });
  });

  it('tags resources with project and stage', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
        Match.objectLike({ Key: 'Stage', Value: 'dev' }),
      ]),
    });
  });
});
