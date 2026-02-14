import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface StorageStackProps extends StackProps {
  stage: string;
}

export class StorageStack extends Stack {
  public readonly bucket: s3.IBucket;
  public readonly anthropicApiKeySecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';
    const frontendOrigin = isProd ? 'https://landscapearchitect.app' : 'http://localhost:5173';

    const bucket = new s3.Bucket(this, 'PhotoBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: [frontendOrigin],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
      lifecycleRules: [{ prefix: 'anonymous/', expiration: Duration.days(1) }],
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const anthropicApiKeySecret = new secretsmanager.Secret(this, 'AnthropicApiKey', {
      secretName: `LandscapeArchitect/${props.stage}/AnthropicApiKey`,
      description: 'Anthropic API key for yard photo analysis',
    });

    this.bucket = bucket;
    this.anthropicApiKeySecret = anthropicApiKeySecret;

    new CfnOutput(this, 'PhotoBucketName', {
      value: bucket.bucketName,
      description: 'Name of the photo upload S3 bucket',
    });

    new CfnOutput(this, 'AnthropicApiKeySecretArn', {
      value: anthropicApiKeySecret.secretArn,
      description: 'ARN of the Anthropic API key secret',
    });

    Tags.of(this).add('Project', 'LandscapeArchitect');
    Tags.of(this).add('Stage', props.stage);
  }
}
