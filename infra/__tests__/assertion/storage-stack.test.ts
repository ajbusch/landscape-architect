import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../../lib/stacks/storage-stack.js';

describe('StorageStack', () => {
  const app = new App();
  const stack = new StorageStack(app, 'TestStorage', {
    stage: 'dev',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('blocks public access on the S3 bucket', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('encrypts the S3 bucket', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          }),
        ]),
      }),
    });
  });

  it('enforces SSL on the bucket', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: {
              Bool: { 'aws:SecureTransport': 'false' },
            },
          }),
        ]),
      }),
    });
  });

  it('has lifecycle rule for anonymous prefix with 1-day expiration', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: Match.objectLike({
        Rules: Match.arrayWith([
          Match.objectLike({
            Prefix: 'photos/anonymous/',
            ExpirationInDays: 1,
            Status: 'Enabled',
          }),
        ]),
      }),
    });
  });

  it('has CORS configured', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: Match.objectLike({
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: Match.arrayWith(['GET', 'PUT', 'POST']),
            AllowedOrigins: Match.arrayWith([
              'https://d2jp0cpr1bn6fp.cloudfront.net',
              'https://d3734vo7rulmf3.cloudfront.net',
              'https://d5hj1rpwk1mpl.cloudfront.net',
              'https://dev.landscaper.cloud',
              'https://staging.landscaper.cloud',
              'https://landscaper.cloud',
              'http://localhost:5173',
              'http://localhost:3000',
            ]),
            AllowedHeaders: Match.arrayWith([
              'Content-Type',
              'x-amz-content-sha256',
              'x-amz-server-side-encryption',
            ]),
            ExposedHeaders: ['ETag'],
          }),
        ]),
      }),
    });
  });

  it('creates a Secrets Manager secret', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  it('tags resources with project and stage', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'LandscapeArchitect' }),
        Match.objectLike({ Key: 'Stage', Value: 'dev' }),
      ]),
    });
  });
});
