import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FrontendStack } from '../../lib/stacks/frontend-stack.js';

const webAssetPath = mkdtempSync(join(tmpdir(), 'web-dist-'));
writeFileSync(join(webAssetPath, 'index.html'), '<html></html>');

describe('FrontendStack', () => {
  const app = new App();
  const stack = new FrontendStack(app, 'TestFrontend', {
    stage: 'dev',
    apiUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com/',
    domainName: 'dev.landscaper.cloud',
    hostedZoneId: 'Z1234567890ABC',
    certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/test-cert-id',
    webAssetPath,
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('creates an S3 bucket with blocked public access', () => {
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

  it('creates a CloudFront distribution', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('configures default root object as index.html', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
    });
  });

  it('redirects HTTP to HTTPS', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  it('has custom error responses for SPA routing', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
      }),
    });
  });

  it('has an /api/* cache behavior', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/api/*',
            ViewerProtocolPolicy: 'redirect-to-https',
            AllowedMethods: Match.arrayWith([
              'GET',
              'HEAD',
              'OPTIONS',
              'PUT',
              'PATCH',
              'POST',
              'DELETE',
            ]),
          }),
        ]),
      }),
    });
  });

  it('uses OAC for S3 origin', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('has an alternate domain name on CloudFront', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['dev.landscaper.cloud'],
      }),
    });
  });

  it('has an ACM certificate attached to CloudFront', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/test-cert-id',
          SslSupportMethod: 'sni-only',
        }),
      }),
    });
  });

  it('creates a Route 53 A record', () => {
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'A',
      Name: 'dev.landscaper.cloud.',
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue(),
      }),
    });
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

describe('FrontendStack with origin-verify secret', () => {
  const app = new App();

  const secretStack = new Stack(app, 'TestSecretStackFe', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const mockSecret = new secretsmanager.Secret(secretStack, 'MockOriginVerifySecret');

  const stack = new FrontendStack(app, 'TestFrontendWithSecret', {
    stage: 'dev',
    apiUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com/',
    domainName: 'dev.landscaper.cloud',
    hostedZoneId: 'Z1234567890ABC',
    certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/test-cert-id',
    webAssetPath,
    originVerifySecret: mockSecret,
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('adds X-Origin-Verify custom header to API origin', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            DomainName: Match.stringLikeRegexp('execute-api'),
            OriginCustomHeaders: Match.arrayWith([
              Match.objectLike({
                HeaderName: 'X-Origin-Verify',
                HeaderValue: Match.anyValue(),
              }),
            ]),
          }),
        ]),
      }),
    });
  });
});
