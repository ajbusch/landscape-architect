#!/usr/bin/env node
import 'source-map-support/register.js';
import { App } from 'aws-cdk-lib';
import { CloudTrailStack } from '../lib/stacks/cloudtrail-stack.js';
import { GitHubOidcStack } from '../lib/stacks/github-oidc-stack.js';
import { NetworkStack } from '../lib/stacks/network-stack.js';

const app = new App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';

new NetworkStack(app, `LandscapeArchitect-Network-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

new CloudTrailStack(app, `LandscapeArchitect-CloudTrail-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

new GitHubOidcStack(app, 'LandscapeArchitect-GitHubOidc', {
  repositorySlug: 'ajbusch/landscape-architect',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

app.synth();
