import { CfnOutput, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface ObservabilityStackProps extends StackProps {
  stage: string;
}

export class ObservabilityStack extends Stack {
  public readonly ddApiKeySecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const ddApiKeySecret = new secretsmanager.Secret(this, 'DatadogApiKey', {
      secretName: `LandscapeArchitect/${props.stage}/datadog-api-key`,
      description: 'Datadog API key for Lambda Extension log shipping',
    });

    this.ddApiKeySecret = ddApiKeySecret;

    new CfnOutput(this, 'DatadogApiKeySecretArn', {
      value: ddApiKeySecret.secretArn,
      exportName: `${this.stackName}-DatadogApiKeySecretArn`,
    });

    Tags.of(this).add('Project', 'LandscapeArchitect');
    Tags.of(this).add('Stage', props.stage);
  }
}
